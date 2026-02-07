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
import { detectPatterns } from './pattern-detector.js';

let schedulerInterval: NodeJS.Timeout | null = null;
let proactiveInterval: NodeJS.Timeout | null = null;
let checkinInterval: NodeJS.Timeout | null = null;

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

  // Start daily check-in calls (every 5 minutes)
  runCheckinCalls().catch(console.error);
  checkinInterval = setInterval(async () => {
    try {
      await runCheckinCalls();
    } catch (error) {
      console.error('[SCHEDULER] Check-in call error:', error);
    }
  }, 5 * 60 * 1000); // Every 5 minutes

  console.log('[SCHEDULER] Check-in engine started - checking every 5 minutes');
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
  if (checkinInterval) {
    clearInterval(checkinInterval);
    checkinInterval = null;
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

  // Cleanup expired email PIN sessions
  try {
    const { data: cleanupResult } = await getSupabaseClient().rpc('cleanup_expired_email_pin_sessions');
    if (cleanupResult && cleanupResult > 0) {
      console.log(`[SCHEDULER] Cleaned up ${cleanupResult} expired email PIN sessions`);
    }
  } catch {
    // Non-critical
  }

  // SELF-LEARNING: Run cross-task pattern detection (daily, checked hourly)
  try {
    const now = new Date();
    // Only run once per day (between 3:00-4:00 AM UTC)
    if (now.getUTCHours() === 3) {
      const patterns = await detectPatterns();
      if (patterns.length > 0) {
        console.log(`[SCHEDULER] Pattern detection: found ${patterns.length} cross-task patterns`);
      }
    }
  } catch (error) {
    console.error('[SCHEDULER] Pattern detection error:', error);
  }

  // AUTONOMOUS INTELLIGENCE: Run skill recommendations (daily at 4 AM UTC, after pattern detection)
  try {
    const now = new Date();
    if (now.getUTCHours() === 4) {
      const { recommendSkills, formatSkillRecommendations } = await import("./autonomous-skill-recommender.js");
      const { sendResponse } = await import("./email.js");

      // Get all users with tasks in last 30 days
      const { data: activeUsers } = await getSupabaseClient()
        .from("tasks")
        .select("user_id")
        .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .limit(1000);

      if (activeUsers && activeUsers.length > 0) {
        const uniqueUserIds = [...new Set(activeUsers.map(u => u.user_id))];
        console.log(`[SCHEDULER] Running skill recommendations for ${uniqueUserIds.length} active users`);

        for (const userId of uniqueUserIds.slice(0, 100)) { // Limit to 100/day to avoid spam
          try {
            const recommendations = await recommendSkills(userId);
            if (recommendations.length > 0) {
              const { data: profile } = await getSupabaseClient()
                .from("profiles")
                .select("email, username")
                .eq("id", userId)
                .single();

              if (profile && profile.email) {
                const formattedRecommendations = formatSkillRecommendations(recommendations);
                await sendResponse({
                  to: profile.email,
                  from: `${profile.username}@aevoy.com`,
                  subject: "[Aevoy] Skill Recommendations",
                  body: `I analyzed your recent task patterns and found ${recommendations.length} skills that could help:\n\n${formattedRecommendations}\n\nInstall skills at: https://www.aevoy.com/dashboard/skills`,
                });
                console.log(`[SCHEDULER] Sent ${recommendations.length} skill recommendations to user ${userId.slice(0, 8)}`);
              }
            }
          } catch {
            // Non-critical, continue to next user
          }
        }
      }
    }
  } catch (error) {
    console.error('[SCHEDULER] Skill recommendation error:', error);
  }

  // META-LEARNING: Analyze learning performance (weekly on Sundays at 5 AM UTC)
  try {
    const now = new Date();
    if (now.getUTCHours() === 5 && now.getUTCDay() === 0) { // Sunday
      const { runMetaLearningCycle, formatMetaReport } = await import("./meta-learner.js");
      console.log(`[SCHEDULER] Running meta-learning cycle (weekly analysis)`);

      const result = await runMetaLearningCycle(); // Global analysis
      console.log(formatMetaReport(result.metrics, result.recommendations));
      console.log(`[SCHEDULER] Meta-learning: ${result.optimizationsApplied} optimizations applied`);
    }
  } catch (error) {
    console.error('[SCHEDULER] Meta-learning error:', error);
  }

  // CAPABILITY EXPANSION: Detect gaps and auto-expand (daily at 6 AM UTC)
  try {
    const now = new Date();
    if (now.getUTCHours() === 6) {
      const { detectCapabilityGaps, autoExpandCapabilities, formatCapabilityReport } = await import("./capability-expander.js");
      console.log(`[SCHEDULER] Running capability expansion (daily scan)`);

      const gaps = await detectCapabilityGaps(undefined, 30); // Global scan, last 30 days
      const expandedCount = await autoExpandCapabilities(gaps, "system");
      console.log(`[SCHEDULER] Capability expansion: ${gaps.length} gaps detected, ${expandedCount} auto-expanded`);

      if (gaps.length > 0) {
        console.log(formatCapabilityReport(gaps));
      }
    }
  } catch (error) {
    console.error('[SCHEDULER] Capability expansion error:', error);
  }

  // PROACTIVE PROBLEM DETECTION: Scan for issues (hourly)
  try {
    const { detectProblemsForUser, autoFixProblems, formatProblemsForNotification } = await import("./proactive-problem-detector.js");

    // Get all active users (with tasks in last 7 days)
    const { data: recentUsers } = await getSupabaseClient()
      .from("tasks")
      .select("user_id")
      .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .limit(100);

    if (recentUsers && recentUsers.length > 0) {
      const uniqueUserIds = [...new Set(recentUsers.map(u => u.user_id))];
      console.log(`[SCHEDULER] Running proactive problem detection for ${uniqueUserIds.length} active users`);

      for (const userId of uniqueUserIds.slice(0, 50)) { // Limit to 50/hour to avoid overload
        try {
          const problems = await detectProblemsForUser(userId);
          if (problems.length > 0) {
            await autoFixProblems(userId, problems);
            console.log(`[SCHEDULER] Detected ${problems.length} problems for user ${userId.slice(0, 8)}, auto-fixing applied`);

            // Notify user about detected problems
            const criticalProblems = problems.filter(p => p.severity === "critical");
            if (criticalProblems.length > 0) {
              const { data: profile } = await getSupabaseClient()
                .from("profiles")
                .select("email, username")
                .eq("id", userId)
                .single();

              if (profile && profile.email) {
                const { sendResponse } = await import("./email.js");
                await sendResponse({
                  to: profile.email,
                  from: `${profile.username}@aevoy.com`,
                  subject: "[Aevoy] Action Required",
                  body: formatProblemsForNotification(criticalProblems),
                });
              }
            }
          }
        } catch {
          // Non-critical, continue to next user
        }
      }
    }
  } catch (error) {
    console.error('[SCHEDULER] Proactive problem detection error:', error);
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
 * Run daily check-in calls for opted-in users.
 * Checks if current time matches morning or evening check-in time (±5 min window).
 * Uses a distributed lock so only one instance runs at a time.
 */
async function runCheckinCalls(): Promise<void> {
  const acquired = await acquireDistributedLock("scheduler_checkins", 5 * 60_000);
  if (!acquired) {
    return; // Another instance is handling check-ins
  }

  try {
    const now = new Date();
    const currentHour = now.getUTCHours();
    const currentMinute = now.getUTCMinutes();

    // Query users who have daily check-ins enabled
    const { data: profiles } = await getSupabaseClient()
      .from("profiles")
      .select("id, username, timezone, phone_number, daily_checkin_morning_time, daily_checkin_evening_time")
      .eq("daily_checkin_enabled", true)
      .not("phone_number", "is", null);

    if (!profiles || profiles.length === 0) {
      await releaseDistributedLock("scheduler_checkins");
      return;
    }

    for (const profile of profiles) {
      try {
        const userTimezone = profile.timezone || "America/Vancouver";
        const morningTime = profile.daily_checkin_morning_time || "09:00:00";
        const eveningTime = profile.daily_checkin_evening_time || "21:00:00";

        // Check if current time matches morning or evening (±5 min window)
        const shouldCallMorning = isTimeMatch(currentHour, currentMinute, morningTime, userTimezone);
        const shouldCallEvening = isTimeMatch(currentHour, currentMinute, eveningTime, userTimezone);

        if (!shouldCallMorning && !shouldCallEvening) continue;

        const callType = shouldCallMorning ? "morning" : "evening";

        // Check if already called today
        const { data: recentCalls } = await getSupabaseClient()
          .from("call_history")
          .select("id")
          .eq("user_id", profile.id)
          .eq("call_type", `checkin_${callType}`)
          .gte("created_at", new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString())
          .limit(1);

        if (recentCalls && recentCalls.length > 0) {
          console.log(`[SCHEDULER] Already called ${profile.username} for ${callType} check-in today`);
          continue;
        }

        // Make check-in call
        console.log(`[SCHEDULER] Initiating ${callType} check-in call for ${profile.username}`);
        const { makeCheckinCall } = await import("./checkin.js");
        await makeCheckinCall(profile.id, profile.phone_number, callType);
      } catch (error) {
        console.error(`[SCHEDULER] Error making check-in call for user ${profile.id}:`, error);
      }
    }
  } catch (error) {
    console.error('[SCHEDULER] Check-in calls error:', error);
  }

  await releaseDistributedLock("scheduler_checkins");
}

/**
 * Check if current UTC time matches user's local time (±5min window).
 * Converts user's local HH:MM time to UTC and compares.
 */
function isTimeMatch(currentHourUTC: number, currentMinuteUTC: number, targetTime: string, timezone: string): boolean {
  // Parse targetTime (HH:MM:SS)
  const [hour, minute] = targetTime.split(":").map(Number);

  // Timezone offset mapping (UTC offset in hours)
  const timezoneOffsets: Record<string, number> = {
    "America/Vancouver": -8,
    "America/Los_Angeles": -8,
    "America/Denver": -7,
    "America/Chicago": -6,
    "America/New_York": -5,
    "America/Toronto": -5,
    "Europe/London": 0,
    "Europe/Paris": 1,
    "Asia/Dubai": 4,
    "Asia/Kolkata": 5.5,
    "Asia/Shanghai": 8,
    "Asia/Tokyo": 9,
    "Australia/Sydney": 11
  };

  const offset = timezoneOffsets[timezone] || 0;

  // Convert local time to UTC (subtract offset)
  const targetHourUTC = (hour - offset + 24) % 24;

  // Calculate time difference in minutes
  const currentTotalMinutes = currentHourUTC * 60 + currentMinuteUTC;
  const targetTotalMinutes = targetHourUTC * 60 + minute;
  const diffMinutes = Math.abs(currentTotalMinutes - targetTotalMinutes);

  // Match if within ±5 minutes
  return diffMinutes <= 5;
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
