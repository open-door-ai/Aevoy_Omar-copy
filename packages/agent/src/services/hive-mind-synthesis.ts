/**
 * Hive Mind Synthesis
 *
 * Weekly job: synthesizes cross-user learnings into global principles.
 * Daily job: promotes high-confidence per-user learnings to global_learnings.
 *
 * Privacy: strips all PII before any cross-user sharing.
 * Security: learnings only from verified task outcomes, never from page content.
 */

import { getSupabaseClient } from '../utils/supabase.js';
import { quickValidate } from './ai.js';

// PII patterns to strip before storing globally
const PII_PATTERNS: RegExp[] = [
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,  // email
  /\+?1?[-.\s]?\(?[0-9]{3}\)?[-.\s][0-9]{3}[-.\s][0-9]{4}/g,  // phone
  /\b[A-Z][a-z]+ [A-Z][a-z]+\b/g,  // names (simple heuristic)
  /(?:password|passwd|pwd|secret|token|key|api.?key)\s*[:=]\s*\S+/gi,  // credentials
  /https?:\/\/[^\s]+(?:token|auth|key|session)[^\s]*/gi,  // auth URLs
];

function anonymizeContent(text: string): string {
  let clean = text;
  for (const pattern of PII_PATTERNS) {
    clean = clean.replace(pattern, '[REDACTED]');
  }
  return clean;
}

/**
 * Promote successful per-user learnings to global_learnings (anonymized).
 * Runs daily. Only promotes learnings with times_used >= 3 AND success_rate >= 0.70.
 */
export async function promoteToGlobal(): Promise<void> {
  const supabase = getSupabaseClient();

  // Check opt-out users
  const { data: optOutUsers } = await supabase
    .from('user_settings')
    .select('user_id')
    .eq('contribute_to_hive_mind', false);
  const optOutIds = new Set((optOutUsers || []).map((u: { user_id: string }) => u.user_id));

  // Fetch high-quality learnings from last 24h
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: learnings } = await supabase
    .from('learnings')
    .select('user_id, service, task_type, title, steps, success_rate, times_used')
    .gte('last_seen_at', since)
    .gte('times_used', 3)
    .gte('success_rate', 0.70)
    .limit(100);

  if (!learnings || learnings.length === 0) return;

  for (const learning of learnings) {
    // Skip opted-out users
    if (optOutIds.has(learning.user_id)) continue;

    // Anonymize content
    const approach = anonymizeContent(
      `${learning.title || ''}: ${(learning.steps || []).join(', ')}`
    ).substring(0, 500);

    // Upsert to global_learnings
    const { error } = await supabase
      .from('global_learnings')
      .upsert({
        domain: learning.service || 'general',
        task_type: learning.task_type || 'general',
        approach,
        outcome: 'success',
        success_rate: learning.success_rate,
        times_used: 1,
        confidence_score: (learning.success_rate || 0.5) * Math.log(Math.max(learning.times_used || 1, 1) + 1),
        last_seen_at: new Date().toISOString(),
      }, {
        onConflict: 'domain,task_type,approach',
        ignoreDuplicates: false,
      });

    if (!error) {
      // Increment contributed_by_count (non-critical)
      try {
        await supabase.rpc('increment_global_learning_count', {
          p_domain: learning.service,
          p_task_type: learning.task_type,
          p_approach: approach,
        });
      } catch { /* non-critical */ }
    }
  }

  console.log(`[HIVE-MIND] Promoted learnings from ${learnings.length} entries to global`);
}

/**
 * Weekly synthesis: AI distills top patterns into high-level principles.
 */
export async function synthesizeWeeklyPrinciples(): Promise<void> {
  const supabase = getSupabaseClient();

  // Fetch top global learnings from last 7 days
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: learnings } = await supabase
    .from('global_learnings')
    .select('domain, task_type, approach, outcome, success_rate, times_used')
    .gte('last_seen_at', since)
    .gte('times_used', 5)
    .order('confidence_score', { ascending: false })
    .limit(50);

  if (!learnings || learnings.length < 5) {
    console.log('[HIVE-MIND] Not enough data for weekly synthesis');
    return;
  }

  const dataBlock = learnings
    .map(l => `[${l.domain}/${l.task_type}] ${l.approach} (${(l.success_rate * 100).toFixed(0)}% success, ${l.times_used} uses)`)
    .join('\n');

  const { result } = await quickValidate(
    `These are successful automation patterns from the last week. Distill the 5 most important GENERAL principles that apply across many domains:\n\n${dataBlock}\n\nOutput: 5 numbered principles, each under 100 chars. Focus on generalizable rules, not site-specific tricks.`,
    'You are a learning synthesis system. Extract general principles from specific examples. Be precise and actionable.'
  );

  if (!result || result.length < 50) return;

  // Store synthesized principles as high-confidence global learnings
  const principles = result.split('\n').filter(l => /^\d+\./.test(l.trim())).slice(0, 5);
  for (const principle of principles) {
    const clean = principle.replace(/^\d+\.\s*/, '').trim();
    if (clean.length < 20) continue;

    try {
      await supabase.from('global_learnings').upsert({
        domain: 'general',
        task_type: 'principle',
        approach: clean,
        outcome: 'success',
        success_rate: 0.90,
        times_used: 100,  // High times_used so it gets retrieved first
        confidence_score: 0.90 * Math.log(101),
        last_seen_at: new Date().toISOString(),
      }, { onConflict: 'domain,task_type,approach', ignoreDuplicates: false });
    } catch { /* non-critical */ }
  }

  console.log(`[HIVE-MIND] Weekly synthesis complete: ${principles.length} principles stored`);
}

/**
 * Retrieve top learnings for a domain — used by vision agent and main AI.
 * Confidence-weighted: min 3 uses, min 70% success rate.
 * Returns max 3 learnings, each max 100 chars.
 */
export async function getHiveMindLearnings(domain: string, taskType?: string): Promise<string[]> {
  const supabase = getSupabaseClient();

  try {
    // First: domain-specific learnings
    let query = supabase
      .from('global_learnings')
      .select('approach, success_rate, times_used, confidence_score')
      .eq('domain', domain)
      .gte('times_used', 3)
      .gte('success_rate', 0.70)
      .order('confidence_score', { ascending: false })
      .limit(3);

    if (taskType) {
      query = query.eq('task_type', taskType);
    }

    const { data: domainLearnings } = await query;

    // Then: general principles
    const { data: generalLearnings } = await supabase
      .from('global_learnings')
      .select('approach, confidence_score')
      .eq('domain', 'general')
      .gte('times_used', 10)
      .order('confidence_score', { ascending: false })
      .limit(2);

    const all = [
      ...(domainLearnings || []).map((l: { approach: string }) => l.approach),
      ...(generalLearnings || []).map((l: { approach: string }) => l.approach),
    ];

    // Truncate each to 100 chars, deduplicate
    return [...new Set(all)].slice(0, 3).map(s => s.substring(0, 100));
  } catch {
    return [];
  }
}

/**
 * Record a failure-fix pair when a task succeeds after previous failure.
 */
export async function recordFailureFix(params: {
  userId: string;
  taskId?: string;
  domain: string;
  taskType: string;
  failureReason: string;
  failureApproach: string;
  successfulFix: string;
  fixCategory?: string;
}): Promise<void> {
  try {
    await getSupabaseClient().from('failure_fixes').insert({
      user_id: params.userId,
      task_id: params.taskId,
      domain: params.domain,
      task_type: params.taskType,
      failure_reason: params.failureReason.substring(0, 500),
      failure_approach: params.failureApproach.substring(0, 500),
      successful_fix: params.successfulFix.substring(0, 500),
      fix_category: params.fixCategory,
    });

    // Also promote to global (anonymized)
    const anonymizedFix = anonymizeContent(params.successfulFix).substring(0, 200);
    const anonymizedFailure = anonymizeContent(params.failureApproach).substring(0, 200);

    try {
      await getSupabaseClient().from('global_learnings').upsert({
        domain: params.domain,
        task_type: params.taskType,
        approach: `AFTER FAILING (${anonymizedFailure.substring(0, 80)}): ${anonymizedFix}`,
        outcome: 'success',
        fix: anonymizedFix,
        success_rate: 0.85,
        times_used: 1,
        confidence_score: 0.85,
        last_seen_at: new Date().toISOString(),
      }, { onConflict: 'domain,task_type,approach', ignoreDuplicates: false });
    } catch { /* non-critical */ }

    console.log(`[HIVE-MIND] Recorded failure-fix pair for ${params.domain}/${params.taskType}`);
  } catch (err) {
    console.error('[HIVE-MIND] Failed to record failure-fix:', err);
  }
}

/**
 * Time-decay: reduce confidence of stale global learnings.
 * Run monthly.
 */
export async function decayStaleKnowledge(): Promise<void> {
  const supabase = getSupabaseClient();

  // Learnings not seen in 90 days: confidence × 0.8
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  try {
    await supabase.rpc('decay_global_learnings', { p_before: ninetyDaysAgo });
  } catch { /* non-critical */ }

  // Archive learnings with confidence < 0.30
  try {
    await supabase
      .from('global_learnings')
      .delete()
      .lt('confidence_score', 0.30);
  } catch { /* non-critical */ }

  console.log('[HIVE-MIND] Knowledge decay complete');
}
