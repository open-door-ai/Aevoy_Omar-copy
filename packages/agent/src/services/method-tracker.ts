/**
 * Method Success Tracker
 *
 * Tracks which click/fill/navigate/login methods work best per domain
 * and reorders method attempts based on historical success rates.
 *
 * Self-learning loop:
 * 1. After every action attempt → record success/failure per method
 * 2. Before trying methods → query for this domain
 * 3. Reorder methods by success rate DESC
 * 4. Skip methods below 20% success rate
 */

import { getSupabaseClient } from "../utils/supabase.js";

interface MethodRanking {
  methodName: string;
  successRate: number;
  totalAttempts: number;
  avgDurationMs: number;
}

// Default method order for each action type
const DEFAULT_METHOD_ORDER: Record<string, string[]> = {
  click: [
    "css", "text", "role", "label", "xpath", "placeholder",
    "force_js", "coordinates", "vision", "double_click",
    "hover_click", "scroll_click",
  ],
  fill: [
    "standard", "label", "placeholder", "name", "id",
    "xpath", "js_value", "react_hack", "focus_type",
    "clipboard", "vision",
  ],
  navigate: [
    "url", "search", "menu", "sitemap", "cached",
    "search_engine", "vision", "back_forward",
  ],
  login: [
    "standard", "oauth_google", "oauth_microsoft", "magic_link",
    "cookie_inject", "session_restore", "sso", "api_login",
  ],
};

// Minimum success rate before disabling a method for a domain
const DISABLE_THRESHOLD = 20;
// Minimum attempts before trusting the data
const MIN_ATTEMPTS = 3;

/**
 * Record a method attempt result for learning.
 */
export async function recordMethodAttempt(params: {
  domain: string;
  actionType: string;
  methodName: string;
  success: boolean;
  durationMs: number;
}): Promise<void> {
  try {
    await getSupabaseClient().rpc("upsert_method_success", {
      p_domain: params.domain,
      p_action_type: params.actionType,
      p_method_name: params.methodName,
      p_success: params.success,
      p_duration_ms: params.durationMs,
    });
  } catch (error) {
    console.error("[METHOD-TRACKER] Failed to record:", error);
  }
}

/**
 * Get optimized method order for a given domain and action type.
 * Returns methods sorted by success rate, with failed methods removed.
 */
export async function getOptimizedMethodOrder(
  domain: string,
  actionType: string
): Promise<string[]> {
  const defaultOrder = DEFAULT_METHOD_ORDER[actionType] || [];

  try {
    const { data } = await getSupabaseClient()
      .from("method_success_rates")
      .select("method_name, successes, failures, avg_duration_ms")
      .eq("domain", domain)
      .eq("action_type", actionType);

    if (!data || data.length === 0) {
      return defaultOrder;
    }

    // Build ranking map
    const rankings = new Map<string, MethodRanking>();
    for (const row of data) {
      const total = row.successes + row.failures;
      if (total < MIN_ATTEMPTS) continue;

      rankings.set(row.method_name, {
        methodName: row.method_name,
        successRate: (row.successes / total) * 100,
        totalAttempts: total,
        avgDurationMs: row.avg_duration_ms,
      });
    }

    if (rankings.size === 0) {
      return defaultOrder;
    }

    // Sort: methods with data first (by success rate DESC), then unknown methods
    const sorted = [...defaultOrder].sort((a, b) => {
      const rankA = rankings.get(a);
      const rankB = rankings.get(b);

      if (!rankA && !rankB) return 0;
      if (!rankA) return 1;
      if (!rankB) return -1;

      // Filter out consistently failing methods
      if (rankA.successRate < DISABLE_THRESHOLD && rankA.totalAttempts >= 5) return 1;
      if (rankB.successRate < DISABLE_THRESHOLD && rankB.totalAttempts >= 5) return -1;

      return rankB.successRate - rankA.successRate;
    });

    // Remove methods that are consistently failing
    const filtered = sorted.filter(method => {
      const rank = rankings.get(method);
      if (!rank) return true; // Keep unknown methods
      if (rank.totalAttempts >= 5 && rank.successRate < DISABLE_THRESHOLD) {
        console.log(
          `[METHOD-TRACKER] Disabling ${method} for ${domain}/${actionType} (${rank.successRate.toFixed(0)}% success)`
        );
        return false;
      }
      return true;
    });

    return filtered.length > 0 ? filtered : defaultOrder;
  } catch (error) {
    console.error("[METHOD-TRACKER] Failed to get optimized order:", error);
    return defaultOrder;
  }
}

/**
 * Get overall method success rates across all domains (global intelligence).
 * Used to set default method order for new domains.
 */
export async function getGlobalMethodRankings(
  actionType: string
): Promise<MethodRanking[]> {
  try {
    const { data } = await getSupabaseClient()
      .from("method_success_rates")
      .select("method_name, successes, failures, avg_duration_ms")
      .eq("action_type", actionType);

    if (!data || data.length === 0) return [];

    // Aggregate across domains
    const aggregated = new Map<string, { successes: number; failures: number; totalDuration: number; count: number }>();

    for (const row of data) {
      const existing = aggregated.get(row.method_name) || { successes: 0, failures: 0, totalDuration: 0, count: 0 };
      existing.successes += row.successes;
      existing.failures += row.failures;
      existing.totalDuration += row.avg_duration_ms;
      existing.count += 1;
      aggregated.set(row.method_name, existing);
    }

    const rankings: MethodRanking[] = [];
    for (const [name, stats] of aggregated) {
      const total = stats.successes + stats.failures;
      if (total < 10) continue; // Need more data globally

      rankings.push({
        methodName: name,
        successRate: (stats.successes / total) * 100,
        totalAttempts: total,
        avgDurationMs: Math.round(stats.totalDuration / stats.count),
      });
    }

    return rankings.sort((a, b) => b.successRate - a.successRate);
  } catch {
    return [];
  }
}
