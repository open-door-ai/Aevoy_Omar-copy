/**
 * Task Logger
 *
 * Logs every execution step to task_logs for audit trail and debugging.
 * Table schema: id (uuid), task_id (uuid), step (text), status (text), details (jsonb), created_at
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
  if (!taskId) return; // Skip if no taskId
  try {
    await getSupabaseClient().from('task_logs').insert({
      task_id: taskId,
      step: `${actionType}: ${target}`,
      status: success ? 'ok' : 'failed',
      details: { stepNumber, methodUsed, success, error, screenshotUrl, durationMs, userId, ...metadata }
    });
  } catch (e) {
    console.error('[TASK-LOGGER] Failed to log step:', e);
  }
}
