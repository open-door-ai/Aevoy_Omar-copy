import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/encryption";

const FITBIT_CLIENT_ID = process.env.FITBIT_CLIENT_ID;
const FITBIT_CLIENT_SECRET = process.env.FITBIT_CLIENT_SECRET;
const REDIRECT_URI = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/fitbit/callback`
  : "http://localhost:3000/api/integrations/fitbit/callback";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

/**
 * GET /api/integrations/fitbit/callback — Fitbit OAuth callback
 * Exchanges authorization code for tokens, stores them, and triggers initial sync.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      return NextResponse.redirect(
        new URL("/dashboard/apps?tab=health&fitbit=error", APP_URL)
      );
    }

    if (!code || !state) {
      return NextResponse.redirect(
        new URL("/dashboard/apps?tab=health&fitbit=missing", APP_URL)
      );
    }

    // Decode and validate state param
    let stateData: { userId: string; ts: number };
    try {
      stateData = JSON.parse(
        Buffer.from(state, "base64url").toString("utf-8")
      );
    } catch {
      return NextResponse.redirect(
        new URL("/dashboard/apps?tab=health&fitbit=invalid_state", APP_URL)
      );
    }

    // Reject stale states (older than 10 minutes)
    if (Date.now() - stateData.ts > 600_000) {
      return NextResponse.redirect(
        new URL("/dashboard/apps?tab=health&fitbit=expired", APP_URL)
      );
    }

    // Verify the logged-in user matches the state
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || user.id !== stateData.userId) {
      return NextResponse.redirect(
        new URL("/dashboard/apps?tab=health&fitbit=unauthorized", APP_URL)
      );
    }

    if (!FITBIT_CLIENT_ID || !FITBIT_CLIENT_SECRET) {
      return NextResponse.redirect(
        new URL("/dashboard/apps?tab=health&fitbit=not_configured", APP_URL)
      );
    }

    // Exchange authorization code for access + refresh tokens
    const basicAuth = Buffer.from(
      `${FITBIT_CLIENT_ID}:${FITBIT_CLIENT_SECRET}`
    ).toString("base64");

    const tokenRes = await fetch("https://api.fitbit.com/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });

    if (!tokenRes.ok) {
      console.error(`[FITBIT] Token exchange failed: HTTP ${tokenRes.status}`);
      return NextResponse.redirect(
        new URL("/dashboard/apps?tab=health&fitbit=token_error", APP_URL)
      );
    }

    const tokens = await tokenRes.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      scope: string;
      user_id?: string;
    };

    // Fetch Fitbit user profile for display name
    const profileRes = await fetch(
      "https://api.fitbit.com/1/user/-/profile.json",
      {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      }
    );

    let displayName = "Fitbit User";
    if (profileRes.ok) {
      const profileData = await profileRes.json() as {
        user?: { displayName?: string; encodedId?: string };
      };
      displayName =
        profileData.user?.displayName ||
        profileData.user?.encodedId ||
        "Fitbit User";
    }

    // Encrypt tokens at rest
    const accessTokenEncrypted = await encrypt(tokens.access_token);
    const refreshTokenEncrypted = tokens.refresh_token
      ? await encrypt(tokens.refresh_token)
      : null;

    const expiresAt = new Date(
      Date.now() + (tokens.expires_in || 28800) * 1000
    ).toISOString();

    // Revoke any existing active Fitbit connections for this user
    await supabase
      .from("oauth_connections")
      .update({ status: "revoked" })
      .eq("user_id", user.id)
      .eq("provider", "fitbit")
      .eq("status", "active");

    // Upsert new Fitbit connection
    const { error: insertError } = await supabase
      .from("oauth_connections")
      .insert({
        user_id: user.id,
        provider: "fitbit",
        access_token: accessTokenEncrypted,
        refresh_token: refreshTokenEncrypted,
        status: "active",
        expires_at: expiresAt,
        account_email: displayName,
        scopes: "heartrate sleep activity weight oxygen_saturation",
      });

    if (insertError) {
      console.error("[FITBIT] oauth_connections insert error:", insertError);
      return NextResponse.redirect(
        new URL("/dashboard/apps?tab=health&fitbit=db_error", APP_URL)
      );
    }

    // Trigger initial Fitbit sync (best-effort — don't block the redirect)
    try {
      const syncUrl = `${APP_URL}/api/health/sync`;
      fetch(syncUrl, {
        method: "POST",
        headers: {
          // Pass session cookies so the route can auth via Supabase
          Cookie: request.headers.get("cookie") || "",
        },
      }).catch((err) =>
        console.error("[FITBIT] Initial sync fetch error:", err)
      );
    } catch {
      // Non-fatal — user can manually trigger sync from dashboard
    }

    return NextResponse.redirect(
      new URL("/dashboard/apps?tab=health&connected=fitbit", APP_URL)
    );
  } catch (err) {
    console.error("[FITBIT] Callback error:", err);
    return NextResponse.redirect(
      new URL("/dashboard/apps?tab=health&fitbit=error", APP_URL)
    );
  }
}
