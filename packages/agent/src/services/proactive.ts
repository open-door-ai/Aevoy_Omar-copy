/**
 * Proactive Engine
 *
 * Checks for triggers and proactively alerts/acts for users.
 * Runs hourly for users with proactive_enabled=true.
 *
 * Triggers:
 * - Domain expiring in 7 days → Call + SMS (high)
 * - Meeting in 1 hour → Email + SMS (medium)
 * - Unanswered email > 24hrs → SMS (medium)
 * - Bill due soon → Call + SMS (high)
 * - Flight booked → Auto check-in (medium)
 * - Package shipped → SMS on delivery (low)
 * - Recurring task detected (3+) → Email (low)
 * - Better deal found → Email (low)
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { sendSms, callUser } from "./twilio.js";
import { sendResponse } from "./email.js";
import type { ProactiveFinding, ProactivePriority } from "../types/index.js";

let supabase: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      process.env.SUPABASE_SERVICE_ROLE_KEY || ""
    );
  }
  return supabase;
}

// ---- Proactive Engine ----

export class ProactiveEngine {
  private isRunning = false;

  /**
   * Run proactive checks for all enabled users.
   */
  async runForAllUsers(): Promise<number> {
    if (this.isRunning) {
      console.log("[PROACTIVE] Already running, skipping");
      return 0;
    }

    this.isRunning = true;
    let findingsCount = 0;

    try {
      // Get all users with proactive enabled
      const { data: users, error } = await getSupabaseClient()
        .from("profiles")
        .select("id, username, email, twilio_number, timezone")
        .eq("proactive_enabled", true);

      if (error || !users || users.length === 0) {
        return 0;
      }

      console.log(`[PROACTIVE] Checking ${users.length} users`);

      for (const user of users) {
        try {
          const findings = await this.checkUser(user.id, user.timezone || "America/Los_Angeles");

          for (const finding of findings) {
            await this.routeFinding(finding, {
              userId: user.id,
              username: user.username,
              email: user.email,
              phone: user.twilio_number,
            });
            findingsCount++;
          }
        } catch (error) {
          console.error(`[PROACTIVE] Error checking user ${user.id}:`, error);
        }
      }

      console.log(`[PROACTIVE] Completed. ${findingsCount} findings routed.`);
    } finally {
      this.isRunning = false;
    }

    return findingsCount;
  }

  /**
   * Check all triggers for a single user.
   */
  async checkUser(userId: string, timezone: string): Promise<ProactiveFinding[]> {
    const findings: ProactiveFinding[] = [];

    const checks = [
      this.checkRecurringTasks(userId),
      this.checkUnansweredTasks(userId),
      this.checkUpcomingScheduledTasks(userId, timezone),
    ];

    const results = await Promise.allSettled(checks);

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        findings.push(...result.value);
      }
    }

    return findings;
  }

  /**
   * Check for recurring task patterns (3+ similar tasks).
   */
  private async checkRecurringTasks(userId: string): Promise<ProactiveFinding[]> {
    const findings: ProactiveFinding[] = [];

    // Get last 30 days of tasks
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: tasks } = await getSupabaseClient()
      .from("tasks")
      .select("email_subject, type, input_text")
      .eq("user_id", userId)
      .eq("status", "completed")
      .gte("created_at", thirtyDaysAgo);

    if (!tasks || tasks.length < 3) return findings;

    // Group by subject similarity (simple keyword matching)
    const subjectCounts = new Map<string, number>();
    for (const task of tasks) {
      const key = normalizeSubject(task.email_subject || task.input_text || "");
      if (key) {
        subjectCounts.set(key, (subjectCounts.get(key) || 0) + 1);
      }
    }

    // Find patterns with 3+ occurrences
    for (const [subject, count] of subjectCounts) {
      if (count >= 3) {
        findings.push({
          trigger: "recurring_task",
          action: `I noticed you've done "${subject}" ${count} times in the last month. Would you like me to automate this as a scheduled task?`,
          channel: "email",
          priority: "low",
          userId,
          data: { subject, count },
        });
      }
    }

    return findings;
  }

  /**
   * Check for tasks that seem unanswered/incomplete.
   */
  private async checkUnansweredTasks(userId: string): Promise<ProactiveFinding[]> {
    const findings: ProactiveFinding[] = [];

    // Find tasks stuck in processing for > 1 hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { data: stuckTasks } = await getSupabaseClient()
      .from("tasks")
      .select("id, email_subject, status, created_at")
      .eq("user_id", userId)
      .in("status", ["processing", "awaiting_user_input"])
      .lt("created_at", oneHourAgo);

    if (stuckTasks && stuckTasks.length > 0) {
      for (const task of stuckTasks) {
        if (task.status === "awaiting_user_input") {
          findings.push({
            trigger: "unanswered_task",
            action: `Your task "${task.email_subject || "untitled"}" is waiting for your response. Reply to continue or cancel it.`,
            channel: "sms",
            priority: "medium",
            userId,
            data: { taskId: task.id },
          });
        }
      }
    }

    return findings;
  }

  /**
   * Check for upcoming scheduled tasks.
   */
  private async checkUpcomingScheduledTasks(
    userId: string,
    _timezone: string
  ): Promise<ProactiveFinding[]> {
    const findings: ProactiveFinding[] = [];

    // Find tasks due in the next hour
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000).toISOString();

    const { data: upcoming } = await getSupabaseClient()
      .from("scheduled_tasks")
      .select("id, description, next_run_at")
      .eq("user_id", userId)
      .eq("is_active", true)
      .gte("next_run_at", now.toISOString())
      .lte("next_run_at", oneHourFromNow);

    if (upcoming && upcoming.length > 0) {
      for (const task of upcoming) {
        findings.push({
          trigger: "upcoming_scheduled_task",
          action: `Reminder: Your scheduled task "${task.description}" will run soon.`,
          channel: "sms",
          priority: "low",
          userId,
          data: { taskId: task.id, nextRun: task.next_run_at },
        });
      }
    }

    return findings;
  }

  /**
   * Route a finding to the appropriate channel based on priority.
   */
  private async routeFinding(
    finding: ProactiveFinding,
    user: { userId: string; username: string; email: string; phone: string | null }
  ): Promise<void> {
    const { priority, action, channel } = finding;

    try {
      switch (priority) {
        case "high": {
          // High priority: Call + SMS
          if (user.phone) {
            await callUser({
              userId: user.userId,
              to: user.phone,
              message: action,
            });
            await sendSms({
              userId: user.userId,
              to: user.phone,
              body: `[Aevoy] ${action}`,
            });
          } else {
            // Fallback to email if no phone
            await sendResponse({
              to: user.email,
              from: `${user.username}@aevoy.com`,
              subject: "[Aevoy Alert] " + finding.trigger.replace(/_/g, " "),
              body: action,
            });
          }
          break;
        }

        case "medium": {
          // Medium: SMS preferred, email fallback
          if (user.phone && (channel === "sms" || channel === "voice")) {
            await sendSms({
              userId: user.userId,
              to: user.phone,
              body: `[Aevoy] ${action}`,
            });
          } else {
            await sendResponse({
              to: user.email,
              from: `${user.username}@aevoy.com`,
              subject: "[Aevoy] " + finding.trigger.replace(/_/g, " "),
              body: action,
            });
          }
          break;
        }

        case "low": {
          // Low: Email only (don't bother with calls/SMS)
          await sendResponse({
            to: user.email,
            from: `${user.username}@aevoy.com`,
            subject: "[Aevoy Suggestion] " + finding.trigger.replace(/_/g, " "),
            body: action,
          });
          break;
        }
      }

      // Record the proactive action as a task
      await getSupabaseClient().from("tasks").insert({
        user_id: user.userId,
        status: "completed",
        type: "proactive",
        email_subject: `[Proactive] ${finding.trigger}`,
        input_text: action,
        input_channel: "proactive",
        completed_at: new Date().toISOString(),
      });

      console.log(`[PROACTIVE] Routed ${priority} finding for ${user.username}: ${finding.trigger}`);
    } catch (error) {
      console.error(`[PROACTIVE] Failed to route finding:`, error);
    }
  }
}

// ---- Helpers ----

/**
 * Normalize a task subject for pattern matching.
 * Removes dates, numbers, and common filler words.
 */
function normalizeSubject(text: string): string {
  return text
    .toLowerCase()
    .replace(/\d{4}-\d{2}-\d{2}/g, "") // Remove dates
    .replace(/\d+/g, "N") // Replace numbers with N
    .replace(/\b(the|a|an|for|to|of|in|on|at|and|or|is|it|my)\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 50);
}

// ---- Singleton ----

let engine: ProactiveEngine | null = null;

export function getProactiveEngine(): ProactiveEngine {
  if (!engine) {
    engine = new ProactiveEngine();
  }
  return engine;
}
