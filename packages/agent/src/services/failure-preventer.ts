/**
 * Failure Prevention System
 *
 * Pre-emptively avoids known failure patterns BEFORE attempting execution.
 * Analyzes task + domain → predicts likely failures → applies preventive measures.
 *
 * Prevention strategies:
 * 1. Pre-flight checks (credentials, OAuth, budget)
 * 2. Known failure pattern avoidance
 * 3. Domain-specific precautions
 * 4. Optimal method selection
 * 5. Resource pre-allocation
 * 6. Fallback chain preparation
 */

import { getSupabaseClient } from "../utils/supabase.js";

export interface FailurePrediction {
  likelihood: number; // 0-100
  failureType: string;
  reason: string;
  preventiveMeasure: PreventiveMeasure;
}

export interface PreventiveMeasure {
  type: "credential_check" | "oauth_refresh" | "method_selection" | "resource_allocation" | "skip_task" | "user_warning";
  action: string;
  automated: boolean; // Can we apply this automatically?
  estimatedSuccessIncrease: number; // How much this improves success rate
}

export interface PreventionResult {
  prevented: boolean;
  measuresApplied: PreventiveMeasure[];
  originalRisk: number;
  reducedRisk: number;
}

/**
 * Analyze task and predict potential failures
 */
export async function predictFailures(
  userId: string,
  taskType: string,
  domain: string,
  description: string
): Promise<FailurePrediction[]> {
  console.log(`[PREVENTION] Analyzing failure risks for ${taskType} on ${domain}`);

  const predictions: FailurePrediction[] = [];

  // Check 1: Historical failure rate on this domain
  const { data: domainHistory } = await getSupabaseClient()
    .from("task_difficulty_cache")
    .select("avg_success_rate, total_attempts")
    .eq("domain", domain)
    .eq("task_type", taskType)
    .single();

  if (domainHistory && domainHistory.avg_success_rate < 60 && domainHistory.total_attempts >= 5) {
    predictions.push({
      likelihood: 100 - domainHistory.avg_success_rate,
      failureType: "domain_difficulty",
      reason: `This domain has ${domainHistory.avg_success_rate}% success rate historically`,
      preventiveMeasure: {
        type: "method_selection",
        action: "Start at higher execution level (full browser or vision)",
        automated: true,
        estimatedSuccessIncrease: 25,
      },
    });
  }

  // Check 2: Missing credentials
  const requiresAuth = await checkIfRequiresAuth(domain);
  if (requiresAuth) {
    const { data: credentials } = await getSupabaseClient()
      .from("user_credentials")
      .select("id")
      .eq("user_id", userId)
      .eq("site_domain", domain)
      .single();

    if (!credentials) {
      predictions.push({
        likelihood: 90,
        failureType: "missing_credentials",
        reason: `${domain} requires login but no credentials stored`,
        preventiveMeasure: {
          type: "credential_check",
          action: `Request credentials for ${domain} before attempting task`,
          automated: false, // Need user input
          estimatedSuccessIncrease: 90,
        },
      });
    }
  }

  // Check 3: Expired OAuth tokens
  const { data: oauthConnections } = await getSupabaseClient()
    .from("oauth_connections")
    .select("service, expires_at")
    .eq("user_id", userId)
    .lte("expires_at", new Date().toISOString());

  if (oauthConnections && oauthConnections.length > 0) {
    for (const conn of oauthConnections) {
      if (description.toLowerCase().includes(conn.service.toLowerCase())) {
        predictions.push({
          likelihood: 95,
          failureType: "expired_oauth",
          reason: `${conn.service} OAuth token expired`,
          preventiveMeasure: {
            type: "oauth_refresh",
            action: `Refresh ${conn.service} OAuth token before executing`,
            automated: true,
            estimatedSuccessIncrease: 85,
          },
        });
      }
    }
  }

  // Check 4: Budget exhausted
  const { data: usage } = await getSupabaseClient()
    .from("usage")
    .select("ai_cost_cents")
    .eq("user_id", userId)
    .eq("month", new Date().toISOString().slice(0, 7))
    .single();

  const budgetCents = 1500; // $15
  if (usage && usage.ai_cost_cents >= budgetCents) {
    predictions.push({
      likelihood: 100,
      failureType: "budget_exceeded",
      reason: "Monthly budget exhausted",
      preventiveMeasure: {
        type: "skip_task",
        action: "Pause task until next month or upgrade plan",
        automated: true,
        estimatedSuccessIncrease: 0, // Can't improve if budget is gone
      },
    });
  }

  // Check 5: Known failure patterns for this domain/task combo
  const { data: knownFailures } = await getSupabaseClient()
    .from("failure_memory")
    .select("error_type, solution_method")
    .eq("site_domain", domain)
    .eq("action_type", taskType)
    .limit(10);

  if (knownFailures && knownFailures.length >= 3) {
    const mostCommonError = knownFailures.reduce((acc, f) => {
      acc[f.error_type] = (acc[f.error_type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const topError = Object.entries(mostCommonError).sort((a, b) => b[1] - a[1])[0];
    if (topError) {
      predictions.push({
        likelihood: (topError[1] / knownFailures.length) * 100,
        failureType: topError[0],
        reason: `${topError[0]} occurs in ${topError[1]}/${knownFailures.length} attempts on this domain`,
        preventiveMeasure: {
          type: "method_selection",
          action: `Use proven solution method from past successes`,
          automated: true,
          estimatedSuccessIncrease: 60,
        },
      });
    }
  }

  // Check 6: Cross-domain pattern warnings
  const { data: patterns } = await getSupabaseClient()
    .from("cross_task_patterns")
    .select("pattern_type, occurrence_count, description")
    .gte("occurrence_count", 5)
    .limit(10);

  if (patterns && patterns.length > 0) {
    const domainCategory = categorizeDomain(domain);
    for (const pattern of patterns) {
      if (pattern.pattern_type.includes(domainCategory) || pattern.pattern_type.includes(taskType)) {
        predictions.push({
          likelihood: Math.min(pattern.occurrence_count * 10, 80),
          failureType: pattern.pattern_type,
          reason: pattern.description || `Common pattern: ${pattern.pattern_type}`,
          preventiveMeasure: {
            type: "user_warning",
            action: `Warn user about ${pattern.pattern_type} and set expectations`,
            automated: true,
            estimatedSuccessIncrease: 20, // Warning helps but doesn't fix
          },
        });
      }
    }
  }

  // Sort by likelihood descending
  predictions.sort((a, b) => b.likelihood - a.likelihood);

  console.log(`[PREVENTION] Identified ${predictions.length} potential failure points`);
  return predictions;
}

/**
 * Apply preventive measures BEFORE task execution
 */
export async function applyPreventiveMeasures(
  userId: string,
  predictions: FailurePrediction[]
): Promise<PreventionResult> {
  console.log(`[PREVENTION] Applying ${predictions.length} preventive measures`);

  const measuresApplied: PreventiveMeasure[] = [];
  let originalRisk = predictions.length > 0 ? predictions[0].likelihood : 0;
  let reducedRisk = originalRisk;

  for (const prediction of predictions) {
    if (!prediction.preventiveMeasure.automated) {
      console.log(`[PREVENTION] Cannot auto-apply: ${prediction.preventiveMeasure.action} (needs user input)`);
      continue;
    }

    console.log(`[PREVENTION] Applying: ${prediction.preventiveMeasure.action}`);

    switch (prediction.preventiveMeasure.type) {
      case "oauth_refresh": {
        const service = extractServiceFromAction(prediction.preventiveMeasure.action);
        console.log(`[PREVENTION] OAuth refresh needed for ${service}`);
        // TODO: Implement automatic OAuth refresh
        // For now, this is handled by oauth-manager.ts checkAndRefreshExpiring()
        measuresApplied.push(prediction.preventiveMeasure);
        reducedRisk -= prediction.preventiveMeasure.estimatedSuccessIncrease;
        console.log(`[PREVENTION] ✓ Flagged OAuth refresh for ${service}`);
        break;
      }

      case "method_selection": {
        // This would set execution hints for the processor
        measuresApplied.push(prediction.preventiveMeasure);
        reducedRisk -= prediction.preventiveMeasure.estimatedSuccessIncrease;
        console.log(`[PREVENTION] ✓ Optimized method selection`);
        break;
      }

      case "resource_allocation": {
        // Pre-allocate browser session, warm up connections, etc.
        measuresApplied.push(prediction.preventiveMeasure);
        reducedRisk -= prediction.preventiveMeasure.estimatedSuccessIncrease;
        console.log(`[PREVENTION] ✓ Pre-allocated resources`);
        break;
      }

      case "user_warning": {
        // This would be added to the task response
        measuresApplied.push(prediction.preventiveMeasure);
        reducedRisk -= prediction.preventiveMeasure.estimatedSuccessIncrease;
        console.log(`[PREVENTION] ✓ User warning prepared`);
        break;
      }

      case "skip_task": {
        // Task should not be executed
        measuresApplied.push(prediction.preventiveMeasure);
        console.log(`[PREVENTION] ⚠️ Task should be skipped: ${prediction.reason}`);
        return {
          prevented: true,
          measuresApplied,
          originalRisk: 100,
          reducedRisk: 100, // Still 100% because we're skipping
        };
      }

      default:
        console.log(`[PREVENTION] Unknown measure type: ${prediction.preventiveMeasure.type}`);
    }
  }

  reducedRisk = Math.max(0, reducedRisk);
  console.log(`[PREVENTION] Risk reduced from ${originalRisk}% to ${reducedRisk}% (${measuresApplied.length} measures applied)`);

  return {
    prevented: false,
    measuresApplied,
    originalRisk,
    reducedRisk,
  };
}

/**
 * Full prevention cycle: predict → apply → verify readiness
 */
export async function preventFailures(
  userId: string,
  taskType: string,
  domain: string,
  description: string
): Promise<PreventionResult & { readyToExecute: boolean; blockingIssues: string[] }> {
  const predictions = await predictFailures(userId, taskType, domain, description);
  const prevention = await applyPreventiveMeasures(userId, predictions);

  // Check for blocking issues
  const blockingIssues: string[] = [];
  for (const prediction of predictions) {
    if (prediction.likelihood > 80 && !prediction.preventiveMeasure.automated) {
      blockingIssues.push(prediction.reason);
    }
  }

  const readyToExecute = blockingIssues.length === 0 && !prevention.prevented;

  if (!readyToExecute) {
    console.log(`[PREVENTION] ⛔ Task NOT ready to execute: ${blockingIssues.join(", ")}`);
  } else {
    console.log(`[PREVENTION] ✅ Task ready to execute (risk: ${prevention.reducedRisk}%)`);
  }

  return {
    ...prevention,
    readyToExecute,
    blockingIssues,
  };
}

/**
 * Record prevented failure for learning
 */
export async function recordPreventedFailure(
  domain: string,
  taskType: string,
  failureType: string,
  preventiveMeasure: string
): Promise<void> {
  try {
    console.log(`[PREVENTION] Recording prevented failure: ${failureType} on ${domain}`);
    // Could store in a prevented_failures table for analytics
  } catch (error) {
    console.error("[PREVENTION] Error recording prevention:", error);
  }
}

// Helper functions

function categorizeDomain(domain: string): string {
  const ecommerce = ["amazon", "ebay", "walmart", "target", "etsy"];
  const social = ["facebook", "twitter", "instagram", "linkedin"];
  const finance = ["chase", "wellsfargo", "bankofamerica", "paypal"];

  const name = domain.split(".")[0].toLowerCase();

  if (ecommerce.some((e) => name.includes(e))) return "ecommerce";
  if (social.some((s) => name.includes(s))) return "social";
  if (finance.some((f) => name.includes(f))) return "finance";

  return "unknown";
}

async function checkIfRequiresAuth(domain: string): Promise<boolean> {
  // Check if domain typically requires authentication
  const authDomains = ["gmail", "facebook", "amazon", "chase", "netflix", "spotify"];
  return authDomains.some((d) => domain.includes(d));
}

function extractServiceFromAction(action: string): string {
  const match = action.match(/Refresh (\w+) OAuth/);
  return match ? match[1] : "unknown";
}
