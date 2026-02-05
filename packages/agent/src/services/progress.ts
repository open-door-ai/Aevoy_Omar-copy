/**
 * Progress Update Service
 *
 * Sends milestone updates to users during long-running tasks.
 * Max 5 updates per task to avoid spam.
 */

import type { InputChannel } from "../types/index.js";

// Track update counts per task (in-memory)
const taskUpdateCounts = new Map<string, number>();
const MAX_UPDATES_PER_TASK = 5;

/**
 * Send a progress update to the user for a running task.
 * Respects the max update limit per task.
 */
export async function sendProgressUpdate(
  userId: string,
  taskId: string,
  channel: InputChannel,
  milestone: string
): Promise<void> {
  const count = taskUpdateCounts.get(taskId) || 0;
  if (count >= MAX_UPDATES_PER_TASK) return;

  taskUpdateCounts.set(taskId, count + 1);

  try {
    if (channel === "sms" || channel === "voice") {
      const { sendSms } = await import("./twilio.js");
      const { getSupabaseClient } = await import("../utils/supabase.js");

      const { data: profile } = await getSupabaseClient()
        .from("profiles")
        .select("twilio_number, phone")
        .eq("id", userId)
        .single();

      if (profile?.twilio_number && profile?.phone) {
        await sendSms({
          userId,
          to: profile.phone,
          body: `[Aevoy Progress] ${milestone}`,
        });
      }
    }
    // For email channel, we already send progress via sendProgressEmail
  } catch {
    // Non-critical — don't fail the task over progress updates
  }
}

/**
 * Clear the update counter for a completed task.
 * Call this after task completion to free memory.
 */
export function clearProgressCounter(taskId: string): void {
  taskUpdateCounts.delete(taskId);
}
