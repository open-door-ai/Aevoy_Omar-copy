/**
 * Failure Memory Database
 * 
 * Learns from every failure. Before every action, check what we've learned.
 * Never make the same mistake twice.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    );
  }
  return supabase;
}

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
  
  try {
    // Try exact match first
    const { data: exact } = await getSupabase()
      .from('failure_memory')
      .select('*')
      .eq('site_domain', domain)
      .eq('action_type', params.actionType)
      .eq('original_selector', params.selector || '')
      .gt('success_rate', 50)
      .single();
    
    if (exact) return mapRecord(exact);
    
    // Try similar match (same site + action type)
    const { data: similar } = await getSupabase()
      .from('failure_memory')
      .select('*')
      .eq('site_domain', domain)
      .eq('action_type', params.actionType)
      .gt('success_rate', 70)
      .order('success_rate', { ascending: false })
      .limit(1)
      .single();
    
    return similar ? mapRecord(similar) : null;
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
  
  try {
    await getSupabase().from('failure_memory').upsert({
      site_domain: domain,
      action_type: params.actionType,
      original_selector: params.selector || '',
      original_method: params.method || '',
      error_type: params.error,
      solution_method: params.solution?.method,
      solution_selector: params.solution?.selector,
      times_used: 1,
      success_rate: params.solution ? 100 : 0
    }, {
      onConflict: 'site_domain,action_type,original_selector'
    });
  } catch (error) {
    console.error('Failed to record failure:', error);
  }
}

/**
 * Record successful use of a learned solution
 */
export async function recordSuccess(failureId: string): Promise<void> {
  try {
    const { data } = await getSupabase()
      .from('failure_memory')
      .select('times_used, success_rate')
      .eq('id', failureId)
      .single();
    
    if (data) {
      const newTimesUsed = data.times_used + 1;
      const newSuccessRate = ((data.success_rate * data.times_used) + 100) / newTimesUsed;
      
      await getSupabase().from('failure_memory').update({
        times_used: newTimesUsed,
        success_rate: Math.min(100, newSuccessRate)
      }).eq('id', failureId);
    }
  } catch (error) {
    console.error('Failed to record success:', error);
  }
}

/**
 * Record when a learned solution fails (decreases success rate)
 */
export async function recordSolutionFailed(failureId: string): Promise<void> {
  try {
    const { data } = await getSupabase()
      .from('failure_memory')
      .select('times_used, success_rate')
      .eq('id', failureId)
      .single();
    
    if (data) {
      const newTimesUsed = data.times_used + 1;
      const newSuccessRate = (data.success_rate * data.times_used) / newTimesUsed;
      
      await getSupabase().from('failure_memory').update({
        times_used: newTimesUsed,
        success_rate: Math.max(0, newSuccessRate)
      }).eq('id', failureId);
    }
  } catch (error) {
    console.error('Failed to record solution failure:', error);
  }
}

/**
 * Learn a new solution from a successful workaround
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
  
  try {
    await getSupabase().from('failure_memory').upsert({
      site_domain: domain,
      action_type: params.actionType,
      original_selector: params.originalSelector || '',
      original_method: params.originalMethod || '',
      error_type: params.error,
      solution_method: params.solution.method,
      solution_selector: params.solution.selector,
      times_used: 1,
      success_rate: 100
    }, {
      onConflict: 'site_domain,action_type,original_selector'
    });
    
    console.log(`[LEARNING] Learned solution for ${domain} ${params.actionType}: ${params.solution.method}`);
  } catch (error) {
    console.error('Failed to learn solution:', error);
  }
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
