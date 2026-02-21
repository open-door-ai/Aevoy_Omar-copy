import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const { id } = await params;

    const { data: app } = await supabase.from("marketplace_apps").select("*").eq("id", id).eq("developer_id", user.id).single();
    if (!app) return NextResponse.json({ error: "not_found" }, { status: 404 });

    // Get submissions for this app
    const { data: submissions } = await supabase.from("app_submissions").select("id, version, review_status, submitted_at, reviewed_at, billed_cost_usd, reviewer_notes, security_flags").eq("app_id", id).order("submitted_at", { ascending: false });

    return NextResponse.json({ app, submissions: submissions || [] });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const { id } = await params;

    // Only allow edits on draft apps
    const { data: app } = await supabase.from("marketplace_apps").select("id, status").eq("id", id).eq("developer_id", user.id).single();
    if (!app) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (!["draft", "rejected"].includes(app.status)) {
      return NextResponse.json({ error: "forbidden", message: "Can only edit draft or rejected apps" }, { status: 403 });
    }

    const body = await request.json();
    const { name, description, long_description, category_id, tags, price_type, price_cents, widget_manifest } = body;

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name) updates.name = name.slice(0, 100);
    if (description) updates.description = description.slice(0, 500);
    if (long_description !== undefined) updates.long_description = long_description?.slice(0, 5000) || null;
    if (category_id) updates.category_id = category_id;
    if (tags) updates.tags = Array.isArray(tags) ? tags.slice(0, 10).map((t: string) => t.slice(0, 30)) : [];
    if (price_type && ["free", "one_time", "monthly"].includes(price_type)) updates.price_type = price_type;
    if (typeof price_cents === "number") updates.price_cents = Math.max(0, Math.round(price_cents));
    if (widget_manifest) updates.widget_manifest = widget_manifest;

    await supabase.from("marketplace_apps").update(updates).eq("id", id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
