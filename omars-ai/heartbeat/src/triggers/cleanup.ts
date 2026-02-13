import type { TriggerResult, HeartbeatState } from '../types.js';

export async function checkCleanupTriggers(state: HeartbeatState): Promise<TriggerResult[]> {
  const results: TriggerResult[] = [];
  const now = new Date();
  const dayOfWeek = now.getDay();
  const hour = now.getHours();

  // Weekly cleanup (Sunday at 8 AM)
  if (dayOfWeek === 0 && hour === 8) {
    const lastCheck = state.lastCheck['weekly_cleanup'] || 0;
    const daysSince = (Date.now() - lastCheck) / (1000 * 60 * 60 * 24);

    if (daysSince >= 6) {
      results.push({
        type: 'weekly_cleanup',
        shouldTrigger: true,
        description: 'Weekly inbox cleanup',
        taskDescription: 'Archive old emails, delete spam, and organize inbox into folders. Focus on emails older than 7 days.',
        critical: false,
      });
    }
  }

  return results;
}
