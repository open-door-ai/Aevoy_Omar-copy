/**
 * Task Scheduler
 * 
 * Runs scheduled tasks based on their cron expressions.
 * Checks every minute for tasks that need to be executed.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { processTask } from './processor.js';

let supabase: SupabaseClient | null = null;
let schedulerInterval: NodeJS.Timeout | null = null;

function getSupabase(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    );
  }
  return supabase;
}

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
}

/**
 * Stop the scheduler
 */
export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[SCHEDULER] Stopped');
  }
}

/**
 * Run all scheduled tasks that are due
 */
async function runDueScheduledTasks(): Promise<void> {
  const now = new Date().toISOString();
  
  // Get all active tasks that are due
  const { data: dueTasks, error } = await getSupabase()
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
      
      await getSupabase()
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
  
  const { data, error } = await getSupabase()
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
  const { error } = await getSupabase()
    .from('scheduled_tasks')
    .update({ is_active: false })
    .eq('id', taskId)
    .eq('user_id', userId);
  
  return !error;
}
