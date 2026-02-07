import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "unauthorized", message: "Not logged in" },
        { status: 401 }
      );
    }

    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: "bad_request", message: "Task ID is required" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const action = body.action as string;

    if (!action || !["resolved", "resume"].includes(action)) {
      return NextResponse.json(
        { error: "bad_request", message: "Action must be 'resolved' or 'resume'" },
        { status: 400 }
      );
    }

    // Verify task belongs to user and needs takeover
    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .select("id, needs_takeover, status")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (taskError || !task) {
      return NextResponse.json(
        { error: "not_found", message: "Task not found" },
        { status: 404 }
      );
    }

    if (!task.needs_takeover) {
      return NextResponse.json(
        { error: "bad_request", message: "Task does not need takeover" },
        { status: 400 }
      );
    }

    // Resolve the takeover
    const updateData: Record<string, unknown> = {
      needs_takeover: false,
      takeover_resolved_at: new Date().toISOString(),
    };

    if (action === "resume") {
      updateData.status = "processing";
    } else {
      // 'resolved' - user handled it manually, mark completed
      updateData.status = "completed";
      updateData.completed_at = new Date().toISOString();
    }

    const { error: updateError } = await supabase
      .from("tasks")
      .update(updateData)
      .eq("id", id)
      .eq("user_id", user.id);

    if (updateError) {
      return NextResponse.json(
        { error: "internal_error", message: "Failed to update task" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      action,
      message: action === "resume"
        ? "Takeover resolved, agent will resume"
        : "Task marked as completed",
    });
  } catch {
    return NextResponse.json(
      { error: "internal_error", message: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
