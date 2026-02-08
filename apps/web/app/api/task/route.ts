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
    const { task, useV2 = true } = body;

    if (!task || typeof task !== "string") {
      return NextResponse.json({ error: "Task required" }, { status: 400 });
    }

    // Get user profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("username, email")
      .eq("id", user.id)
      .single();

    if (useV2) {
      // Use new V2 processor
      const response = await fetch(process.env.AGENT_URL + "/task/v2" || "", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": process.env.AGENT_WEBHOOK_SECRET || "",
        },
        body: JSON.stringify({
          userId: user.id,
          username: profile?.username || "user",
          email: profile?.email || "",
          task,
          channel: "web",
        }),
      });

      const result = await response.json();

      // If awaiting confirmation, return plan ID
      if (result.awaitingConfirmation && result.planId) {
        return NextResponse.json({
          success: true,
          awaitingConfirmation: true,
          planId: result.planId,
          message: result.response,
        });
      }

      return NextResponse.json(result);
    } else {
      // Use legacy processor
      const response = await fetch(process.env.AGENT_URL + "/task" || "", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": process.env.AGENT_WEBHOOK_SECRET || "",
        },
        body: JSON.stringify({
          userId: user.id,
          username: profile?.username || "user",
          from: profile?.email || "",
          subject: "Web Task",
          body: task,
          inputChannel: "web",
        }),
      });

      const result = await response.json();
      return NextResponse.json(result);
    }

  } catch (error) {
    console.error("Task API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
