import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/inbox/queue - Get pending email approvals for user
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const status = url.searchParams.get("status") || "pending";
    const limit = parseInt(url.searchParams.get("limit") || "50");

    const { data: queue, error } = await supabase
      .from("inbox_queue")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", status)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[INBOX_QUEUE] GET error:", error);
      return NextResponse.json({ error: "Failed to fetch queue" }, { status: 500 });
    }

    // Get stats
    const { data: stats } = await supabase
      .from("inbox_queue")
      .select("status", { count: "exact" })
      .eq("user_id", user.id);

    const pendingCount = stats?.filter(s => s.status === "pending").length || 0;
    const approvedCount = stats?.filter(s => s.status === "approved").length || 0;
    const rejectedCount = stats?.filter(s => s.status === "rejected").length || 0;

    return NextResponse.json({
      queue: queue || [],
      stats: {
        pending: pendingCount,
        approved: approvedCount,
        rejected: rejectedCount,
      },
    });
  } catch (error) {
    console.error("[INBOX_QUEUE] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/inbox/queue/approve - Approve a queued email action
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { queueId, decision, modifiedResponse } = body;

    if (!queueId) {
      return NextResponse.json({ error: "Queue ID required" }, { status: 400 });
    }

    // Get the queue item
    const { data: queueItem } = await supabase
      .from("inbox_queue")
      .select("*")
      .eq("id", queueId)
      .eq("user_id", user.id)
      .single();

    if (!queueItem) {
      return NextResponse.json({ error: "Queue item not found" }, { status: 404 });
    }

    // Update with user's decision
    const updateData: {
      status: string;
      user_decision?: string;
      executed_at?: string;
    } = {
      status: decision || "approved",
      user_decision: modifiedResponse || queueItem.suggested_response,
      executed_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("inbox_queue")
      .update(updateData)
      .eq("id", queueId);

    if (error) {
      console.error("[INBOX_QUEUE] Update error:", error);
      return NextResponse.json({ error: "Failed to update" }, { status: 500 });
    }

    // Trigger execution via webhook to agent
    if (decision === "approved" || decision === "modified") {
      try {
        await fetch(`${process.env.AGENT_URL || "http://localhost:3001"}/webhooks/inbox-action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            queueId,
            userId: user.id,
            action: queueItem.suggested_action,
            response: modifiedResponse || queueItem.suggested_response,
          }),
        });
      } catch (err) {
        console.error("[INBOX_QUEUE] Failed to trigger execution:", err);
        // Don't fail the request - execution will retry
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[INBOX_QUEUE] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
