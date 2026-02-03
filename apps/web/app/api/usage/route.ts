import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const monthParam = url.searchParams.get("month");
  const monthRegex = /^\d{4}-\d{2}$/;
  const month = (monthParam && monthRegex.test(monthParam)) ? monthParam : new Date().toISOString().slice(0, 7);

  // Get usage for the requested month
  const { data: usage, error } = await supabase
    .from("usage")
    .select("*")
    .eq("user_id", user.id)
    .eq("month", month)
    .single();

  if (error && error.code !== "PGRST116") {
    // PGRST116 = no rows found, which is fine
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Get task counts for the month
  const startDate = `${month}-01T00:00:00Z`;
  const endDate = month === new Date().toISOString().slice(0, 7)
    ? new Date().toISOString()
    : `${month}-31T23:59:59Z`;

  const { count: totalTasks } = await supabase
    .from("tasks")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", startDate)
    .lte("created_at", endDate);

  const { count: completedTasks } = await supabase
    .from("tasks")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "completed")
    .gte("created_at", startDate)
    .lte("created_at", endDate);

  // Get total cost for the month
  const { data: costData } = await supabase
    .from("tasks")
    .select("cost_usd")
    .eq("user_id", user.id)
    .gte("created_at", startDate)
    .lte("created_at", endDate);

  const totalCostUsd = (costData || []).reduce(
    (sum, t) => sum + (parseFloat(String(t.cost_usd)) || 0),
    0
  );

  return NextResponse.json({
    month,
    browserTasks: usage?.browser_tasks || 0,
    simpleTasks: usage?.simple_tasks || 0,
    smsCount: usage?.sms_count || 0,
    voiceMinutes: usage?.voice_minutes || 0,
    aiCostCents: usage?.ai_cost_cents || 0,
    totalTasks: totalTasks || 0,
    completedTasks: completedTasks || 0,
    totalCostUsd: Math.round(totalCostUsd * 10000) / 10000,
  });
}
