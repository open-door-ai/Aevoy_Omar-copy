import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "unauthorized", message: "Not logged in" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { subject, body: taskBody } = body;

    if (!subject || !taskBody) {
      return NextResponse.json(
        { error: "bad_request", message: "Missing subject or body" },
        { status: 400 }
      );
    }

    // Look up user profile for username
    const { data: profile } = await supabase
      .from("profiles")
      .select("username, email")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json(
        { error: "not_found", message: "User profile not found" },
        { status: 404 }
      );
    }

    // Forward to agent server
    const agentUrl = process.env.AGENT_URL || "http://localhost:3001";
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
      }),
    });

    if (!agentResponse.ok) {
      return NextResponse.json(
        { error: "agent_error", message: "Failed to submit task to agent" },
        { status: 502 }
      );
    }

    const result = await agentResponse.json();
    return NextResponse.json({ status: "queued", ...result });
  } catch {
    return NextResponse.json(
      { error: "internal_error", message: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: "unauthorized", message: "Not logged in" },
        { status: 401 }
      );
    }

    // Parse query parameters with validation
    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(Math.max(1, parseInt(searchParams.get("limit") || "20") || 20), 100);
    const offset = Math.max(0, parseInt(searchParams.get("offset") || "0") || 0);
    const status = searchParams.get("status");
    const needsTakeover = searchParams.get("needs_takeover");

    // Validate status parameter
    const validStatuses = ["pending", "processing", "completed", "failed", "cancelled", "needs_review", "awaiting_confirmation", "awaiting_user_input", "all"];
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: "bad_request", message: "Invalid status filter" },
        { status: 400 }
      );
    }

    // Build query
    let query = supabase
      .from("tasks")
      .select("*", { count: "exact" })
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (status && status !== "all") {
      query = query.eq("status", status);
    }

    if (needsTakeover === "true") {
      query = query.eq("needs_takeover", true);
    }

    query = query.range(offset, offset + limit - 1);

    const { data: tasks, count, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: "internal_error", message: "Failed to fetch tasks" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      tasks: tasks || [],
      total: count || 0,
    });
  } catch {
    return NextResponse.json(
      { error: "internal_error", message: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
