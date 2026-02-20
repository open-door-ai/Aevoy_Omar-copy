import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: taskId } = await params;
  if (!taskId) return NextResponse.json({ error: "Missing task ID" }, { status: 400 });

  // Verify the task belongs to this user
  const { data: task } = await supabase
    .from("tasks")
    .select("id, user_id, cost_usd, tokens_used")
    .eq("id", taskId)
    .eq("user_id", user.id)
    .single();

  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  // Fetch per-call AI cost breakdown from ai_cost_log
  const { data: costRows, error } = await supabase
    .from("ai_cost_log")
    .select("id, provider, model, input_tokens, output_tokens, cost_usd, purpose, cached, created_at")
    .eq("task_id", taskId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[AI-COSTS] Fetch error:", error);
    return NextResponse.json({ error: "Failed to load cost data" }, { status: 500 });
  }

  const rows = costRows || [];

  // Aggregate totals
  const totalInputTokens = rows.reduce((s, r) => s + (r.input_tokens || 0), 0);
  const totalOutputTokens = rows.reduce((s, r) => s + (r.output_tokens || 0), 0);
  const totalCostUsd = rows.reduce((s, r) => s + (parseFloat(String(r.cost_usd)) || 0), 0);

  // Group by provider
  const byProvider: Record<string, { calls: number; inputTokens: number; outputTokens: number; costUsd: number }> = {};
  for (const r of rows) {
    const p = r.provider || "unknown";
    if (!byProvider[p]) byProvider[p] = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    byProvider[p].calls++;
    byProvider[p].inputTokens += r.input_tokens || 0;
    byProvider[p].outputTokens += r.output_tokens || 0;
    byProvider[p].costUsd += parseFloat(String(r.cost_usd)) || 0;
  }

  return NextResponse.json({
    taskId,
    taskCostUsd: parseFloat(String(task.cost_usd)) || 0,
    taskTokensUsed: task.tokens_used || 0,
    calls: rows,
    summary: {
      totalCalls: rows.length,
      totalInputTokens,
      totalOutputTokens,
      totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
      byProvider,
    },
  });
}
