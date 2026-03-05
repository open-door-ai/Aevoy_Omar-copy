/**
 * Agent Self-Model — 3-Layer Self-Awareness System
 *
 * Layer 1: Capability Ledger (agent_self_model DB table)
 *   Quantitative. Updated after every task. Answers: "Am I good at this domain?"
 *
 * Layer 2: Identity Document (AGENT_IDENTITY.md in user workspace)
 *   Qualitative. AI-synthesized weekly. Answers: "Who am I to this user?"
 *
 * Layer 3: Metacognitive Confidence Scoring (per browser action, pure heuristic)
 *   Real-time. No AI call. Answers: "How sure am I about THIS action?"
 *
 * Security:
 * - Self-model ONLY updated from verified task outcomes (status=completed/failed)
 * - Never updated from page content or AI response text
 * - Strict userId scoping via RLS + code-level filtering
 * - Confidence used to inform STRATEGY, never to refuse tasks
 */

import { getSupabaseClient } from '../utils/supabase.js';
import { getUserWorkspace } from '../execution/workspace.js';

// ── Types ──────────────────────────────────────────────────────────

export interface CapabilityRecord {
  domain: string;
  taskType: string;
  successRate: number;
  confidence: number;
  avgSteps: number;
  avgCostUsd: number;
  totalTasks: number;
  stale: boolean;
}

export interface SelfModelSummary {
  strengths: CapabilityRecord[];   // success_rate >= 0.75
  weaknesses: CapabilityRecord[];  // success_rate < 0.50, confidence >= 0.40
  totalDomains: number;
  formattedPrompt: string;         // Injected into AI system prompt at task start
}

// ── Layer 1: Capability Ledger ─────────────────────────────────────

/**
 * Read self-model for injection into AI context at task start.
 * Returns top strengths + known weaknesses, formatted as a brief prompt block.
 * Fast: single DB query, < 50ms.
 */
export async function readSelfModel(userId: string): Promise<SelfModelSummary> {
  const empty: SelfModelSummary = {
    strengths: [], weaknesses: [], totalDomains: 0,
    formattedPrompt: '',
  };

  try {
    const { data } = await getSupabaseClient()
      .from('agent_self_model')
      .select('capability_domain, task_type, success_rate, confidence, avg_steps, avg_cost_usd, success_count, failure_count, stale')
      .eq('user_id', userId)
      .eq('stale', false)
      .gte('confidence', 0.35)  // Minimum confidence to be worth including
      .order('confidence', { ascending: false })
      .limit(30);

    if (!data || data.length === 0) return empty;

    const records: CapabilityRecord[] = data.map(r => ({
      domain: r.capability_domain,
      taskType: r.task_type,
      successRate: r.success_rate,
      confidence: r.confidence,
      avgSteps: r.avg_steps,
      avgCostUsd: r.avg_cost_usd,
      totalTasks: (r.success_count || 0) + (r.failure_count || 0),
      stale: r.stale,
    }));

    const strengths = records
      .filter(r => r.successRate >= 0.75)
      .sort((a, b) => b.successRate * b.confidence - a.successRate * a.confidence)
      .slice(0, 5);

    const weaknesses = records
      .filter(r => r.successRate < 0.50 && r.confidence >= 0.40)
      .sort((a, b) => a.successRate - b.successRate)
      .slice(0, 3);

    // Format compact prompt block (< 200 tokens total)
    const lines: string[] = ['MY CAPABILITY SELF-MODEL:'];

    if (strengths.length > 0) {
      lines.push('Strong at: ' + strengths
        .map(s => `${s.domain} (${Math.round(s.successRate * 100)}% success, ${Math.round(s.avgSteps)} steps avg)`)
        .join(', '));
    }

    if (weaknesses.length > 0) {
      lines.push('Struggle with: ' + weaknesses
        .map(w => `${w.domain} (${Math.round(w.successRate * 100)}% success — add extra verification steps)`)
        .join(', '));
    }

    if (strengths.length > 0 || weaknesses.length > 0) {
      lines.push('USE THIS: match strategy to known capability. Low confidence domain → extra screenshot verification + earlier clarification.');
    }

    return {
      strengths,
      weaknesses,
      totalDomains: data.length,
      formattedPrompt: lines.join('\n'),
    };
  } catch (err) {
    console.error('[SELF-MODEL] Failed to read:', err);
    return empty;
  }
}

/**
 * Update capability score after task completion.
 * Called from processor.ts after every task finishes.
 * Non-blocking — wrapped in fire-and-forget.
 */
export async function updateCapabilityScore(params: {
  userId: string;
  domain: string;       // e.g., 'restaurant_booking', 'amazon_signup', 'cold_email'
  taskType: string;     // e.g., 'browser', 'email', 'research'
  success: boolean;
  steps: number;
  costUsd: number;
}): Promise<void> {
  if (!params.userId || !params.domain) return;

  try {
    await getSupabaseClient().rpc('upsert_capability_score', {
      p_user_id: params.userId,
      p_domain: params.domain.substring(0, 100).toLowerCase().replace(/\s+/g, '_'),
      p_task_type: params.taskType || 'general',
      p_success: params.success,
      p_steps: Math.max(0, Math.round(params.steps)),
      p_cost_usd: Math.max(0, params.costUsd),
    });
  } catch (err) {
    // Non-critical — never block the task pipeline over self-model updates
    console.error('[SELF-MODEL] Failed to update capability score:', err);
  }
}

/**
 * Extract the capability domain from task text.
 * Heuristic — no AI call needed.
 */
export function extractDomain(taskText: string): string {
  const lower = taskText.toLowerCase().substring(0, 200);

  // URL-based domain extraction
  const urlMatch = lower.match(/(?:browse|navigate|go to|open|visit)\s+(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,})/);
  if (urlMatch) return urlMatch[1].replace(/^www\./, '');

  // Task-type patterns
  if (/restaurant|reservation|book.*table|resy|opentable/.test(lower)) return 'restaurant_booking';
  if (/flight|airline|ticket|travel|hotel/.test(lower)) return 'travel_booking';
  if (/email|inbox|send.*email|read.*email/.test(lower)) return 'email_management';
  if (/tweet|twitter|x\.com|post.*social/.test(lower)) return 'social_media';
  if (/sign.?up|register|create.*account/.test(lower)) {
    const siteMatch = lower.match(/(?:sign.?up|register).*?(?:on|for|at|to)\s+([a-z0-9]+)/);
    return siteMatch ? `signup_${siteMatch[1]}` : 'account_signup';
  }
  if (/cold.*email|outreach|prospect/.test(lower)) return 'cold_email_outreach';
  if (/schedule|calendar|meeting/.test(lower)) return 'calendar_scheduling';
  if (/research|find|search|what.*price|how much/.test(lower)) return 'web_research';
  if (/code|script|program|function/.test(lower)) return 'code_generation';
  if (/spreadsheet|excel|csv|data.*analysis/.test(lower)) return 'data_analysis';

  // Generic fallback
  const firstVerb = lower.match(/^(find|book|send|create|sign|research|get|make|buy|order)/);
  return firstVerb ? `${firstVerb[1]}_task` : 'general';
}

// ── Layer 2: Identity Document ─────────────────────────────────────

/**
 * Read identity document from user workspace.
 * Returns formatted text or empty string if not yet created.
 */
export async function readIdentityDocument(userId: string): Promise<string> {
  try {
    const ws = getUserWorkspace(userId);
    const result = await ws.readFile('AGENT_IDENTITY.md');
    if (result.ok && result.content) {
      // Strip truncation note if present
      return result.content.replace(/\[File truncated.*\]$/, '').trim();
    }
  } catch { /* workspace may not exist yet */ }
  return '';
}

/**
 * Synthesize and save identity document.
 * Called weekly (or on-demand). Uses self-model data + recent task history.
 * Pure data synthesis — AI formulates, cannot invent stats.
 */
export async function synthesizeIdentityDocument(userId: string): Promise<void> {
  const { quickValidate } = await import('./ai.js');
  const supabase = getSupabaseClient();

  // Fetch top 15 capability records
  const { data: capabilities } = await supabase
    .from('agent_self_model')
    .select('capability_domain, task_type, success_rate, confidence, avg_steps, success_count, failure_count, stale')
    .eq('user_id', userId)
    .gte('confidence', 0.35)
    .order('confidence', { ascending: false })
    .limit(15);

  // Fetch recent successful task patterns (last 30 days)
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentTasks } = await supabase
    .from('tasks')
    .select('type, status, created_at')
    .eq('user_id', userId)
    .gte('created_at', since)
    .in('status', ['completed', 'failed'])
    .limit(50);

  if (!capabilities || capabilities.length === 0) {
    console.log('[SELF-MODEL] Not enough data to synthesize identity document');
    return;
  }

  const capabilityBlock = capabilities.map(c => {
    const total = (c.success_count || 0) + (c.failure_count || 0);
    return `${c.capability_domain}/${c.task_type}: ${Math.round(c.success_rate * 100)}% success, ${total} tasks${c.stale ? ' (stale)' : ''}`;
  }).join('\n');

  const taskCount = recentTasks?.length || 0;
  const completedCount = recentTasks?.filter(t => t.status === 'completed').length || 0;

  const prompt = `Based ONLY on this data, write a brief agent self-identity document. Do NOT invent any numbers or facts not in the data.

CAPABILITY DATA:
${capabilityBlock}

RECENT ACTIVITY: ${completedCount}/${taskCount} tasks completed in last 30 days

Write a AGENT_IDENTITY.md with these sections (keep it under 50 lines total):
1. "## What I'm Good At" — list top 3-5 strengths with stats from the data
2. "## What I Struggle With" — list any domains with < 50% success rate
3. "## Strategy Notes" — 2-3 tactical notes based on the patterns above
Keep each bullet under 120 chars. Use actual numbers from the data.`;

  try {
    const { result } = await quickValidate(prompt,
      'You are synthesizing an AI agent self-model from quantitative data. Be precise. Never add statistics not in the provided data.');

    if (!result || result.length < 100) {
      console.log('[SELF-MODEL] Synthesis produced insufficient output');
      return;
    }

    // Save to workspace
    const doc = `# Agent Self-Identity\n> Auto-generated ${new Date().toISOString().split('T')[0]}. Do not edit manually.\n\n${result}`;
    const ws = getUserWorkspace(userId);
    await ws.writeFile('AGENT_IDENTITY.md', doc);
    console.log(`[SELF-MODEL] Identity document synthesized for user ${userId.slice(0, 8)}`);
  } catch (err) {
    console.error('[SELF-MODEL] Synthesis failed:', err);
  }
}

// ── Layer 3: Metacognitive Confidence Scoring ──────────────────────

export interface ConfidenceFactors {
  actionType: string;
  refFound: boolean;        // was a ref number available in a11y tree?
  historyFailures: number;  // how many failures in current step history?
  snapshotSize: number;     // how many interactive elements in current snapshot?
  consecutiveStuck: number; // how many steps at same URL?
  domainKnown: boolean;     // do we have self-model data for this domain?
  domainSuccessRate: number; // our historical success rate for this domain
}

/**
 * Score confidence 0-100 for a proposed action.
 * Pure heuristic — NO AI call, NO async, < 1ms.
 *
 * Used by vision-agent.ts to decide:
 * - < 40: trigger screenshot before acting
 * - < 20: add explicit REASONING step to history, prefer WAIT or slower approach
 */
export function scoreActionConfidence(factors: ConfidenceFactors): number {
  let score = 70; // Baseline confidence

  // Action type base score
  const actionBaseScores: Record<string, number> = {
    navigate: 95,  // URL navigation is deterministic
    fill: 85,      // Filling a found field is reliable
    click: 75,     // Clicking depends on finding the right element
    select: 70,    // Select dropdowns sometimes tricky
    press: 90,     // Key presses are reliable
    scroll: 95,    // Scrolling always works
    wait: 95,      // Waiting is safe
    type: 80,      // Typing is reliable if field found
    hover: 70,     // Hover depends on element visibility
  };
  score = actionBaseScores[factors.actionType] ?? 70;

  // Boost: ref number available (we know exactly which element to target)
  if (factors.refFound) score += 10;

  // Penalty: recent failures in history
  score -= Math.min(30, factors.historyFailures * 8);

  // Penalty: sparse DOM (fewer elements = harder to navigate)
  if (factors.snapshotSize < 5) score -= 20;
  else if (factors.snapshotSize < 10) score -= 10;

  // Penalty: stuck (same URL many steps)
  if (factors.consecutiveStuck >= 5) score -= 25;
  else if (factors.consecutiveStuck >= 3) score -= 15;

  // Domain intelligence: adjust based on historical performance
  if (factors.domainKnown) {
    // Scale domain success rate to ±15 adjustment
    const domainAdjustment = (factors.domainSuccessRate - 0.5) * 30; // -15 to +15
    score += domainAdjustment;
  } else {
    // Unknown domain: slight penalty (we haven't done this before)
    score -= 5;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Get domain success rate from self-model for confidence scoring.
 * Cached per session (Map) — reads from DB on first call, then uses cache.
 */
const domainCache = new Map<string, { successRate: number; known: boolean }>();

export async function getDomainConfidence(
  userId: string,
  domain: string
): Promise<{ successRate: number; known: boolean }> {
  const cacheKey = `${userId}:${domain}`;
  if (domainCache.has(cacheKey)) return domainCache.get(cacheKey)!;

  try {
    const { data } = await getSupabaseClient()
      .from('agent_self_model')
      .select('success_rate, confidence')
      .eq('user_id', userId)
      .eq('capability_domain', domain)
      .gte('confidence', 0.35)
      .single();

    const result = data
      ? { successRate: data.success_rate, known: true }
      : { successRate: 0.5, known: false };

    domainCache.set(cacheKey, result);
    // Expire cache after 5 min
    setTimeout(() => domainCache.delete(cacheKey), 5 * 60 * 1000);
    return result;
  } catch {
    return { successRate: 0.5, known: false };
  }
}

// ── Startup: Domain cache cleanup ──────────────────────────────────
// Cache cleanup is handled by setTimeout in getDomainConfidence()
// No module-level interval needed — entries expire individually.
