/**
 * Task Logger
 *
 * Logs every execution step to task_logs for audit trail and debugging.
 * Called after EVERY action (click, fill, navigate, select, submit, login).
 */

import { getSupabaseClient } from '../utils/supabase.js';

export async function logTaskStep(
  taskId: string,
  userId: string,
  stepNumber: number,
  actionType: string,
  target: string,
  methodUsed: string,
  success: boolean,
  screenshotUrl?: string,
  error?: string,
  durationMs?: number,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await getSupabaseClient().from('task_logs').insert({
      task_id: taskId,
      level: success ? 'info' : 'error',
      message: `${actionType}: ${target} [${methodUsed}] ${success ? 'OK' : 'FAILED'}${error ? ': ' + error : ''}`,
      metadata: { stepNumber, actionType, target, methodUsed, success, screenshotUrl, durationMs, ...metadata }
    });
  } catch (e) {
    console.error('[TASK-LOGGER] Failed to log step:', e);
  }
}
