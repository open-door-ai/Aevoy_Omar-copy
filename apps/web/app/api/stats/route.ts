import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

    // Get profile for usage info
    const { data: profile } = await supabase
      .from("profiles")
      .select("messages_used, messages_limit")
      .eq("id", user.id)
      .single();

    // Get task counts
    const { count: totalTasks } = await supabase
      .from("tasks")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id);

    const { count: completedTasks } = await supabase
      .from("tasks")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "completed");

    const { count: failedTasks } = await supabase
      .from("tasks")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "failed");

    // Get total cost from all tasks
    const { data: costData } = await supabase
      .from("tasks")
      .select("cost_usd")
      .eq("user_id", user.id);
    
    const totalCost = costData?.reduce((sum, t) => sum + (t.cost_usd || 0), 0) || 0;
    
    // Get total tokens used
    const { data: tokenData } = await supabase
      .from("tasks")
      .select("tokens_used")
      .eq("user_id", user.id);
    
    const totalTokens = tokenData?.reduce((sum, t) => sum + (t.tokens_used || 0), 0) || 0;

    // Get 7-day success rate from the view
    const { data: weeklyStats } = await supabase
      .from('user_task_stats')
      .select('completed_last_7d, failed_last_7d, success_rate_7d, completed_last_30d, tasks_last_30d')
      .eq('user_id', user.id)
      .single();

    return NextResponse.json({
      messagesUsed: profile?.messages_used || 0,
      messagesLimit: profile?.messages_limit || 20,
      totalTasks: totalTasks || 0,
      completedTasks: completedTasks || 0,
      failedTasks: failedTasks || 0,
      totalCostUsd: totalCost,
      totalTokensUsed: totalTokens,
      // Weekly metrics
      completedLast7d: weeklyStats?.completed_last_7d || 0,
      failedLast7d: weeklyStats?.failed_last_7d || 0,
      successRate7d: weeklyStats?.success_rate_7d || null,
      completedLast30d: weeklyStats?.completed_last_30d || 0,
      tasksLast30d: weeklyStats?.tasks_last_30d || 0,
    });
  } catch {
    return NextResponse.json(
      { error: "internal_error", message: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
