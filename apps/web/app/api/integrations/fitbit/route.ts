import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const FITBIT_CLIENT_ID = process.env.FITBIT_CLIENT_ID;
const FITBIT_CLIENT_SECRET = process.env.FITBIT_CLIENT_SECRET;
const REDIRECT_URI = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/fitbit/callback`
  : "http://localhost:3000/api/integrations/fitbit/callback";
const FITBIT_AUTH_URL = "https://www.fitbit.com/oauth2/authorize";
const SCOPES = "heartrate sleep activity weight oxygen_saturation";

/**
 * GET /api/integrations/fitbit — Get Fitbit connection status
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

    const { data: conn } = await supabase
      .from("oauth_connections")
      .select("id, created_at, account_email, updated_at")
      .eq("user_id", user.id)
      .eq("provider", "fitbit")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Get last synced metric timestamp
    const { data: lastMetric } = await supabase
      .from("health_metrics")
      .select("created_at")
      .eq("user_id", user.id)
      .eq("source", "fitbit")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    return NextResponse.json({
      connected: !!conn,
      connectedAt: conn?.created_at || null,
      displayName: conn?.account_email || null,
      lastSynced: lastMetric?.created_at || null,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/integrations/fitbit — Start Fitbit OAuth 2.0 Authorization Code flow
 * Returns { authUrl } for the client to redirect to.
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!FITBIT_CLIENT_ID || !FITBIT_CLIENT_SECRET) {
      return NextResponse.json(
        { error: "Fitbit integration not configured" },
        { status: 503 }
      );
    }

    // State param encodes user ID for CSRF protection
    const state = Buffer.from(
      JSON.stringify({ userId: user.id, ts: Date.now() })
    ).toString("base64url");

    const authUrl = new URL(FITBIT_AUTH_URL);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", FITBIT_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authUrl.searchParams.set("scope", SCOPES);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("expires_in", "604800"); // 7 days

    return NextResponse.json({ authUrl: authUrl.toString() });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/integrations/fitbit — Disconnect Fitbit
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

    await supabase
      .from("oauth_connections")
      .update({ status: "revoked" })
      .eq("user_id", user.id)
      .eq("provider", "fitbit");

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
