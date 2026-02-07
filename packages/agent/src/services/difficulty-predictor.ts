/**
 * Task Difficulty Predictor
 *
 * Predicts how hard a task will be BEFORE execution based on historical data.
 * Uses aggregated data from completed tasks to estimate:
 * - Success probability
 * - Expected duration
 * - Expected cost
 * - Recommended execution method (API vs browser vs fallback)
 * - Recommended model
 *
 * Self-learning: Every completed task updates the difficulty cache.
 */

import { getSupabaseClient } from "../utils/supabase.js";

export interface DifficultyPrediction {
  difficulty: "easy" | "medium" | "hard" | "nightmare";
  predictedSuccessRate: number;
  recommendedMethod: "api" | "browser" | "email_fallback";
  recommendedModel: string | null;
  estimatedDurationMs: number;
  estimatedCostUsd: number;
  confidence: number; // 0-100, how confident we are in this prediction
  sampleCount: number;
  maxStrikes: number;
}

/**
 * Predict task difficulty before execution.
 * Returns prediction with confidence score.
 */
export async function predictDifficulty(
  domain: string,
  taskType: string
): Promise<DifficultyPrediction> {
  const defaultPrediction: DifficultyPrediction = {
    difficulty: "medium",
    predictedSuccessRate: 75,
    recommendedMethod: "browser",
    recommendedModel: null,
    estimatedDurationMs: 30000,
    estimatedCostUsd: 0.05,
    confidence: 0,
    sampleCount: 0,
    maxStrikes: 3,
  };

  try {
    // Check domain-specific cache first
    const { data: domainCache } = await getSupabaseClient()
      .from("task_difficulty_cache")
      .select("*")
      .eq("domain", domain)
      .eq("task_type", taskType)
      .single();

    if (domainCache && domainCache.sample_count >= 3) {
      return mapCacheToPrediction(domainCache);
    }

    // Fall back to task-type-only cache (across all domains)
    const { data: typeCache } = await getSupabaseClient()
      .from("task_difficulty_cache")
      .select("*")
      .eq("task_type", taskType)
      .order("sample_count", { ascending: false })
      .limit(5);

    if (typeCache && typeCache.length > 0) {
      // Aggregate across domains
      const totalSamples = typeCache.reduce((sum, c) => sum + c.sample_count, 0);
      if (totalSamples >= 5) {
        const avgSuccessRate =
          typeCache.reduce((sum, c) => sum + c.success_rate * c.sample_count, 0) / totalSamples;
        const avgDuration =
          typeCache.reduce((sum, c) => sum + c.avg_duration_ms * c.sample_count, 0) / totalSamples;
        const avgCost =
          typeCache.reduce((sum, c) => sum + parseFloat(c.avg_cost_usd) * c.sample_count, 0) / totalSamples;

        return {
          difficulty: classifyDifficulty(avgSuccessRate),
          predictedSuccessRate: Math.round(avgSuccessRate),
          recommendedMethod: avgSuccessRate < 50 ? "email_fallback" : "browser",
          recommendedModel: typeCache[0].recommended_model,
          estimatedDurationMs: Math.round(avgDuration),
          estimatedCostUsd: Number(avgCost.toFixed(6)),
          confidence: Math.min(totalSamples * 5, 80), // Max 80% for cross-domain
          sampleCount: totalSamples,
          maxStrikes: avgSuccessRate < 50 ? 5 : avgSuccessRate < 80 ? 3 : 2,
        };
      }
    }

    return defaultPrediction;
  } catch (error) {
    console.error("[DIFFICULTY] Prediction failed:", error);
    return defaultPrediction;
  }
}

/**
 * Record task completion data for future predictions.
 */
export async function recordTaskDifficulty(params: {
  domain: string;
  taskType: string;
  durationMs: number;
  strikes: number;
  costUsd: number;
  success: boolean;
}): Promise<void> {
  try {
    await getSupabaseClient().rpc("upsert_task_difficulty", {
      p_domain: params.domain || "unknown",
      p_task_type: params.taskType,
      p_duration_ms: params.durationMs,
      p_strikes: params.strikes,
      p_cost_usd: params.costUsd,
      p_success: params.success,
    });
  } catch (error) {
    console.error("[DIFFICULTY] Failed to record:", error);
  }
}

function mapCacheToPrediction(cache: Record<string, unknown>): DifficultyPrediction {
  const successRate = Number(cache.success_rate) || 75;
  const sampleCount = Number(cache.sample_count) || 0;

  return {
    difficulty: classifyDifficulty(successRate),
    predictedSuccessRate: Math.round(successRate),
    recommendedMethod: (cache.recommended_method as "api" | "browser" | "email_fallback") || "browser",
    recommendedModel: (cache.recommended_model as string) || null,
    estimatedDurationMs: Number(cache.avg_duration_ms) || 30000,
    estimatedCostUsd: Number(Number(cache.avg_cost_usd).toFixed(6)),
    confidence: Math.min(sampleCount * 10, 95), // Max 95% confidence
    sampleCount,
    maxStrikes: successRate < 50 ? 5 : successRate < 80 ? 3 : 2,
  };
}

function classifyDifficulty(successRate: number): "easy" | "medium" | "hard" | "nightmare" {
  if (successRate >= 90) return "easy";
  if (successRate >= 70) return "medium";
  if (successRate >= 40) return "hard";
  return "nightmare";
}
