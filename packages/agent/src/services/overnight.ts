/**
 * Overnight Task Manager
 *
 * Manages async/overnight task queues and morning summaries.
 * Tasks are queued and processed in priority order during off-hours.
 */

import { getSupabaseClient } from "../utils/supabase.js";
import { processTask } from "./processor.js";

/**
 * Queue an overnight task for later processing.
 */
export async function queueOvernightTask(
  userId: string,
  taskDescription: string,
  priority: number = 5,
  parentTaskId?: string
): Promise<void> {
  await getSupabaseClient().from("task_queue").insert({
    user_id: userId,
    parent_task_id: parentTaskId || null,
    description: taskDescription,
    priority: Math.max(1, Math.min(10, priority)),
    status: "queued",
  });

  console.log(`[OVERNIGHT] Queued task (priority ${priority}): ${taskDescription.substring(0, 50)}...`);
}

/**
 * Process the overnight task queue.
 * Picks up queued tasks in priority order and executes them.
 * Called by scheduler hourly.
 */
export async function processOvernightQueue(): Promise<void> {
  try {
    // Get queued tasks that are ready (no scheduled_for or past due)
    const { data: tasks } = await getSupabaseClient()
      .from("task_queue")
      .select("*")
      .eq("status", "queued")
      .or(`scheduled_for.is.null,scheduled_for.lte.${new Date().toISOString()}`)
      .order("priority", { ascending: false }) // Higher priority first
      .order("created_at", { ascending: true })
      .limit(5); // Process max 5 per cycle

    if (!tasks || tasks.length === 0) return;

    console.log(`[OVERNIGHT] Processing ${tasks.length} queued tasks`);

    for (const task of tasks) {
      // Mark as processing
      await getSupabaseClient()
        .from("task_queue")
        .update({ status: "processing", started_at: new Date().toISOString() })
        .eq("id", task.id);

      try {
        // Get user info
        const { data: profile } = await getSupabaseClient()
          .from("profiles")
          .select("id, username, email")
          .eq("id", task.user_id)
          .single();

        if (!profile) {
          await getSupabaseClient()
            .from("task_queue")
            .update({ status: "failed", result: { error: "User not found" } })
            .eq("id", task.id);
          continue;
        }

        const result = await processTask({
          userId: profile.id,
          username: profile.username,
          from: profile.email,
          subject: "Overnight Task",
          body: task.description,
          inputChannel: "proactive",
        });

        await getSupabaseClient()
          .from("task_queue")
          .update({
            status: result.success ? "completed" : "failed",
            result: { taskId: result.taskId, success: result.success },
            completed_at: new Date().toISOString(),
          })
          .eq("id", task.id);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await getSupabaseClient()
          .from("task_queue")
          .update({
            status: "failed",
            result: { error: msg },
            completed_at: new Date().toISOString(),
          })
          .eq("id", task.id);
      }
    }
  } catch (error) {
    console.error("[OVERNIGHT] Queue processing error:", error);
  }
}

/**
 * Generate a morning summary for a user.
 */
export async function generateMorningSummary(userId: string): Promise<string> {
  try {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Get completed tasks from overnight
    const { data: completed } = await getSupabaseClient()
      .from("task_queue")
      .select("description, status, result")
      .eq("user_id", userId)
      .gte("completed_at", yesterday)
      .in("status", ["completed", "failed"]);

    if (!completed || completed.length === 0) return "";

    const successCount = completed.filter((t) => t.status === "completed").length;
    const failCount = completed.filter((t) => t.status === "failed").length;

    let summary = `Good morning! Here's your overnight task summary:\n\n`;
    summary += `Completed: ${successCount} | Failed: ${failCount}\n\n`;

    for (const task of completed) {
      const icon = task.status === "completed" ? "[OK]" : "[!!]";
      summary += `${icon} ${task.description.substring(0, 100)}\n`;
    }

    return summary;
  } catch {
    return "";
  }
}

/**
 * Send morning summaries to all users with overnight results.
 * Called by scheduler — checks user timezone for 7 AM.
 */
export async function sendMorningSummaries(): Promise<void> {
  try {
    // Get users who had overnight tasks complete
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: userIds } = await getSupabaseClient()
      .from("task_queue")
      .select("user_id")
      .gte("completed_at", yesterday)
      .in("status", ["completed", "failed"]);

    if (!userIds || userIds.length === 0) return;

    // Dedupe user IDs
    const uniqueUserIds = [...new Set(userIds.map((r) => r.user_id))];

    for (const uid of uniqueUserIds) {
      // Check if it's ~7 AM in user's timezone
      const { data: profile } = await getSupabaseClient()
        .from("profiles")
        .select("timezone, email, username")
        .eq("id", uid)
        .single();

      if (!profile) continue;

      const tz = profile.timezone || "America/Los_Angeles";
      const now = new Date();
      const userHour = parseInt(
        now.toLocaleString("en-US", { timeZone: tz, hour: "numeric", hour12: false })
      );

      // Only send between 7 and 8 AM
      if (userHour !== 7) continue;

      const summary = await generateMorningSummary(uid);
      if (!summary) continue;

      try {
        const { sendSms } = await import("./twilio.js");
        const { sendResponse } = await import("./email.js");

        // Try SMS first if user has a Twilio number
        const { data: twilioProfile } = await getSupabaseClient()
          .from("profiles")
          .select("twilio_number, phone")
          .eq("id", uid)
          .single();

        if (twilioProfile?.twilio_number && twilioProfile?.phone) {
          await sendSms({
            userId: uid,
            to: twilioProfile.phone,
            body: summary.substring(0, 1500),
          });
        }

        // Always send email too
        await sendResponse({
          to: profile.email,
          from: `${profile.username}@aevoy.com`,
          subject: "Your Overnight Task Summary",
          body: summary,
        });
      } catch {
        // Non-critical
      }
    }
  } catch (error) {
    console.error("[OVERNIGHT] Morning summary error:", error);
  }
}
