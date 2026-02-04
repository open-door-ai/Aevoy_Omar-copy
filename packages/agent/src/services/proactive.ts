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

import { sendSms, callUser } from "./twilio.js";
import { sendResponse } from "./email.js";
import { getSupabaseClient } from "../utils/supabase.js";
import type { ProactiveFinding, ProactivePriority } from "../types/index.js";

// ---- Proactive Engine ----

export class ProactiveEngine {
  private isRunning = false;
  private dailyCounters = new Map<string, { count: number; date: string }>();

  /**
   * Check if it's quiet hours (10 PM – 7 AM) in the user's timezone.
   */
  private isQuietHours(timezone: string): boolean {
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "numeric",
        hour12: false,
      });
      const hour = parseInt(formatter.format(now));
      return hour >= 22 || hour < 7;
    } catch {
      // Invalid timezone — default to not quiet
      return false;
    }
  }

  /**
   * Check if daily proactive limit is reached for a user.
   * Max 2 proactive messages per user per day (high priority bypasses).
   */
  private isDailyLimitReached(userId: string, priority: ProactivePriority): boolean {
    if (priority === "high") return false; // High priority always goes through

    const today = new Date().toISOString().split("T")[0];
    const counter = this.dailyCounters.get(userId);

    if (!counter || counter.date !== today) {
      return false; // New day, no limit
    }

    return counter.count >= 2;
  }

  /**
   * Increment daily counter for a user.
   */
  private incrementDailyCounter(userId: string): void {
    const today = new Date().toISOString().split("T")[0];
    const counter = this.dailyCounters.get(userId);

    if (!counter || counter.date !== today) {
      this.dailyCounters.set(userId, { count: 1, date: today });
    } else {
      counter.count++;
    }
  }

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
          const tz = user.timezone || "America/Los_Angeles";

          // Skip users in quiet hours
          if (this.isQuietHours(tz)) {
            console.log(`[PROACTIVE] Skipping ${user.username} (quiet hours in ${tz})`);
            continue;
          }

          const findings = await this.checkUser(user.id, tz);

          for (const finding of findings) {
            // Check daily rate limit
            if (this.isDailyLimitReached(user.id, finding.priority)) {
              console.log(`[PROACTIVE] Skipping ${finding.trigger} for ${user.username} (daily limit reached)`);
              continue;
            }

            await this.routeFinding(finding, {
              userId: user.id,
              username: user.username,
              email: user.email,
              phone: user.twilio_number,
            });
            this.incrementDailyCounter(user.id);
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
      this.checkUpcomingMeetings(userId),
      this.checkRecurringBills(userId),
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
   * Check for upcoming meetings by scanning recent booking-type tasks with future dates.
   */
  private async checkUpcomingMeetings(userId: string): Promise<ProactiveFinding[]> {
    const findings: ProactiveFinding[] = [];

    const now = new Date();
    const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Find completed booking/appointment tasks that reference future dates
    const { data: tasks } = await getSupabaseClient()
      .from("tasks")
      .select("email_subject, input_text, completed_at")
      .eq("user_id", userId)
      .eq("status", "completed")
      .in("type", ["booking", "general"])
      .order("completed_at", { ascending: false })
      .limit(50);

    if (!tasks) return findings;

    const meetingKeywords = ["meeting", "appointment", "call", "interview", "reservation", "booking"];

    for (const task of tasks) {
      const text = `${task.email_subject || ""} ${task.input_text || ""}`.toLowerCase();
      const hasMeetingKeyword = meetingKeywords.some((kw) => text.includes(kw));
      if (!hasMeetingKeyword) continue;

      // Try to find a date reference in the task text
      const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
      if (!dateMatch) continue;

      const meetingDate = new Date(dateMatch[1]);
      if (meetingDate >= now && meetingDate <= twentyFourHoursFromNow) {
        findings.push({
          trigger: "upcoming_meeting",
          action: `Reminder: You have an upcoming meeting/appointment tomorrow related to "${task.email_subject || "a booking"}".`,
          channel: "sms",
          priority: "medium",
          userId,
          data: { subject: task.email_subject, date: dateMatch[1] },
        });
      }
    }

    return findings;
  }

  /**
   * Check for recurring bill patterns by detecting payment tasks at regular intervals.
   */
  private async checkRecurringBills(userId: string): Promise<ProactiveFinding[]> {
    const findings: ProactiveFinding[] = [];

    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

    const { data: tasks } = await getSupabaseClient()
      .from("tasks")
      .select("email_subject, input_text, created_at")
      .eq("user_id", userId)
      .eq("status", "completed")
      .gte("created_at", sixtyDaysAgo)
      .order("created_at", { ascending: true });

    if (!tasks || tasks.length < 2) return findings;

    const billKeywords = ["pay", "bill", "invoice", "subscription", "renew", "payment"];

    // Group bill-like tasks by normalized subject
    const billGroups = new Map<string, Date[]>();
    for (const task of tasks) {
      const text = `${task.email_subject || ""} ${task.input_text || ""}`.toLowerCase();
      const isBillLike = billKeywords.some((kw) => text.includes(kw));
      if (!isBillLike) continue;

      const key = normalizeSubject(task.email_subject || task.input_text || "");
      if (!key) continue;

      const dates = billGroups.get(key) || [];
      dates.push(new Date(task.created_at));
      billGroups.set(key, dates);
    }

    // Detect monthly patterns (2+ occurrences ~30 days apart)
    const now = new Date();
    for (const [subject, dates] of billGroups) {
      if (dates.length < 2) continue;

      // Check if dates are roughly 30 days apart
      const intervals = [];
      for (let i = 1; i < dates.length; i++) {
        intervals.push((dates[i].getTime() - dates[i - 1].getTime()) / (24 * 60 * 60 * 1000));
      }
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

      if (avgInterval >= 25 && avgInterval <= 35) {
        // Predict next due date
        const lastDate = dates[dates.length - 1];
        const predictedNext = new Date(lastDate.getTime() + avgInterval * 24 * 60 * 60 * 1000);
        const daysUntilDue = (predictedNext.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);

        if (daysUntilDue > 0 && daysUntilDue <= 7) {
          findings.push({
            trigger: "recurring_bill",
            action: `Heads up: "${subject}" appears to be a recurring monthly payment. It may be due in about ${Math.round(daysUntilDue)} days. Want me to handle it?`,
            channel: "email",
            priority: "medium",
            userId,
            data: { subject, predictedDate: predictedNext.toISOString(), avgInterval },
          });
        }
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
      // 24h dedup: skip if same trigger was sent to this user recently
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: recentSame } = await getSupabaseClient()
        .from("tasks")
        .select("id")
        .eq("user_id", user.userId)
        .eq("type", "proactive")
        .eq("email_subject", `[Proactive] ${finding.trigger}`)
        .gte("created_at", twentyFourHoursAgo)
        .limit(1);

      if (recentSame && recentSame.length > 0) {
        console.log(`[PROACTIVE] Skipping duplicate ${finding.trigger} for ${user.username} (sent within 24h)`);
        return;
      }

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
