/**
 * TFA Code Service
 *
 * Captures, stores, and retrieves 2FA codes from multiple sources:
 * SMS (via Twilio webhook), Email (via Gmail API), TOTP (stored secrets).
 */

import { getSupabaseClient } from "../utils/supabase.js";
import { getValidToken } from "./oauth-manager.js";

/**
 * Store a 2FA code received from any source.
 */
export async function storeTfaCode(
  userId: string,
  taskId: string | null,
  code: string,
  source: "sms" | "email" | "totp",
  siteDomain?: string
): Promise<void> {
  try {
    await getSupabaseClient().from("tfa_codes").insert({
      user_id: userId,
      task_id: taskId || null,
      code,
      source,
      site_domain: siteDomain || null,
      used: false,
    });
    console.log(`[TFA] Stored ${source} code for user (task: ${taskId || "none"})`);
  } catch (error) {
    console.error("[TFA] Failed to store code:", error);
  }
}

/**
 * Get the latest unused code for a user + site domain. Marks it as used.
 */
export async function getLatestCode(userId: string, siteDomain?: string): Promise<string | null> {
  try {
    const result = await getSupabaseClient().rpc("get_latest_tfa_code", {
      p_user_id: userId,
      p_site_domain: siteDomain || "",
    });
    return result.data || null;
  } catch {
    return null;
  }
}

/**
 * Get the latest unused code for a user (fallback when no task context).
 */
export async function getLatestCodeForUser(userId: string): Promise<string | null> {
  try {
    const { data } = await getSupabaseClient()
      .from("tfa_codes")
      .select("id, code")
      .eq("user_id", userId)
      .eq("used", false)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1);

    if (!data || data.length === 0) return null;

    // Mark as used
    await getSupabaseClient()
      .from("tfa_codes")
      .update({ used: true })
      .eq("id", data[0].id);

    return data[0].code;
  } catch {
    return null;
  }
}

/**
 * Generate a TOTP code from an encrypted secret.
 * Uses the HOTP/TOTP algorithm (RFC 6238).
 */
export async function generateTotpCode(
  encryptedSecret: string,
  userId: string
): Promise<string> {
  const { decryptWithServerKey } = await import("../security/encryption.js");
  const secret = await decryptWithServerKey(encryptedSecret);

  // Base32 decode the secret
  const base32Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits: number[] = [];
  for (const char of secret.toUpperCase().replace(/=+$/, "")) {
    const val = base32Chars.indexOf(char);
    if (val === -1) continue;
    for (let i = 4; i >= 0; i--) {
      bits.push((val >> i) & 1);
    }
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | bits[i * 8 + j];
    }
    bytes[i] = byte;
  }

  // TOTP: time step = 30s
  const time = Math.floor(Date.now() / 30000);
  const timeBuffer = Buffer.alloc(8);
  timeBuffer.writeUInt32BE(Math.floor(time / 0x100000000), 0);
  timeBuffer.writeUInt32BE(time & 0xffffffff, 4);

  const { createHmac } = await import("crypto");
  const hmac = createHmac("sha1", Buffer.from(bytes));
  hmac.update(timeBuffer);
  const hash = hmac.digest();

  const offset = hash[hash.length - 1] & 0xf;
  const code =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);

  return String(code % 1000000).padStart(6, "0");
}

/**
 * Try to extract a 2FA code from a user's Gmail inbox.
 * Searches recent emails for verification code patterns.
 */
export async function extractCodeFromGmail(
  userId: string,
  siteDomain: string
): Promise<string | null> {
  try {
    const token = await getValidToken(userId, "google");
    if (!token) return null;

    // Search for recent verification emails (last 5 minutes)
    const query = encodeURIComponent(
      `(verification OR code OR OTP OR "security code" OR "confirmation code") newer_than:5m`
    );

    const res = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=3`,
      { headers: { Authorization: `Bearer ${token.accessToken}` } }
    );

    if (!res.ok) return null;

    const data = await res.json();
    if (!data.messages || data.messages.length === 0) return null;

    // Check each message for a code
    for (const msg of data.messages) {
      const msgRes = await fetch(
        `https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
        { headers: { Authorization: `Bearer ${token.accessToken}` } }
      );

      if (!msgRes.ok) continue;

      const msgData = await msgRes.json();
      const snippet = msgData.snippet || "";

      // Extract 4-8 digit codes from snippet
      const codeMatch = snippet.match(/\b(\d{4,8})\b/);
      if (codeMatch) {
        return codeMatch[1];
      }
    }

    return null;
  } catch (error) {
    console.error("[TFA] Gmail extraction failed:", error);
    return null;
  }
}
