/**
 * Task Scheduler
 * 
 * Runs scheduled tasks based on their cron expressions.
 * Checks every minute for tasks that need to be executed.
 */

import { processTask } from './processor.js';
import { getProactiveEngine } from './proactive.js';
import { compressOldMemories, decayMemories } from './memory.js';
import { getSupabaseClient, acquireDistributedLock, releaseDistributedLock } from '../utils/supabase.js';

let schedulerInterval: NodeJS.Timeout | null = null;
let proactiveInterval: NodeJS.Timeout | null = null;

/**
 * Start the scheduler - runs every minute
 */
export function startScheduler(): void {
  if (schedulerInterval) {
    console.log('[SCHEDULER] Already running');
    return;
  }
  
  // Run immediately on start
  runDueScheduledTasks().catch(console.error);
  
  // Then run every minute
  schedulerInterval = setInterval(async () => {
    try {
      await runDueScheduledTasks();
    } catch (error) {
      console.error('[SCHEDULER] Error running scheduled tasks:', error);
    }
  }, 60 * 1000);
  
  console.log('[SCHEDULER] Started - checking for due tasks every minute');

  // Start proactive engine (hourly)
  runProactiveChecks().catch(console.error);
  proactiveInterval = setInterval(async () => {
    try {
      await runProactiveChecks();
    } catch (error) {
      console.error('[SCHEDULER] Proactive check error:', error);
    }
  }, 60 * 60 * 1000); // Every hour

  console.log('[SCHEDULER] Proactive engine started - checking hourly');
}

/**
 * Stop the scheduler
 */
export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  if (proactiveInterval) {
    clearInterval(proactiveInterval);
    proactiveInterval = null;
  }
  console.log('[SCHEDULER] Stopped');
}

/**
 * Run proactive checks for all enabled users.
 * Uses a distributed lock so only one instance runs at a time.
 */
async function runProactiveChecks(): Promise<void> {
  const acquired = await acquireDistributedLock("scheduler_proactive", 5 * 60_000);
  if (!acquired) {
    console.log("[SCHEDULER] Proactive check skipped — another instance holds the lock");
    return;
  }

  try {
    const engine = getProactiveEngine();
    const count = await engine.runForAllUsers();
    if (count > 0) {
      console.log(`[SCHEDULER] Proactive: ${count} findings routed`);
    }
  } catch (error) {
    console.error('[SCHEDULER] Proactive engine error:', error);
  }

  // Also run memory compression + decay
  try {
    await runMemoryCompression();
  } catch (error) {
    console.error('[SCHEDULER] Memory compression error:', error);
  }

  // Run data retention cleanup (daily, checked hourly)
  try {
    await runDataRetention();
  } catch (error) {
    console.error('[SCHEDULER] Data retention error:', error);
  }

  // Cleanup expired TFA codes
  try {
    await getSupabaseClient().rpc('cleanup_expired_tfa_codes');
  } catch {
    // Non-critical
  }

  // Refresh expiring OAuth tokens
  try {
    const { checkAndRefreshExpiring } = await import("./oauth-manager.js");
    await checkAndRefreshExpiring();
  } catch {
    // Non-critical
  }

  // Process overnight task queue
  try {
    const { processOvernightQueue, sendMorningSummaries } = await import("./overnight.js");
    await processOvernightQueue();
    await sendMorningSummaries();
  } catch {
    // Non-critical
  }

  // Check stale learnings (>14 days since layout verified)
  try {
    await checkStaleLearnings();
  } catch {
    // Non-critical
  }

  // Clean up old processed_emails (>7 days)
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    await getSupabaseClient()
      .from("processed_emails")
      .delete()
      .lt("processed_at", sevenDaysAgo);
  } catch {
    // Non-critical
  }

  await releaseDistributedLock("scheduler_proactive");
}

/**
 * Mark learnings with stale layout verification (>14 days old).
 */
async function checkStaleLearnings(): Promise<void> {
  const staleDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  await getSupabaseClient()
    .from("learnings")
    .update({ page_hash: null })
    .not("page_hash", "is", null)
    .lt("layout_verified_at", staleDate);
}

/**
 * Compress old working memories for all users.
 */
async function runMemoryCompression(): Promise<void> {
  const { data: users } = await getSupabaseClient()
    .from('profiles')
    .select('id')
    .limit(100);

  if (!users) return;

  for (const user of users) {
    try {
      await compressOldMemories(user.id);
      await decayMemories(user.id);
    } catch {
      // Non-critical
    }
  }
}

// Track last retention run date to avoid running more than once per day
let lastRetentionDate = "";

/**
 * Delete completed/failed tasks and action_history older than 90 days.
 * Runs once per day (checked on each hourly invocation).
 */
async function runDataRetention(): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  if (lastRetentionDate === today) return;

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  // Delete old action_history entries
  const { error: ahError } = await getSupabaseClient()
    .from("action_history")
    .delete()
    .lt("created_at", ninetyDaysAgo);

  if (ahError) {
    console.error("[RETENTION] action_history cleanup error:", ahError);
  }

  // Delete old completed/failed/cancelled tasks
  const { data: deleted, error: taskError } = await getSupabaseClient()
    .from("tasks")
    .delete()
    .in("status", ["completed", "cancelled", "failed"])
    .lt("completed_at", ninetyDaysAgo)
    .select("id");

  if (taskError) {
    console.error("[RETENTION] tasks cleanup error:", taskError);
  } else if (deleted && deleted.length > 0) {
    console.log(`[RETENTION] Cleaned up ${deleted.length} old tasks`);
  }

  lastRetentionDate = today;
}

/**
 * Run all scheduled tasks that are due.
 * Uses a distributed lock so only one instance runs at a time.
 */
async function runDueScheduledTasks(): Promise<void> {
  const acquired = await acquireDistributedLock("scheduler_tasks", 2 * 60_000);
  if (!acquired) {
    return; // Another instance is handling scheduled tasks
  }

  try {
    await runDueScheduledTasksInner();
  } finally {
    await releaseDistributedLock("scheduler_tasks");
  }
}

async function runDueScheduledTasksInner(): Promise<void> {
  const now = new Date().toISOString();

  // Get all active tasks that are due
  const { data: dueTasks, error } = await getSupabaseClient()
    .from('scheduled_tasks')
    .select('*, profiles!user_id(*)')
    .eq('is_active', true)
    .lte('next_run_at', now);
  
  if (error) {
    console.error('[SCHEDULER] Error fetching due tasks:', error);
    return;
  }
  
  if (!dueTasks || dueTasks.length === 0) {
    return; // No tasks due
  }
  
  console.log(`[SCHEDULER] Found ${dueTasks.length} due tasks`);
  
  for (const scheduled of dueTasks) {
    try {
      // Create a task from the scheduled template
      const profile = scheduled.profiles;
      if (!profile) {
        console.error(`[SCHEDULER] No profile found for scheduled task ${scheduled.id}`);
        continue;
      }
      
      // Process the scheduled task
      await processTask({
        userId: scheduled.user_id,
        username: profile.username,
        from: profile.email,
        subject: `[Scheduled] ${scheduled.description}`,
        body: scheduled.description
      });
      
      // Update last_run_at and calculate next_run_at
      const nextRun = calculateNextRun(scheduled.cron_expression, scheduled.timezone);
      
      await getSupabaseClient()
        .from('scheduled_tasks')
        .update({
          last_run_at: now,
          next_run_at: nextRun,
          run_count: (scheduled.run_count || 0) + 1
        })
        .eq('id', scheduled.id);
      
      console.log(`[SCHEDULER] Completed scheduled task: ${scheduled.description}`);
    } catch (error) {
      console.error(`[SCHEDULER] Error processing scheduled task ${scheduled.id}:`, error);
    }
  }
}

/**
 * Calculate next run time based on cron expression
 * Simplified version - supports basic patterns:
 * - "daily" or "0 9 * * *" - runs daily at 9am
 * - "weekly" or "0 9 * * 1" - runs weekly on Monday at 9am
 * - "monthly" or "0 9 1 * *" - runs monthly on 1st at 9am
 * - "hourly" - runs every hour
 */
function calculateNextRun(cronExpression: string, timezone: string = 'America/Los_Angeles'): string {
  const now = new Date();
  let next: Date;
  
  const cron = cronExpression.toLowerCase().trim();
  
  switch (cron) {
    case 'hourly':
      next = new Date(now.getTime() + 60 * 60 * 1000);
      break;
    case 'daily':
      next = new Date(now);
      next.setDate(next.getDate() + 1);
      next.setHours(9, 0, 0, 0);
      break;
    case 'weekly':
      next = new Date(now);
      next.setDate(next.getDate() + 7);
      next.setHours(9, 0, 0, 0);
      break;
    case 'monthly':
      next = new Date(now);
      next.setMonth(next.getMonth() + 1);
      next.setDate(1);
      next.setHours(9, 0, 0, 0);
      break;
    default:
      // For standard cron expressions, use a simple parser
      next = parseCronToNextRun(cronExpression, now);
  }
  
  return next.toISOString();
}

/**
 * Simple cron parser for standard expressions
 * Format: minute hour day month weekday
 */
function parseCronToNextRun(cron: string, from: Date): Date {
  const parts = cron.split(' ');
  if (parts.length !== 5) {
    // Invalid cron, default to daily
    const next = new Date(from);
    next.setDate(next.getDate() + 1);
    next.setHours(9, 0, 0, 0);
    return next;
  }
  
  const [minute, hour, day, month, weekday] = parts;
  const next = new Date(from);
  
  // Set time
  if (hour !== '*') next.setHours(parseInt(hour) || 9);
  if (minute !== '*') next.setMinutes(parseInt(minute) || 0);
  next.setSeconds(0);
  next.setMilliseconds(0);
  
  // If the time has passed today, move to tomorrow
  if (next <= from) {
    next.setDate(next.getDate() + 1);
  }
  
  // Handle day of month
  if (day !== '*') {
    const targetDay = parseInt(day) || 1;
    if (next.getDate() > targetDay) {
      next.setMonth(next.getMonth() + 1);
    }
    next.setDate(targetDay);
  }
  
  // Handle weekday (0 = Sunday, 1 = Monday, etc.)
  if (weekday !== '*') {
    const targetWeekday = parseInt(weekday) || 0;
    const currentWeekday = next.getDay();
    let daysToAdd = targetWeekday - currentWeekday;
    if (daysToAdd <= 0) daysToAdd += 7;
    next.setDate(next.getDate() + daysToAdd);
  }
  
  return next;
}

/**
 * Create a new scheduled task
 */
export async function createScheduledTask(params: {
  userId: string;
  description: string;
  cronExpression: string;
  timezone?: string;
}): Promise<{ success: boolean; taskId?: string; error?: string }> {
  const nextRun = calculateNextRun(params.cronExpression, params.timezone);
  
  const { data, error } = await getSupabaseClient()
    .from('scheduled_tasks')
    .insert({
      user_id: params.userId,
      description: params.description,
      cron_expression: params.cronExpression,
      timezone: params.timezone || 'America/Los_Angeles',
      next_run_at: nextRun,
      is_active: true
    })
    .select()
    .single();
  
  if (error) {
    return { success: false, error: error.message };
  }
  
  return { success: true, taskId: data.id };
}

/**
 * Cancel a scheduled task
 */
export async function cancelScheduledTask(taskId: string, userId: string): Promise<boolean> {
  const { error } = await getSupabaseClient()
    .from('scheduled_tasks')
    .update({ is_active: false })
    .eq('id', taskId)
    .eq('user_id', userId);
  
  return !error;
}
