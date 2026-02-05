/**
 * OAuth Token Manager
 *
 * Manages OAuth tokens lifecycle: retrieval, refresh, expiry checks.
 * Works with oauth_connections table for encrypted token storage.
 */

import { getSupabaseClient } from "../utils/supabase.js";
import { encryptWithServerKey, decryptWithServerKey } from "../security/encryption.js";

interface OAuthToken {
  accessToken: string;
  email: string;
}

/**
 * Get a valid OAuth token for a user + provider.
 * Automatically refreshes if expired.
 */
export async function getValidToken(
  userId: string,
  provider: string
): Promise<OAuthToken | null> {
  try {
    const { data: connections } = await getSupabaseClient()
      .from("oauth_connections")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", provider)
      .eq("status", "active")
      .limit(1);

    if (!connections || connections.length === 0) return null;

    const conn = connections[0];

    // Check if token is expired or expiring soon (5 min buffer)
    const expiresAt = conn.expires_at ? new Date(conn.expires_at).getTime() : Infinity;
    const isExpired = expiresAt < Date.now() + 5 * 60 * 1000;

    if (isExpired && conn.refresh_token_encrypted) {
      const refreshed = provider === "google"
        ? await refreshGoogleTokens(conn.id, conn.refresh_token_encrypted)
        : provider === "microsoft"
          ? await refreshMicrosoftTokens(conn.id, conn.refresh_token_encrypted)
          : false;

      if (!refreshed) {
        await getSupabaseClient()
          .from("oauth_connections")
          .update({ status: "expired" })
          .eq("id", conn.id);
        return null;
      }

      // Re-fetch the updated connection
      const { data: updated } = await getSupabaseClient()
        .from("oauth_connections")
        .select("*")
        .eq("id", conn.id)
        .single();

      if (!updated) return null;

      const accessToken = await decryptWithServerKey(updated.access_token_encrypted);
      return { accessToken, email: updated.account_email || "" };
    }

    const accessToken = await decryptWithServerKey(conn.access_token_encrypted);
    return { accessToken, email: conn.account_email || "" };
  } catch (error) {
    console.error(`[OAUTH] Failed to get token for ${provider}:`, error);
    return null;
  }
}

/**
 * Refresh Google OAuth tokens.
 */
async function refreshGoogleTokens(connectionId: string, refreshTokenEncrypted: string): Promise<boolean> {
  try {
    const refreshToken = await decryptWithServerKey(refreshTokenEncrypted);

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) {
      console.error("[OAUTH] Google refresh failed:", await res.text());
      return false;
    }

    const tokens = await res.json();
    const newAccessEncrypted = await encryptWithServerKey(tokens.access_token);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    await getSupabaseClient()
      .from("oauth_connections")
      .update({
        access_token_encrypted: newAccessEncrypted,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", connectionId);

    console.log("[OAUTH] Google tokens refreshed");
    return true;
  } catch (error) {
    console.error("[OAUTH] Google refresh error:", error);
    return false;
  }
}

/**
 * Refresh Microsoft OAuth tokens.
 */
async function refreshMicrosoftTokens(connectionId: string, refreshTokenEncrypted: string): Promise<boolean> {
  try {
    const refreshToken = await decryptWithServerKey(refreshTokenEncrypted);

    const res = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID || "",
        client_secret: process.env.MICROSOFT_CLIENT_SECRET || "",
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) {
      console.error("[OAUTH] Microsoft refresh failed:", await res.text());
      return false;
    }

    const tokens = await res.json();
    const newAccessEncrypted = await encryptWithServerKey(tokens.access_token);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // Microsoft also returns a new refresh token
    const updates: Record<string, unknown> = {
      access_token_encrypted: newAccessEncrypted,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    };

    if (tokens.refresh_token) {
      updates.refresh_token_encrypted = await encryptWithServerKey(tokens.refresh_token);
    }

    await getSupabaseClient()
      .from("oauth_connections")
      .update(updates)
      .eq("id", connectionId);

    console.log("[OAUTH] Microsoft tokens refreshed");
    return true;
  } catch (error) {
    console.error("[OAUTH] Microsoft refresh error:", error);
    return false;
  }
}

/**
 * Check and refresh all expiring tokens (called by scheduler hourly).
 */
export async function checkAndRefreshExpiring(): Promise<void> {
  try {
    const soon = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min from now

    const { data: expiring } = await getSupabaseClient()
      .from("oauth_connections")
      .select("id, provider, refresh_token_encrypted")
      .eq("status", "active")
      .lt("expires_at", soon)
      .not("refresh_token_encrypted", "is", null);

    if (!expiring || expiring.length === 0) return;

    console.log(`[OAUTH] Refreshing ${expiring.length} expiring tokens`);

    for (const conn of expiring) {
      if (conn.provider === "google") {
        await refreshGoogleTokens(conn.id, conn.refresh_token_encrypted);
      } else if (conn.provider === "microsoft") {
        await refreshMicrosoftTokens(conn.id, conn.refresh_token_encrypted);
      }
    }
  } catch (error) {
    console.error("[OAUTH] Token refresh check failed:", error);
  }
}
