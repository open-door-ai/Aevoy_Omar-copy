/**
 * V3 System Tools
 *
 * Scheduling, calendar, and system tools.
 * Wraps existing service implementations.
 */

import { registerTool } from '../tool-registry.js';
import { getSupabaseClient } from '../../utils/supabase.js';
import type { ToolCallResult, TaskContext } from '../types.js';

/** Schedule task tool */
registerTool({
  name: 'schedule_task',
  description: 'Schedule a task, reminder, or action for later. Supports one-time and recurring schedules.',
  category: 'system',
  parameters: {
    description: { type: 'string', description: 'What to do when the schedule fires' },
    time: { type: 'string', description: 'When to execute. Examples: "in 5 minutes", "at 3pm", "tomorrow at 9am", "every weekday at 8am"' },
    action_type: { type: 'string', description: 'Type of action: "reminder" (SMS), "call" (voice call), "task" (general task)', enum: ['reminder', 'call', 'task'] },
  },
  required: ['description', 'time'],
  async execute(params, ctx): Promise<ToolCallResult> {
    const description = String(params.description);
    const timeStr = String(params.time);
    const actionType = String(params.action_type || 'reminder');

    try {
      // Get user timezone
      const { data: profile } = await getSupabaseClient()
        .from('profiles')
        .select('timezone')
        .eq('id', ctx.userId)
        .single();
      const timezone = profile?.timezone || ctx.profile.timezone || 'America/Los_Angeles';

      // Parse relative time expressions
      const now = new Date();
      let nextRun: Date | null = null;
      let cronExpression = 'once';

      // "in X minutes/hours/seconds"
      const relMatch = timeStr.match(/in\s+(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hrs?|hours?|d|days?)/i);
      if (relMatch) {
        const amount = parseInt(relMatch[1]);
        const unit = relMatch[2].charAt(0).toLowerCase();
        nextRun = new Date(now);
        switch (unit) {
          case 's': nextRun.setSeconds(nextRun.getSeconds() + amount); break;
          case 'm': nextRun.setMinutes(nextRun.getMinutes() + amount); break;
          case 'h': nextRun.setHours(nextRun.getHours() + amount); break;
          case 'd': nextRun.setDate(nextRun.getDate() + amount); break;
        }
      }

      // Helper: convert local hour/min in user's timezone to a UTC Date
      function localTimeToUtc(baseDate: Date, hour: number, min: number, tz: string): Date {
        // Build an ISO-ish string in the target timezone, then let Date parse it as UTC
        // Step 1: Get the UTC offset for the target timezone at the given date
        const utcStr = baseDate.toLocaleString('en-US', { timeZone: 'UTC' });
        const tzStr = baseDate.toLocaleString('en-US', { timeZone: tz });
        const utcMs = new Date(utcStr).getTime();
        const tzMs = new Date(tzStr).getTime();
        const offsetMs = tzMs - utcMs; // positive = ahead of UTC
        // Step 2: Create a date at the desired local time, then subtract offset to get UTC
        const localDate = new Date(baseDate);
        localDate.setHours(hour, min, 0, 0);
        return new Date(localDate.getTime() - offsetMs);
      }

      // "tomorrow at X" — check BEFORE bare "at X" to prevent wrong-day scheduling
      if (!nextRun && /tomorrow/i.test(timeStr)) {
        const atMatch = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i);
        let hour = 9, min = 0;
        if (atMatch) {
          hour = parseInt(atMatch[1]);
          min = parseInt(atMatch[2] || '0');
          const meridiem = (atMatch[3] || '').replace(/\./g, '').toLowerCase();
          if (meridiem === 'pm' && hour < 12) hour += 12;
          if (meridiem === 'am' && hour === 12) hour = 0;
        }
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        nextRun = localTimeToUtc(tomorrow, hour, min, timezone);
      }

      // "at Xpm/am" (today or next occurrence)
      if (!nextRun) {
        const atMatch = timeStr.match(/(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i);
        if (atMatch) {
          let hour = parseInt(atMatch[1]);
          const min = parseInt(atMatch[2] || '0');
          const meridiem = (atMatch[3] || '').replace(/\./g, '').toLowerCase();
          if (meridiem === 'pm' && hour < 12) hour += 12;
          if (meridiem === 'am' && hour === 12) hour = 0;
          nextRun = localTimeToUtc(now, hour, min, timezone);
          if (nextRun <= now) nextRun = new Date(nextRun.getTime() + 86400000); // +1 day
        }
      }

      // "every X" (recurring)
      const recurMatch = timeStr.match(/every\s+(weekday|day|morning|monday|tuesday|wednesday|thursday|friday|saturday|sunday|hour)/i);
      if (recurMatch) {
        const freq = recurMatch[1].toLowerCase();
        const atMatch = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
        let hour = 9, min = 0;
        if (atMatch) {
          hour = parseInt(atMatch[1]);
          min = parseInt(atMatch[2] || '0');
          const meridiem = (atMatch[3] || '').toLowerCase();
          if (meridiem === 'pm' && hour < 12) hour += 12;
        }

        const cronDayMap: Record<string, string> = {
          weekday: '1-5', day: '*', morning: '*',
          monday: '1', tuesday: '2', wednesday: '3',
          thursday: '4', friday: '5', saturday: '6', sunday: '0',
          hour: '*',
        };
        const cronDay = cronDayMap[freq] || '*';
        cronExpression = freq === 'hour' ? `0 * * * *` : `${min} ${hour} * * ${cronDay}`;

        nextRun = localTimeToUtc(now, hour, min, timezone);
        if (nextRun <= now) nextRun = new Date(nextRun.getTime() + 86400000);
      }

      if (!nextRun) {
        return { success: false, error: `Could not parse time: "${timeStr}". Try "in 5 minutes", "at 3pm", or "tomorrow at 9am".`, cost: 0 };
      }

      // Map action type to task template
      const template = actionType === 'call' ? `call_user:${description}` :
                       actionType === 'reminder' ? `send_sms:${description}` :
                       description;

      // Create scheduled task
      await getSupabaseClient().from('scheduled_tasks').insert({
        user_id: ctx.userId,
        description: template,
        task_template: template,
        cron_expression: cronExpression,
        next_run_at: nextRun.toISOString(),
        is_active: true,
      });

      const humanTime = nextRun.toLocaleString('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        ...(nextRun.getDate() !== now.getDate() ? { weekday: 'short', month: 'short', day: 'numeric' } : {}),
      });

      const verb = actionType === 'call' ? 'call you' : actionType === 'reminder' ? 'remind you' : 'do that';
      return {
        success: true,
        data: `Scheduled — I'll ${verb} at ${humanTime}: ${description}`,
        cost: 0,
      };
    } catch (err) {
      return { success: false, error: `Scheduling failed: ${err instanceof Error ? err.message : 'unknown'}`, cost: 0 };
    }
  },
});

/** Check calendar tool */
registerTool({
  name: 'check_calendar',
  description: 'Check the user\'s calendar events for a date range.',
  category: 'system',
  parameters: {
    start_date: { type: 'string', description: 'Start date (ISO format or "today", "tomorrow")' },
    end_date: { type: 'string', description: 'End date (ISO format or "today", "tomorrow")' },
  },
  async execute(params, ctx): Promise<ToolCallResult> {
    try {
      const { getCalendarEvents } = await import('../../services/calendar.js');
      const daysAhead = params.end_date ? 30 : 7;
      const events = await getCalendarEvents(ctx.userId, daysAhead);
      if (!events || events.length === 0) {
        return { success: true, data: 'No calendar events found.', cost: 0 };
      }
      const formatted = events.map((e: any) =>
        `${e.title} — ${e.start} to ${e.end}${e.location ? ` at ${e.location}` : ''}`
      ).join('\n');
      return { success: true, data: formatted, cost: 0 };
    } catch (err) {
      return { success: false, error: 'Calendar check failed', cost: 0 };
    }
  },
});

/** Create calendar event tool */
registerTool({
  name: 'create_event',
  description: 'Create a new calendar event.',
  category: 'system',
  parameters: {
    title: { type: 'string', description: 'Event title' },
    start_time: { type: 'string', description: 'Start time (ISO format or natural language)' },
    end_time: { type: 'string', description: 'End time (ISO format or natural language)' },
    location: { type: 'string', description: 'Event location' },
    description: { type: 'string', description: 'Event description' },
  },
  required: ['title', 'start_time'],
  async execute(params, ctx): Promise<ToolCallResult> {
    try {
      const { createCalendarEvent } = await import('../../services/calendar.js');
      const result = await createCalendarEvent(ctx.userId, {
        title: String(params.title),
        start: String(params.start_time),
        end: String(params.end_time || ''),
        location: String(params.location || ''),
        description: String(params.description || ''),
      });
      return { success: true, data: `Event created: ${params.title}${result.link ? ` (${result.link})` : ''}`, cost: 0 };
    } catch (err) {
      return { success: false, error: 'Failed to create event', cost: 0 };
    }
  },
});
