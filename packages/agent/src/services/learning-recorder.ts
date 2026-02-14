/**
 * Automatic Learning Recorder
 * Records learnings from successful task executions to Hive Mind
 * Enables 24/7 continuous improvement
 */

import { getSupabaseClient } from "../utils/supabase.js";

interface TaskOutcome {
  taskId: string;
  userId: string;
  taskType: string;
  domain?: string;
  success: boolean;
  actions: Array<{ type: string; success: boolean; method?: string }>;
  duration_ms: number;
  iterations: number;
  cost_usd: number;
  error?: string;
}

/**
 * Automatically record learning from task outcome
 */
export async function recordLearning(outcome: TaskOutcome): Promise<void> {
  // Only record learnings from successful tasks
  if (!outcome.success || outcome.error) {
    return;
  }

  // Skip trivial tasks (no actions)
  if (outcome.actions.length === 0) {
    return;
  }

  try {
    const service = outcome.domain || 'general';
    const taskType = outcome.taskType || 'general';

    // Extract steps from actions
    const steps = outcome.actions
      .filter(a => a.success)
      .map(a => `${a.type}${a.method ? ` (${a.method})` : ''}`);

    // Calculate difficulty based on iterations and duration
    const difficulty = outcome.iterations > 3 ? 'hard' :
                       outcome.iterations > 1 ? 'medium' : 'easy';

    // Success rate: 100% if we got here (only recording successful outcomes)
    const successRate = 100;

    // Check if similar learning already exists
    const { data: existing } = await getSupabaseClient()
      .from('learnings')
      .select('id, success_rate, times_used')
      .eq('service', service)
      .eq('task_type', taskType)
      .limit(1);

    if (existing && existing.length > 0) {
      // Update existing learning (increment usage, update success rate with EMA)
      const current = existing[0];
      const newSuccessRate = (current.success_rate * 0.9) + (successRate * 0.1); // EMA

      await getSupabaseClient()
        .from('learnings')
        .update({
          times_used: (current.times_used || 0) + 1,
          success_rate: newSuccessRate,
          last_seen_at: new Date().toISOString(),
        })
        .eq('id', current.id);

      console.log(`[LEARNING] Updated existing learning for ${service}/${taskType} (${current.times_used + 1} uses, ${newSuccessRate.toFixed(1)}% success)`);
    } else {
      // Create new learning
      const title = `Successful ${taskType} on ${service}`;

      await getSupabaseClient()
        .from('learnings')
        .insert({
          service,
          task_type: taskType,
          title,
          steps,
          gotchas: [], // Will be populated from failures
          success_rate: successRate,
          difficulty,
          is_warning: false,
          tags: [taskType, service, difficulty],
          times_used: 1,
        });

      console.log(`[LEARNING] Recorded new learning: ${title} (${steps.length} steps, ${difficulty})`);
    }
  } catch (error) {
    // Non-critical - don't fail task if learning recording fails
    console.error('[LEARNING] Failed to record learning:', error);
  }
}

/**
 * Record failure pattern for future improvement
 */
export async function recordFailurePattern(outcome: TaskOutcome): Promise<void> {
  if (outcome.success) {
    return;
  }

  try {
    const service = outcome.domain || 'general';
    const taskType = outcome.taskType || 'general';

    // Find or create gotcha entry
    const title = `${taskType} failures on ${service}`;
    const gotcha = `Common error: ${outcome.error?.substring(0, 100) || 'Unknown error'}`;

    const { data: existing } = await getSupabaseClient()
      .from('learnings')
      .select('id, gotchas, success_rate, times_used')
      .eq('service', service)
      .eq('task_type', taskType)
      .eq('is_warning', true)
      .limit(1);

    if (existing && existing.length > 0) {
      const current = existing[0];
      const gotchas = Array.isArray(current.gotchas) ? current.gotchas : [];

      if (!gotchas.includes(gotcha)) {
        gotchas.push(gotcha);
      }

      // Decrease success rate (EMA)
      const newSuccessRate = (current.success_rate * 0.9) + (0 * 0.1);

      await getSupabaseClient()
        .from('learnings')
        .update({
          gotchas,
          success_rate: newSuccessRate,
          times_used: (current.times_used || 0) + 1,
          last_seen_at: new Date().toISOString(),
        })
        .eq('id', current.id);

      console.log(`[LEARNING] Updated failure pattern for ${service}/${taskType}`);
    } else {
      // Create new failure warning
      await getSupabaseClient()
        .from('learnings')
        .insert({
          service,
          task_type: taskType,
          title,
          steps: [],
          gotchas: [gotcha],
          success_rate: 0,
          difficulty: 'hard',
          is_warning: true,
          tags: [taskType, service, 'failure', 'warning'],
          times_used: 1,
        });

      console.log(`[LEARNING] Recorded new failure pattern: ${title}`);
    }
  } catch (error) {
    console.error('[LEARNING] Failed to record failure pattern:', error);
  }
}
