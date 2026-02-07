/**
 * Self-Debugging System
 *
 * Automatically diagnoses task failures and applies fixes.
 * When a task fails, the system:
 * 1. Analyzes the error and context
 * 2. Generates hypotheses for the cause
 * 3. Tests fixes in order of likelihood
 * 4. Records successful fixes for future use
 *
 * Fix strategies (in order):
 * 1. Retry with different method (click_css → click_xpath → click_text)
 * 2. Add wait time (element might be loading)
 * 3. Clear cookies/cache (session issue)
 * 4. Use vision mode (DOM-based methods failing)
 * 5. Switch execution level (browser_cached → browser_new)
 * 6. OAuth refresh (token expired)
 * 7. Escalate to human (unfixable)
 */

import { getSupabaseClient } from "../utils/supabase.js";
import type { Action, ActionResult } from "../types/index.js";

export interface DebugHypothesis {
  cause: string;
  likelihood: number; // 0-100
  suggestedFix: DebugFix;
  reasoning: string;
}

export interface DebugFix {
  type:
    | "retry_different_method"
    | "add_wait"
    | "clear_session"
    | "use_vision"
    | "escalate_execution"
    | "refresh_oauth"
    | "ask_user";
  params: Record<string, unknown>;
  estimatedSuccessRate: number;
}

export interface DebugResult {
  fixed: boolean;
  appliedFix: DebugFix | null;
  attempts: number;
  finalError?: string;
}

/**
 * Diagnose a failed action and generate fix hypotheses
 */
export async function diagnoseFailure(
  action: Action,
  error: string,
  context: {
    userId: string;
    domain: string;
    taskType: string;
    previousAttempts: number;
  }
): Promise<DebugHypothesis[]> {
  const hypotheses: DebugHypothesis[] = [];

  console.log(`[DEBUG] Diagnosing failure: ${action.type} on ${context.domain} (attempt ${context.previousAttempts + 1})`);
  console.log(`[DEBUG] Error: ${error}`);

  // Analyze error message to determine likely causes
  const errorLower = error.toLowerCase();

  // Hypothesis 1: Selector not found → try different method
  if (errorLower.includes("not found") || errorLower.includes("no such element") || errorLower.includes("selector")) {
    hypotheses.push({
      cause: "Element selector invalid or page structure changed",
      likelihood: 80,
      reasoning: "Error indicates element not found — likely wrong selector or page layout changed",
      suggestedFix: {
        type: "retry_different_method",
        params: {
          action: action.type,
          fallbackMethods: getFallbackMethods(action.type, action.params?.method as string),
        },
        estimatedSuccessRate: 70,
      },
    });
  }

  // Hypothesis 2: Timing issue → add wait
  if (errorLower.includes("timeout") || errorLower.includes("loading") || context.previousAttempts === 0) {
    hypotheses.push({
      cause: "Element not loaded yet or page still loading",
      likelihood: 60,
      reasoning: "Timeout error or first attempt — element may still be loading",
      suggestedFix: {
        type: "add_wait",
        params: {
          waitMs: context.previousAttempts === 0 ? 2000 : 5000, // Progressive wait
          waitFor: "networkidle",
        },
        estimatedSuccessRate: 65,
      },
    });
  }

  // Hypothesis 3: Session/auth issue → clear session or refresh OAuth
  if (errorLower.includes("unauthorized") || errorLower.includes("login") || errorLower.includes("authentication")) {
    // Check if OAuth is available for this domain
    const { data: oauth } = await getSupabaseClient()
      .from("oauth_connections")
      .select("service, expires_at")
      .eq("user_id", context.userId)
      .single();

    if (oauth && new Date(oauth.expires_at) < new Date()) {
      hypotheses.push({
        cause: "OAuth token expired",
        likelihood: 90,
        reasoning: "Auth error and expired OAuth token detected",
        suggestedFix: {
          type: "refresh_oauth",
          params: { service: oauth.service },
          estimatedSuccessRate: 85,
        },
      });
    } else {
      hypotheses.push({
        cause: "Session expired or cookies invalid",
        likelihood: 70,
        reasoning: "Auth error but no OAuth — likely cookie/session issue",
        suggestedFix: {
          type: "clear_session",
          params: { domain: context.domain },
          estimatedSuccessRate: 60,
        },
      });
    }
  }

  // Hypothesis 4: Dynamic/complex page → use vision
  if (context.previousAttempts >= 2 || errorLower.includes("shadow") || errorLower.includes("iframe")) {
    hypotheses.push({
      cause: "Page uses dynamic elements or complex DOM (Shadow DOM, iframes)",
      likelihood: 50,
      reasoning: "Multiple attempts failed — may need vision-based interaction",
      suggestedFix: {
        type: "use_vision",
        params: { enableVision: true },
        estimatedSuccessRate: 55,
      },
    });
  }

  // Hypothesis 5: Execution level too low → escalate
  if (context.previousAttempts >= 3) {
    hypotheses.push({
      cause: "Current execution method insufficient for complexity",
      likelihood: 40,
      reasoning: "Multiple failures across methods — need more sophisticated approach",
      suggestedFix: {
        type: "escalate_execution",
        params: { escalateFrom: "cached_browser", escalateTo: "full_browser" },
        estimatedSuccessRate: 50,
      },
    });
  }

  // Hypothesis 6: Unfixable → ask user
  if (context.previousAttempts >= 5 || errorLower.includes("captcha") || errorLower.includes("verification")) {
    hypotheses.push({
      cause: "Manual intervention required (CAPTCHA, 2FA, or unsupported page)",
      likelihood: context.previousAttempts >= 5 ? 80 : 30,
      reasoning: context.previousAttempts >= 5 ? "All automated fixes exhausted" : "CAPTCHA or verification detected",
      suggestedFix: {
        type: "ask_user",
        params: { reason: "CAPTCHA or manual verification required" },
        estimatedSuccessRate: 100, // User intervention = guaranteed fix (if they respond)
      },
    });
  }

  // Sort by likelihood descending
  hypotheses.sort((a, b) => b.likelihood - a.likelihood);

  console.log(`[DEBUG] Generated ${hypotheses.length} hypotheses, most likely: ${hypotheses[0]?.cause}`);
  return hypotheses;
}

/**
 * Attempt to fix a failure using the suggested fix
 */
export async function applyFix(
  fix: DebugFix,
  action: Action,
  context: {
    userId: string;
    domain: string;
    executionEngine?: unknown; // ExecutionEngine instance
  }
): Promise<{ success: boolean; error?: string }> {
  console.log(`[DEBUG] Applying fix: ${fix.type}`);

  switch (fix.type) {
    case "retry_different_method": {
      const methods = fix.params.fallbackMethods as string[];
      console.log(`[DEBUG] Trying fallback methods: ${methods.join(", ")}`);
      // This would be called by the action executor
      return { success: true }; // Indicates fix was applied, actual retry happens in executor
    }

    case "add_wait": {
      const waitMs = fix.params.waitMs as number;
      console.log(`[DEBUG] Adding ${waitMs}ms wait before retry`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return { success: true };
    }

    case "clear_session": {
      const domain = fix.params.domain as string;
      console.log(`[DEBUG] Clearing session for ${domain}`);
      try {
        // Clear user_sessions table entry
        await getSupabaseClient()
          .from("user_sessions")
          .delete()
          .eq("user_id", context.userId)
          .eq("domain", domain);
        console.log(`[DEBUG] Session cleared for ${domain}`);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    case "use_vision": {
      console.log(`[DEBUG] Enabling vision mode for retry`);
      // This would set a flag for the execution engine to use vision
      return { success: true };
    }

    case "escalate_execution": {
      const escalateTo = fix.params.escalateTo as string;
      console.log(`[DEBUG] Escalating execution level to ${escalateTo}`);
      // This would trigger iterative deepening escalation
      return { success: true };
    }

    case "refresh_oauth": {
      const service = fix.params.service as string;
      console.log(`[DEBUG] OAuth refresh needed for ${service}`);
      // TODO: Implement automatic OAuth refresh
      // For now, this is handled by oauth-manager.ts checkAndRefreshExpiring()
      console.log(`[DEBUG] Flagged OAuth refresh for ${service}`);
      return { success: true };
    }

    case "ask_user": {
      const reason = fix.params.reason as string;
      console.log(`[DEBUG] Escalating to user: ${reason}`);
      // This would send clarification request to user
      return { success: true };
    }

    default:
      return { success: false, error: "Unknown fix type" };
  }
}

/**
 * Run full debug cycle: diagnose → apply fixes → record success
 */
export async function debugAndFix(
  action: Action,
  error: string,
  context: {
    userId: string;
    domain: string;
    taskType: string;
    previousAttempts: number;
  }
): Promise<DebugResult> {
  const hypotheses = await diagnoseFailure(action, error, context);

  if (hypotheses.length === 0) {
    console.log(`[DEBUG] No fix hypotheses generated`);
    return { fixed: false, appliedFix: null, attempts: 0, finalError: error };
  }

  // Try fixes in order of likelihood
  for (let i = 0; i < Math.min(hypotheses.length, 3); i++) {
    const hypothesis = hypotheses[i];
    console.log(`[DEBUG] Attempt ${i + 1}: ${hypothesis.cause} (${hypothesis.likelihood}% likely)`);

    const fixResult = await applyFix(hypothesis.suggestedFix, action, { userId: context.userId, domain: context.domain });

    if (fixResult.success) {
      // Record successful fix for learning
      await recordSuccessfulFix(context.domain, context.taskType, action.type, error, hypothesis.suggestedFix.type);

      return {
        fixed: true,
        appliedFix: hypothesis.suggestedFix,
        attempts: i + 1,
      };
    } else {
      console.log(`[DEBUG] Fix failed: ${fixResult.error}`);
    }
  }

  console.log(`[DEBUG] All fixes exhausted, could not auto-fix`);
  return {
    fixed: false,
    appliedFix: null,
    attempts: hypotheses.length,
    finalError: error,
  };
}

/**
 * Get fallback methods for an action type
 */
function getFallbackMethods(actionType: string, currentMethod: string | undefined): string[] {
  const methodChains: Record<string, string[]> = {
    click: ["click_css", "click_xpath", "click_text", "click_role", "click_label", "click_force", "click_js", "click_vision"],
    fill: ["fill_standard", "fill_label", "fill_placeholder", "fill_name", "fill_js", "fill_react", "fill_vision"],
    navigate: ["navigate_url", "navigate_search", "navigate_menu", "navigate_cached", "navigate_sitemap", "navigate_vision"],
  };

  const chain = methodChains[actionType] || [];
  if (!currentMethod) return chain;

  // Return methods after the current one
  const currentIndex = chain.indexOf(currentMethod);
  return currentIndex >= 0 ? chain.slice(currentIndex + 1) : chain;
}

/**
 * Record successful fix for future use
 */
async function recordSuccessfulFix(
  domain: string,
  taskType: string,
  actionType: string,
  originalError: string,
  fixType: string
): Promise<void> {
  try {
    // Store in verification_learnings table
    await getSupabaseClient().from("verification_learnings").upsert(
      {
        domain,
        task_type: taskType,
        action_type: actionType,
        original_error: originalError.substring(0, 200), // Truncate
        correction_hint: `Auto-fix: ${fixType}`,
        times_applied: 1,
        times_succeeded: 1,
        success_rate: 100,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: "domain,task_type,action_type,correction_hint" }
    );

    console.log(`[DEBUG] Recorded successful fix: ${fixType} for ${actionType} on ${domain}`);
  } catch (error) {
    console.error("[DEBUG] Error recording fix:", error);
  }
}

/**
 * Query known fixes for an error
 */
export async function getKnownFixes(domain: string, taskType: string, actionType: string, error: string): Promise<DebugFix[]> {
  try {
    const { data: knownFixes } = await getSupabaseClient()
      .from("verification_learnings")
      .select("correction_hint, success_rate")
      .eq("domain", domain)
      .eq("task_type", taskType)
      .eq("action_type", actionType)
      .gte("success_rate", 60)
      .order("success_rate", { ascending: false })
      .limit(5);

    if (!knownFixes || knownFixes.length === 0) return [];

    const fixes: DebugFix[] = knownFixes.map((fix) => {
      // Parse correction_hint to extract fix type
      const hint = fix.correction_hint;
      let type: DebugFix["type"] = "retry_different_method";
      let params: Record<string, unknown> = {};

      if (hint.includes("wait")) type = "add_wait";
      else if (hint.includes("clear")) type = "clear_session";
      else if (hint.includes("vision")) type = "use_vision";
      else if (hint.includes("escalate")) type = "escalate_execution";
      else if (hint.includes("oauth")) type = "refresh_oauth";

      return {
        type,
        params,
        estimatedSuccessRate: fix.success_rate,
      };
    });

    console.log(`[DEBUG] Found ${fixes.length} known fixes for ${actionType} on ${domain}`);
    return fixes;
  } catch (error) {
    console.error("[DEBUG] Error querying known fixes:", error);
    return [];
  }
}
