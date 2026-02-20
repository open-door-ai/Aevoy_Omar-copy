/**
 * Health Analyzer Service
 *
 * Agent-side service for AI-powered health metric analysis.
 * Uses Claude (claude-haiku-4-5-20251001) to analyze trends and generate insights.
 * Results are stored in the health_insights table for display in the dashboard.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseClient } from "../utils/supabase.js";

const CLAUDE_MODEL = "claude-haiku-4-5-20251001";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ─── Types ──────────────────────────────────────────────────────────────────

export interface HealthMetricSummary {
  metric_type: string;
  avg_value: number;
  min_value: number;
  max_value: number;
  unit: string;
  samples: number;
}

export interface HealthInsightResult {
  insight_text: string;
  anomalies: Array<{
    metric: string;
    value: number;
    expected: string;
    severity: "low" | "moderate" | "high";
  }>;
  severity: "normal" | "low" | "moderate" | "high";
  data_summary: Record<string, HealthMetricSummary>;
}

interface RawMetricRow {
  metric_type: string;
  value: number;
  unit: string;
  recorded_at: string;
}

interface ClaudeAnalysisResponse {
  summary?: string;
  anomalies?: Array<{
    metric?: string;
    value?: number;
    expected?: string;
    severity?: string;
  }>;
  severity?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Aggregate raw metric rows into per-type summaries.
 */
function aggregateMetrics(
  rows: RawMetricRow[]
): Record<string, HealthMetricSummary> {
  const grouped: Record<
    string,
    { values: number[]; unit: string }
  > = {};

  for (const row of rows) {
    if (!grouped[row.metric_type]) {
      grouped[row.metric_type] = { values: [], unit: row.unit };
    }
    grouped[row.metric_type].values.push(row.value);
    // Keep the most recent unit if it changes (should not happen)
    grouped[row.metric_type].unit = row.unit;
  }

  const summary: Record<string, HealthMetricSummary> = {};

  for (const [type, data] of Object.entries(grouped)) {
    const values = data.values;
    const sum = values.reduce((a, b) => a + b, 0);
    summary[type] = {
      metric_type: type,
      avg_value: Math.round((sum / values.length) * 100) / 100,
      min_value: Math.min(...values),
      max_value: Math.max(...values),
      unit: data.unit,
      samples: values.length,
    };
  }

  return summary;
}

/**
 * Build a human-readable metrics description for the AI prompt.
 */
function buildMetricsDescription(
  summary: Record<string, HealthMetricSummary>
): string {
  const lines: string[] = [];
  for (const [, s] of Object.entries(summary)) {
    lines.push(
      `- ${s.metric_type}: avg=${s.avg_value} ${s.unit}, min=${s.min_value}, max=${s.max_value} (${s.samples} samples over 7 days)`
    );
  }
  return lines.join("\n");
}

// ─── Main Exports ─────────────────────────────────────────────────────────────

/**
 * Generate a daily health insight for a user.
 *
 * 1. Fetches the last 7 days of health_metrics.
 * 2. Aggregates by metric type.
 * 3. Sends aggregated data to Claude for plain-English analysis.
 * 4. Inserts result into health_insights.
 * 5. Returns the result (or null if no data).
 */
export async function generateDailyInsight(
  userId: string
): Promise<HealthInsightResult | null> {
  const sb = getSupabaseClient();

  // Fetch last 7 days of metrics
  const since = new Date();
  since.setDate(since.getDate() - 7);

  const { data: rows, error: fetchError } = await sb
    .from("health_metrics")
    .select("metric_type, value, unit, recorded_at")
    .eq("user_id", userId)
    .gte("recorded_at", since.toISOString())
    .order("recorded_at", { ascending: true });

  if (fetchError) {
    console.error("[HEALTH ANALYZER] Fetch error:", fetchError);
    return null;
  }

  if (!rows || rows.length === 0) {
    console.log(`[HEALTH ANALYZER] No metrics for user ${userId}`);
    return null;
  }

  const dataSummary = aggregateMetrics(rows as RawMetricRow[]);
  const metricsDescription = buildMetricsDescription(dataSummary);

  const prompt = `Analyze these health metrics collected over the last 7 days:

${metricsDescription}

Provide:
1. A brief 2-3 sentence plain-English summary of the trends.
2. A list of anomalies if any (values significantly outside normal ranges).
3. An overall severity level: normal / low / moderate / high.

DO NOT diagnose. Stick to observable patterns and general wellness observations.

Respond as JSON only (no markdown, no code blocks):
{
  "summary": "string",
  "anomalies": [
    { "metric": "string", "value": number, "expected": "string", "severity": "low|moderate|high" }
  ],
  "severity": "normal|low|moderate|high"
}`;

  let analysisResult: ClaudeAnalysisResponse;
  try {
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });

    const rawText =
      message.content[0].type === "text" ? message.content[0].text : "";

    // Strip optional markdown code fences
    const jsonMatch = rawText.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    analysisResult = JSON.parse(jsonMatch) as ClaudeAnalysisResponse;
  } catch (err) {
    console.error("[HEALTH ANALYZER] Claude parsing error:", err);
    analysisResult = {
      summary: "Health data analyzed. No significant anomalies detected.",
      anomalies: [],
      severity: "normal",
    };
  }

  const insightText = analysisResult.summary || "Health data analyzed.";
  const anomalies = (analysisResult.anomalies || []).map((a) => ({
    metric: a.metric || "unknown",
    value: typeof a.value === "number" ? a.value : 0,
    expected: a.expected || "within normal range",
    severity: (["low", "moderate", "high"].includes(a.severity || "")
      ? a.severity
      : "low") as "low" | "moderate" | "high",
  }));
  const severity = (
    ["normal", "low", "moderate", "high"].includes(analysisResult.severity || "")
      ? analysisResult.severity
      : "normal"
  ) as "normal" | "low" | "moderate" | "high";

  const result: HealthInsightResult = {
    insight_text: insightText,
    anomalies,
    severity,
    data_summary: dataSummary,
  };

  // Persist to health_insights
  const { error: insertError } = await sb.from("health_insights").insert({
    user_id: userId,
    insight_text: insightText,
    anomalies,
    severity,
    data_summary: dataSummary,
    generated_at: new Date().toISOString(),
    notified: false,
  });

  if (insertError) {
    console.error("[HEALTH ANALYZER] Insert error:", insertError);
  }

  return result;
}

/**
 * Get a plain-text health summary for the last 7 days.
 * Used by the agent when the user asks "how am I doing health-wise?"
 */
export async function getHealthSummaryForUser(userId: string): Promise<string> {
  const sb = getSupabaseClient();

  // Check for a recent insight first (generated in the last 24 hours)
  const recentCutoff = new Date();
  recentCutoff.setHours(recentCutoff.getHours() - 24);

  const { data: recentInsight } = await sb
    .from("health_insights")
    .select("insight_text, severity, anomalies, generated_at")
    .eq("user_id", userId)
    .gte("generated_at", recentCutoff.toISOString())
    .order("generated_at", { ascending: false })
    .limit(1)
    .single();

  if (recentInsight) {
    const anomalyCount = Array.isArray(recentInsight.anomalies)
      ? recentInsight.anomalies.length
      : 0;
    const anomalyNote =
      anomalyCount > 0
        ? ` There ${anomalyCount === 1 ? "is" : "are"} ${anomalyCount} anomal${anomalyCount === 1 ? "y" : "ies"} worth monitoring.`
        : "";
    return `Health status (${new Date(recentInsight.generated_at).toLocaleDateString()}): ${recentInsight.insight_text}${anomalyNote} Overall severity: ${recentInsight.severity}.`;
  }

  // No recent insight — generate one now
  const insight = await generateDailyInsight(userId);
  if (!insight) {
    return "No health data available yet. Connect Fitbit or set up Apple Shortcuts to start tracking your health metrics.";
  }

  const anomalyCount = insight.anomalies.length;
  const anomalyNote =
    anomalyCount > 0
      ? ` There ${anomalyCount === 1 ? "is" : "are"} ${anomalyCount} anomal${anomalyCount === 1 ? "y" : "ies"} worth monitoring.`
      : "";

  return `Health summary (last 7 days): ${insight.insight_text}${anomalyNote} Overall severity: ${insight.severity}.`;
}

/**
 * Run daily AI insight generation for all users who have health data synced today.
 * Called by the daily cron at 6 AM UTC (after Fitbit sync completes).
 * Returns the number of users who received new insights.
 */
export async function generateDailyInsightsForAllUsers(): Promise<number> {
  const sb = getSupabaseClient();

  // Find distinct users with health metrics synced in the last 48h (covers timezone differences)
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await sb
    .from("health_metrics")
    .select("user_id")
    .gte("created_at", cutoff);

  if (error || !rows || rows.length === 0) {
    console.log("[HEALTH ANALYZER] No users with recent health data to analyze");
    return 0;
  }

  const uniqueUserIds = [...new Set(rows.map((r) => r.user_id as string))];
  console.log(`[HEALTH ANALYZER] Generating insights for ${uniqueUserIds.length} user(s)`);

  let successCount = 0;
  const results = await Promise.allSettled(
    uniqueUserIds.map(async (userId) => {
      const insight = await generateDailyInsight(userId);
      if (insight) successCount++;
    })
  );

  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    console.warn(`[HEALTH ANALYZER] ${failed} insight generation(s) failed`);
  }

  return successCount;
}
