import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const NYLAS_CLIENT_ID = process.env.NYLAS_CLIENT_ID;
const NYLAS_API_KEY = process.env.NYLAS_API_KEY;
const REDIRECT_URI = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/nylas/callback`
  : "http://localhost:3000/api/integrations/nylas/callback";

/**
 * GET /api/integrations/nylas — Get Nylas connection status
 * 
 * Nylas provides hosted OAuth - no Google Cloud Console needed!
 * Free tier: 5 connected accounts
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user has Nylas connected
    const { data: conn } = await supabase
      .from("oauth_connections")
      .select("id, created_at, account_email, provider")
      .eq("user_id", user.id)
      .eq("provider", "nylas")
      .eq("status", "active")
      .single();

    return NextResponse.json({
      connected: !!conn,
      connectedAt: conn?.created_at || null,
      email: conn?.account_email || null,
      provider: conn?.provider || null,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/integrations/nylas — Start Nylas OAuth flow
 * 
 * Returns a hosted auth URL. Nylas handles the Google/Microsoft OAuth
 * approval process - no months-long wait for your own app approval!
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!NYLAS_CLIENT_ID || !NYLAS_API_KEY) {
      return NextResponse.json(
        { error: "Nylas integration not configured" },
        { status: 503 }
      );
    }

    // Get request body for provider hint (google, microsoft, etc.)
    const body = await request.json().catch(() => ({}));
    const providerHint = body.provider || "google"; // google, microsoft, imap

    // Generate state param with user ID for security
    const state = Buffer.from(
      JSON.stringify({ userId: user.id, provider: providerHint, ts: Date.now() })
    ).toString("base64url");

    // Build Nylas hosted auth URL
    // This redirects to Nylas, which then handles OAuth with Google/Microsoft
    const authUrl = new URL("https://api.us.nylas.com/v3/connect/auth");
    authUrl.searchParams.set("client_id", NYLAS_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive.file");
    authUrl.searchParams.set("login_hint", user.email || "");
    authUrl.searchParams.set("state", state);
    
    // Provider hint - Nylas will show appropriate OAuth screen
    if (providerHint !== "imap") {
      authUrl.searchParams.set("provider", providerHint);
    }

    return NextResponse.json({ 
      authUrl: authUrl.toString(),
      provider: providerHint,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/integrations/nylas — Disconnect Nylas
 */
export async function DELETE() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get the Nylas grant ID before revoking
    const { data: conn } = await supabase
      .from("oauth_connections")
      .select("access_token_encrypted") // Stores the Nylas grant ID
      .eq("user_id", user.id)
      .eq("provider", "nylas")
      .eq("status", "active")
      .single();

    // Revoke with Nylas if we have a grant ID
    if (conn?.access_token_encrypted && NYLAS_API_KEY) {
      try {
        await fetch(`https://api.us.nylas.com/v3/grants/${conn.access_token_encrypted}`, {
          method: "DELETE",
          headers: {
            "Authorization": `Bearer ${NYLAS_API_KEY}`,
            "Content-Type": "application/json",
          },
        });
      } catch (err) {
        console.error("[NYLAS] Failed to revoke grant:", err);
        // Continue with local cleanup even if Nylas revoke fails
      }
    }

    // Revoke in oauth_connections
    await supabase
      .from("oauth_connections")
      .update({ status: "revoked" })
      .eq("user_id", user.id)
      .eq("provider", "nylas");

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
