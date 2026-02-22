import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
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

    // Fetch task - only return own tasks
    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (taskError || !task) {
      return NextResponse.json(
        { error: "not_found", message: "Task not found" },
        { status: 404 }
      );
    }

    // Fetch task logs
    const { data: logs } = await supabase
      .from("task_logs")
      .select("*")
      .eq("task_id", id)
      .order("created_at", { ascending: true });

    return NextResponse.json({
      task,
      logs: logs || [],
    });
  } catch {
    return NextResponse.json(
      { error: "internal_error", message: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}

export async function PATCH(
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
    const body = await request.json();
    const { status } = body;

    if (status !== "cancelled") {
      return NextResponse.json(
        { error: "bad_request", message: "Only cancellation is supported" },
        { status: 400 }
      );
    }

    const { data: task, error: fetchError } = await supabase
      .from("tasks")
      .select("id, status, user_id")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (fetchError || !task) {
      return NextResponse.json(
        { error: "not_found", message: "Task not found" },
        { status: 404 }
      );
    }

    if (!["pending", "awaiting_confirmation", "awaiting_user_input"].includes(task.status)) {
      return NextResponse.json(
        { error: "conflict", message: "Task cannot be cancelled in its current state" },
        { status: 409 }
      );
    }

    const { error: updateError } = await supabase
      .from("tasks")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", user.id);

    if (updateError) {
      return NextResponse.json(
        { error: "internal_error", message: "Failed to cancel task" },
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
