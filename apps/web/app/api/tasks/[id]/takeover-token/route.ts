import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import crypto from "crypto";

export async function POST(
  _request: NextRequest,
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

    const { id: taskId } = await params;

    if (!taskId) {
      return NextResponse.json(
        { error: "bad_request", message: "Task ID is required" },
        { status: 400 }
      );
    }

    // Verify task belongs to user
    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .select("id, status, user_id")
      .eq("id", taskId)
      .eq("user_id", user.id)
      .single();

    if (taskError || !task) {
      return NextResponse.json(
        { error: "not_found", message: "Task not found" },
        { status: 404 }
      );
    }

    // Generate short-lived token
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Store token in DB (use admin client to bypass RLS)
    const adminClient = getAdminClient();
    const { error: insertError } = await adminClient
      .from("takeover_tokens")
      .insert({
        token,
        task_id: taskId,
        user_id: user.id,
        expires_at: expiresAt.toISOString(),
      });

    if (insertError) {
      console.error("[TAKEOVER-TOKEN] Insert failed:", insertError);
      return NextResponse.json(
        { error: "internal_error", message: "Failed to create token" },
        { status: 500 }
      );
    }

    const agentUrl = process.env.AGENT_URL || "https://agent-production-1339.up.railway.app";
    const wsUrl = `${agentUrl.replace(/^http/, "ws")}/ws/browser/${taskId}?token=${token}`;

    return NextResponse.json({
      token,
      wsUrl,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    console.error("[TAKEOVER-TOKEN] Error:", err);
    return NextResponse.json(
      { error: "internal_error", message: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
