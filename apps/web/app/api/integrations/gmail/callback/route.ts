import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/encryption";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const REDIRECT_URI = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/gmail/callback`
  : "http://localhost:3000/api/integrations/gmail/callback";

/**
 * GET /api/integrations/gmail/callback — OAuth callback from Google
 * Exchanges auth code for tokens and stores encrypted in user_credentials.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      return NextResponse.redirect(
        new URL("/dashboard/settings?gmail=error", request.url)
      );
    }

    if (!code || !state) {
      return NextResponse.redirect(
        new URL("/dashboard/settings?gmail=missing", request.url)
      );
    }

    // Decode state to get user ID
    let stateData: { userId: string; ts: number };
    try {
      stateData = JSON.parse(
        Buffer.from(state, "base64url").toString("utf-8")
      );
    } catch {
      return NextResponse.redirect(
        new URL("/dashboard/settings?gmail=invalid", request.url)
      );
    }

    // Verify state is recent (within 10 minutes)
    if (Date.now() - stateData.ts > 600_000) {
      return NextResponse.redirect(
        new URL("/dashboard/settings?gmail=expired", request.url)
      );
    }

    // Verify the logged-in user matches the state
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || user.id !== stateData.userId) {
      return NextResponse.redirect(
        new URL("/dashboard/settings?gmail=unauthorized", request.url)
      );
    }

    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID!,
        client_secret: GOOGLE_CLIENT_SECRET!,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      console.error("[GMAIL] Token exchange failed:", await tokenRes.text());
      return NextResponse.redirect(
        new URL("/dashboard/settings?gmail=token_error", request.url)
      );
    }

    const tokens = await tokenRes.json();

    // Get user's Gmail address
    const profileRes = await fetch(
      "https://www.googleapis.com/gmail/v1/users/me/profile",
      {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      }
    );

    let gmailAddress = "";
    if (profileRes.ok) {
      const profile = await profileRes.json();
      gmailAddress = profile.emailAddress || "";
    }

    // Encrypt tokens before storage (FIX: was plaintext before)
    const accessTokenEncrypted = await encrypt(tokens.access_token);
    const refreshTokenEncrypted = tokens.refresh_token
      ? await encrypt(tokens.refresh_token)
      : null;

    const scopes = [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.modify",
    ];

    // Dual-write: new oauth_connections table (primary)
    await supabase.from("oauth_connections").upsert(
      {
        user_id: user.id,
        provider: "google",
        access_token_encrypted: accessTokenEncrypted,
        refresh_token_encrypted: refreshTokenEncrypted,
        expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        scopes,
        account_email: gmailAddress,
        status: "active",
      },
      { onConflict: "user_id,provider,account_email" }
    );

    // Backward compat: also write to user_credentials (encrypted)
    const tokenData = await encrypt(JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + tokens.expires_in * 1000,
      gmail_address: gmailAddress,
    }));

    await supabase.from("user_credentials").upsert(
      {
        user_id: user.id,
        site_domain: "gmail.googleapis.com",
        encrypted_data: tokenData,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,site_domain" }
    );

    return NextResponse.redirect(
      new URL("/dashboard/settings?gmail=connected", request.url)
    );
  } catch (err) {
    console.error("[GMAIL] Callback error:", err);
    return NextResponse.redirect(
      new URL("/dashboard/settings?gmail=error", request.url)
    );
  }
}
