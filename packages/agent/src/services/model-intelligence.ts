/**
 * Adaptive Model Selection Engine
 *
 * Tracks which AI model performs best for each (task_type, domain) combination
 * and dynamically reorders the routing chain based on historical performance.
 *
 * Self-learning loop:
 * 1. After every AI call → record success/failure/cost/latency
 * 2. Before routing → query history for this (task_type, domain)
 * 3. Reorder chain by success rate, then cost
 */

import { getSupabaseClient } from "../utils/supabase.js";
import type { TaskType, ModelProvider } from "../types/index.js";

interface ModelPerformance {
  model: string;
  provider: string;
  successes: number;
  failures: number;
  successRate: number;
  avgCost: number;
  avgLatency: number;
}

interface ModelConfig {
  provider: ModelProvider;
  model: string;
  costPerMInput: number;
  costPerMOutput: number;
}

// Minimum calls before we trust the data enough to reorder
const MIN_SAMPLES_FOR_ADAPTATION = 5;

/**
 * Record the outcome of an AI model call for future adaptation.
 */
export async function recordModelOutcome(params: {
  userId: string;
  model: string;
  provider: string;
  taskType: string;
  domain: string;
  success: boolean;
  tokens: number;
  costUsd: number;
  latencyMs: number;
}): Promise<void> {
  try {
    await getSupabaseClient().rpc("upsert_model_performance", {
      p_user_id: params.userId,
      p_model: params.model,
      p_task_type: params.taskType,
      p_domain: params.domain || "",
      p_success: params.success,
      p_tokens: params.tokens,
      p_cost_usd: params.costUsd,
      p_latency_ms: params.latencyMs,
    });
  } catch (error) {
    // Non-critical — don't fail the task over learning
    console.error("[MODEL-INTEL] Failed to record outcome:", error);
  }
}

/**
 * Get optimized model chain for a given task type and domain.
 * Returns the default chain reordered by historical performance.
 */
export async function getAdaptiveChain(
  userId: string,
  taskType: TaskType,
  domain: string,
  defaultChain: ModelConfig[]
): Promise<ModelConfig[]> {
  try {
    // Query performance data for this user + task type + domain
    const { data: perfData } = await getSupabaseClient()
      .from("model_performance")
      .select("model, successes, failures, avg_cost_usd, avg_latency_ms")
      .eq("user_id", userId)
      .eq("task_type", taskType);

    if (!perfData || perfData.length === 0) {
      return defaultChain;
    }

    // Also check domain-specific data
    const { data: domainData } = domain
      ? await getSupabaseClient()
          .from("model_performance")
          .select("model, successes, failures, avg_cost_usd, avg_latency_ms")
          .eq("user_id", userId)
          .eq("task_type", taskType)
          .eq("domain", domain)
      : { data: null };

    // Merge domain-specific with general (domain-specific gets 2x weight)
    const perfMap = new Map<string, ModelPerformance>();

    for (const row of perfData) {
      const total = row.successes + row.failures;
      if (total < MIN_SAMPLES_FOR_ADAPTATION) continue;

      perfMap.set(row.model, {
        model: row.model,
        provider: "",
        successes: row.successes,
        failures: row.failures,
        successRate: (row.successes / total) * 100,
        avgCost: row.avg_cost_usd,
        avgLatency: row.avg_latency_ms,
      });
    }

    // Override with domain-specific data if available
    if (domainData) {
      for (const row of domainData) {
        const total = row.successes + row.failures;
        if (total < 3) continue; // Lower threshold for domain-specific

        perfMap.set(row.model, {
          model: row.model,
          provider: "",
          successes: row.successes,
          failures: row.failures,
          successRate: (row.successes / total) * 100,
          avgCost: row.avg_cost_usd,
          avgLatency: row.avg_latency_ms,
        });
      }
    }

    if (perfMap.size === 0) {
      return defaultChain;
    }

    // Sort default chain by: success rate DESC, then cost ASC
    const sorted = [...defaultChain].sort((a, b) => {
      const perfA = perfMap.get(a.model);
      const perfB = perfMap.get(b.model);

      // Models without data keep their original position
      if (!perfA && !perfB) return 0;
      if (!perfA) return 1; // Unknown models go after known ones
      if (!perfB) return -1;

      // Primary sort: success rate (higher is better)
      const rateDiff = perfB.successRate - perfA.successRate;
      if (Math.abs(rateDiff) > 5) return rateDiff; // Only reorder if >5% difference

      // Secondary sort: cost (lower is better)
      return perfA.avgCost - perfB.avgCost;
    });

    // Always keep Claude Sonnet as last resort (never remove it)
    const sonnetIdx = sorted.findIndex(m => m.provider === "sonnet");
    if (sonnetIdx !== -1 && sonnetIdx !== sorted.length - 1) {
      const sonnet = sorted.splice(sonnetIdx, 1)[0];
      sorted.push(sonnet);
    }

    console.log(
      `[MODEL-INTEL] Adaptive chain for ${taskType}/${domain}: ${sorted.map(m => m.provider).join(" → ")}`
    );

    return sorted;
  } catch (error) {
    console.error("[MODEL-INTEL] Failed to get adaptive chain:", error);
    return defaultChain;
  }
}

/**
 * Get the best-performing model for a task type (used for pre-escalation).
 */
export async function getBestModel(
  userId: string,
  taskType: string,
  domain: string
): Promise<string | null> {
  try {
    const { data } = await getSupabaseClient()
      .from("model_performance")
      .select("model, successes, failures")
      .eq("user_id", userId)
      .eq("task_type", taskType)
      .eq("domain", domain || "");

    if (!data || data.length === 0) return null;

    let bestModel: string | null = null;
    let bestRate = 0;

    for (const row of data) {
      const total = row.successes + row.failures;
      if (total < MIN_SAMPLES_FOR_ADAPTATION) continue;
      const rate = row.successes / total;
      if (rate > bestRate) {
        bestRate = rate;
        bestModel = row.model;
      }
    }

    return bestModel;
  } catch {
    return null;
  }
}
