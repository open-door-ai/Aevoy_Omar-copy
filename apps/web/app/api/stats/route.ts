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

    return NextResponse.json({
      messagesUsed: profile?.messages_used || 0,
      messagesLimit: profile?.messages_limit || 20,
      totalTasks: totalTasks || 0,
      completedTasks: completedTasks || 0,
      failedTasks: failedTasks || 0,
      totalCostUsd: totalCost,
      totalTokensUsed: totalTokens,
    });
  } catch {
    return NextResponse.json(
      { error: "internal_error", message: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
