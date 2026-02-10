import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const NYLAS_CLIENT_ID = process.env.NYLAS_CLIENT_ID;
const NYLAS_API_KEY = process.env.NYLAS_API_KEY;
const NYLAS_CLIENT_SECRET = process.env.NYLAS_CLIENT_SECRET;

/**
 * GET /api/integrations/nylas/callback — Handle Nylas OAuth callback
 * 
 * Nylas redirects here after user grants permission.
 * We exchange the code for a grant ID and store it.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  // Handle errors from Nylas
  if (error) {
    console.error("[NYLAS] OAuth error:", error, errorDescription);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/dashboard/settings?error=${encodeURIComponent(errorDescription || error)}`
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/dashboard/settings?error=missing_params`
    );
  }

  try {
    // Decode state to get user ID
    let stateData: { userId: string; provider?: string; ts: number };
    try {
      stateData = JSON.parse(Buffer.from(state, "base64url").toString());
    } catch {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/dashboard/settings?error=invalid_state`
      );
    }

    // Verify state hasn't expired (10 minute window)
    if (Date.now() - stateData.ts > 10 * 60 * 1000) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/dashboard/settings?error=expired`
      );
    }

    if (!NYLAS_API_KEY || !NYLAS_CLIENT_ID || !NYLAS_CLIENT_SECRET) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/dashboard/settings?error=not_configured`
      );
    }

    // Exchange code for access token with Nylas
    const tokenRes = await fetch("https://api.us.nylas.com/v3/connect/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: NYLAS_CLIENT_ID,
        client_secret: NYLAS_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const errorData = await tokenRes.text();
      console.error("[NYLAS] Token exchange failed:", errorData);
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/dashboard/settings?error=token_exchange_failed`
      );
    }

    const tokenData = await tokenRes.json();
    const grantId = tokenData.grant_id;
    const email = tokenData.email_address;
    const provider = tokenData.provider || stateData.provider || "unknown";

    if (!grantId) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/dashboard/settings?error=no_grant`
      );
    }

    // Store in Supabase
    const supabase = await createClient();

    // Check if connection already exists
    const { data: existing } = await supabase
      .from("oauth_connections")
      .select("id")
      .eq("user_id", stateData.userId)
      .eq("provider", "nylas")
      .eq("status", "active")
      .single();

    if (existing) {
      // Update existing connection
      await supabase
        .from("oauth_connections")
        .update({
          access_token_encrypted: grantId, // Nylas uses grant_id for API calls
          account_email: email,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    } else {
      // Create new connection
      await supabase.from("oauth_connections").insert({
        user_id: stateData.userId,
        provider: "nylas",
        provider_subtype: provider,
        access_token_encrypted: grantId, // Nylas grant ID
        account_email: email,
        status: "active",
      });
    }

    console.log(`[NYLAS] Connected user ${stateData.userId} with grant ${grantId}`);

    // Redirect to settings with success
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/dashboard/settings?nylas=connected`
    );
  } catch (err) {
    console.error("[NYLAS] Callback error:", err);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/dashboard/settings?error=server_error`
    );
  }
}
