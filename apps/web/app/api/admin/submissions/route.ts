import { NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, secureResponse, secureError } from "@/lib/admin-auth";

const VALID_STATUSES = ["queued", "approved", "rejected", "needs_changes"];

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth) return auth.error;

    const supabase = getAdminClient();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "queued";

    // V37 fix: validate status
    if (!VALID_STATUSES.includes(status)) {
      return secureError("invalid_status", 400);
    }

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

    return secureResponse({ submissions: submissions || [] });
  } catch (err) {
    console.error("Admin submissions error:", err instanceof Error ? err.message : "unknown");
    return secureError("internal_error", 500);
  }
}
