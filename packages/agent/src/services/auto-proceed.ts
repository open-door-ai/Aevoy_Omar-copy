/**
 * Auto-Proceed Poller
 *
 * When the agent asks a clarifying question and the user doesn't reply,
 * this poller picks up those tasks and re-triggers them with a "proceed
 * autonomously" instruction.
 *
 * - Normal tasks: auto-proceed after 1 hour
 * - Important tasks (bookings, financial, orders): auto-proceed after 20 minutes
 *
 * Runs every 5 minutes via the scheduler.
 */

import { processTask } from './processor.js';
import { getSupabaseClient, acquireDistributedLock, releaseDistributedLock } from '../utils/supabase.js';

let autoProceedInterval: NodeJS.Timeout | null = null;

/** How often to check for auto-proceed tasks (ms) */
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/** Normal task auto-proceed delay */
export const NORMAL_DELAY_MS = 60 * 60 * 1000; // 1 hour

/** Important task auto-proceed delay (bookings, financial, orders, signups) */
export const IMPORTANT_DELAY_MS = 20 * 60 * 1000; // 20 minutes

/**
 * Detect whether a task is "important" (time-sensitive) based on its text.
 * Important tasks get a shorter auto-proceed window (20 min vs 1 hour).
 */
export function isImportantTask(taskText: string): boolean {
  return /\b(book|reserv|order|buy|purchase|cancel|financial|payment|transfer|urgent|asap|time.?sensitive|sign\s?up|signup|register)\b/i.test(taskText);
}

/**
 * Calculate the auto-proceed timestamp for a task.
 */
export function getAutoProceedAt(taskText: string): string {
  const delayMs = isImportantTask(taskText) ? IMPORTANT_DELAY_MS : NORMAL_DELAY_MS;
  return new Date(Date.now() + delayMs).toISOString();
}

/**
 * Build the auto-proceed context string that tells the AI what to do.
 */
export function buildAutoProceedContext(
  originalQuestion: string,
  originalTaskText: string,
  delayMinutes: number,
): string {
  return [
    `AUTO-PROCEED: The user was asked the following question but did not respond within ${delayMinutes} minutes:`,
    `"${originalQuestion}"`,
    ``,
    `Original task: "${originalTaskText}"`,
    ``,
    `Proceed with the most reasonable default. Make the decision a smart, resourceful human would make.`,
    `Do NOT ask the user again — they already didn't reply. Just pick the best option and execute.`,
  ].join('\n');
}

/**
 * Start the auto-proceed polling loop.
 */
export function startAutoProceedPoller(): void {
  if (autoProceedInterval) {
    console.log('[AUTO-PROCEED] Already running');
    return;
  }

  // Run immediately on start
  pollAutoProceedTasks().catch(console.error);

  // Then run every 5 minutes
  autoProceedInterval = setInterval(async () => {
    try {
      await pollAutoProceedTasks();
    } catch (error) {
      console.error('[AUTO-PROCEED] Poll error:', error);
    }
  }, POLL_INTERVAL_MS);

  console.log('[AUTO-PROCEED] Poller started — checking every 5 minutes');
}

/**
 * Stop the auto-proceed polling loop.
 */
export function stopAutoProceedPoller(): void {
  if (autoProceedInterval) {
    clearInterval(autoProceedInterval);
    autoProceedInterval = null;
  }
  console.log('[AUTO-PROCEED] Poller stopped');
}

/**
 * Poll for tasks that have passed their auto_proceed_at deadline
 * and re-trigger them.
 */
async function pollAutoProceedTasks(): Promise<void> {
  const acquired = await acquireDistributedLock('auto_proceed_poll', 4 * 60_000);
  if (!acquired) {
    return; // Another instance is handling it
  }

  try {
    const now = new Date().toISOString();
    const supabase = getSupabaseClient();

    // Find tasks ready to auto-proceed (needs_review, pending_approval, or awaiting_confirmation)
    const { data: tasks, error } = await supabase
      .from('tasks')
      .select('id, user_id, input_text, email_subject, input_channel, auto_proceed_context, status')
      .in('status', ['needs_review', 'pending_approval', 'awaiting_confirmation'])
      .not('auto_proceed_at', 'is', null)
      .lte('auto_proceed_at', now)
      .limit(10); // Process up to 10 at a time to avoid overload

    if (error) {
      console.error('[AUTO-PROCEED] Query error:', error);
      return;
    }

    if (!tasks || tasks.length === 0) {
      return; // Nothing to auto-proceed
    }

    console.log(`[AUTO-PROCEED] Found ${tasks.length} task(s) ready to auto-proceed`);

    for (const task of tasks) {
      try {
        // Look up user profile
        const { data: profile } = await supabase
          .from('profiles')
          .select('id, username, email')
          .eq('id', task.user_id)
          .single();

        if (!profile) {
          console.error(`[AUTO-PROCEED] No profile for user ${task.user_id.slice(0, 8)}`);
          // Clear auto_proceed to prevent infinite retries
          await supabase.from('tasks').update({
            auto_proceed_at: null,
            auto_proceed_context: null,
          }).eq('id', task.id);
          continue;
        }

        // Mark task as processing to prevent double-pickup
        await supabase.from('tasks').update({
          status: 'processing',
          auto_proceed_at: null, // Clear so it doesn't get picked up again
        }).eq('id', task.id);

        console.log(`[AUTO-PROCEED] Re-triggering task ${task.id.slice(0, 8)} for user ${profile.username}`);

        const autoProceedContext = task.auto_proceed_context || 'The user did not respond. Proceed with the most reasonable default.';

        // Re-process the task with auto-proceed context
        processTask({
          userId: task.user_id,
          username: profile.username,
          from: profile.email,
          subject: task.email_subject || task.input_text?.substring(0, 200) || 'Auto-proceed task',
          body: `${task.input_text || ''}\n\n--- AUTO-PROCEED INSTRUCTIONS ---\n${autoProceedContext}`,
          taskId: task.id,
          inputChannel: (task.input_channel as any) || 'email',
          responsePrefix: `You didn't reply to my question, so I went ahead with my best judgment. Here's what I did:`,
        }).then((result) => {
          console.log(`[AUTO-PROCEED] Task ${task.id.slice(0, 8)} completed: success=${result.success}`);
        }).catch((err) => {
          console.error(`[AUTO-PROCEED] Task ${task.id.slice(0, 8)} failed:`, err);
        });
      } catch (taskError) {
        console.error(`[AUTO-PROCEED] Error processing task ${task.id.slice(0, 8)}:`, taskError);
        // Reset task status so it doesn't get stuck
        await supabase.from('tasks').update({
          status: 'needs_review',
          auto_proceed_at: null,
          auto_proceed_context: null,
        }).eq('id', task.id);
      }
    }
  } finally {
    await releaseDistributedLock('auto_proceed_poll');
  }
}
