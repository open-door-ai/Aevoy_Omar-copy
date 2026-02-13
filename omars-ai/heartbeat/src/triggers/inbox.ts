import type { TriggerResult, HeartbeatState } from '../types.js';

export async function checkInboxTriggers(state: HeartbeatState): Promise<TriggerResult[]> {
  const results: TriggerResult[] = [];

  // TODO: Check IMAP for urgent emails
  // Keywords: "urgent", "asap", "important", "emergency"
  // Filter by senders (family, boss, etc.)

  return results;
}
