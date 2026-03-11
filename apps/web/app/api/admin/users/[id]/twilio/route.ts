import { NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, logAdminAction, secureResponse, secureError } from "@/lib/admin-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth) return auth.error;

    const supabase = getAdminClient();
    const { id } = await params;

    if (!UUID_RE.test(id)) return secureError("invalid_id", 400);

    // Check if user has a Twilio number
    const { data: existing } = await supabase
      .from("user_twilio_numbers")
      .select("phone_number")
      .eq("user_id", id)
      .limit(1);

    if (!existing || existing.length === 0) {
      return secureError("no_twilio_number", 404);
    }

    const phoneNumber = existing[0].phone_number;

    const { error } = await supabase
      .from("user_twilio_numbers")
      .delete()
      .eq("user_id", id);

    if (error) {
      console.error("Admin twilio disconnect error:", error.message);
      return secureError("disconnect_failed", 500);
    }

    await logAdminAction(auth.session.id, "disconnect_twilio", "user", id, `Disconnected Twilio number: ${phoneNumber}`);

    return secureResponse({ success: true, disconnected: phoneNumber });
  } catch (err) {
    console.error("Admin twilio disconnect error:", err instanceof Error ? err.message : "unknown");
    return secureError("internal_error", 500);
  }
}
