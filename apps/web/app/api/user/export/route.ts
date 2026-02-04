import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/user/export — GDPR data export
 * Returns all user data as a downloadable JSON file.
 */
export async function GET() {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "unauthorized", message: "Not logged in" },
        { status: 401 }
      );
    }

    const userId = user.id;
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    // Fetch all user data in parallel
    const [
      profile,
      tasks,
      scheduledTasks,
      settings,
      usage,
      agentCards,
    ] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).single(),
      supabase.from("tasks").select("id, status, type, email_subject, created_at, completed_at, cost_usd").eq("user_id", userId).gte("created_at", ninetyDaysAgo).order("created_at", { ascending: false }),
      supabase.from("scheduled_tasks").select("*").eq("user_id", userId),
      supabase.from("user_settings").select("*").eq("user_id", userId).single(),
      supabase.from("usage").select("*").eq("user_id", userId),
      supabase.from("agent_cards").select("id, last_four, balance_cents, is_frozen, created_at").eq("user_id", userId),
    ]);

    const exportData = {
      exportedAt: new Date().toISOString(),
      profile: profile.data,
      tasks: tasks.data || [],
      scheduledTasks: scheduledTasks.data || [],
      settings: settings.data,
      usage: usage.data || [],
      agentCards: agentCards.data || [],
    };

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="aevoy-data-export-${new Date().toISOString().split("T")[0]}.json"`,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "internal_error", message: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
