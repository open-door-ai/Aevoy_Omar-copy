/**
 * Proactive Engagement System
 *
 * Advanced habit-learning agent that:
 * - Learns user patterns (task timing, frequency, preferences)
 * - Provides intelligent suggestions based on behavior
 * - Sends daily productivity digests
 * - Sends weekly productivity reports
 * - All data encrypted and privacy-first (opt-in only)
 *
 * Builds on top of existing proactive.ts with enhanced ML capabilities.
 */

import { getSupabaseClient } from "../utils/supabase.js";
import { sendResponse } from "./email.js";
import { sendSms } from "./twilio.js";
import { encryptWithServerKey, decryptWithServerKey } from "../security/encryption.js";
import type { InputChannel } from "../types/index.js";

// ---- Types ----

export interface UserHabit {
  userId: string;
  habitType: 'task_timing' | 'task_frequency' | 'task_preference' | 'productivity_pattern';
  pattern: string; // Encrypted JSON
  confidence: number; // 0-1
  lastUpdated: string;
  occurrences: number;
}

export interface TaskPattern {
  taskType: string;
  keywords: string[];
  avgTimeOfDay: number; // Hour 0-23
  avgDayOfWeek: number; // 0-6 (Sun-Sat)
  frequency: number; // Tasks per week
  avgDuration: number; // Minutes
  successRate: number; // 0-1
  preferredChannel: InputChannel;
  costPerTask: number;
}

export interface ProductivityInsight {
  type: 'peak_hours' | 'productive_days' | 'task_completion' | 'cost_optimization' | 'automation_opportunity';
  message: string;
  data: Record<string, unknown>;
  priority: 'high' | 'medium' | 'low';
  actionable: boolean;
}

export interface DailyDigest {
  userId: string;
  date: string;
  tasksCompleted: number;
  tasksFailed: number;
  totalCost: number;
  totalTime: number; // Minutes
  topInsights: ProductivityInsight[];
  suggestions: string[];
  peakProductivityHour: number;
  mostUsedChannel: InputChannel;
}

export interface WeeklyReport {
  userId: string;
  weekStart: string;
  weekEnd: string;
  tasksCompleted: number;
  tasksFailed: number;
  totalCost: number;
  totalTime: number; // Minutes
  insights: ProductivityInsight[];
  habits: TaskPattern[];
  suggestions: string[];
  productivity_score: number; // 0-100
  cost_trend: 'increasing' | 'stable' | 'decreasing';
  automation_savings_potential: number; // USD per week
}

export interface ProactiveSuggestion {
  type: 'reminder' | 'optimization' | 'automation' | 'insight' | 'alert';
  message: string;
  data: Record<string, unknown>;
  priority: 'high' | 'medium' | 'low';
  channel: InputChannel;
  scheduledFor?: string; // ISO timestamp
}

// ---- Proactive Engagement Engine ----

export class ProactiveEngagementEngine {
  private isRunning = false;

  /**
   * Main entry point: analyze user behavior after each task completion
   */
  async analyzeTaskCompletion(userId: string, taskId: string): Promise<void> {
    try {
      // Get task details
      const { data: task } = await getSupabaseClient()
        .from("tasks")
        .select("*")
        .eq("id", taskId)
        .single();

      if (!task) return;

      // Update habit patterns
      await this.updateHabitPatterns(userId, task);

      // Check for immediate suggestions
      const suggestions = await this.generateImmediateSuggestions(userId, task);

      // Send high-priority suggestions immediately
      for (const suggestion of suggestions.filter(s => s.priority === 'high')) {
        await this.sendSuggestion(userId, suggestion);
      }

      // Store medium/low priority for daily digest
      for (const suggestion of suggestions.filter(s => s.priority !== 'high')) {
        await this.storeSuggestionForDigest(userId, suggestion);
      }
    } catch (error) {
      console.error("[PROACTIVE_ENGAGEMENT] Error analyzing task:", error);
    }
  }

  /**
   * Learn and update user habit patterns based on completed task
   */
  private async updateHabitPatterns(userId: string, task: any): Promise<void> {
    const now = new Date(task.completed_at || task.created_at);
    const hour = now.getHours();
    const dayOfWeek = now.getDay();
    const taskType = task.type || 'general';
    const channel = task.input_channel || 'email';
    const duration = task.execution_time_ms ? Math.round(task.execution_time_ms / 60000) : 0;
    const cost = task.cost_usd || 0;

    // Extract keywords from task
    const text = `${task.email_subject || ''} ${task.input_text || ''}`.toLowerCase();
    const keywords = this.extractKeywords(text);

    // Get existing pattern or create new
    const { data: existingHabits } = await getSupabaseClient()
      .from("user_memory")
      .select("*")
      .eq("user_id", userId)
      .eq("memory_type", "long_term")
      .like("encrypted_data", `%habit_pattern:${taskType}%`);

    let pattern: TaskPattern;
    let occurrences = 1;

    if (existingHabits && existingHabits.length > 0) {
      // Decrypt and update existing pattern
      const encrypted = existingHabits[0].encrypted_data;
      const decrypted = await decryptWithServerKey(encrypted);
      pattern = JSON.parse(decrypted) as TaskPattern;
      occurrences = (pattern.frequency || 0) + 1;

      // Update with exponential moving average (EMA)
      const alpha = 0.3; // Weight for new observations
      pattern.avgTimeOfDay = pattern.avgTimeOfDay * (1 - alpha) + hour * alpha;
      pattern.avgDayOfWeek = pattern.avgDayOfWeek * (1 - alpha) + dayOfWeek * alpha;
      pattern.avgDuration = pattern.avgDuration * (1 - alpha) + duration * alpha;
      pattern.costPerTask = pattern.costPerTask * (1 - alpha) + cost * alpha;
      pattern.frequency = occurrences;

      // Merge keywords
      pattern.keywords = [...new Set([...pattern.keywords, ...keywords])].slice(0, 20);

      // Update success rate
      if (task.status === 'completed') {
        pattern.successRate = pattern.successRate * (1 - alpha) + 1 * alpha;
      } else {
        pattern.successRate = pattern.successRate * (1 - alpha) + 0 * alpha;
      }
    } else {
      // Create new pattern
      pattern = {
        taskType,
        keywords,
        avgTimeOfDay: hour,
        avgDayOfWeek: dayOfWeek,
        frequency: 1,
        avgDuration: duration,
        successRate: task.status === 'completed' ? 1 : 0,
        preferredChannel: channel,
        costPerTask: cost,
      };
    }

    // Store encrypted pattern
    const patternData = JSON.stringify({
      ...pattern,
      _metadata: {
        type: 'habit_pattern',
        taskType,
        lastUpdated: new Date().toISOString(),
        occurrences,
      }
    });
    const encrypted = await encryptWithServerKey(patternData);

    if (existingHabits && existingHabits.length > 0) {
      // Update existing
      await getSupabaseClient()
        .from("user_memory")
        .update({
          encrypted_data: encrypted,
          importance: Math.min(0.9, 0.5 + (occurrences * 0.05)), // Importance increases with frequency
          last_accessed_at: new Date().toISOString(),
        })
        .eq("id", existingHabits[0].id);
    } else {
      // Insert new
      await getSupabaseClient()
        .from("user_memory")
        .insert({
          user_id: userId,
          memory_type: "long_term",
          encrypted_data: encrypted,
          importance: 0.5,
          last_accessed_at: new Date().toISOString(),
        });
    }
  }

  /**
   * Generate immediate suggestions based on current task and patterns
   */
  private async generateImmediateSuggestions(
    userId: string,
    task: any
  ): Promise<ProactiveSuggestion[]> {
    const suggestions: ProactiveSuggestion[] = [];

    // Get user's habit patterns
    const patterns = await this.getUserPatterns(userId);

    // Check for automation opportunities (3+ similar tasks)
    const similarPatterns = patterns.filter(p =>
      p.frequency >= 3 &&
      p.taskType === task.type
    );

    for (const pattern of similarPatterns) {
      suggestions.push({
        type: 'automation',
        message: `I've noticed you do "${pattern.taskType}" tasks ${Math.round(pattern.frequency)} times per week. Would you like me to automate this as a scheduled task?`,
        data: { pattern, taskId: task.id },
        priority: pattern.frequency >= 5 ? 'high' : 'medium',
        channel: pattern.preferredChannel,
      });
    }

    // Check for cost optimization (task cost significantly above average)
    const avgCost = patterns.reduce((sum, p) => sum + p.costPerTask, 0) / (patterns.length || 1);
    if (task.cost_usd > avgCost * 1.5) {
      suggestions.push({
        type: 'optimization',
        message: `This task cost $${task.cost_usd.toFixed(4)}, which is ${Math.round((task.cost_usd / avgCost - 1) * 100)}% above your average. Consider using cached results or scheduled tasks to reduce costs.`,
        data: { taskCost: task.cost_usd, avgCost },
        priority: 'medium',
        channel: 'email',
      });
    }

    // Check for timing patterns (user doing task at unusual time)
    const now = new Date();
    const currentHour = now.getHours();
    const matchingPattern = patterns.find(p => p.taskType === task.type);

    if (matchingPattern && Math.abs(currentHour - matchingPattern.avgTimeOfDay) > 4) {
      suggestions.push({
        type: 'insight',
        message: `You usually do this type of task around ${Math.round(matchingPattern.avgTimeOfDay)}:00. Working at a different time today?`,
        data: { usualHour: matchingPattern.avgTimeOfDay, currentHour },
        priority: 'low',
        channel: 'email',
      });
    }

    return suggestions;
  }

  /**
   * Generate daily productivity digest
   */
  async generateDailyDigest(userId: string): Promise<DailyDigest | null> {
    try {
      const today = new Date();
      const startOfDay = new Date(today.setHours(0, 0, 0, 0)).toISOString();
      const endOfDay = new Date(today.setHours(23, 59, 59, 999)).toISOString();

      // Get today's tasks
      const { data: tasks } = await getSupabaseClient()
        .from("tasks")
        .select("*")
        .eq("user_id", userId)
        .gte("created_at", startOfDay)
        .lte("created_at", endOfDay);

      if (!tasks || tasks.length === 0) return null;

      const completed = tasks.filter(t => t.status === 'completed');
      const failed = tasks.filter(t => t.status === 'failed');
      const totalCost = tasks.reduce((sum, t) => sum + (t.cost_usd || 0), 0);
      const totalTime = tasks.reduce((sum, t) => sum + (t.execution_time_ms || 0), 0) / 60000;

      // Channel usage
      const channelCounts = tasks.reduce((acc, t) => {
        acc[t.input_channel] = (acc[t.input_channel] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      const mostUsedChannel = Object.entries(channelCounts)
        .sort(([, a], [, b]) => (b as number) - (a as number))[0][0] as InputChannel;

      // Peak productivity hour
      const hourCounts = completed.reduce((acc, t) => {
        const hour = new Date(t.created_at).getHours();
        acc[hour] = (acc[hour] || 0) + 1;
        return acc;
      }, {} as Record<number, number>);
      const peakHour = parseInt(
        Object.entries(hourCounts).sort(([, a], [, b]) => (b as number) - (a as number))[0]?.[0] || '9'
      );

      // Generate insights
      const insights = await this.generateDailyInsights(userId, tasks, completed, failed);

      // Get stored suggestions from earlier
      const suggestions = await this.getStoredSuggestions(userId, startOfDay);

      return {
        userId,
        date: today.toISOString().split('T')[0],
        tasksCompleted: completed.length,
        tasksFailed: failed.length,
        totalCost,
        totalTime,
        topInsights: insights.slice(0, 3),
        suggestions,
        peakProductivityHour: peakHour,
        mostUsedChannel,
      };
    } catch (error) {
      console.error("[PROACTIVE_ENGAGEMENT] Error generating daily digest:", error);
      return null;
    }
  }

  /**
   * Generate weekly productivity report
   */
  async generateWeeklyReport(userId: string): Promise<WeeklyReport | null> {
    try {
      const today = new Date();
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - 7);
      const weekStartStr = weekStart.toISOString();
      const weekEndStr = today.toISOString();

      // Get week's tasks
      const { data: tasks } = await getSupabaseClient()
        .from("tasks")
        .select("*")
        .eq("user_id", userId)
        .gte("created_at", weekStartStr)
        .lte("created_at", weekEndStr);

      if (!tasks || tasks.length === 0) return null;

      const completed = tasks.filter(t => t.status === 'completed');
      const failed = tasks.filter(t => t.status === 'failed');
      const totalCost = tasks.reduce((sum, t) => sum + (t.cost_usd || 0), 0);
      const totalTime = tasks.reduce((sum, t) => sum + (t.execution_time_ms || 0), 0) / 60000;

      // Get previous week for comparison
      const prevWeekStart = new Date(weekStart);
      prevWeekStart.setDate(weekStart.getDate() - 7);
      const { data: prevTasks } = await getSupabaseClient()
        .from("tasks")
        .select("cost_usd")
        .eq("user_id", userId)
        .gte("created_at", prevWeekStart.toISOString())
        .lt("created_at", weekStartStr);

      const prevCost = prevTasks?.reduce((sum, t) => sum + (t.cost_usd || 0), 0) || 0;
      const costTrend = totalCost > prevCost * 1.1 ? 'increasing' :
                       totalCost < prevCost * 0.9 ? 'decreasing' : 'stable';

      // Get user patterns
      const habits = await this.getUserPatterns(userId);

      // Calculate automation savings potential
      const automationSavings = habits
        .filter(h => h.frequency >= 3)
        .reduce((sum, h) => sum + (h.costPerTask * h.frequency * 0.5), 0); // 50% cost reduction via automation

      // Generate insights
      const insights = await this.generateWeeklyInsights(userId, tasks, completed, habits);

      // Calculate productivity score
      const successRate = completed.length / (tasks.length || 1);
      const avgCostPerTask = totalCost / (tasks.length || 1);
      const targetCost = 0.10; // $0.10 per task target
      const costScore = Math.max(0, 100 - (avgCostPerTask / targetCost) * 100);
      const productivityScore = Math.round(
        successRate * 60 + // 60% weight on success
        (costScore / 100) * 20 + // 20% weight on cost efficiency
        Math.min(20, (completed.length / 50) * 20) // 20% weight on volume (max at 50 tasks/week)
      );

      return {
        userId,
        weekStart: weekStartStr.split('T')[0],
        weekEnd: weekEndStr.split('T')[0],
        tasksCompleted: completed.length,
        tasksFailed: failed.length,
        totalCost,
        totalTime,
        insights,
        habits,
        suggestions: insights.filter(i => i.actionable).map(i => i.message),
        productivity_score: productivityScore,
        cost_trend: costTrend,
        automation_savings_potential: automationSavings,
      };
    } catch (error) {
      console.error("[PROACTIVE_ENGAGEMENT] Error generating weekly report:", error);
      return null;
    }
  }

  /**
   * Send daily digest to all opted-in users
   */
  async sendDailyDigests(): Promise<number> {
    if (this.isRunning) {
      console.log("[PROACTIVE_ENGAGEMENT] Daily digest already running");
      return 0;
    }

    this.isRunning = true;
    let sentCount = 0;

    try {
      // Get users with proactive enabled — read from user_settings (v31+)
      const { data: enabledSettings } = await getSupabaseClient()
        .from("user_settings")
        .select("user_id")
        .eq("proactive_enabled", true);

      const enabledUserIds = (enabledSettings || []).map((s: { user_id: string }) => s.user_id);
      if (enabledUserIds.length === 0) return 0;

      const { data: users } = await getSupabaseClient()
        .from("profiles")
        .select("id, username, email, timezone")
        .in("id", enabledUserIds);

      if (!users || users.length === 0) return 0;

      console.log(`[PROACTIVE_ENGAGEMENT] Generating digests for ${users.length} users`);

      for (const user of users) {
        try {
          // Check if it's the right time (6 PM in user's timezone)
          const tz = user.timezone || "America/Los_Angeles";
          if (!this.isDigestTime(tz, 18)) continue; // 6 PM

          const digest = await this.generateDailyDigest(user.id);
          if (!digest) continue;

          // Format and send email
          const emailBody = this.formatDailyDigestEmail(digest);
          await sendResponse({
            to: user.email,
            from: `${user.username}@aevoy.com`,
            subject: `Your Daily Aevoy Digest - ${digest.date}`,
            body: emailBody,
          });

          sentCount++;
          console.log(`[PROACTIVE_ENGAGEMENT] Sent digest to ${user.username}`);
        } catch (error) {
          console.error(`[PROACTIVE_ENGAGEMENT] Error sending digest to ${user.id}:`, error);
        }
      }
    } finally {
      this.isRunning = false;
    }

    return sentCount;
  }

  /**
   * Send weekly reports to all opted-in users
   */
  async sendWeeklyReports(): Promise<number> {
    if (this.isRunning) {
      console.log("[PROACTIVE_ENGAGEMENT] Weekly report already running");
      return 0;
    }

    this.isRunning = true;
    let sentCount = 0;

    try {
      // Get users with proactive enabled — read from user_settings (v31+)
      const { data: enabledSettings2 } = await getSupabaseClient()
        .from("user_settings")
        .select("user_id")
        .eq("proactive_enabled", true);

      const enabledUserIds2 = (enabledSettings2 || []).map((s: { user_id: string }) => s.user_id);
      if (enabledUserIds2.length === 0) return 0;

      const { data: users } = await getSupabaseClient()
        .from("profiles")
        .select("id, username, email, timezone")
        .in("id", enabledUserIds2);

      if (!users || users.length === 0) return 0;

      console.log(`[PROACTIVE_ENGAGEMENT] Generating reports for ${users.length} users`);

      for (const user of users) {
        try {
          // Send on Sunday at 8 PM
          const tz = user.timezone || "America/Los_Angeles";
          if (!this.isWeeklyReportTime(tz)) continue;

          const report = await this.generateWeeklyReport(user.id);
          if (!report) continue;

          // Format and send email
          const emailBody = this.formatWeeklyReportEmail(report);
          await sendResponse({
            to: user.email,
            from: `${user.username}@aevoy.com`,
            subject: `Your Weekly Aevoy Report - Productivity Score: ${report.productivity_score}/100`,
            body: emailBody,
          });

          sentCount++;
          console.log(`[PROACTIVE_ENGAGEMENT] Sent report to ${user.username}`);
        } catch (error) {
          console.error(`[PROACTIVE_ENGAGEMENT] Error sending report to ${user.id}:`, error);
        }
      }
    } finally {
      this.isRunning = false;
    }

    return sentCount;
  }

  // ---- Helper Methods ----

  /**
   * Extract meaningful keywords from text
   */
  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
      'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
      'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might',
      'can', 'please', 'help', 'me', 'my', 'i', 'you', 'your', 'it', 'this', 'that',
    ]);

    return text
      .toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 3 && !stopWords.has(word))
      .filter(word => /^[a-z]+$/.test(word)) // Only alphabetic
      .slice(0, 10);
  }

  /**
   * Get user's learned patterns
   */
  private async getUserPatterns(userId: string): Promise<TaskPattern[]> {
    const { data: memories } = await getSupabaseClient()
      .from("user_memory")
      .select("encrypted_data")
      .eq("user_id", userId)
      .eq("memory_type", "long_term");

    if (!memories) return [];

    const patterns: TaskPattern[] = [];
    for (const mem of memories) {
      try {
        const decrypted = await decryptWithServerKey(mem.encrypted_data);
        const data = JSON.parse(decrypted);
        if (data._metadata?.type === 'habit_pattern') {
          patterns.push(data as TaskPattern);
        }
      } catch {
        // Skip invalid entries
      }
    }

    return patterns;
  }

  /**
   * Generate insights from daily data
   */
  private async generateDailyInsights(
    userId: string,
    tasks: any[],
    completed: any[],
    failed: any[]
  ): Promise<ProductivityInsight[]> {
    const insights: ProductivityInsight[] = [];

    // Success rate insight
    const successRate = completed.length / (tasks.length || 1);
    if (successRate < 0.8) {
      insights.push({
        type: 'task_completion',
        message: `Your success rate today was ${Math.round(successRate * 100)}%. ${failed.length} tasks had issues.`,
        data: { successRate, failedCount: failed.length },
        priority: 'medium',
        actionable: true,
      });
    }

    // Cost insight
    const totalCost = tasks.reduce((sum, t) => sum + (t.cost_usd || 0), 0);
    if (totalCost > 0.50) {
      insights.push({
        type: 'cost_optimization',
        message: `Today's tasks cost $${totalCost.toFixed(2)}. Consider using scheduled tasks to reduce costs.`,
        data: { totalCost },
        priority: 'medium',
        actionable: true,
      });
    }

    // Peak hours
    const hourCounts = completed.reduce((acc, t) => {
      const hour = new Date(t.created_at).getHours();
      acc[hour] = (acc[hour] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);

    const peakHour = parseInt(
      Object.entries(hourCounts).sort(([, a], [, b]) => (b as number) - (a as number))[0]?.[0] || '9'
    );

    insights.push({
      type: 'peak_hours',
      message: `You were most productive around ${peakHour}:00 today.`,
      data: { peakHour, distribution: hourCounts },
      priority: 'low',
      actionable: false,
    });

    return insights;
  }

  /**
   * Generate insights from weekly data
   */
  private async generateWeeklyInsights(
    userId: string,
    tasks: any[],
    completed: any[],
    habits: TaskPattern[]
  ): Promise<ProductivityInsight[]> {
    const insights: ProductivityInsight[] = [];

    // Automation opportunities
    const automatable = habits.filter(h => h.frequency >= 3);
    if (automatable.length > 0) {
      const savingsPotential = automatable.reduce((sum, h) =>
        sum + (h.costPerTask * h.frequency * 0.5), 0
      );

      insights.push({
        type: 'automation_opportunity',
        message: `You have ${automatable.length} tasks that could be automated, potentially saving $${savingsPotential.toFixed(2)}/week.`,
        data: { count: automatable.length, savings: savingsPotential, patterns: automatable },
        priority: 'high',
        actionable: true,
      });
    }

    // Productive days
    const dayCounts = completed.reduce((acc, t) => {
      const day = new Date(t.created_at).getDay();
      acc[day] = (acc[day] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const mostProductiveDay = parseInt(
      Object.entries(dayCounts).sort(([, a], [, b]) => (b as number) - (a as number))[0]?.[0] || '1'
    );

    insights.push({
      type: 'productive_days',
      message: `${dayNames[mostProductiveDay]} was your most productive day this week.`,
      data: { day: mostProductiveDay, distribution: dayCounts },
      priority: 'low',
      actionable: false,
    });

    return insights;
  }

  /**
   * Check if it's the right time for daily digest
   */
  private isDigestTime(timezone: string, targetHour: number): boolean {
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "numeric",
        hour12: false,
      });
      const hour = parseInt(formatter.format(now));
      return hour === targetHour;
    } catch {
      return false;
    }
  }

  /**
   * Check if it's time for weekly report (Sunday 8 PM)
   */
  private isWeeklyReportTime(timezone: string): boolean {
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "numeric",
        hour12: false,
        weekday: "long",
      });
      const formatted = formatter.format(now);
      return formatted.includes("Sunday") && formatted.includes("20");
    } catch {
      return false;
    }
  }

  /**
   * Format daily digest email
   */
  private formatDailyDigestEmail(digest: DailyDigest): string {
    return `
<h2>Your Daily Aevoy Digest</h2>
<p><strong>Date:</strong> ${digest.date}</p>

<h3>📊 Today's Summary</h3>
<ul>
  <li>✅ Tasks completed: ${digest.tasksCompleted}</li>
  <li>❌ Tasks failed: ${digest.tasksFailed}</li>
  <li>💰 Total cost: $${digest.totalCost.toFixed(4)}</li>
  <li>⏱️ Total time: ${Math.round(digest.totalTime)} minutes</li>
  <li>🔥 Peak productivity: ${digest.peakProductivityHour}:00</li>
  <li>📱 Most used channel: ${digest.mostUsedChannel}</li>
</ul>

<h3>💡 Top Insights</h3>
<ul>
  ${digest.topInsights.map(i => `<li>${i.message}</li>`).join('\n  ')}
</ul>

${digest.suggestions.length > 0 ? `
<h3>🎯 Suggestions</h3>
<ul>
  ${digest.suggestions.map(s => `<li>${s}</li>`).join('\n  ')}
</ul>
` : ''}

<p><em>This digest was automatically generated by your Aevoy AI. Reply to this email to interact with me!</em></p>
    `.trim();
  }

  /**
   * Format weekly report email
   */
  private formatWeeklyReportEmail(report: WeeklyReport): string {
    return `
<h2>Your Weekly Aevoy Report</h2>
<p><strong>Week:</strong> ${report.weekStart} to ${report.weekEnd}</p>
<p><strong>Productivity Score:</strong> ${report.productivity_score}/100 🎯</p>

<h3>📊 Weekly Summary</h3>
<ul>
  <li>✅ Tasks completed: ${report.tasksCompleted}</li>
  <li>❌ Tasks failed: ${report.tasksFailed}</li>
  <li>💰 Total cost: $${report.totalCost.toFixed(2)}</li>
  <li>⏱️ Total time: ${Math.round(report.totalTime)} minutes</li>
  <li>📈 Cost trend: ${report.cost_trend}</li>
</ul>

<h3>🔄 Your Habits</h3>
<p>I've learned ${report.habits.length} patterns from your behavior:</p>
<ul>
  ${report.habits.slice(0, 5).map(h => `
    <li><strong>${h.taskType}</strong>: ${Math.round(h.frequency)}x/week at ${Math.round(h.avgTimeOfDay)}:00, ${Math.round(h.successRate * 100)}% success rate</li>
  `).join('\n  ')}
</ul>

<h3>💡 Insights</h3>
<ul>
  ${report.insights.slice(0, 5).map(i => `<li>${i.message}</li>`).join('\n  ')}
</ul>

${report.automation_savings_potential > 0 ? `
<h3>💰 Automation Savings Potential</h3>
<p>You could save up to <strong>$${report.automation_savings_potential.toFixed(2)}/week</strong> by automating recurring tasks.</p>
` : ''}

${report.suggestions.length > 0 ? `
<h3>🎯 Action Items</h3>
<ul>
  ${report.suggestions.map(s => `<li>${s}</li>`).join('\n  ')}
</ul>
` : ''}

<p><em>This report was automatically generated by your Aevoy AI. Reply to this email to interact with me!</em></p>
    `.trim();
  }

  /**
   * Send individual suggestion to user
   */
  private async sendSuggestion(userId: string, suggestion: ProactiveSuggestion): Promise<void> {
    const { data: user } = await getSupabaseClient()
      .from("profiles")
      .select("username, email, twilio_number")
      .eq("id", userId)
      .single();

    if (!user) return;

    try {
      if (suggestion.channel === 'sms' && user.twilio_number) {
        await sendSms({
          userId,
          to: user.twilio_number,
          body: `[Aevoy] ${suggestion.message}`,
        });
      } else {
        await sendResponse({
          to: user.email,
          from: `${user.username}@aevoy.com`,
          subject: `[Aevoy ${suggestion.type}] ${suggestion.message.substring(0, 50)}...`,
          body: suggestion.message,
        });
      }

      console.log(`[PROACTIVE_ENGAGEMENT] Sent ${suggestion.type} to ${user.username}`);
    } catch (error) {
      console.error("[PROACTIVE_ENGAGEMENT] Error sending suggestion:", error);
    }
  }

  /**
   * Store suggestion for daily digest
   */
  private async storeSuggestionForDigest(
    userId: string,
    suggestion: ProactiveSuggestion
  ): Promise<void> {
    const encrypted = await encryptWithServerKey(JSON.stringify({
      ...suggestion,
      _metadata: {
        type: 'pending_suggestion',
        createdAt: new Date().toISOString(),
      }
    }));

    await getSupabaseClient()
      .from("user_memory")
      .insert({
        user_id: userId,
        memory_type: "short_term",
        encrypted_data: encrypted,
        importance: suggestion.priority === 'high' ? 0.8 : suggestion.priority === 'medium' ? 0.6 : 0.4,
        last_accessed_at: new Date().toISOString(),
      });
  }

  /**
   * Get stored suggestions for digest
   */
  private async getStoredSuggestions(userId: string, since: string): Promise<string[]> {
    const { data: memories } = await getSupabaseClient()
      .from("user_memory")
      .select("encrypted_data")
      .eq("user_id", userId)
      .eq("memory_type", "short_term")
      .gte("created_at", since);

    if (!memories) return [];

    const suggestions: string[] = [];
    for (const mem of memories) {
      try {
        const decrypted = await decryptWithServerKey(mem.encrypted_data);
        const data = JSON.parse(decrypted);
        if (data._metadata?.type === 'pending_suggestion') {
          suggestions.push(data.message);
        }
      } catch {
        // Skip invalid entries
      }
    }

    // Cleanup after retrieval
    await getSupabaseClient()
      .from("user_memory")
      .delete()
      .eq("user_id", userId)
      .eq("memory_type", "short_term")
      .gte("created_at", since);

    return suggestions;
  }
}

// ---- Singleton ----

let engagementEngine: ProactiveEngagementEngine | null = null;

export function getProactiveEngagementEngine(): ProactiveEngagementEngine {
  if (!engagementEngine) {
    engagementEngine = new ProactiveEngagementEngine();
  }
  return engagementEngine;
}
