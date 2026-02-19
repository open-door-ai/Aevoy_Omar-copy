import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/encryption";

const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID;
const TWITTER_CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET;
const REDIRECT_URI = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/twitter/callback`
  : "http://localhost:3000/api/integrations/twitter/callback";

/**
 * GET /api/integrations/twitter/callback — OAuth 2.0 callback from Twitter
 * Exchanges auth code + PKCE verifier for tokens, stores encrypted in oauth_connections.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      return NextResponse.redirect(
        new URL("/dashboard/apps?twitter=error", request.url)
      );
    }

    if (!code || !state) {
      return NextResponse.redirect(
        new URL("/dashboard/apps?twitter=missing", request.url)
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
        new URL("/dashboard/apps?twitter=invalid", request.url)
      );
    }

    // Verify state is recent (within 10 minutes)
    if (Date.now() - stateData.ts > 600_000) {
      return NextResponse.redirect(
        new URL("/dashboard/apps?twitter=expired", request.url)
      );
    }

    // Verify the logged-in user matches the state
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || user.id !== stateData.userId) {
      return NextResponse.redirect(
        new URL("/dashboard/apps?twitter=unauthorized", request.url)
      );
    }

    // Retrieve PKCE code_verifier from cookie
    const cookieStore = await cookies();
    const codeVerifier = cookieStore.get("twitter_code_verifier")?.value;

    if (!codeVerifier) {
      return NextResponse.redirect(
        new URL("/dashboard/apps?twitter=missing_verifier", request.url)
      );
    }

    // Exchange code + verifier for tokens (Basic auth for confidential clients)
    const basicAuth = Buffer.from(
      `${TWITTER_CLIENT_ID}:${TWITTER_CLIENT_SECRET}`
    ).toString("base64");

    const tokenRes = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        code,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      const errStatus = tokenRes.status;
      // Log only status code — don't leak full response which may echo secrets
      console.error(`[TWITTER] Token exchange failed: HTTP ${errStatus}`);
      return NextResponse.redirect(
        new URL("/dashboard/apps?twitter=token_error", request.url)
      );
    }

    const tokens = await tokenRes.json();

    // Get the user's Twitter handle
    const profileRes = await fetch("https://api.twitter.com/2/users/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    let twitterHandle = "";
    if (profileRes.ok) {
      const profile = (await profileRes.json()) as {
        data?: { username?: string };
      };
      twitterHandle = profile.data?.username
        ? `@${profile.data.username}`
        : "";
    }

    // Encrypt tokens before storage
    const accessTokenEncrypted = await encrypt(tokens.access_token);
    const refreshTokenEncrypted = tokens.refresh_token
      ? await encrypt(tokens.refresh_token)
      : null;

    const scopes = (tokens.scope || "tweet.read tweet.write users.read offline.access")
      .split(" ");

    // Revoke any existing Twitter connections for this user first
    // (handles handle changes — old @handle row gets revoked, new one created)
    await supabase
      .from("oauth_connections")
      .update({ status: "revoked" })
      .eq("user_id", user.id)
      .eq("provider", "twitter")
      .eq("status", "active");

    // Insert new connection
    const { error: insertError } = await supabase
      .from("oauth_connections")
      .insert({
        user_id: user.id,
        provider: "twitter",
        access_token_encrypted: accessTokenEncrypted,
        refresh_token_encrypted: refreshTokenEncrypted,
        expires_at: new Date(
          Date.now() + (tokens.expires_in || 7200) * 1000
        ).toISOString(),
        scopes,
        account_email: twitterHandle,
        status: "active",
      });

    if (insertError) {
      console.error("[TWITTER] oauth_connections insert error:", insertError);
    }

    // Clear the PKCE cookie
    const response = NextResponse.redirect(
      new URL("/dashboard/apps?twitter=connected", request.url)
    );
    response.cookies.delete("twitter_code_verifier");

    return response;
  } catch (err) {
    console.error("[TWITTER] Callback error:", err);
    return NextResponse.redirect(
      new URL("/dashboard/apps?twitter=error", request.url)
    );
  }
}
