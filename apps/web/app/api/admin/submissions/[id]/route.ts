import { NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, logAdminAction, secureResponse, secureError } from "@/lib/admin-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth) return auth.error;

    const supabase = getAdminClient();
    const { id } = await params;

    // V07 fix: validate UUID
    if (!UUID_RE.test(id)) return secureError("invalid_id", 400);

    const { data: submission } = await supabase
      .from("app_submissions")
      .select(`*, app:app_id(*), developer:developer_id(id, username, email)`)
      .eq("id", id)
      .single();

    if (!submission) return secureError("not_found", 404);
    return secureResponse({ submission });
  } catch (err) {
    console.error("Admin submission detail error:", err instanceof Error ? err.message : "unknown");
    return secureError("internal_error", 500);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth) return auth.error;

    const supabase = getAdminClient();
    const { id } = await params;

    if (!UUID_RE.test(id)) return secureError("invalid_id", 400);

    // V08 fix: wrap json parse
    let body: { action?: string; notes?: string };
    try {
      body = await request.json();
    } catch {
      return secureError("bad_request", 400);
    }

    const { action, notes } = body;

    // V12 fix: validate notes length
    if (notes && (typeof notes !== "string" || notes.length > 2000)) {
      return secureError("notes_too_long", 400);
    }

    const { data: submission } = await supabase
      .from("app_submissions")
      .select("id, app_id, developer_id")
      .eq("id", id)
      .single();
    if (!submission) return secureError("not_found", 404);

    let newReviewStatus: string;
    let newAppStatus: string | null = null;

    if (action === "approve") { newReviewStatus = "approved"; newAppStatus = "approved"; }
    else if (action === "reject") { newReviewStatus = "rejected"; newAppStatus = "rejected"; }
    else if (action === "request_changes") { newReviewStatus = "needs_changes"; newAppStatus = "draft"; }
    else return secureError("invalid_action", 400);

    await supabase.from("app_submissions").update({
      review_status: newReviewStatus,
      reviewer_notes: notes || null,
      reviewed_at: new Date().toISOString(),
    }).eq("id", id);

    if (newAppStatus) {
      await supabase.from("marketplace_apps").update({
        status: newAppStatus,
        updated_at: new Date().toISOString(),
      }).eq("id", submission.app_id);
    }

    await logAdminAction(auth.session.id, `${action}_submission`, "app", submission.app_id, notes);

    return secureResponse({ success: true });
  } catch (err) {
    console.error("Admin submission action error:", err instanceof Error ? err.message : "unknown");
    return secureError("internal_error", 500);
  }
}
