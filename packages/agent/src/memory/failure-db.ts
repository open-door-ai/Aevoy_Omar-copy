/**
 * Failure Memory Database
 *
 * Learns from every failure. Before every action, check what we've learned.
 * Never make the same mistake twice.
 *
 * Uses exponential moving average for success rates (recency weight 0.3).
 * Cross-user learning: solutions used successfully 3+ times are promoted globally.
 */

import { getSupabaseClient } from '../utils/supabase.js';

// Expiration: 90 days instead of 30
const EXPIRATION_DAYS = 90;

// Exponential moving average weight for recency
const EMA_WEIGHT = 0.3;

// Minimum uses before a solution is considered "global"
const GLOBAL_PROMOTION_THRESHOLD = 3;

export interface FailureRecord {
  id: string;
  siteDomain: string;
  sitePath?: string;
  actionType: string;
  originalSelector?: string;
  originalMethod?: string;
  errorType: string;
  solution?: {
    method: string;
    selector?: string;
    steps?: unknown[];
  };
  successRate: number;
  timesUsed: number;
}

/**
 * Check if we've seen this failure before and have a solution
 */
export async function getFailureMemory(params: {
  site: string;
  actionType: string;
  selector?: string;
}): Promise<FailureRecord | null> {
  const domain = extractDomain(params.site);
  const expirationDate = new Date(Date.now() - EXPIRATION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  try {
    // Try exact match first (exclude stale entries)
    const { data: exact } = await getSupabaseClient()
      .from('failure_memory')
      .select('*')
      .eq('site_domain', domain)
      .eq('action_type', params.actionType)
      .eq('original_selector', params.selector || '')
      .gt('success_rate', 50)
      .gte('last_seen_at', expirationDate)
      .single();

    if (exact) return mapRecord(exact);

    // Try similar match (same site + action type, not stale)
    const { data: similar } = await getSupabaseClient()
      .from('failure_memory')
      .select('*')
      .eq('site_domain', domain)
      .eq('action_type', params.actionType)
      .gt('success_rate', 70)
      .gte('last_seen_at', expirationDate)
      .order('success_rate', { ascending: false })
      .limit(1)
      .single();

    if (similar) return mapRecord(similar);

    // Try global solutions (cross-user learning)
    const { data: global } = await getSupabaseClient()
      .from('failure_memory')
      .select('*')
      .eq('site_domain', domain)
      .eq('action_type', params.actionType)
      .gte('times_used', GLOBAL_PROMOTION_THRESHOLD)
      .gt('success_rate', 70)
      .gte('last_seen_at', expirationDate)
      .order('success_rate', { ascending: false })
      .limit(1)
      .single();

    return global ? mapRecord(global) : null;
  } catch {
    return null;
  }
}

/**
 * Record a failure for future learning
 */
export async function recordFailure(params: {
  site: string;
  actionType: string;
  selector?: string;
  method?: string;
  error: string;
  solution?: {
    method: string;
    selector?: string;
  };
}): Promise<void> {
  const domain = extractDomain(params.site);

  // Validate CSS selector before storing
  if (params.solution?.selector && !isValidSelector(params.solution.selector)) {
    console.warn(`[LEARNING] Invalid CSS selector, not storing: ${params.solution.selector}`);
    params.solution.selector = undefined;
  }

  try {
    // Check for existing record to apply EMA
    const { data: existing } = await getSupabaseClient()
      .from('failure_memory')
      .select('success_rate, times_used')
      .eq('site_domain', domain)
      .eq('action_type', params.actionType)
      .eq('original_selector', params.selector || '')
      .single();

    let newSuccessRate: number;
    let newTimesUsed: number;

    if (existing) {
      // Apply EMA: new_rate = weight * new_value + (1 - weight) * old_rate
      const newValue = params.solution ? 100 : 0;
      newSuccessRate = EMA_WEIGHT * newValue + (1 - EMA_WEIGHT) * existing.success_rate;
      newTimesUsed = existing.times_used + 1;
    } else {
      newSuccessRate = params.solution ? 100 : 0;
      newTimesUsed = 1;
    }

    await getSupabaseClient().from('failure_memory').upsert({
      site_domain: domain,
      action_type: params.actionType,
      original_selector: params.selector || '',
      original_method: params.method || '',
      error_type: params.error,
      solution_method: params.solution?.method,
      solution_selector: params.solution?.selector,
      times_used: newTimesUsed,
      success_rate: Math.round(newSuccessRate * 100) / 100,
      last_seen_at: new Date().toISOString(),
    }, {
      onConflict: 'site_domain,action_type,original_selector'
    });
  } catch (error) {
    console.error('Failed to record failure:', error);
  }
}

/**
 * Record successful use of a learned solution (EMA update)
 */
export async function recordSuccess(failureId: string): Promise<void> {
  try {
    const { data } = await getSupabaseClient()
      .from('failure_memory')
      .select('times_used, success_rate')
      .eq('id', failureId)
      .single();

    if (data) {
      // EMA update with success (100)
      const newSuccessRate = EMA_WEIGHT * 100 + (1 - EMA_WEIGHT) * data.success_rate;
      const newTimesUsed = data.times_used + 1;

      await getSupabaseClient().from('failure_memory').update({
        times_used: newTimesUsed,
        success_rate: Math.min(100, Math.round(newSuccessRate * 100) / 100),
        last_seen_at: new Date().toISOString(),
      }).eq('id', failureId);
    }
  } catch (error) {
    console.error('Failed to record success:', error);
  }
}

/**
 * Record when a learned solution fails (EMA update with 0)
 */
export async function recordSolutionFailed(failureId: string): Promise<void> {
  try {
    const { data } = await getSupabaseClient()
      .from('failure_memory')
      .select('times_used, success_rate')
      .eq('id', failureId)
      .single();

    if (data) {
      // EMA update with failure (0)
      const newSuccessRate = EMA_WEIGHT * 0 + (1 - EMA_WEIGHT) * data.success_rate;
      const newTimesUsed = data.times_used + 1;

      await getSupabaseClient().from('failure_memory').update({
        times_used: newTimesUsed,
        success_rate: Math.max(0, Math.round(newSuccessRate * 100) / 100),
        last_seen_at: new Date().toISOString(),
      }).eq('id', failureId);
    }
  } catch (error) {
    console.error('Failed to record solution failure:', error);
  }
}

/**
 * Learn a new solution from a successful workaround.
 * Only overwrites existing solutions if their success rate is < 70%.
 */
export async function learnSolution(params: {
  site: string;
  actionType: string;
  originalSelector?: string;
  originalMethod?: string;
  error: string;
  solution: {
    method: string;
    selector?: string;
  };
}): Promise<void> {
  const domain = extractDomain(params.site);

  // Validate selector before storing
  if (params.solution.selector && !isValidSelector(params.solution.selector)) {
    console.warn(`[LEARNING] Invalid CSS selector, not storing: ${params.solution.selector}`);
    params.solution.selector = undefined;
  }

  try {
    // Check existing solution before overwriting
    const { data: existing } = await getSupabaseClient()
      .from('failure_memory')
      .select('success_rate, solution_method, times_used')
      .eq('site_domain', domain)
      .eq('action_type', params.actionType)
      .eq('original_selector', params.originalSelector || '')
      .single();

    // Only overwrite if existing solution has < 70% success rate
    if (existing && existing.solution_method && existing.success_rate >= 70) {
      console.log(`[LEARNING] Existing solution for ${domain} has ${existing.success_rate}% success rate, not overwriting`);
      return;
    }

    await getSupabaseClient().from('failure_memory').upsert({
      site_domain: domain,
      action_type: params.actionType,
      original_selector: params.originalSelector || '',
      original_method: params.originalMethod || '',
      error_type: params.error,
      solution_method: params.solution.method,
      solution_selector: params.solution.selector,
      times_used: existing ? existing.times_used + 1 : 1,
      success_rate: 100,
      last_seen_at: new Date().toISOString(),
    }, {
      onConflict: 'site_domain,action_type,original_selector'
    });

    console.log(`[LEARNING] Learned solution for ${domain} ${params.actionType}: ${params.solution.method}`);
  } catch (error) {
    console.error('Failed to learn solution:', error);
  }
}

/**
 * Validate a CSS selector is syntactically valid.
 */
function isValidSelector(selector: string): boolean {
  if (!selector || selector.length > 500) return false;
  if (/[{}]/.test(selector)) return false;
  return /^[a-zA-Z0-9_\-\[\]()#.:*,>+~ ="'^$|\\/@]+$/.test(selector);
}

function extractDomain(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
  } catch {
    return url;
  }
}

function mapRecord(db: Record<string, unknown>): FailureRecord {
  return {
    id: db.id as string,
    siteDomain: db.site_domain as string,
    sitePath: db.site_path as string | undefined,
    actionType: db.action_type as string,
    originalSelector: db.original_selector as string | undefined,
    originalMethod: db.original_method as string | undefined,
    errorType: db.error_type as string,
    solution: db.solution_method ? {
      method: db.solution_method as string,
      selector: db.solution_selector as string | undefined,
      steps: db.solution_steps as unknown[] | undefined
    } : undefined,
    successRate: db.success_rate as number,
    timesUsed: db.times_used as number
  };
}
