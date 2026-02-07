/**
 * Iterative Deepening Engine
 *
 * When a task fails, automatically escalate through increasingly complex approaches
 * until success. Learns optimal starting level per (task_type, domain).
 *
 * Levels:
 * 1. API Direct — Fastest, cheapest (Gmail API, Calendar API, etc.)
 * 2. Cached Browser — Proven selectors, no vision
 * 3. Full Browser — All 15 click methods, 12 fill methods
 * 4. Vision Browser — Add screenshot analysis
 * 5. Human Handoff — Ask user for help
 *
 * Database: method_success_rates table tracks optimal starting level
 */

import { getSupabaseClient } from "../utils/supabase.js";
import type { Task } from "../types/index.js";

export type DeepingLevel = 1 | 2 | 3 | 4 | 5;

export interface DeepingStrategy {
  level: DeepingLevel;
  name: string;
  description: string;
  maxCostUSD: number;
  maxDurationSec: number;
  enableVision: boolean;
  allowedMethods: string[];
}

export interface DeepingResult {
  success: boolean;
  level: DeepingLevel;
  attempts: number;
  totalCost: number;
  totalDuration: number;
  error?: string;
  shouldEscalate: boolean;
}

export interface DeepingHistory {
  taskType: string;
  domain: string;
  successfulLevel: DeepingLevel | null;
  attempts: number;
  lastUpdated: Date;
}

// Deepening strategies in ascending complexity/cost
const DEEPENING_STRATEGIES: Record<DeepingLevel, DeepingStrategy> = {
  1: {
    level: 1,
    name: "API Direct",
    description: "Use native APIs (Gmail, Calendar, etc.) - fastest and cheapest",
    maxCostUSD: 0.001,
    maxDurationSec: 5,
    enableVision: false,
    allowedMethods: ["api"],
  },
  2: {
    level: 2,
    name: "Cached Browser",
    description: "Browser with cached selectors from past successes",
    maxCostUSD: 0.01,
    maxDurationSec: 30,
    enableVision: false,
    allowedMethods: ["click_css", "click_xpath", "fill_standard", "fill_label"],
  },
  3: {
    level: 3,
    name: "Full Browser",
    description: "All 15 click methods, 12 fill methods, try everything",
    maxCostUSD: 0.05,
    maxDurationSec: 120,
    enableVision: false,
    allowedMethods: ["all"],
  },
  4: {
    level: 4,
    name: "Vision Browser",
    description: "Add screenshot analysis for dynamic/complex sites",
    maxCostUSD: 0.15,
    maxDurationSec: 180,
    enableVision: true,
    allowedMethods: ["all"],
  },
  5: {
    level: 5,
    name: "Human Handoff",
    description: "Ask user for help or manual verification",
    maxCostUSD: 0,
    maxDurationSec: Infinity,
    enableVision: false,
    allowedMethods: [],
  },
};

/**
 * Get optimal starting level for a task based on historical data
 * Falls back to level 2 (cached browser) if no history
 */
export async function getOptimalStartingLevel(
  taskType: string,
  domain: string
): Promise<DeepingLevel> {
  try {
    const supabase = getSupabaseClient();

    // Query historical success data
    const { data, error } = await supabase
      .from("method_success_rates")
      .select("action_type, success_rate, times_used")
      .eq("domain", domain)
      .gte("success_rate", 70) // Only consider reliable methods
      .order("success_rate", { ascending: false })
      .limit(10);

    if (error || !data || data.length === 0) {
      console.log(`[DEEPENING] No history for ${domain}, starting at level 2`);
      return 2; // Default: cached browser
    }

    // Analyze which methods have worked
    const hasApiSuccess = data.some((m) => m.action_type.includes("api") && m.times_used >= 3);
    const hasCachedSuccess = data.some(
      (m) => ["click_css", "click_xpath", "fill_standard"].includes(m.action_type) && m.times_used >= 3
    );
    const hasVisionSuccess = data.some((m) => m.action_type.includes("vision") && m.times_used >= 2);

    // Determine optimal starting level
    if (hasApiSuccess) {
      console.log(`[DEEPENING] API proven for ${domain}, starting at level 1`);
      return 1;
    } else if (hasCachedSuccess) {
      console.log(`[DEEPENING] Cached methods proven for ${domain}, starting at level 2`);
      return 2;
    } else if (hasVisionSuccess) {
      console.log(`[DEEPENING] Vision required for ${domain}, starting at level 4`);
      return 4;
    } else {
      console.log(`[DEEPENING] Unknown domain ${domain}, starting at level 3 (full browser)`);
      return 3;
    }
  } catch (error) {
    console.error("[DEEPENING] Error getting optimal level:", error);
    return 2; // Safe default
  }
}

/**
 * Execute task with iterative deepening
 * Starts at optimal level, escalates on failure
 */
export async function executeWithDeepening(
  task: Task,
  executor: (level: DeepingLevel, strategy: DeepingStrategy) => Promise<DeepingResult>
): Promise<DeepingResult> {
  const domain = extractDomain(task.input_text || "");
  const taskType = task.type || "unknown";

  // Get optimal starting level
  const startLevel = await getOptimalStartingLevel(taskType, domain);

  let currentLevel = startLevel;
  let totalAttempts = 0;
  let totalCost = 0;
  let totalDuration = 0;
  let lastError: string | undefined;

  console.log(`[DEEPENING] Starting task ${task.id?.slice(0, 8)} at level ${currentLevel}`);

  // Escalate through levels until success or max level
  while (currentLevel <= 5) {
    const strategy = DEEPENING_STRATEGIES[currentLevel];
    console.log(`[DEEPENING] Level ${currentLevel}: ${strategy.name}`);

    try {
      const result = await executor(currentLevel, strategy);
      totalAttempts++;
      totalCost += result.totalCost;
      totalDuration += result.totalDuration;

      if (result.success) {
        // Success! Record and return
        console.log(`[DEEPENING] SUCCESS at level ${currentLevel} after ${totalAttempts} attempts`);
        await recordDeepingSuccess(taskType, domain, currentLevel, totalAttempts);
        return {
          success: true,
          level: currentLevel,
          attempts: totalAttempts,
          totalCost,
          totalDuration,
          shouldEscalate: false,
        };
      }

      // Failure - should we escalate?
      lastError = result.error;
      if (!result.shouldEscalate) {
        // Executor says don't escalate (e.g., permanent error like 404)
        console.log(`[DEEPENING] Non-recoverable error, stopping at level ${currentLevel}`);
        break;
      }

      // Escalate to next level
      console.log(`[DEEPENING] Level ${currentLevel} failed, escalating...`);
      currentLevel = (currentLevel + 1) as DeepingLevel;
    } catch (error) {
      console.error(`[DEEPENING] Error at level ${currentLevel}:`, error);
      lastError = error instanceof Error ? error.message : String(error);
      currentLevel = (currentLevel + 1) as DeepingLevel;
    }
  }

  // All levels failed
  console.error(`[DEEPENING] FAILED at all levels after ${totalAttempts} attempts`);
  await recordDeepingFailure(taskType, domain, totalAttempts);

  return {
    success: false,
    level: 5,
    attempts: totalAttempts,
    totalCost,
    totalDuration,
    error: lastError || "All deepening levels failed",
    shouldEscalate: false,
  };
}

/**
 * Record successful deepening execution
 * Updates optimal starting level for future tasks
 */
async function recordDeepingSuccess(
  taskType: string,
  domain: string,
  successLevel: DeepingLevel,
  attempts: number
): Promise<void> {
  try {
    const supabase = getSupabaseClient();

    // Insert/update deepening history
    await supabase.from("method_success_rates").upsert(
      {
        domain,
        action_type: `deepening_level_${successLevel}`,
        success_rate: 100, // Initial success
        times_used: 1,
        avg_duration_ms: 0,
        last_attempt_at: new Date().toISOString(),
      },
      { onConflict: "domain,action_type" }
    );

    console.log(`[DEEPENING] Recorded success: ${taskType} on ${domain} at level ${successLevel}`);
  } catch (error) {
    console.error("[DEEPENING] Error recording success:", error);
  }
}

/**
 * Record deepening failure
 */
async function recordDeepingFailure(
  taskType: string,
  domain: string,
  attempts: number
): Promise<void> {
  try {
    console.log(`[DEEPENING] Recorded failure: ${taskType} on ${domain} after ${attempts} attempts`);
    // Failure is implicit - no successful level recorded
  } catch (error) {
    console.error("[DEEPENING] Error recording failure:", error);
  }
}

/**
 * Extract domain from task description
 * e.g., "Book flight on expedia.com" → "expedia.com"
 */
function extractDomain(description: string): string {
  const domainMatch = description.match(/(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z]{2,})/);
  return domainMatch ? domainMatch[1] : "unknown";
}

/**
 * Check if error is recoverable (should escalate) or permanent
 */
export function shouldEscalateError(error: string): boolean {
  const permanentErrors = [
    "404",
    "not found",
    "does not exist",
    "invalid credentials",
    "account locked",
    "payment required",
    "forbidden",
    "unauthorized",
  ];

  const errorLower = error.toLowerCase();
  return !permanentErrors.some((pe) => errorLower.includes(pe));
}

/**
 * Get strategy for a specific level
 */
export function getStrategy(level: DeepingLevel): DeepingStrategy {
  return DEEPENING_STRATEGIES[level];
}

/**
 * Check if method is allowed at current deepening level
 */
export function isMethodAllowed(method: string, level: DeepingLevel): boolean {
  const strategy = DEEPENING_STRATEGIES[level];
  if (strategy.allowedMethods.includes("all")) return true;
  if (strategy.allowedMethods.includes("api") && method.startsWith("api")) return true;
  return strategy.allowedMethods.includes(method);
}
