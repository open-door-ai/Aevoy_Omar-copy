import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// Current model pricing rates (per 1M tokens) — verified Feb 2026
const MODEL_RATES: Record<string, { input: number; output: number; displayName: string }> = {
  groq: { input: 0.59, output: 0.79, displayName: "Groq (Llama 3.3 70B)" },
  deepseek: { input: 0.27, output: 1.10, displayName: "DeepSeek V3" },
  kimi: { input: 0.60, output: 2.50, displayName: "Kimi K2 (Moonshot)" },
  gemini: { input: 0, output: 0, displayName: "Gemini 2.0 Flash (Free)" },
  sonnet: { input: 3.00, output: 15.00, displayName: "Claude Sonnet 4" },
  haiku: { input: 0.80, output: 4.00, displayName: "Claude 3.5 Haiku" },
  ollama: { input: 0, output: 0, displayName: "Ollama (Local)" },
  openrouter: { input: 0, output: 0, displayName: "OpenRouter (dynamic)" },
};

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const monthParam = url.searchParams.get("month");
  const monthRegex = /^\d{4}-\d{2}$/;
  const month = monthParam && monthRegex.test(monthParam)
    ? monthParam
    : new Date().toISOString().slice(0, 7);

  const startDate = `${month}-01T00:00:00Z`;
  const [yearNum, monNum] = month.split("-").map(Number);
  const lastDay = new Date(yearNum, monNum, 0).getDate();
  const isCurrentMonth = month === new Date().toISOString().slice(0, 7);
  const endDate = isCurrentMonth
    ? new Date().toISOString()
    : `${month}-${String(lastDay).padStart(2, "0")}T23:59:59Z`;

  // Fetch all ai_cost_log rows for this month
  const { data: costRows, error } = await supabase
    .from("ai_cost_log")
    .select("provider, model, input_tokens, output_tokens, cost_usd, purpose, cached, created_at")
    .eq("user_id", user.id)
    .gte("created_at", startDate)
    .lte("created_at", endDate)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[COST-ANALYTICS] Fetch error:", error);
    return NextResponse.json({ error: "Failed to load analytics" }, { status: 500 });
  }

  const rows = costRows || [];

  // Breakdown by provider
  const byProvider: Record<string, {
    provider: string;
    displayName: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    cachedCalls: number;
    inputRatePerM: number;
    outputRatePerM: number;
  }> = {};

  for (const r of rows) {
    const p = r.provider || "unknown";
    if (!byProvider[p]) {
      const rates = MODEL_RATES[p] || { input: 0, output: 0, displayName: p };
      byProvider[p] = {
        provider: p,
        displayName: rates.displayName,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        cachedCalls: 0,
        inputRatePerM: rates.input,
        outputRatePerM: rates.output,
      };
    }
    byProvider[p].calls++;
    byProvider[p].inputTokens += r.input_tokens || 0;
    byProvider[p].outputTokens += r.output_tokens || 0;
    byProvider[p].costUsd += parseFloat(String(r.cost_usd)) || 0;
    if (r.cached) byProvider[p].cachedCalls++;
  }

  // Breakdown by purpose (task type)
  const byPurpose: Record<string, { purpose: string; calls: number; costUsd: number }> = {};
  for (const r of rows) {
    const p = r.purpose || "unknown";
    if (!byPurpose[p]) byPurpose[p] = { purpose: p, calls: 0, costUsd: 0 };
    byPurpose[p].calls++;
    byPurpose[p].costUsd += parseFloat(String(r.cost_usd)) || 0;
  }

  // Daily cost trend (last 7 days of current month)
  const dailyCosts: Record<string, number> = {};
  for (const r of rows) {
    const day = r.created_at.slice(0, 10);
    dailyCosts[day] = (dailyCosts[day] || 0) + (parseFloat(String(r.cost_usd)) || 0);
  }

  const totalCostUsd = rows.reduce((s, r) => s + (parseFloat(String(r.cost_usd)) || 0), 0);
  const totalInputTokens = rows.reduce((s, r) => s + (r.input_tokens || 0), 0);
  const totalOutputTokens = rows.reduce((s, r) => s + (r.output_tokens || 0), 0);

  return NextResponse.json({
    month,
    summary: {
      totalCalls: rows.length,
      totalInputTokens,
      totalOutputTokens,
      totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
    },
    byProvider: Object.values(byProvider).sort((a, b) => b.costUsd - a.costUsd),
    byPurpose: Object.values(byPurpose).sort((a, b) => b.calls - a.calls),
    dailyCosts,
    pricingReference: Object.entries(MODEL_RATES).map(([key, val]) => ({
      provider: key,
      displayName: val.displayName,
      inputRatePerM: val.input,
      outputRatePerM: val.output,
      lastVerified: "2026-02-20",
    })),
  });
}
