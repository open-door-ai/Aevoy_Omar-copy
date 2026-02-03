import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Lazy init to avoid build-time errors
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || ""
  );
}

export async function POST(request: NextRequest) {
  try {
    // Verify webhook secret — ALWAYS require it
    const secret = request.headers.get("x-webhook-secret");
    if (!secret || secret !== process.env.AGENT_WEBHOOK_SECRET) {
      return NextResponse.json(
        { error: "unauthorized", message: "Invalid webhook secret" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { taskId, userId, status, error_message, tokens_used, type } = body;

    if (!taskId) {
      return NextResponse.json(
        { error: "bad_request", message: "taskId is required" },
        { status: 400 }
      );
    }

    // Validate status against allowed values
    const validStatuses = ["pending", "processing", "completed", "failed", "cancelled", "needs_review", "awaiting_confirmation", "awaiting_user_input"];
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: "bad_request", message: "Invalid status value" },
        { status: 400 }
      );
    }

    // Update task in database with ownership check
    const updateData: Record<string, unknown> = {};

    if (status) {
      updateData.status = status;
      if (status === "completed" || status === "failed") {
        updateData.completed_at = new Date().toISOString();
      }
    }

    if (error_message !== undefined) {
      updateData.error_message = String(error_message).slice(0, 1000);
    }

    if (tokens_used !== undefined) {
      updateData.tokens_used = Math.max(0, parseInt(String(tokens_used)) || 0);
    }

    if (type !== undefined) {
      updateData.type = String(type).slice(0, 50);
    }

    // Build query with mandatory ownership verification
    if (!userId) {
      return NextResponse.json(
        { error: "bad_request", message: "userId is required for ownership verification" },
        { status: 400 }
      );
    }

    const { error } = await getSupabase()
      .from("tasks")
      .update(updateData)
      .eq("id", taskId)
      .eq("user_id", userId);

    if (error) {
      return NextResponse.json(
        { error: "internal_error", message: "Failed to update task" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "internal_error", message: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
