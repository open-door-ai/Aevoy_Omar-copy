import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/encryption";

const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
const REDIRECT_URI = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/microsoft/callback`
  : "http://localhost:3000/api/integrations/microsoft/callback";

/**
 * GET /api/integrations/microsoft/callback — OAuth callback from Microsoft
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      return NextResponse.redirect(
        new URL("/dashboard/settings?microsoft=error", request.url)
      );
    }

    if (!code || !state) {
      return NextResponse.redirect(
        new URL("/dashboard/settings?microsoft=missing", request.url)
      );
    }

    let stateData: { userId: string; ts: number };
    try {
      stateData = JSON.parse(
        Buffer.from(state, "base64url").toString("utf-8")
      );
    } catch {
      return NextResponse.redirect(
        new URL("/dashboard/settings?microsoft=invalid", request.url)
      );
    }

    if (Date.now() - stateData.ts > 600_000) {
      return NextResponse.redirect(
        new URL("/dashboard/settings?microsoft=expired", request.url)
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || user.id !== stateData.userId) {
      return NextResponse.redirect(
        new URL("/dashboard/settings?microsoft=unauthorized", request.url)
      );
    }

    // Exchange code for tokens
    const tokenRes = await fetch(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: MICROSOFT_CLIENT_ID!,
          client_secret: MICROSOFT_CLIENT_SECRET!,
          redirect_uri: REDIRECT_URI,
          grant_type: "authorization_code",
        }),
      }
    );

    if (!tokenRes.ok) {
      console.error("[MSFT] Token exchange failed:", await tokenRes.text());
      return NextResponse.redirect(
        new URL("/dashboard/settings?microsoft=token_error", request.url)
      );
    }

    const tokens = await tokenRes.json();

    // Get user's email via Microsoft Graph
    let msEmail = "";
    try {
      const profileRes = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (profileRes.ok) {
        const profile = await profileRes.json();
        msEmail = profile.mail || profile.userPrincipalName || "";
      }
    } catch {
      // Non-critical
    }

    // Encrypt tokens before storage
    const accessTokenEncrypted = await encrypt(tokens.access_token);
    const refreshTokenEncrypted = tokens.refresh_token
      ? await encrypt(tokens.refresh_token)
      : null;

    const scopes = [
      "Mail.Read",
      "Mail.Send",
      "Calendars.ReadWrite",
      "Files.ReadWrite",
      "User.Read",
      "offline_access",
    ];

    // Write to oauth_connections
    await supabase.from("oauth_connections").upsert(
      {
        user_id: user.id,
        provider: "microsoft",
        access_token_encrypted: accessTokenEncrypted,
        refresh_token_encrypted: refreshTokenEncrypted,
        expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        scopes,
        account_email: msEmail,
        status: "active",
      },
      { onConflict: "user_id,provider,account_email" }
    );

    return NextResponse.redirect(
      new URL("/dashboard/settings?microsoft=connected", request.url)
    );
  } catch (err) {
    console.error("[MSFT] Callback error:", err);
    return NextResponse.redirect(
      new URL("/dashboard/settings?microsoft=error", request.url)
    );
  }
}
