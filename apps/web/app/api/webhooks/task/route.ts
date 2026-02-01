import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Use service role key for webhooks
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

export async function POST(request: NextRequest) {
  try {
    // Verify webhook secret
    const secret = request.headers.get("x-webhook-secret");
    if (process.env.AGENT_WEBHOOK_SECRET && secret !== process.env.AGENT_WEBHOOK_SECRET) {
      return NextResponse.json(
        { error: "unauthorized", message: "Invalid webhook secret" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { taskId, status, error_message, tokens_used, type } = body;

    if (!taskId) {
      return NextResponse.json(
        { error: "bad_request", message: "taskId is required" },
        { status: 400 }
      );
    }

    // Update task in database
    const updateData: Record<string, unknown> = {};
    
    if (status) {
      updateData.status = status;
      if (status === "completed" || status === "failed") {
        updateData.completed_at = new Date().toISOString();
      }
    }
    
    if (error_message !== undefined) {
      updateData.error_message = error_message;
    }
    
    if (tokens_used !== undefined) {
      updateData.tokens_used = tokens_used;
    }
    
    if (type !== undefined) {
      updateData.type = type;
    }

    const { error } = await supabase
      .from("tasks")
      .update(updateData)
      .eq("id", taskId);

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
