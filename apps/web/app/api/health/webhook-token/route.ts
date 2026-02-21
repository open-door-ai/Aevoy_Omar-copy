import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/health/webhook-token
 * Returns the user's personal Apple Health webhook token.
 * This token is auto-generated on signup and stored in profiles.health_webhook_token.
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

    const { data: profile } = await supabase
      .from("profiles")
      .select("health_webhook_token")
      .eq("id", user.id)
      .single();

    const token = profile?.health_webhook_token ?? null;
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://www.aevoy.com";
    const webhookUrl = token
      ? `${appUrl}/api/health/shortcuts?token=${token}`
      : null;

    return NextResponse.json({ token, webhookUrl });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
