import type { TriggerResult, HeartbeatState } from '../types.js';

export async function checkPresenceTriggers(state: HeartbeatState): Promise<TriggerResult[]> {
  const results: TriggerResult[] = [];

  // TODO: Track sit duration from Vision system
  // Suggest break after 90 minutes of continuous sitting

  return results;
}
