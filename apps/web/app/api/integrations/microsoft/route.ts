import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
const REDIRECT_URI = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/microsoft/callback`
  : "http://localhost:3000/api/integrations/microsoft/callback";

const SCOPES = [
  "Mail.Read",
  "Mail.Send",
  "Calendars.ReadWrite",
  "Files.ReadWrite",
  "User.Read",
  "offline_access",
].join(" ");

/**
 * GET /api/integrations/microsoft — Get Microsoft integration status
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
      .select("id, created_at, account_email")
      .eq("user_id", user.id)
      .eq("provider", "microsoft")
      .eq("status", "active")
      .single();

    return NextResponse.json({
      connected: !!conn,
      connectedAt: conn?.created_at || null,
      email: conn?.account_email || null,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/integrations/microsoft — Start Microsoft OAuth flow
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

    if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET) {
      return NextResponse.json(
        { error: "Microsoft integration not configured" },
        { status: 503 }
      );
    }

    const state = Buffer.from(
      JSON.stringify({ userId: user.id, ts: Date.now() })
    ).toString("base64url");

    const authUrl = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    authUrl.searchParams.set("client_id", MICROSOFT_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", SCOPES);
    authUrl.searchParams.set("response_mode", "query");
    authUrl.searchParams.set("state", state);

    return NextResponse.json({ authUrl: authUrl.toString() });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/integrations/microsoft — Disconnect Microsoft
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
      .eq("provider", "microsoft");

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
