import type { TriggerResult, HeartbeatState } from '../types.js';

export async function checkBudgetTriggers(state: HeartbeatState): Promise<TriggerResult[]> {
  const results: TriggerResult[] = [];

  // TODO: Check monthly AI cost from Core's cost tracker
  // Alert if > 80% of $50 limit

  return results;
}
