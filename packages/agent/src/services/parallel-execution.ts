/**
 * Parallel Execution Engine
 *
 * Execute multiple approaches simultaneously and use the first successful one.
 * Dramatically improves success rate and reduces average execution time.
 *
 * Strategy:
 * - Launch 2-4 parallel attempts with different methods
 * - First to succeed wins, others are cancelled
 * - Learn which approach won for future optimization
 *
 * Use cases:
 * - Try multiple selectors in parallel (CSS, XPath, text, role)
 * - Try API + Browser simultaneously
 * - Try multiple login methods
 */

import { getSupabaseClient } from "../utils/supabase.js";
import type { DeepingLevel } from "./iterative-deepening.js";

export interface ParallelStrategy {
  id: string;
  name: string;
  level: DeepingLevel;
  executor: () => Promise<ParallelResult>;
  estimatedDuration: number; // ms
  estimatedCost: number; // USD
}

export interface ParallelResult {
  success: boolean;
  strategyId: string;
  duration: number;
  cost: number;
  data?: unknown;
  error?: string;
}

export interface ParallelExecutionResult {
  success: boolean;
  winningStrategy: string | null;
  results: ParallelResult[];
  totalDuration: number;
  totalCost: number;
  cancelledCount: number;
}

/**
 * Execute multiple strategies in parallel, return first success
 * All other executions are cancelled immediately
 */
export async function executeInParallel(
  strategies: ParallelStrategy[],
  options: {
    taskType: string;
    domain: string;
    maxConcurrent?: number;
    raceMode?: boolean; // true = cancel others on first success
  }
): Promise<ParallelExecutionResult> {
  const { taskType, domain, maxConcurrent = 4, raceMode = true } = options;

  console.log(`[PARALLEL] Starting ${strategies.length} strategies in parallel for ${domain}`);
  console.log(
    `[PARALLEL] Strategies: ${strategies.map((s) => s.name).join(", ")}`
  );

  const startTime = Date.now();
  const results: ParallelResult[] = [];
  const abortControllers: Map<string, AbortController> = new Map();
  let winningStrategy: string | null = null;
  let firstSuccess = false;

  // Create abort controllers for each strategy
  for (const strategy of strategies) {
    abortControllers.set(strategy.id, new AbortController());
  }

  // Execute strategies with controlled concurrency
  const executeStrategy = async (
    strategy: ParallelStrategy
  ): Promise<ParallelResult> => {
    const strategyStart = Date.now();
    console.log(`[PARALLEL] Launching strategy: ${strategy.name}`);

    try {
      const result = await strategy.executor();
      const duration = Date.now() - strategyStart;

      console.log(
        `[PARALLEL] Strategy ${strategy.name} ${result.success ? "SUCCEEDED" : "FAILED"} in ${duration}ms`
      );

      return {
        ...result,
        strategyId: strategy.id,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - strategyStart;
      console.error(`[PARALLEL] Strategy ${strategy.name} threw error:`, error);

      return {
        success: false,
        strategyId: strategy.id,
        duration,
        cost: strategy.estimatedCost,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  // Race all strategies
  const promises = strategies.map(async (strategy) => {
    const result = await executeStrategy(strategy);
    results.push(result);

    // If this succeeded and we're in race mode, cancel others
    if (result.success && raceMode && !firstSuccess) {
      firstSuccess = true;
      winningStrategy = strategy.id;

      console.log(`[PARALLEL] ✓ Winner: ${strategy.name} — cancelling others`);

      // Cancel all other strategies
      for (const [id, controller] of abortControllers.entries()) {
        if (id !== strategy.id) {
          controller.abort();
        }
      }
    }

    return result;
  });

  // Wait for all to complete or first success (if racing)
  if (raceMode) {
    // Race mode: wait for first success, then cancel others
    await Promise.race([
      ...promises,
      // Also wait a bit to give all strategies a chance
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  } else {
    // Wait for all
    await Promise.allSettled(promises);
  }

  const totalDuration = Date.now() - startTime;
  const totalCost = results.reduce((sum, r) => sum + r.cost, 0);
  const cancelledCount = strategies.length - results.length;

  // Record winning strategy for future optimization
  if (winningStrategy) {
    await recordParallelWinner(taskType, domain, winningStrategy);
  }

  console.log(`[PARALLEL] Execution complete in ${totalDuration}ms`);
  console.log(`[PARALLEL] Winner: ${winningStrategy || "none"}`);
  console.log(`[PARALLEL] Cancelled: ${cancelledCount}`);
  console.log(`[PARALLEL] Total cost: $${totalCost.toFixed(4)}`);

  return {
    success: firstSuccess,
    winningStrategy,
    results,
    totalDuration,
    totalCost,
    cancelledCount,
  };
}

/**
 * Get optimal strategy order based on historical wins
 * Returns strategies sorted by historical success rate
 */
export async function getOptimizedStrategyOrder(
  taskType: string,
  domain: string,
  strategies: ParallelStrategy[]
): Promise<ParallelStrategy[]> {
  try {
    const supabase = getSupabaseClient();

    // Query historical wins
    const { data, error } = await supabase
      .from("method_success_rates")
      .select("action_type, success_rate, times_used")
      .eq("domain", domain)
      .gte("success_rate", 50)
      .order("success_rate", { ascending: false })
      .limit(20);

    if (error || !data || data.length === 0) {
      console.log(`[PARALLEL] No history for ${domain}, using default order`);
      return strategies;
    }

    // Score strategies based on historical performance
    const scoredStrategies = strategies.map((strategy) => {
      const matchingMethods = data.filter((m) =>
        strategy.name.toLowerCase().includes(m.action_type.toLowerCase())
      );

      const avgSuccessRate =
        matchingMethods.length > 0
          ? matchingMethods.reduce((sum, m) => sum + m.success_rate, 0) /
            matchingMethods.length
          : 50; // Default 50% if no history

      const totalUses = matchingMethods.reduce((sum, m) => sum + m.times_used, 0);

      return {
        strategy,
        score: avgSuccessRate * 0.7 + Math.min(totalUses * 5, 30), // Success rate 70%, usage 30%
      };
    });

    // Sort by score descending
    scoredStrategies.sort((a, b) => b.score - a.score);

    const ordered = scoredStrategies.map((s) => s.strategy);
    console.log(
      `[PARALLEL] Optimized order: ${ordered.map((s) => s.name).join(" → ")}`
    );

    return ordered;
  } catch (error) {
    console.error("[PARALLEL] Error optimizing order:", error);
    return strategies;
  }
}

/**
 * Record which strategy won for learning
 */
async function recordParallelWinner(
  taskType: string,
  domain: string,
  strategyId: string
): Promise<void> {
  try {
    const supabase = getSupabaseClient();

    await supabase.from("method_success_rates").upsert(
      {
        domain,
        action_type: `parallel_winner_${strategyId}`,
        success_rate: 100,
        times_used: 1,
        avg_duration_ms: 0,
        last_attempt_at: new Date().toISOString(),
      },
      { onConflict: "domain,action_type" }
    );

    console.log(`[PARALLEL] Recorded winner: ${strategyId} for ${domain}`);
  } catch (error) {
    console.error("[PARALLEL] Error recording winner:", error);
  }
}

/**
 * Create parallel strategies for common tasks
 */
export function createLoginStrategies(
  page: any,
  email: string,
  password: string
): ParallelStrategy[] {
  return [
    {
      id: "standard_login",
      name: "Standard Form Login",
      level: 2,
      executor: async () => {
        // Try standard email/password form
        await page.fill('input[type="email"]', email);
        await page.fill('input[type="password"]', password);
        await page.click('button[type="submit"]');
        await page.waitForNavigation({ timeout: 5000 });
        return { success: true, strategyId: "standard_login", duration: 0, cost: 0.001 };
      },
      estimatedDuration: 3000,
      estimatedCost: 0.001,
    },
    {
      id: "label_login",
      name: "Label-Based Login",
      level: 2,
      executor: async () => {
        // Try finding by labels
        const emailField = await page.locator('text="Email"').first().inputValue();
        await page.fill(emailField, email);
        const passwordField = await page.locator('text="Password"').first().inputValue();
        await page.fill(passwordField, password);
        await page.click('text="Sign in"');
        await page.waitForNavigation({ timeout: 5000 });
        return { success: true, strategyId: "label_login", duration: 0, cost: 0.001 };
      },
      estimatedDuration: 3000,
      estimatedCost: 0.001,
    },
    {
      id: "role_login",
      name: "ARIA Role Login",
      level: 2,
      executor: async () => {
        // Try ARIA roles
        await page.fill('input[role="textbox"]', email);
        await page.fill('input[type="password"]', password);
        await page.click('button[role="button"]');
        await page.waitForNavigation({ timeout: 5000 });
        return { success: true, strategyId: "role_login", duration: 0, cost: 0.001 };
      },
      estimatedDuration: 3000,
      estimatedCost: 0.001,
    },
  ];
}

/**
 * Check if parallel execution is beneficial for this task
 * Returns true if task is complex/uncertain enough to benefit from parallelism
 */
export function shouldUseParallelExecution(
  taskType: string,
  domain: string,
  historicalSuccessRate: number
): boolean {
  // Use parallel if:
  // 1. Unknown domain (no history)
  // 2. Historical success rate < 80%
  // 3. Task type is complex (login, multi-step, form)

  if (historicalSuccessRate === 0) {
    console.log(`[PARALLEL] Unknown domain — using parallel execution`);
    return true;
  }

  if (historicalSuccessRate < 80) {
    console.log(
      `[PARALLEL] Low success rate (${historicalSuccessRate}%) — using parallel execution`
    );
    return true;
  }

  const complexTasks = ["login", "signup", "checkout", "form_fill", "multi_step"];
  if (complexTasks.some((ct) => taskType.includes(ct))) {
    console.log(`[PARALLEL] Complex task type — using parallel execution`);
    return true;
  }

  console.log(`[PARALLEL] High success rate — skipping parallel execution`);
  return false;
}
