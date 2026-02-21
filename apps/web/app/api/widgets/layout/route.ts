import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_LAYOUT, type WidgetLayoutItem } from "@/lib/widgets/default-layout";
import { randomUUID } from "crypto";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const { data } = await supabase
      .from("dashboard_widget_layouts")
      .select("layout")
      .eq("user_id", user.id)
      .single();

    if (data?.layout && Array.isArray(data.layout) && data.layout.length > 0) {
      return NextResponse.json({ layout: data.layout });
    }

    // Generate default layout
    const layout: WidgetLayoutItem[] = DEFAULT_LAYOUT.map(item => ({
      id: randomUUID(),
      ...item,
    }));
    return NextResponse.json({ layout, isDefault: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = await request.json();
    const { layout } = body;

    if (!Array.isArray(layout)) {
      return NextResponse.json({ error: "bad_request", message: "layout must be an array" }, { status: 400 });
    }

    // Validate each item has required fields
    for (const item of layout) {
      if (!item.id || !item.widgetId || typeof item.w !== "number" || typeof item.h !== "number") {
        return NextResponse.json({ error: "bad_request", message: "Invalid layout item" }, { status: 400 });
      }
    }

    const { error } = await supabase
      .from("dashboard_widget_layouts")
      .upsert({ user_id: user.id, layout, updated_at: new Date().toISOString() }, { onConflict: "user_id" });

    if (error) return NextResponse.json({ error: "internal_error" }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
