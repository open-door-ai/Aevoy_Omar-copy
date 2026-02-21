import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyAdminSession } from "@/lib/admin-auth";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!await verifyAdminSession(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const supabase = await createClient();
    const { id } = await params;

    const { data: submission } = await supabase
      .from("app_submissions")
      .select(`*, app:app_id(*), developer:developer_id(id, username, email)`)
      .eq("id", id)
      .single();

    if (!submission) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ submission });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!await verifyAdminSession(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const supabase = await createClient();
    const { id } = await params;
    const body = await request.json();
    const { action, notes } = body; // action: 'approve' | 'reject' | 'request_changes'

    const { data: submission } = await supabase.from("app_submissions").select("id, app_id, developer_id").eq("id", id).single();
    if (!submission) return NextResponse.json({ error: "not_found" }, { status: 404 });

    let newReviewStatus: string;
    let newAppStatus: string | null = null;

    if (action === "approve") { newReviewStatus = "approved"; newAppStatus = "approved"; }
    else if (action === "reject") { newReviewStatus = "rejected"; newAppStatus = "rejected"; }
    else if (action === "request_changes") { newReviewStatus = "needs_changes"; newAppStatus = "draft"; }
    else return NextResponse.json({ error: "bad_request" }, { status: 400 });

    await supabase.from("app_submissions").update({
      review_status: newReviewStatus,
      reviewer_notes: notes || null,
      reviewed_at: new Date().toISOString(),
    }).eq("id", id);

    if (newAppStatus) {
      await supabase.from("marketplace_apps").update({ status: newAppStatus, updated_at: new Date().toISOString() }).eq("id", submission.app_id);
    }

    // Audit log
    const token = request.cookies.get("admin-session")?.value;
    const { data: sess } = await supabase.from("admin_sessions").select("id").eq("session_token", token || "").single();
    await supabase.from("admin_audit_log").insert({
      admin_session_id: sess?.id,
      action: `${action}_submission`,
      target_type: "app",
      target_id: submission.app_id,
      notes: notes || null,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
