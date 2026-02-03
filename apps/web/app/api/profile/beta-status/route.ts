import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Admin-only list of user IDs who can grant beta status
// In production, move this to a database table or env variable
const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || "").split(",").filter(Boolean);

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only admins can grant beta status
    if (!ADMIN_USER_IDS.includes(user.id)) {
      return NextResponse.json(
        { error: "Forbidden — admin access required" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { status, targetUserId } = body;

    // Validate status value
    const allowedStatuses = ["beta", "active", "free"];
    if (!allowedStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${allowedStatuses.join(", ")}` },
        { status: 400 }
      );
    }

    // Admin can update their own or a target user's status
    const userIdToUpdate = targetUserId || user.id;

    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        subscription_status: status,
        messages_limit: status === "beta" ? 10000 : 20
      })
      .eq("id", userIdToUpdate);

    if (updateError) {
      console.error("Error updating beta status:", updateError);
      return NextResponse.json({ error: "Failed to update status" }, { status: 500 });
    }

    return NextResponse.json({ success: true, status });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
