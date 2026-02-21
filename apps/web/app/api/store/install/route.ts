import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = await request.json();
    const { appId } = body;
    if (!appId) return NextResponse.json({ error: "bad_request", message: "appId required" }, { status: 400 });

    // Verify app exists and is approved
    const { data: app } = await supabase.from("marketplace_apps").select("id, price_type, price_cents, status").eq("id", appId).single();
    if (!app || app.status !== "approved") return NextResponse.json({ error: "not_found", message: "App not found" }, { status: 404 });

    // Paid apps: mocked for Beta
    if (app.price_type !== "free" && app.price_cents > 0) {
      // In Beta, mock payment success — real Stripe will be added later
      // Real impl: verify payment_intent_id from request body
    }

    // Install
    const { error } = await supabase
      .from("marketplace_installs")
      .upsert({ user_id: user.id, app_id: appId }, { onConflict: "user_id,app_id" });

    if (error) {
      if (error.code === "23505") return NextResponse.json({ success: true, alreadyInstalled: true });
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = await request.json();
    const { appId } = body;
    if (!appId) return NextResponse.json({ error: "bad_request" }, { status: 400 });

    await supabase.from("marketplace_installs").delete().eq("user_id", user.id).eq("app_id", appId);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
