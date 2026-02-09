/**
 * Template Recorder — "Teach & Repeat"
 *
 * Records successful browser action sequences as replayable templates.
 * When a similar task arrives, matches it against stored templates and
 * replays the learned sequence instead of re-planning from scratch.
 *
 * Flow:
 *   1. Task completes successfully with browser actions
 *   2. recordTemplate() saves the action sequence + extracted variables
 *   3. Next similar task arrives → findTemplate() matches by domain + text similarity
 *   4. replayTemplate() re-executes the stored steps with variable substitution
 */

import { getSupabaseClient } from "../utils/supabase.js";
import type { ActionResult, Action } from "../types/index.js";

export interface TemplateMatch {
  id: string;
  taskPattern: string;
  steps: TemplateStep[];
  variables: Record<string, string>;
  successCount: number;
  failCount: number;
  avgDurationMs: number;
  rank: number;
}

export interface TemplateStep {
  type: string;
  params: Record<string, unknown>;
}

/**
 * Extract variable-like values from action params.
 * URLs, search queries, form values, etc. become template variables
 * that can be swapped on replay.
 */
function extractVariables(
  steps: TemplateStep[],
  taskText: string
): { parameterizedSteps: TemplateStep[]; variables: Record<string, string> } {
  const variables: Record<string, string> = {};
  let varIndex = 0;

  const parameterizedSteps = steps.map(step => {
    const newParams: Record<string, unknown> = { ...step.params };

    // Parameterize URL paths (keep domain, replace path)
    if (step.type === "navigate" && typeof newParams.url === "string") {
      const url = newParams.url as string;
      try {
        const parsed = new URL(url);
        // Keep the domain, parameterize query strings
        if (parsed.search) {
          const varName = `{{query_${varIndex++}}}`;
          variables[varName] = parsed.search;
          newParams.url = `${parsed.origin}${parsed.pathname}${varName}`;
        }
      } catch {
        // Not a valid URL, skip parameterization
      }
    }

    // Parameterize search/fill values
    if (step.type === "fill" && typeof newParams.value === "string") {
      const val = newParams.value as string;
      // Only parameterize if the value appears in the task text (user-specific input)
      if (val.length > 2 && taskText.toLowerCase().includes(val.toLowerCase())) {
        const varName = `{{input_${varIndex++}}}`;
        variables[varName] = val;
        newParams.value = varName;
      }
    }

    // Parameterize search queries
    if (step.type === "search" && typeof newParams.query === "string") {
      const varName = `{{search_${varIndex++}}}`;
      variables[varName] = newParams.query as string;
      newParams.query = varName;
    }

    return { type: step.type, params: newParams };
  });

  return { parameterizedSteps, variables };
}

/**
 * Record a successful browser execution as a replayable template.
 * Called after task completion with browser actions.
 */
export async function recordTemplate(
  userId: string,
  domain: string,
  taskText: string,
  taskType: string,
  actionResults: ActionResult[],
  durationMs: number,
  costUsd: number
): Promise<string | null> {
  // Only record if we had at least 2 successful actions
  const successfulActions = actionResults.filter(r => r.success);
  if (successfulActions.length < 2) return null;

  // Convert action results to template steps
  const rawSteps: TemplateStep[] = successfulActions.map(r => ({
    type: r.action.type,
    params: r.action.params,
  }));

  // Extract variables for parameterization
  const { parameterizedSteps, variables } = extractVariables(rawSteps, taskText);

  try {
    const { data } = await getSupabaseClient().rpc("upsert_workflow_template", {
      p_user_id: userId,
      p_domain: domain,
      p_task_pattern: taskText.substring(0, 500),
      p_task_type: taskType,
      p_steps: parameterizedSteps,
      p_variables: variables,
      p_duration_ms: durationMs,
      p_cost_usd: costUsd,
    });

    const templateId = data as string | null;
    if (templateId) {
      console.log(`[TEMPLATE] Recorded template ${templateId} for ${domain} (${parameterizedSteps.length} steps, ${Object.keys(variables).length} variables)`);
    }
    return templateId;
  } catch (err) {
    console.warn("[TEMPLATE] Failed to record template:", err);
    return null;
  }
}

/**
 * Find a matching template for a given task.
 * Uses full-text search ranking by domain + task text similarity.
 */
export async function findTemplate(
  userId: string,
  domain: string,
  taskText: string
): Promise<TemplateMatch | null> {
  try {
    const { data, error } = await getSupabaseClient().rpc("find_matching_template", {
      p_user_id: userId,
      p_domain: domain,
      p_task_text: taskText.substring(0, 500),
    });

    if (error || !data || !Array.isArray(data) || data.length === 0) {
      return null;
    }

    const best = data[0];

    // Only use template if success rate > 70%
    const successRate = best.success_count / (best.success_count + best.fail_count);
    if (successRate < 0.7) {
      console.log(`[TEMPLATE] Found template but success rate too low (${(successRate * 100).toFixed(0)}%)`);
      return null;
    }

    console.log(`[TEMPLATE] Found matching template: "${best.task_pattern.substring(0, 60)}..." (rank=${best.rank.toFixed(3)}, success=${best.success_count})`);

    return {
      id: best.id,
      taskPattern: best.task_pattern,
      steps: best.steps as TemplateStep[],
      variables: best.variables as Record<string, string>,
      successCount: best.success_count,
      failCount: best.fail_count,
      avgDurationMs: best.avg_duration_ms,
      rank: best.rank,
    };
  } catch (err) {
    console.warn("[TEMPLATE] Failed to find template:", err);
    return null;
  }
}

/**
 * Substitute variables in template steps with new values extracted from the task.
 * Uses the AI's action params to fill in template variables.
 */
export function substituteVariables(
  steps: TemplateStep[],
  originalVariables: Record<string, string>,
  newTaskText: string,
  newActions?: Action[]
): TemplateStep[] {
  // Build substitution map from new task
  const substitutions: Record<string, string> = {};

  // If AI generated actions for this task, use those values to fill variables
  if (newActions && newActions.length > 0) {
    let varIndex = 0;
    for (const action of newActions) {
      if (action.type === "fill" && typeof action.params.value === "string") {
        // Match fill variables in order
        const fillVars = Object.keys(originalVariables).filter(k => k.startsWith("{{input_"));
        if (varIndex < fillVars.length) {
          substitutions[fillVars[varIndex]] = action.params.value as string;
          varIndex++;
        }
      }
      if (action.type === "search" && typeof action.params.query === "string") {
        const searchVars = Object.keys(originalVariables).filter(k => k.startsWith("{{search_"));
        if (searchVars.length > 0) {
          substitutions[searchVars[0]] = action.params.query as string;
        }
      }
    }
  }

  // Fallback: if no AI actions, try to extract values from task text
  if (Object.keys(substitutions).length === 0) {
    // For search variables, use the task text itself as the query
    for (const [varName] of Object.entries(originalVariables)) {
      if (varName.startsWith("{{search_")) {
        substitutions[varName] = newTaskText.substring(0, 200);
      }
    }
  }

  // Apply substitutions to steps
  return steps.map(step => {
    const newParams: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(step.params)) {
      if (typeof value === "string") {
        let result = value;
        for (const [varName, replacement] of Object.entries(substitutions)) {
          result = result.replace(varName, replacement);
        }
        // If variable wasn't substituted, use original value
        for (const [varName, original] of Object.entries(originalVariables)) {
          result = result.replace(varName, original);
        }
        newParams[key] = result;
      } else {
        newParams[key] = value;
      }
    }
    return { type: step.type, params: newParams };
  });
}

/**
 * Record a template replay failure so quality tracking stays accurate.
 */
export async function recordTemplateFailure(templateId: string): Promise<void> {
  try {
    await getSupabaseClient().rpc("record_template_failure", {
      p_template_id: templateId,
    });
    console.log(`[TEMPLATE] Recorded failure for template ${templateId}`);
  } catch {
    // Non-critical
  }
}
