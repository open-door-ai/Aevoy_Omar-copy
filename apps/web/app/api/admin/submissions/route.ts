import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyAdminSession } from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  try {
    if (!await verifyAdminSession(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "queued";

    const { data: submissions } = await supabase
      .from("app_submissions")
      .select(`
        id, review_status, version, submitted_at, reviewed_at, billed_cost_usd,
        security_flags, reviewer_notes, payment_status,
        app:app_id(id, name, slug, icon_url, category_id, price_type, price_cents, widget_manifest),
        developer:developer_id(id, username, email)
      `)
      .eq("review_status", status)
      .order("submitted_at", { ascending: true });

    return NextResponse.json({ submissions: submissions || [] });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
