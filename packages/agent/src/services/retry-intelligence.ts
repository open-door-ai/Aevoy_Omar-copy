/**
 * Retry Intelligence System
 *
 * Ensures the agent NEVER makes the same mistake twice.
 * Tracks all failure patterns and enforces intelligent retry diversity.
 */

import { getSupabaseClient } from "../utils/supabase.js";
import type { Action } from "../types/index.js";

export interface RetryStrategy {
  actionType: string;
  method: string;
  attemptCount: number;
  lastFailure: string;
  alternatives: string[]; // Suggested alternative approaches
}

export interface FailurePattern {
  signature: string; // Hash of action type + params
  failureCount: number;
  successfulAlternative?: string;
  forbiddenMethods: Set<string>;
}

// Global tracking of what we've tried for this task
const taskFailurePatterns = new Map<string, FailurePattern>();

/**
 * Generate a signature for an action to detect repeated attempts.
 */
export function getActionSignature(action: Action): string {
  const key = `${action.type}:${action.params?.url || action.params?.selector || action.params?.text || ''}`;
  return key;
}

/**
 * Record a failed action attempt.
 * Returns whether this strategy is now forbidden (too many failures).
 */
export function recordFailedAttempt(
  action: Action,
  method: string,
  error: string
): { forbidden: boolean; attemptCount: number } {
  const sig = getActionSignature(action);

  let pattern = taskFailurePatterns.get(sig);
  if (!pattern) {
    pattern = {
      signature: sig,
      failureCount: 0,
      forbiddenMethods: new Set(),
    };
    taskFailurePatterns.set(sig, pattern);
  }

  pattern.failureCount++;
  pattern.forbiddenMethods.add(method);

  const forbidden = pattern.failureCount >= 3; // After 3 failures, forbid this exact approach

  console.log(`[RETRY] Action ${sig} failed ${pattern.failureCount} times with method '${method}'${forbidden ? ' (NOW FORBIDDEN)' : ''}`);

  return {
    forbidden,
    attemptCount: pattern.failureCount,
  };
}

/**
 * Check if an action should be retried, and with what alternative.
 * Returns null if action is forbidden, otherwise returns suggested alternative approach.
 */
export function getRetryGuidance(action: Action): {
  shouldRetry: boolean;
  forbiddenMethods: Set<string>;
  suggestions: string[];
} | null {
  const sig = getActionSignature(action);
  const pattern = taskFailurePatterns.get(sig);

  if (!pattern) {
    return {
      shouldRetry: true,
      forbiddenMethods: new Set(),
      suggestions: [],
    };
  }

  // If we've failed this exact action 3+ times, STOP
  if (pattern.failureCount >= 3) {
    console.log(`[RETRY] Action ${sig} has failed ${pattern.failureCount} times — FORBIDDEN, must try different approach`);
    return null; // Don't retry this action at all
  }

  // Provide alternative suggestions based on action type
  const suggestions = getAlternativeSuggestions(action, pattern.forbiddenMethods);

  return {
    shouldRetry: true,
    forbiddenMethods: pattern.forbiddenMethods,
    suggestions,
  };
}

/**
 * Get alternative approaches for a failed action.
 */
function getAlternativeSuggestions(action: Action, forbiddenMethods: Set<string>): string[] {
  const suggestions: string[] = [];

  switch (action.type) {
    case 'click':
      if (!forbiddenMethods.has('css_selector')) suggestions.push('Try CSS selector');
      if (!forbiddenMethods.has('xpath')) suggestions.push('Try XPath selector');
      if (!forbiddenMethods.has('text_search')) suggestions.push('Try searching by visible text');
      if (!forbiddenMethods.has('aria_role')) suggestions.push('Try ARIA role/label');
      if (!forbiddenMethods.has('force_click')) suggestions.push('Try force click via JavaScript');
      suggestions.push('Try clicking parent element instead');
      suggestions.push('Try scrolling element into view first');
      break;

    case 'fill':
      if (!forbiddenMethods.has('standard_fill')) suggestions.push('Try standard fill');
      if (!forbiddenMethods.has('js_fill')) suggestions.push('Try JavaScript .value setter');
      if (!forbiddenMethods.has('label_search')) suggestions.push('Try finding input by label text');
      if (!forbiddenMethods.has('placeholder')) suggestions.push('Try finding by placeholder');
      suggestions.push('Try clicking input first, then typing');
      suggestions.push('Try clearing existing value before filling');
      break;

    case 'search':
      suggestions.push('Try different search engine (DuckDuckGo, Google, Bing)');
      suggestions.push('Try reformulated query with synonyms');
      suggestions.push('Try more specific/narrow query');
      suggestions.push('Try broader query');
      break;

    case 'login':
      if (!forbiddenMethods.has('standard_form')) suggestions.push('Try standard form fill');
      if (!forbiddenMethods.has('oauth')) suggestions.push('Try OAuth if available');
      if (!forbiddenMethods.has('magic_link')) suggestions.push('Try magic link/email login');
      suggestions.push('Try waiting longer for page to load');
      suggestions.push('Try clicking "Sign in" button explicitly');
      break;

    default:
      suggestions.push('Try waiting for page to fully load');
      suggestions.push('Try refreshing the page');
      suggestions.push('Try different browser context');
  }

  return suggestions.filter(s => !Array.from(forbiddenMethods).some(m => s.toLowerCase().includes(m)));
}

/**
 * Build enforcement message for AI to prevent repeating failed strategies.
 */
export function buildRetryEnforcementMessage(): string {
  const forbiddenActions = Array.from(taskFailurePatterns.entries())
    .filter(([_, pattern]) => pattern.failureCount >= 3);

  if (forbiddenActions.length === 0) {
    return '';
  }

  const forbidden = forbiddenActions.map(([sig, pattern]) => {
    const methods = Array.from(pattern.forbiddenMethods).join(', ');
    return `  - ${sig} (tried: ${methods}) — FORBIDDEN after ${pattern.failureCount} failures`;
  }).join('\n');

  return `
🚫 CRITICAL - RETRY ENFORCEMENT:
These approaches have FAILED multiple times. You are FORBIDDEN from trying them again:

${forbidden}

You MUST use COMPLETELY DIFFERENT approaches:
- Different website/domain/URL
- Different selector strategy (CSS → XPath → text → ARIA)
- Different action sequence (navigate → search instead of direct navigate)
- Different data source (API instead of scraping, or vice versa)
- Different method entirely (if click fails 3x, try submit or keyboard)

Think creatively. What would a resourceful human do when stuck?`;
}

/**
 * Clear task-specific failure patterns (call this when starting a new task).
 */
export function clearFailurePatterns(): void {
  taskFailurePatterns.clear();
  console.log('[RETRY] Cleared failure patterns for new task');
}

/**
 * Persist failure patterns to database for cross-task learning.
 */
export async function persistFailurePatterns(userId: string, taskId: string): Promise<void> {
  try {
    for (const [sig, pattern] of taskFailurePatterns.entries()) {
      if (pattern.failureCount >= 2) {
        // Extract domain from signature
        const domainMatch = sig.match(/:([^:\/]+\.[^:\/]+)/);
        const domain = domainMatch ? domainMatch[1] : 'unknown';

        // Extract action type
        const actionType = sig.split(':')[0];

        await getSupabaseClient().rpc('atomic_record_failure', {
          p_site_domain: domain,
          p_action_type: actionType,
          p_original_selector: sig,
          p_error_type: 'repeated_failure',
          p_success: false,
        });
      }
    }
    console.log('[RETRY] Persisted failure patterns to database');
  } catch (error) {
    console.error('[RETRY] Failed to persist patterns:', error);
  }
}

/**
 * Get statistics on retry attempts for monitoring.
 */
export function getRetryStats(): {
  totalAttempts: number;
  forbiddenActions: number;
  mostProblematicAction: string | null;
} {
  let totalAttempts = 0;
  let forbiddenActions = 0;
  let maxFailures = 0;
  let mostProblematic: string | null = null;

  for (const [sig, pattern] of taskFailurePatterns.entries()) {
    totalAttempts += pattern.failureCount;
    if (pattern.failureCount >= 3) {
      forbiddenActions++;
    }
    if (pattern.failureCount > maxFailures) {
      maxFailures = pattern.failureCount;
      mostProblematic = sig;
    }
  }

  return {
    totalAttempts,
    forbiddenActions,
    mostProblematicAction: mostProblematic,
  };
}
