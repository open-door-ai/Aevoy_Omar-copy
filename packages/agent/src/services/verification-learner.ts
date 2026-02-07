/**
 * Verification Learning System
 *
 * Learns from verification corrections so the system can pre-apply
 * known fixes before the first attempt, avoiding unnecessary retries.
 *
 * Self-learning loop:
 * 1. After strike 2+ succeeds → record the correction hint that fixed it
 * 2. Before execution → check for known corrections for this (domain, task_type)
 * 3. If corrections exist with >60% success → inject into prompt BEFORE first attempt
 * 4. Track whether pre-applied hints actually help
 */

import { getSupabaseClient } from "../utils/supabase.js";

interface VerificationHint {
  correctionHint: string;
  successRate: number;
  timesApplied: number;
  timesHelped: number;
}

// Only pre-apply corrections with success rate above this threshold
const PRE_APPLY_THRESHOLD = 60;

/**
 * Record a successful correction hint from verification.
 * Called when strike 2+ succeeds with correction hints.
 */
export async function recordCorrectionSuccess(params: {
  domain: string;
  taskType: string;
  correctionHints: string[];
}): Promise<void> {
  try {
    for (const hint of params.correctionHints) {
      if (!hint || hint.length < 5) continue;

      // Normalize hint (trim, lowercase first word for dedup)
      const normalizedHint = hint.trim().substring(0, 500);

      await getSupabaseClient().rpc("upsert_verification_learning", {
        p_domain: params.domain || "unknown",
        p_task_type: params.taskType,
        p_correction_hint: normalizedHint,
        p_helped: true,
      });
    }
  } catch (error) {
    console.error("[VERIFY-LEARN] Failed to record correction:", error);
  }
}

/**
 * Record that a pre-applied correction was used but didn't help.
 */
export async function recordCorrectionFailure(params: {
  domain: string;
  taskType: string;
  correctionHint: string;
}): Promise<void> {
  try {
    await getSupabaseClient().rpc("upsert_verification_learning", {
      p_domain: params.domain || "unknown",
      p_task_type: params.taskType,
      p_correction_hint: params.correctionHint.trim().substring(0, 500),
      p_helped: false,
    });
  } catch (error) {
    console.error("[VERIFY-LEARN] Failed to record failure:", error);
  }
}

/**
 * Get known correction hints for a task before execution.
 * Returns hints with >60% success rate, sorted by effectiveness.
 */
export async function getKnownCorrections(
  domain: string,
  taskType: string
): Promise<string[]> {
  try {
    // Check domain-specific corrections
    const { data: domainHints } = await getSupabaseClient()
      .from("verification_learnings")
      .select("correction_hint, success_rate, times_applied, times_helped")
      .eq("domain", domain)
      .eq("task_type", taskType)
      .gte("success_rate", PRE_APPLY_THRESHOLD)
      .gte("times_applied", 2) // Need at least 2 data points
      .order("success_rate", { ascending: false })
      .limit(5);

    if (domainHints && domainHints.length > 0) {
      console.log(
        `[VERIFY-LEARN] Found ${domainHints.length} known corrections for ${domain}/${taskType}`
      );
      return domainHints.map((h) => h.correction_hint);
    }

    // Fall back to task-type-only corrections (cross-domain)
    const { data: typeHints } = await getSupabaseClient()
      .from("verification_learnings")
      .select("correction_hint, success_rate, times_applied")
      .eq("task_type", taskType)
      .gte("success_rate", 75) // Higher threshold for cross-domain
      .gte("times_applied", 5) // Need more data for cross-domain
      .order("success_rate", { ascending: false })
      .limit(3);

    if (typeHints && typeHints.length > 0) {
      return typeHints.map((h) => h.correction_hint);
    }

    return [];
  } catch (error) {
    console.error("[VERIFY-LEARN] Failed to get corrections:", error);
    return [];
  }
}

/**
 * Format known corrections as a prompt injection string.
 * Used to pre-apply fixes into the AI prompt before first attempt.
 */
export function formatCorrectionsForPrompt(corrections: string[]): string {
  if (corrections.length === 0) return "";

  const correctionList = corrections
    .map((c, i) => `${i + 1}. ${c}`)
    .join("\n");

  return `\n\nIMPORTANT - Known issues for this type of task (apply these fixes proactively):\n${correctionList}`;
}
