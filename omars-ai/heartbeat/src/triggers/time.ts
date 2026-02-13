import type { TriggerResult, HeartbeatState } from '../types.js';

export async function checkTimeTriggers(state: HeartbeatState): Promise<TriggerResult[]> {
  const results: TriggerResult[] = [];
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();

  // Morning summary (8:30 AM)
  if (hour === 8 && minute >= 30 && minute < 35) {
    const lastCheck = state.lastCheck['morning_summary'] || 0;
    const hoursSince = (Date.now() - lastCheck) / (1000 * 60 * 60);

    if (hoursSince >= 23) {
      results.push({
        type: 'morning_summary',
        shouldTrigger: true,
        description: 'Morning summary',
        taskDescription: 'Provide a morning summary: Check calendar for today, check inbox for urgent emails, provide weather forecast, and any reminders.',
        critical: false,
      });
    }
  }

  // Evening recap (6 PM)
  if (hour === 18 && minute < 5) {
    const lastCheck = state.lastCheck['evening_recap'] || 0;
    const hoursSince = (Date.now() - lastCheck) / (1000 * 60 * 60);

    if (hoursSince >= 23) {
      results.push({
        type: 'evening_recap',
        shouldTrigger: true,
        description: 'Evening recap',
        taskDescription: 'Provide an evening recap: Summarize completed tasks from today, list pending items for tomorrow, and highlight any follow-ups needed.',
        critical: false,
      });
    }
  }

  return results;
}
