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
    const { skillId } = body;

    if (!skillId) {
      return NextResponse.json(
        { error: "skillId is required" },
        { status: 400 }
      );
    }

    // Call agent to install skill
    const agentUrl = process.env.AGENT_URL || "http://localhost:3001";
    const webhookSecret = process.env.AGENT_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error("[SKILLS-INSTALL] Missing AGENT_WEBHOOK_SECRET");
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }

    const installRes = await fetch(`${agentUrl}/skills/install`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": webhookSecret,
      },
      body: JSON.stringify({
        skillId,
        userId: user.id,
        skipAudit: false, // Always audit for user-initiated installs
      }),
    });

    if (!installRes.ok) {
      const errorData = await installRes.json().catch(() => ({}));
      console.error("[SKILLS-INSTALL] Agent install failed:", errorData);
      return NextResponse.json(
        {
          error: "Installation failed",
          message: errorData.message || installRes.statusText,
        },
        { status: installRes.status }
      );
    }

    const result = await installRes.json();

    return NextResponse.json(result);
  } catch (error) {
    console.error("[SKILLS-INSTALL] Error:", error);
    return NextResponse.json(
      {
        error: "Installation failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
