import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/workflows — List user's workflows
 * POST /api/workflows — Create a new workflow (forwards to agent server)
 */

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: workflows, error } = await supabase
      .from("workflows")
      .select(
        "id, title, description, status, current_step, total_steps, total_cost_usd, created_at, updated_at"
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch workflows" },
        { status: 500 }
      );
    }

    return NextResponse.json(workflows || []);
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { description } = body;

    if (!description || typeof description !== "string" || description.length < 10) {
      return NextResponse.json(
        { error: "Description must be at least 10 characters" },
        { status: 400 }
      );
    }

    // Get user profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("username, email")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json(
        { error: "Profile not found" },
        { status: 404 }
      );
    }

    // Forward to agent server
    const agentUrl = process.env.AGENT_URL || "http://localhost:3001";
    const res = await fetch(`${agentUrl}/task/incoming`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": process.env.AGENT_WEBHOOK_SECRET || "",
      },
      body: JSON.stringify({
        userId: user.id,
        username: profile.username,
        from: profile.email,
        subject: "Workflow Request",
        body: description,
        inputChannel: "web",
      }),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: "Failed to create workflow" },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, message: "Workflow submitted" });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
