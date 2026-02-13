import type { TriggerResult, HeartbeatState } from '../types.js';

export async function checkHabitTriggers(state: HeartbeatState): Promise<TriggerResult[]> {
  const results: TriggerResult[] = [];

  // TODO: Learn habits from USER.md
  // Example: "Omar usually checks email at 9 AM, 12 PM, 3 PM"
  // Remind if he hasn't checked in expected time window

  return results;
}
