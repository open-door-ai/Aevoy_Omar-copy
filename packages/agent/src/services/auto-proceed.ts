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

/**
 * Dynamic auto-proceed delays based on task complexity and risk:
 * - Time-sensitive (bookings, orders): 20 min — then proceed with best option
 * - Simple missing detail (which restaurant?): 20 min — then pick top 2-3 and do them all
 * - Normal tasks (signup, research): 1 hour — then proceed with best judgment
 * - Complex/risky (financial, career, irreversible): 4 hours — then proceed carefully
 */
export const URGENT_DELAY_MS = 20 * 60 * 1000;      // 20 minutes
export const NORMAL_DELAY_MS = 60 * 60 * 1000;       // 1 hour
export const COMPLEX_DELAY_MS = 4 * 60 * 60 * 1000;  // 4 hours

// Keep old name for backwards compatibility
export const IMPORTANT_DELAY_MS = URGENT_DELAY_MS;

/**
 * Classify task urgency level for dynamic auto-proceed timing.
 * Returns: 'urgent' (20min), 'normal' (1h), 'complex' (4h)
 */
export function classifyTaskUrgency(taskText: string): 'urgent' | 'normal' | 'complex' {
  const lower = taskText.toLowerCase();

  // Complex/risky: financial decisions, career moves, irreversible actions, large purchases
  if (/\b(invest|stock|crypto|mortgage|loan|insurance|retire|career|quit|resign|contract|legal|lawsuit|medical|surgery|relocat|move to|immigration|visa|tax|divorce|marriage)\b/i.test(lower)) {
    return 'complex';
  }

  // Urgent: time-sensitive, bookings, orders, active signups
  if (/\b(book|reserv|order|buy|purchase|cancel|urgent|asap|time.?sensitive|tonight|today|right now|immediately|hurry|sign\s?up|signup|register)\b/i.test(lower)) {
    return 'urgent';
  }

  return 'normal';
}

// Keep old function for backwards compatibility
export function isImportantTask(taskText: string): boolean {
  return classifyTaskUrgency(taskText) === 'urgent';
}

/**
 * Calculate the auto-proceed timestamp for a task.
 */
export function getAutoProceedAt(taskText: string): string {
  const urgency = classifyTaskUrgency(taskText);
  const delayMs = urgency === 'urgent' ? URGENT_DELAY_MS
    : urgency === 'complex' ? COMPLEX_DELAY_MS
    : NORMAL_DELAY_MS;
  return new Date(Date.now() + delayMs).toISOString();
}

/**
 * Get delay in minutes for display purposes.
 */
export function getDelayMinutes(taskText: string): number {
  const urgency = classifyTaskUrgency(taskText);
  return urgency === 'urgent' ? 20 : urgency === 'complex' ? 240 : 60;
}

/**
 * Build smart auto-proceed context that tells the AI WHAT to do, not just "proceed."
 * Context is tailored to the type of question that was asked.
 */
export function buildAutoProceedContext(
  originalQuestion: string,
  originalTaskText: string,
  delayMinutes: number,
): string {
  const lower = originalTaskText.toLowerCase();
  const questionLower = originalQuestion.toLowerCase();

  // Determine smart auto-proceed strategy based on what was asked
  let strategy: string;

  if (/\b(which restaurant|where|which place|which one|pick|choose|prefer)\b/i.test(questionLower)) {
    // Missing preference → pick multiple options
    strategy = `STRATEGY: The user didn't specify a preference. Pick the top 2-3 highest-rated options and execute on ALL of them. For bookings, book the #1 rated option. For orders, pick the most popular. Report what you chose and why.`;
  } else if (/\b(address|delivery|location|where.*deliver|where.*send|where.*ship)\b/i.test(questionLower)) {
    // Missing address → check profile, use default, or skip
    strategy = `STRATEGY: The user didn't provide an address. Check their profile for a saved address. If none found, pick the nearest/default option that doesn't require delivery (e.g., pickup instead of delivery, digital instead of physical).`;
  } else if (/\b(credential|password|login|email.*password|log\s*in)\b/i.test(questionLower)) {
    // Missing credentials → use agent's own or skip
    strategy = `STRATEGY: The user didn't provide credentials. If this is a NEW account signup, use the agent's own email and auto-generated password. If this requires the USER's existing login (cancel/manage), report what you attempted and ask them to provide credentials when they're free.`;
  } else if (/\b(time|date|when|what day|what time|party size|how many|guests)\b/i.test(questionLower)) {
    // Missing booking details → pick sensible defaults
    strategy = `STRATEGY: The user didn't specify details. Use smart defaults: party size=2, time=7:00 PM tonight (or tomorrow if past 5 PM), pick the first available slot. Book it and tell the user what you booked — they can always change it.`;
  } else if (/\b(confirm|approve|go ahead|proceed|permission)\b/i.test(questionLower)) {
    // Waiting for confirmation → just do it
    strategy = `STRATEGY: The user was asked to confirm but didn't respond. They likely want it done. Proceed with the action as described. If it's reversible, just do it. If irreversible (delete account, large purchase), do everything EXCEPT the final irreversible step and report.`;
  } else if (/\b(skill|experience|background|what.*do you|what.*can you|specialty)\b/i.test(questionLower)) {
    // Missing user skills for money-making → pick universally applicable approach
    strategy = `STRATEGY: The user didn't share their skills. Pick the most universally accessible income approach: sign up for survey/micro-task sites, apply to entry-level freelance writing/data entry gigs, or create content. Execute on 3 different platforms. Report results.`;
  } else {
    // Generic fallback
    strategy = `STRATEGY: Make the decision a smart, resourceful human would make. Pick the most reasonable default, execute it, and tell the user what you did and why. If multiple good options exist, pick the best one. Don't overthink — just act.`;
  }

  return [
    `AUTO-PROCEED: The user was asked the following question but did not respond within ${delayMinutes} minutes:`,
    `"${originalQuestion}"`,
    ``,
    `Original task: "${originalTaskText}"`,
    ``,
    strategy,
    ``,
    `Do NOT ask the user again — they already didn't reply. Just execute the strategy above.`,
    `Report what you did clearly so the user can adjust if needed.`,
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
        // LOOP PREVENTION: Check if this task has already been auto-proceeded
        // Count how many tasks with similar input_text were created for this user today
        const taskText = (task.input_text || '').substring(0, 100);
        const { data: similarToday } = await supabase
          .from('tasks')
          .select('id')
          .eq('user_id', task.user_id)
          .gte('created_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
          .ilike('input_text', `%${taskText.substring(0, 50).replace(/[%_]/g, '')}%`)
          .limit(5);

        if (similarToday && similarToday.length >= 3) {
          console.warn(`[AUTO-PROCEED] LOOP DETECTED: "${taskText.substring(0, 40)}..." has ${similarToday.length} similar tasks today — killing auto-proceed`);
          await supabase.from('tasks').update({
            auto_proceed_at: null,
            auto_proceed_context: null,
          }).eq('id', task.id);
          continue;
        }

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
