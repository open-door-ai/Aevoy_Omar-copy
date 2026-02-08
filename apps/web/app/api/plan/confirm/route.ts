import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { planId, action, modifications } = body;

    if (!planId || !action) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Verify plan belongs to user
    const { data: plan, error: planError } = await supabase
      .from("execution_plans")
      .select("*")
      .eq("id", planId)
      .eq("user_id", user.id)
      .single();

    if (planError || !plan) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    if (action === "yes") {
      // Confirm and queue for execution
      await supabase
        .from("execution_plans")
        .update({
          status: "approved",
          approved_at: new Date().toISOString(),
        })
        .eq("id", planId);

      // Add to task queue
      await supabase
        .from("task_queue")
        .insert({
          plan_id: planId,
          user_id: user.id,
          status: "queued",
        });

      // Trigger agent execution (webhook or queue)
      // This would call your agent service
      await fetch(process.env.AGENT_WEBHOOK_URL || "", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, userId: user.id }),
      }).catch(() => {
        // Non-blocking - agent will poll queue
      });

      return NextResponse.json({ success: true, message: "Plan approved and queued" });

    } else if (action === "no") {
      // Reject plan
      await supabase
        .from("execution_plans")
        .update({
          status: "rejected",
          rejected_at: new Date().toISOString(),
        })
        .eq("id", planId);

      return NextResponse.json({ success: true, message: "Plan rejected" });

    } else if (action === "modify") {
      // Store modifications and re-plan
      await supabase
        .from("execution_plans")
        .update({
          status: "modified",
          modifications,
          modified_at: new Date().toISOString(),
        })
        .eq("id", planId);

      // Trigger re-planning
      await fetch(process.env.AGENT_WEBHOOK_URL + "/replan" || "", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          planId, 
          userId: user.id,
          originalPlan: plan,
          modifications 
        }),
      }).catch(() => {});

      return NextResponse.json({ success: true, message: "Modifications received, re-planning" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  } catch (error) {
    console.error("Plan confirm error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
