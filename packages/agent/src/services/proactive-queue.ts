/**
 * Proactive Queue — Aurora's Action Generation & Processing
 *
 * Generates candidate proactive actions from:
 * - Commitments that are upcoming or overdue
 * - Detected patterns whose trigger conditions match now
 * - Smart suggestions from recent context
 *
 * Only creates actions with confidence >= 0.85.
 * Processes pending actions when their trigger time arrives.
 *
 * The actual delivery is handled by the communication system
 * (to be built later). For now, actions are logged and marked.
 */

import { getSupabaseClient } from "../utils/supabase.js";
import { logger } from "../utils/logger.js";

// ---- Types ----

type ActionType = "remind" | "suggest" | "inform" | "ask" | "do" | "check_in" | "follow_up";
type ActionStatus = "pending" | "scheduled" | "delivered" | "acted_on" | "dismissed" | "expired" | "failed";

interface QueuedAction {
  id: string;
  user_id: string;
  action_type: ActionType;
  title: string;
  description: string | null;
  priority: number;
  confidence: number;
  trigger_at: string | null;
  status: ActionStatus;
  preferred_channel: string | null;
  commitment_id: string | null;
  pattern_id: string | null;
}

interface CommitmentRow {
  id: string;
  user_id: string;
  description: string;
  who_committed: string;
  committed_to: string | null;
  due_date: string | null;
  status: string;
  reminder_sent: boolean;
  follow_up_sent: boolean;
}

interface PatternRow {
  id: string;
  user_id: string;
  pattern_type: string;
  description: string;
  trigger_conditions: Record<string, unknown> | null;
  confidence: number;
  is_active: boolean;
}

// ---- Constants ----

const MIN_ACTION_CONFIDENCE = 0.85;
const COMMITMENT_REMINDER_HOURS = 2; // Remind 2 hours before due
const MAX_ACTIONS_PER_RUN = 10; // Cap actions generated per user per run
const MAX_PROACTIVE_PER_DAY = 5; // Default daily frequency cap (configurable via user_settings)

// ---- Commitment Scanning ----

/**
 * Scan commitments table for upcoming/overdue items.
 * Generate reminder or follow-up actions.
 */
async function scanCommitments(userId: string): Promise<QueuedAction[]> {
  const actions: QueuedAction[] = [];
  const supabase = getSupabaseClient();

  try {
    // Find commitments due within COMMITMENT_REMINDER_HOURS that haven't been reminded
    const now = new Date();
    const reminderWindow = new Date(now.getTime() + COMMITMENT_REMINDER_HOURS * 60 * 60 * 1000);

    const { data: upcoming } = await supabase
      .from("commitments")
      .select("id, user_id, description, who_committed, committed_to, due_date, status, reminder_sent, follow_up_sent")
      .eq("user_id", userId)
      .eq("status", "pending")
      .eq("reminder_sent", false)
      .not("due_date", "is", null)
      .lte("due_date", reminderWindow.toISOString())
      .gte("due_date", now.toISOString());

    if (upcoming) {
      for (const commitment of upcoming as CommitmentRow[]) {
        const dueDate = new Date(commitment.due_date!);
        const hoursUntilDue = (dueDate.getTime() - now.getTime()) / (60 * 60 * 1000);
        const priority = hoursUntilDue <= 1 ? 8 : 6; // Higher priority if due soon

        actions.push({
          id: "",
          user_id: userId,
          action_type: "remind",
          title: `Reminder: ${commitment.description.substring(0, 80)}`,
          description: `You committed to "${commitment.description}"${
            commitment.committed_to ? ` (to ${commitment.committed_to})` : ""
          }. It's due in about ${Math.round(hoursUntilDue)} hour${hoursUntilDue >= 2 ? "s" : ""}.`,
          priority,
          confidence: 0.95, // Commitments are high-confidence
          trigger_at: now.toISOString(), // Trigger immediately
          status: "pending",
          preferred_channel: null, // Let the delivery system decide
          commitment_id: commitment.id,
          pattern_id: null,
        });
      }
    }

    // Find overdue commitments that haven't been followed up
    const { data: overdue } = await supabase
      .from("commitments")
      .select("id, user_id, description, who_committed, committed_to, due_date, status, reminder_sent, follow_up_sent")
      .eq("user_id", userId)
      .eq("status", "pending")
      .eq("follow_up_sent", false)
      .not("due_date", "is", null)
      .lt("due_date", now.toISOString());

    if (overdue) {
      for (const commitment of overdue as CommitmentRow[]) {
        const dueDate = new Date(commitment.due_date!);
        const hoursOverdue = (now.getTime() - dueDate.getTime()) / (60 * 60 * 1000);

        // Only follow up if overdue by 1+ hours (avoid immediate nagging)
        if (hoursOverdue < 1) continue;

        actions.push({
          id: "",
          user_id: userId,
          action_type: "follow_up",
          title: `Overdue: ${commitment.description.substring(0, 80)}`,
          description: `Your commitment "${commitment.description}" was due ${
            hoursOverdue < 24
              ? `${Math.round(hoursOverdue)} hours ago`
              : `${Math.round(hoursOverdue / 24)} days ago`
          }. Did you complete it, or should I reschedule?`,
          priority: 7,
          confidence: 0.9,
          trigger_at: now.toISOString(),
          status: "pending",
          preferred_channel: null,
          commitment_id: commitment.id,
          pattern_id: null,
        });

        // Mark the commitment as overdue
        await supabase
          .from("commitments")
          .update({ status: "overdue", updated_at: now.toISOString() })
          .eq("id", commitment.id);
      }
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[PROACTIVE-Q] Commitment scan error");
  }

  return actions;
}

/**
 * Scan detected patterns for trigger conditions that match now.
 */
async function scanPatternTriggers(userId: string): Promise<QueuedAction[]> {
  const actions: QueuedAction[] = [];
  const supabase = getSupabaseClient();

  try {
    const { data: patterns } = await supabase
      .from("detected_patterns")
      .select("id, user_id, pattern_type, description, trigger_conditions, confidence, is_active")
      .eq("user_id", userId)
      .eq("is_active", true)
      .gte("confidence", MIN_ACTION_CONFIDENCE);

    if (!patterns) return actions;

    const now = new Date();
    const currentHour = now.getHours();
    const currentDay = now.getDay();

    for (const pattern of patterns as PatternRow[]) {
      if (!pattern.trigger_conditions) continue;

      const conditions = pattern.trigger_conditions;
      let triggered = false;
      let actionType: ActionType = "suggest";
      let description = "";

      // Check daily routine triggers
      if (pattern.pattern_type === "daily_routine") {
        const windowStart = conditions.time_window_start as number | undefined;
        const windowEnd = conditions.time_window_end as number | undefined;
        const channel = conditions.channel as string | undefined;

        if (windowStart !== undefined && windowEnd !== undefined) {
          // Trigger 30 minutes before their typical active window
          const triggerHour = (windowStart - 1 + 24) % 24;
          if (currentHour === triggerHour) {
            triggered = true;
            actionType = "check_in";
            description = `It's almost your typical active time. Anything I can help you with today?`;
          }
        } else if (channel && conditions.typical_hour !== undefined) {
          // Channel-specific routine — just record, don't trigger
        }
      }

      // Check weekly cycle triggers
      if (pattern.pattern_type === "weekly_cycle") {
        const dayOfWeek = conditions.day_of_week as number | undefined;
        if (dayOfWeek !== undefined && currentDay === dayOfWeek && currentHour === 9) {
          // Trigger at 9 AM on their active day
          triggered = true;
          actionType = "check_in";
          const dayName = conditions.day_name as string || "today";
          description = `It's ${dayName} — one of your busiest days. Ready to get started?`;
        }
      }

      if (triggered && pattern.confidence >= MIN_ACTION_CONFIDENCE) {
        // Deduplicate: check if we already queued a similar action today
        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);
        const { data: existingToday } = await supabase
          .from("proactive_queue")
          .select("id")
          .eq("user_id", userId)
          .eq("pattern_id", pattern.id)
          .gte("created_at", todayStart.toISOString())
          .limit(1);

        if (existingToday && existingToday.length > 0) continue;

        actions.push({
          id: "",
          user_id: userId,
          action_type: actionType,
          title: `Pattern: ${pattern.description.substring(0, 80)}`,
          description,
          priority: 4, // Low-medium for pattern-triggered actions
          confidence: pattern.confidence,
          trigger_at: now.toISOString(),
          status: "pending",
          preferred_channel: null,
          commitment_id: null,
          pattern_id: pattern.id,
        });
      }
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[PROACTIVE-Q] Pattern trigger scan error");
  }

  return actions;
}

// ---- Main Entry Points ----

/**
 * Generate proactive actions for a specific user.
 * Scans commitments and pattern triggers, then inserts
 * qualified actions into the proactive_queue table.
 */
export async function generateProactiveActions(userId: string): Promise<number> {
  let actionsGenerated = 0;

  try {
    // Run all scanners in parallel
    const [commitmentActions, patternActions] = await Promise.all([
      scanCommitments(userId),
      scanPatternTriggers(userId),
    ]);

    const allActions = [...commitmentActions, ...patternActions];

    // Filter by minimum confidence
    const qualified = allActions
      .filter(a => a.confidence >= MIN_ACTION_CONFIDENCE)
      .slice(0, MAX_ACTIONS_PER_RUN);

    if (qualified.length === 0) return 0;

    const supabase = getSupabaseClient();

    for (const action of qualified) {
      try {
        const { error } = await supabase.from("proactive_queue").insert({
          user_id: action.user_id,
          action_type: action.action_type,
          title: action.title,
          description: action.description,
          priority: action.priority,
          confidence: action.confidence,
          trigger_at: action.trigger_at,
          status: "pending",
          preferred_channel: action.preferred_channel,
          commitment_id: action.commitment_id,
          pattern_id: action.pattern_id,
        });

        if (error) {
          logger.debug({ error: error.message }, "[PROACTIVE-Q] Failed to insert action");
        } else {
          actionsGenerated++;

          // If this was a commitment reminder, mark reminder_sent
          if (action.commitment_id && action.action_type === "remind") {
            await supabase
              .from("commitments")
              .update({ reminder_sent: true, updated_at: new Date().toISOString() })
              .eq("id", action.commitment_id);
          }

          // If this was a follow-up, mark follow_up_sent
          if (action.commitment_id && action.action_type === "follow_up") {
            await supabase
              .from("commitments")
              .update({ follow_up_sent: true, updated_at: new Date().toISOString() })
              .eq("id", action.commitment_id);
          }
        }
      } catch (err) {
        logger.debug({ err: err instanceof Error ? err.message : String(err) }, "[PROACTIVE-Q] Action insert error");
      }
    }

    if (actionsGenerated > 0) {
      logger.info("[PROACTIVE-Q] Generated %d actions for user %s", actionsGenerated, userId.substring(0, 8));
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[PROACTIVE-Q] Action generation failed");
  }

  return actionsGenerated;
}

// ---- FIX 2: Proactive Frequency Cap ----

/**
 * Check if a user has hit their daily proactive message limit.
 * Returns true if under the limit (OK to send), false if limit reached.
 */
async function checkProactiveLimit(userId: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  const today = new Date().toISOString().split('T')[0];

  try {
    const { count } = await supabase
      .from("proactive_queue")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "delivered")
      .gte("delivered_at", `${today}T00:00:00Z`);

    return (count || 0) < MAX_PROACTIVE_PER_DAY;
  } catch (err) {
    logger.debug({ err: err instanceof Error ? err.message : String(err) }, "[PROACTIVE-Q] Limit check failed — allowing");
    return true; // Fail open — better to send than silently drop
  }
}

// ---- FIX 5: Smart Proactive Timing ----

/**
 * Determine if a queued action should be delivered right now based on
 * user timezone, action type, and priority.
 */
function shouldDeliverNow(action: { action_type: string; priority: number }, userTimezone: string): boolean {
  // Parse the user's current hour
  try {
    const userTimeStr = new Date().toLocaleString('en-US', {
      timeZone: userTimezone,
      hour: 'numeric',
      hour12: false,
    });
    const userHour = parseInt(userTimeStr, 10);

    // Never deliver between 10 PM and 7 AM user time (unless critical)
    if ((userHour >= 22 || userHour < 7) && action.priority < 9) {
      return false;
    }
  } catch {
    // Invalid timezone — allow delivery (fail open)
  }

  // Action suggestions (from listening) — deliver within 30 seconds
  if (action.action_type === 'suggest' && action.priority >= 7) return true;

  // Commitment reminders — deliver at the scheduled time
  if (action.action_type === 'remind') return true;

  // Follow-ups — deliver
  if (action.action_type === 'follow_up') return true;

  // Low-priority info — batch for morning or evening digest
  if (action.priority <= 3) return false;

  return true;
}

/**
 * Load user timezone from their profile. Falls back to 'America/Los_Angeles'.
 */
async function getUserTimezone(userId: string): Promise<string> {
  try {
    const { data } = await getSupabaseClient()
      .from("profiles")
      .select("timezone")
      .eq("id", userId)
      .single();
    return data?.timezone || 'America/Los_Angeles';
  } catch {
    return 'America/Los_Angeles';
  }
}

/**
 * Process pending actions in the proactive queue.
 * Finds actions whose trigger_at has arrived and marks them for delivery.
 *
 * FIX 2: Checks daily frequency cap before delivering.
 * FIX 5: Checks smart timing (user timezone, quiet hours).
 *
 * The actual delivery (SMS/email/etc.) will be handled by the
 * communication system. For now, this logs what would be sent.
 */
export async function processQueue(): Promise<number> {
  let processed = 0;

  try {
    const now = new Date().toISOString();
    const supabase = getSupabaseClient();

    // Fetch pending actions whose trigger time has passed
    const { data: pendingActions, error } = await supabase
      .from("proactive_queue")
      .select("id, user_id, action_type, title, description, priority, preferred_channel, commitment_id, pattern_id")
      .eq("status", "pending")
      .lte("trigger_at", now)
      .order("priority", { ascending: false }) // Highest priority first
      .limit(20);

    if (error) {
      logger.warn({ error: error.message }, "[PROACTIVE-Q] Failed to fetch pending actions");
      return 0;
    }

    if (!pendingActions || pendingActions.length === 0) return 0;

    // Cache timezone lookups per user to avoid repeated DB queries
    const timezoneCache = new Map<string, string>();

    for (const action of pendingActions) {
      try {
        const userId = action.user_id as string;

        // FIX 2: Check daily frequency cap (skip if limit reached, unless priority >= 9)
        if ((action.priority as number) < 9) {
          const underLimit = await checkProactiveLimit(userId);
          if (!underLimit) {
            logger.debug("[PROACTIVE-Q] Daily limit reached for user %s — skipping %s", userId.substring(0, 8), action.title);
            continue;
          }
        }

        // FIX 5: Check smart timing (user timezone, quiet hours)
        let userTimezone = timezoneCache.get(userId);
        if (!userTimezone) {
          userTimezone = await getUserTimezone(userId);
          timezoneCache.set(userId, userTimezone);
        }

        if (!shouldDeliverNow(
          { action_type: action.action_type as string, priority: action.priority as number },
          userTimezone
        )) {
          logger.debug("[PROACTIVE-Q] Not the right time for user %s — deferring %s", userId.substring(0, 8), action.title);
          continue;
        }

        // For now, log the action and mark as delivered
        // The communication system (Phase 3) will handle actual delivery
        logger.info(
          "[PROACTIVE-Q] Would deliver to user %s: [%s] %s — %s (priority: %d, channel: %s)",
          userId.substring(0, 8),
          action.action_type,
          action.title,
          action.description || "(no description)",
          action.priority,
          action.preferred_channel || "auto"
        );

        // Mark as delivered (placeholder — will be updated when communication system is built)
        await supabase
          .from("proactive_queue")
          .update({
            status: "scheduled", // Set to 'scheduled' — communication system will set 'delivered'
            updated_at: new Date().toISOString(),
          })
          .eq("id", action.id);

        processed++;
      } catch (err) {
        // Mark as failed
        try {
          await supabase
            .from("proactive_queue")
            .update({
              status: "failed",
              updated_at: new Date().toISOString(),
            })
            .eq("id", action.id);
        } catch {
          /* ignore nested error */
        }

        logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[PROACTIVE-Q] Action processing failed");
      }
    }

    // Expire old pending actions (> 24 hours old)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from("proactive_queue")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("status", "pending")
      .lt("trigger_at", oneDayAgo);

    if (processed > 0) {
      logger.info("[PROACTIVE-Q] Processed %d queued actions", processed);
    }
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "[PROACTIVE-Q] Queue processing failed");
  }

  return processed;
}

/**
 * Acquire a distributed lock to prevent concurrent execution across instances.
 * Uses the same distributed_locks table pattern as scheduler.ts.
 * Returns true if lock was acquired, false if another instance holds it.
 */
async function acquireProactiveLock(): Promise<boolean> {
  const lockName = "proactive_queue_run";
  const supabase = getSupabaseClient();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minute lock

  try {
    // Try to upsert a lock — only succeed if no unexpired lock exists
    const { data: existing } = await supabase
      .from("distributed_locks")
      .select("locked_at")
      .eq("lock_name", lockName)
      .single();

    if (existing?.locked_at) {
      const lockedAt = new Date(existing.locked_at).getTime();
      const lockAge = now.getTime() - lockedAt;
      // If lock is less than 5 minutes old, another instance is running
      if (lockAge < 5 * 60 * 1000) {
        return false;
      }
    }

    // Acquire or renew the lock
    await supabase
      .from("distributed_locks")
      .upsert({
        lock_name: lockName,
        locked_at: now.toISOString(),
        locked_by: `proactive-queue-${process.pid}`,
        expires_at: expiresAt.toISOString(),
      }, { onConflict: "lock_name" });

    return true;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[PROACTIVE-Q] Lock acquisition failed");
    return false;
  }
}

/**
 * Release the distributed lock after processing completes.
 */
async function releaseProactiveLock(): Promise<void> {
  try {
    await getSupabaseClient()
      .from("distributed_locks")
      .delete()
      .eq("lock_name", "proactive_queue_run");
  } catch {
    // Non-critical — lock will expire on its own
  }
}

/**
 * Generate and process proactive actions for all active users.
 * Called by the scheduler periodically.
 *
 * Uses a distributed lock to prevent concurrent execution across
 * multiple instances (E025). Checks global proactive_enabled setting (E028).
 */
export async function runProactiveQueue(): Promise<{ generated: number; processed: number }> {
  // Acquire distributed lock — prevents duplicate execution across instances
  const lockAcquired = await acquireProactiveLock();
  if (!lockAcquired) {
    logger.debug("[PROACTIVE-Q] Skipping — another instance holds the lock");
    return { generated: 0, processed: 0 };
  }

  let totalGenerated = 0;
  let totalProcessed = 0;

  try {
    // Get users with proactive enabled (per-user opt-out check)
    const { data: enabledSettings } = await getSupabaseClient()
      .from("user_settings")
      .select("user_id")
      .eq("proactive_enabled", true);

    if (enabledSettings && enabledSettings.length > 0) {
      const userIds = enabledSettings.map(s => s.user_id as string);

      for (const userId of userIds) {
        try {
          const generated = await generateProactiveActions(userId);
          totalGenerated += generated;
        } catch {
          // Continue to next user
        }
      }
    }

    // Process any pending actions across all users
    totalProcessed = await processQueue();
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "[PROACTIVE-Q] Batch run failed");
  } finally {
    // Always release lock
    await releaseProactiveLock();
  }

  return { generated: totalGenerated, processed: totalProcessed };
}
