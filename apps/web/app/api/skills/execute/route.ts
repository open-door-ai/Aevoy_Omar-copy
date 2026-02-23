import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { skillId, params } = body;

    if (!skillId || !params) {
      return NextResponse.json(
        { error: "skillId and params are required" },
        { status: 400 }
      );
    }

    // Call agent to execute skill
    const agentUrl = process.env.AGENT_URL || "https://agent-production-1339.up.railway.app";
    const webhookSecret = process.env.AGENT_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error("[SKILLS-EXECUTE] Missing AGENT_WEBHOOK_SECRET");
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }

    const executeRes = await fetch(`${agentUrl}/skills/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": webhookSecret,
      },
      body: JSON.stringify({
        userId: user.id,
        skillId,
        params,
      }),
    });

    if (!executeRes.ok) {
      const errorData = await executeRes.json().catch(() => ({}));
      console.error("[SKILLS-EXECUTE] Agent execute failed:", errorData);
      return NextResponse.json(
        {
          error: "Execution failed",
          message: errorData.message || executeRes.statusText,
        },
        { status: executeRes.status }
      );
    }

    const result = await executeRes.json();

    return NextResponse.json(result);
  } catch (error) {
    console.error("[SKILLS-EXECUTE] Error:", error);
    return NextResponse.json(
      {
        error: "Execution failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
