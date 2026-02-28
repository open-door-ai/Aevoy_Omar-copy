import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { id: taskId } = await params;

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

    const body = await request.json();
    const { message } = body;

    if (!message || typeof message !== "string" || message.length > 10000) {
      return NextResponse.json(
        { error: "bad_request", message: "Missing or invalid message" },
        { status: 400 }
      );
    }

    // Fetch the original task to get context
    const { data: originalTask } = await supabase
      .from("tasks")
      .select("input_text, response_text, email_subject")
      .eq("id", taskId)
      .eq("user_id", user.id)
      .single();

    if (!originalTask) {
      return NextResponse.json(
        { error: "not_found", message: "Task not found" },
        { status: 404 }
      );
    }

    // Look up user profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("username, email")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json(
        { error: "not_found", message: "Profile not found" },
        { status: 404 }
      );
    }

    // Build follow-up task with conversation context
    const subject = `Re: ${originalTask.email_subject || originalTask.input_text?.substring(0, 80) || "Previous task"}`;
    const taskBody = [
      `[CONVERSATION CONTEXT — this is a follow-up reply to a previous task]`,
      `Original request: ${originalTask.input_text || "N/A"}`,
      `Agent response: ${originalTask.response_text?.substring(0, 1000) || "N/A"}`,
      ``,
      `User reply: ${message}`,
      ``,
      `Execute what the user is asking in their reply. Use the conversation context above to understand what they want.`,
    ].join("\n");

    // Forward to agent
    const agentUrl =
      process.env.AGENT_URL ||
      "https://agent-production-1339.up.railway.app";
    const webhookSecret = process.env.AGENT_WEBHOOK_SECRET;

    if (!webhookSecret) {
      return NextResponse.json(
        { error: "config_error", message: "Agent webhook secret not configured" },
        { status: 500 }
      );
    }

    const agentResponse = await fetch(`${agentUrl}/task/incoming`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": webhookSecret,
      },
      body: JSON.stringify({
        userId: user.id,
        username: profile.username,
        from: profile.email,
        subject,
        body: taskBody,
        inputChannel: "web",
        parentTaskId: taskId,
      }),
    });

    if (!agentResponse.ok) {
      return NextResponse.json(
        { error: "agent_error", message: "Failed to submit reply to agent" },
        { status: 502 }
      );
    }

    const result = await agentResponse.json();
    return NextResponse.json({ status: "queued", taskId: result.taskId, ...result });
  } catch {
    return NextResponse.json(
      { error: "internal_error", message: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
