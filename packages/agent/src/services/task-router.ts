/**
 * Task Router
 *
 * Lightweight routing functions extracted from the deleted V1 processor.
 * Routes incoming tasks, confirmation replies, and verification codes to the V3 processor.
 */

import { getSupabaseClient } from "../utils/supabase.js";
import { sendResponse, sendOverQuotaEmail, sendTaskCancelled } from "./email.js";
import { processTaskV3 } from "../v3/processor-v3.js";
import { parseConfirmationReply, parseCardCommand } from "./clarifier.js";
import type { TaskRequest, TaskResult } from "../types/index.js";

// ── Helpers ──

function shouldSkipPayment(): boolean {
  return (
    process.env.BILLING_ENABLED !== 'true' ||
    process.env.SKIP_PAYMENT_CHECKS === 'true' ||
    !process.env.STRIPE_SECRET_KEY
  );
}

// ── Card Commands ──

async function handleCardCommand(
  command: { type: string; amount?: number },
  userId: string,
  from: string,
  username: string
): Promise<TaskResult> {
  const { getAgentCard, fundAgentCard, freezeCard, unfreezeCard } = await import("./privacy-card.js");

  try {
    switch (command.type) {
      case 'balance': {
        const card = await getAgentCard(userId);
        if (!card) {
          await sendResponse({
            to: from, from: `${username}@aevoy.com`,
            subject: "Agent Card Balance",
            body: "You don't have an agent card set up yet. Visit your settings to create one!",
          });
        } else {
          await sendResponse({
            to: from, from: `${username}@aevoy.com`,
            subject: "Agent Card Balance",
            body: `Your agent card balance is **$${(card.balance_cents / 100).toFixed(2)}**\n\nCard ending in ${card.last_four}\nStatus: ${card.is_frozen ? 'Frozen' : 'Active'}`,
          });
        }
        break;
      }
      case 'freeze': {
        const success = await freezeCard(userId);
        await sendResponse({
          to: from, from: `${username}@aevoy.com`,
          subject: "Agent Card Frozen",
          body: success ? "Card frozen. No purchases allowed until you unfreeze." : "Failed to freeze card. Please try again.",
        });
        break;
      }
      case 'unfreeze': {
        const success = await unfreezeCard(userId);
        await sendResponse({
          to: from, from: `${username}@aevoy.com`,
          subject: "Agent Card Unfrozen",
          body: success ? "Card unfrozen. I can now make purchases for you." : "Failed to unfreeze card. Please try again.",
        });
        break;
      }
      case 'fund': {
        if (!command.amount) {
          await sendResponse({
            to: from, from: `${username}@aevoy.com`,
            subject: "Agent Card",
            body: "Please specify an amount to add, like: 'Add $50 to my card'",
          });
        } else {
          const result = await fundAgentCard(userId, command.amount);
          await sendResponse({
            to: from, from: `${username}@aevoy.com`,
            subject: "Agent Card Funded",
            body: result.success
              ? `Done! Added $${(command.amount / 100).toFixed(2)} to your card.\n\nNew balance: **$${(result.newBalance / 100).toFixed(2)}**`
              : `Failed to add funds: ${result.error}`,
          });
        }
        break;
      }
    }
    return { taskId: "", success: true, response: "Card command handled", actions: [] };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[CARD] Command error:", errorMessage);
    await sendResponse({
      to: from, from: `${username}@aevoy.com`,
      subject: "Agent Card",
      body: "I had trouble processing your card command. Please try again or check your card settings in the dashboard.",
    });
    return { taskId: "", success: false, response: "", actions: [], error: errorMessage };
  }
}

// ══════════════════════════════════════════════════════════════════
// PUBLIC API — Used by index.ts, inbox-poller.ts, scheduler.ts
// ══════════════════════════════════════════════════════════════════

/**
 * Process an incoming task — checks quota, handles card commands, then delegates to V3.
 */
export async function processIncomingTask(task: TaskRequest): Promise<TaskResult> {
  const { userId, username, from, subject, body } = task;

  try {
    // Check quota
    const { data: profile } = await getSupabaseClient()
      .from("profiles")
      .select("messages_used, messages_limit, subscription_status")
      .eq("id", userId)
      .single();

    const isBeta = profile?.subscription_status === 'beta';
    if (!shouldSkipPayment() && !isBeta && profile && profile.messages_used >= profile.messages_limit) {
      await sendOverQuotaEmail(from, `${username}@aevoy.com`, subject);
      return { taskId: "", success: false, response: "Over quota", actions: [], error: "User is over their message quota" };
    }

    // Card commands
    const cardCommand = parseCardCommand(body);
    if (cardCommand) {
      return handleCardCommand(cardCommand, userId, from, username);
    }

    // Route to V3 processor
    return processTaskV3(task);
  } catch (error) {
    console.error("[TASK-ROUTER] processIncomingTask error:", error instanceof Error ? error.message : error);
    return { taskId: "", success: false, response: "Internal error", actions: [], error: "Task processing failed" };
  }
}

/**
 * Handle a confirmation reply (yes/no/modify) from the user.
 */
export async function handleConfirmationReply(
  userId: string,
  username: string,
  from: string,
  replyText: string,
  taskId: string
): Promise<TaskResult> {
  const replyType = parseConfirmationReply(replyText);

  const { data: task, error } = await getSupabaseClient()
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .eq("user_id", userId)
    .single();

  if (error || !task) {
    return { taskId: "", success: false, response: "Task not found", actions: [], error: "Could not find the task to confirm" };
  }

  if (task.status !== "awaiting_confirmation" && task.status !== "pending_approval") {
    return { taskId, success: false, response: "Task already processed", actions: [], error: "This task is no longer awaiting confirmation" };
  }

  switch (replyType) {
    case 'yes': {
      await getSupabaseClient()
        .from("tasks")
        .update({ status: "pending", auto_proceed_at: null, auto_proceed_context: null })
        .eq("id", taskId);

      await sendResponse({
        to: from, from: `${username}@aevoy.com`,
        subject: `Confirm: ${task.input_text?.slice(0, 30)}...`,
        body: "Got it! Working on it now.",
      });

      return processTaskV3({
        userId, username, from,
        subject: task.email_subject,
        body: task.input_text || "",
        taskId,
      });
    }

    case 'no': {
      await getSupabaseClient()
        .from("tasks")
        .update({ status: "cancelled", auto_proceed_at: null, auto_proceed_context: null })
        .eq("id", taskId);

      await sendTaskCancelled(from, `${username}@aevoy.com`, task.email_subject);

      return { taskId, success: true, response: "Task cancelled", actions: [] };
    }

    case 'changes': {
      const updatedInput = `${task.input_text}\n\nUser clarification: ${replyText}`;

      await getSupabaseClient()
        .from("tasks")
        .update({ status: "pending", input_text: updatedInput, auto_proceed_at: null, auto_proceed_context: null })
        .eq("id", taskId);

      await sendResponse({
        to: from, from: `${username}@aevoy.com`,
        subject: `Confirm: ${task.input_text?.slice(0, 30)}...`,
        body: "Got it! Updated and working on it now.",
      });

      return processTaskV3({
        userId, username, from,
        subject: task.email_subject,
        body: updatedInput,
        taskId,
      });
    }

    default:
      return { taskId, success: false, response: "Unknown reply type", actions: [], error: "Could not understand the reply" };
  }
}

/**
 * Handle a verification code reply from the user.
 */
export async function handleVerificationCodeReply(
  userId: string,
  username: string,
  from: string,
  code: string,
  taskId: string
): Promise<TaskResult> {
  const { data: task, error } = await getSupabaseClient()
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .eq("user_id", userId)
    .single();

  if (error || !task) {
    return { taskId: "", success: false, response: "Task not found", actions: [], error: "Could not find the task needing verification" };
  }

  if (task.status !== "awaiting_user_input" || task.stuck_reason !== "verification_code") {
    return { taskId, success: false, response: "Task not awaiting verification", actions: [], error: "This task is not waiting for a verification code" };
  }

  await getSupabaseClient()
    .from("tasks")
    .update({
      status: "processing",
      stuck_reason: null,
      structured_intent: { ...task.structured_intent, verification_code: code },
    })
    .eq("id", taskId);

  await sendResponse({
    to: from, from: `${username}@aevoy.com`,
    subject: "Verification code received",
    body: "Got it! Continuing with the task...",
  });

  return processTaskV3({
    userId, username, from,
    subject: task.email_subject,
    body: task.input_text || "",
    taskId,
  });
}
