/**
 * Task Planner
 *
 * Determines the optimal execution method for a task:
 * - 'api': Direct API call (Google Calendar, Gmail, etc.) — fastest, cheapest
 * - 'browser_cached': Replay recorded browser steps — fast, reliable
 * - 'browser_new': AI-driven browser with step recording — standard
 * - 'direct': Existing AI-driven flow (no change) — fallback
 */

import { getSupabaseClient } from "../utils/supabase.js";
import type { Memory, ExecutionPlan, PlanStep } from "../types/index.js";
import { findSkillForTask } from "./skill-registry.js";

interface Classification {
  taskType: string;
  goal: string;
  domains: string[];
  needsBrowser: boolean;
}

/**
 * Create an execution plan for a task.
 * Checks API skills, cached browser steps, and auth status.
 * Falls through to 'direct' (existing flow) if nothing matches.
 */
export async function createPlan(
  userId: string,
  taskId: string,
  classification: Classification,
  _memory: Memory,
  _learningsHint: string
): Promise<ExecutionPlan> {
  const plan: ExecutionPlan = {
    taskId,
    method: "direct",
    steps: [],
    requiredAuth: [],
    estimatedCost: 0.05,
  };

  // 1. Check for API skills (fastest path)
  try {
    // Get user's connected providers
    const { data: connections } = await getSupabaseClient()
      .from("oauth_connections")
      .select("provider, status")
      .eq("user_id", userId)
      .eq("status", "active");

    const userProviders = (connections || []).map((c) => c.provider);

    const skill = await findSkillForTask(
      classification.goal,
      classification.domains,
      userProviders
    );

    if (skill) {
      plan.method = "api";
      plan.estimatedCost = 0.001; // API calls are nearly free
      plan.steps = [
        {
          type: "api_call",
          description: `Execute via ${skill.provider} API: ${skill.action}`,
          params: { skillId: skill.id, skillName: skill.name, provider: skill.provider },
        },
      ];
      plan.requiredAuth = [{ provider: skill.provider, status: "ready" }];
      console.log(`[PLANNER] API path: ${skill.name} via ${skill.provider}`);
      return plan;
    }
  } catch {
    // Non-critical — fall through
  }

  // 2. Check cached browser steps (second fastest)
  if (classification.needsBrowser) {
    try {
      const domain = classification.domains[0] || "";
      const { data: learnings } = await getSupabaseClient()
        .from("learnings")
        .select("id, recorded_steps, page_hash, layout_verified_at, success_rate")
        .or(`service.ilike.%${domain}%,task_type.eq.${classification.taskType}`)
        .not("recorded_steps", "is", null)
        .not("page_hash", "is", null)
        .order("success_rate", { ascending: false })
        .limit(1);

      if (learnings && learnings.length > 0) {
        const learning = learnings[0];
        const verifiedAt = learning.layout_verified_at
          ? new Date(learning.layout_verified_at).getTime()
          : 0;
        const daysSinceVerified = (Date.now() - verifiedAt) / (1000 * 60 * 60 * 24);
        const successRate = Number(learning.success_rate) || 0;

        if (daysSinceVerified < 14 && successRate > 90) {
          plan.method = "browser_cached";
          plan.estimatedCost = 0.02;
          plan.steps = (learning.recorded_steps as PlanStep[]) || [];
          console.log(`[PLANNER] Cached browser path: ${domain} (${successRate}% success)`);
          return plan;
        }
      }
    } catch {
      // Non-critical
    }
  }

  // 3. Check if auth is missing for browser tasks needing login
  if (classification.needsBrowser && classification.domains.length > 0) {
    try {
      const domain = classification.domains[0];

      // Check credential vault
      const { data: cred } = await getSupabaseClient()
        .from("credential_vault")
        .select("id")
        .eq("user_id", userId)
        .eq("site_domain", domain)
        .single();

      if (!cred) {
        // Check old user_credentials too
        const { data: oldCred } = await getSupabaseClient()
          .from("user_credentials")
          .select("id")
          .eq("user_id", userId)
          .eq("site_domain", domain)
          .single();

        if (!oldCred) {
          plan.requiredAuth.push({ provider: domain, status: "missing" });
        }
      }
    } catch {
      // Non-critical
    }
  }

  // 4. Fall through to direct (existing AI-driven flow)
  plan.method = classification.needsBrowser ? "browser_new" : "direct";
  plan.estimatedCost = classification.needsBrowser ? 0.15 : 0.05;
  console.log(`[PLANNER] ${plan.method} path for ${classification.taskType}`);
  return plan;
}
