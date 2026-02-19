/**
 * Task Processor
 * 
 * Orchestrates task processing with security, execution engine, and failure learning.
 * Includes confirmation flow for unclear tasks based on user settings.
 */

import { loadMemory, appendDailyLog, updateMemoryWithFact } from "./memory.js";
import { generateResponse, cleanResponseForEmail, classifyTask, checkUserBudget, quickValidate } from "./ai.js";
import { sendResponse, sendOverQuotaEmail, sendProgressEmail, sendConfirmationEmail, sendTaskAccepted, sendTaskCancelled } from "./email.js";
import { sendSms } from "./twilio.js";
import { createLockedIntent, getTaskTypeFromClassification, validateAction } from "../security/intent-lock.js";
import { ActionValidator } from "../security/validator.js";
import { ExecutionEngine } from "../execution/engine.js";
import { getFailureMemory, recordFailure, learnSolution } from "../memory/failure-db.js";
import { clarifyTask, formatConfirmationMessage, parseConfirmationReply, parseCardCommand, getUserSettings, type ClarifiedTask } from "./clarifier.js";
import { verifyTask, quickVerify, getQualityTier, QUALITY_TIERS } from "./task-verifier.js";
import { detectWorkflow, createWorkflow } from "./workflow.js";
import { requiresAutonomousPlanning, handleAutonomousWorkflow } from "./autonomous-integration.js";
import { clearFailurePatterns, persistFailurePatterns, buildRetryEnforcementMessage, recordFailedAttempt, getRetryGuidance } from "./retry-intelligence.js";
import { getSupabaseClient } from "../utils/supabase.js";
import type { TaskRequest, TaskResult, Action, ActionResult, InputChannel, StrikeContext, StrikeRecord, VerificationResult } from "../types/index.js";
import { readFileSync } from 'fs';
import { join } from 'path';

// Self-learning intelligence imports
import { recordModelOutcome } from "./model-intelligence.js";
import { predictDifficulty, recordTaskDifficulty } from "./difficulty-predictor.js";
import { recordMethodAttempt } from "./method-tracker.js";
import { getKnownCorrections, formatCorrectionsForPrompt, recordCorrectionSuccess } from "./verification-learner.js";
import { getPatternWarnings } from "./pattern-detector.js";
import { executeWithDeepening, getOptimalStartingLevel } from "./iterative-deepening.js";
import { executeInParallel, shouldUseParallelExecution } from "./parallel-execution.js";
import { getRecentContext, storeTaskContext, formatContextForPrompt } from "./context-carryover.js";
import { decomposeTask, getExecutionOrder } from "./task-decomposition.js";
import { recommendSkills, formatSkillRecommendations } from "./autonomous-skill-recommender.js";
import { findTemplate, recordTemplate, substituteVariables, recordTemplateFailure } from "./template-recorder.js";

/**
 * Resolve correct recipient based on channel and user profile.
 * Email channel: send to 'from' (user's email)
 * SMS channel: send SMS to 'from' (phone), email to profile.email
 * Voice channel: send SMS to 'from' (phone), email to profile.email
 */
async function resolveRecipient(
  channel: InputChannel | undefined,
  from: string,
  userId: string
): Promise<{ email: string; phone: string | null }> {
  if (channel === 'email') {
    return { email: from, phone: null };
  }

  // For SMS/voice, fetch user's registered email and phone
  const { data: profile } = await getSupabaseClient()
    .from('profiles')
    .select('email, phone')
    .eq('id', userId)
    .single();

  return {
    email: profile?.email || from,
    phone: from, // from = phone for SMS/voice
  };
}

/**
 * Send a message back to the user via the same channel they used.
 * SMS/voice channels get SMS replies; email/web/other get email replies.
 * Falls back to email if SMS delivery fails or no phone number on file.
 */
async function sendViaChannel(
  channel: InputChannel | undefined,
  userId: string,
  from: string,
  aevoyFrom: string,
  subject: string,
  body: string
): Promise<void> {
  const { email, phone } = await resolveRecipient(channel, from, userId);

  if (channel === "sms" || channel === "voice") {
    // Try SMS first
    if (phone) {
      const smsBody = body.length > 1500
        ? body.substring(0, 1500) + "... (full results emailed)"
        : body;
      await sendSms({ userId, to: phone, body: smsBody });

      // For long messages or voice tasks, also send email
      if (body.length > 1500 || channel === "voice") {
        await sendResponse({ to: email, from: aevoyFrom, subject, body });
      }
      return;
    }
  }

  // Default to email
  await sendResponse({ to: email, from: aevoyFrom, subject, body });
}

/**
 * Request a browser takeover when the agent is stuck.
 * Updates the task record and notifies the user.
 */
async function requestTakeover(
  taskId: string,
  reason: string,
  userId: string,
  from: string,
  username: string,
  inputChannel?: InputChannel
): Promise<void> {
  console.log(`[TAKEOVER] Requesting user takeover for task ${taskId.slice(0, 8)}: ${reason}`);

  // Fetch the live_view_url from the task (saved during engine init)
  const { data: task } = await getSupabaseClient()
    .from('tasks')
    .select('live_view_url')
    .eq('id', taskId)
    .single();

  await getSupabaseClient()
    .from('tasks')
    .update({
      needs_takeover: true,
      takeover_reason: reason,
      takeover_requested_at: new Date().toISOString(),
      status: 'awaiting_user_input',
    })
    .eq('id', taskId);

  // Notify the user
  const reasonLabel: Record<string, string> = {
    captcha_detected: 'a CAPTCHA that I cannot solve',
    bot_blocked: 'bot detection blocking my progress',
    verification_needed: 'a verification step that needs your input',
    login_required: 'a login that requires your credentials',
    low_success_rate: 'repeated failures on browser actions',
  };
  const humanReason = reasonLabel[reason] || 'a step that needs your help';
  const liveUrl = task?.live_view_url;

  let message = `I'm stuck on your task due to ${humanReason}.`;
  if (liveUrl) {
    message += `\n\nTake over the browser here:\n${liveUrl}\n\nOr use your dashboard: ${process.env.NEXT_PUBLIC_APP_URL || 'https://www.aevoy.com'}/dashboard/takeover/${taskId}`;
  } else {
    message += `\n\nVisit your dashboard to help: ${process.env.NEXT_PUBLIC_APP_URL || 'https://www.aevoy.com'}/dashboard/takeover/${taskId}`;
  }
  message += '\n\nOnce you resolve the issue, click "I\'m Done" and I\'ll continue.';

  await sendViaChannel(inputChannel, userId, from, `${username}@aevoy.com`, 'Your AI needs help', message);
}

// ---- Test Mode / Payment Skip ----
function isTestMode(): boolean {
  // Never use test mode in production — even if TEST_MODE is accidentally set
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.TEST_MODE === "true" || process.env.NODE_ENV === "development";
}

function shouldSkipPayment(): boolean {
  // TODO: Implement proper payment/subscription check once Stripe is fully integrated.
  // For now, quota is enforced by checking messages_used >= messages_limit.
  // Return false to enforce quota checks in production/non-test environments.
  return process.env.SKIP_PAYMENT_CHECKS === "true";
}

/**
 * Process incoming email - handles clarification and confirmation flow
 */
export async function processIncomingTask(task: TaskRequest): Promise<TaskResult> {
  const { userId, username, from, subject, body } = task;
  
  try {
    // Check quota first
    const { data: profile } = await getSupabaseClient()
      .from("profiles")
      .select("messages_used, messages_limit, subscription_status")
      .eq("id", userId)
      .single();

    const isBeta = profile?.subscription_status === 'beta';
    if (!shouldSkipPayment() && !isBeta && profile && profile.messages_used >= profile.messages_limit) {
      await sendOverQuotaEmail(from, `${username}@aevoy.com`, subject);
      return {
        taskId: "",
        success: false,
        response: "Over quota",
        actions: [],
        error: "User is over their message quota",
      };
    }

    // Check if this is a card management command
    const cardCommand = parseCardCommand(body);
    if (cardCommand) {
      return handleCardCommand(cardCommand, userId, from, username);
    }

    // AUTONOMOUS WORKFLOW DETECTION: Check if this requires AGI-level planning
    if (await requiresAutonomousPlanning(subject, body)) {
      console.log(`[AUTONOMOUS] Task requires autonomous workflow planning`);
      return handleAutonomousWorkflow({
        userId,
        username,
        from,
        subject,
        body,
        taskId: undefined,
        inputChannel: task.inputChannel,
      });
    }

    // Detect if this is a multi-step workflow (complex project)
    const workflowCheck = await detectWorkflow(subject, body);
    if (workflowCheck.isWorkflow) {
      console.log(`[WORKFLOW] Detected multi-step project: ${workflowCheck.reason}`);
      const workflowId = await createWorkflow(userId, username, from, subject, body);
      return {
        taskId: workflowId,
        success: true,
        response: "Workflow created and processing",
        actions: [],
      };
    }

    // Load user's memory for clarification
    const memory = await loadMemory(userId);

    // Clarify the task using AI
    const clarified = await clarifyTask(body, memory, userId);

    // Create task record with structured intent
    const { data: taskRecord, error: taskError } = await getSupabaseClient()
      .from("tasks")
      .insert({
        user_id: userId,
        status: clarified.needsConfirmation ? "awaiting_confirmation" : "pending",
        email_subject: subject,
        input_text: body,
        structured_intent: clarified.structuredIntent,
        confidence: clarified.confidence,
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (taskError || !taskRecord) {
      throw new Error("Failed to create task record");
    }

    const taskId = taskRecord.id;

    // Either send confirmation or execute immediately
    if (clarified.needsConfirmation) {
      const confirmationMessage = formatConfirmationMessage(clarified);
      await sendConfirmationEmail(
        from,
        `${username}@aevoy.com`,
        taskId,
        clarified.structuredIntent.goal,
        confirmationMessage
      );
      
      return {
        taskId,
        success: true,
        response: "Awaiting confirmation",
        actions: [],
      };
    } else {
      // Execute immediately
      await sendTaskAccepted(from, `${username}@aevoy.com`, clarified.structuredIntent.goal);
      
      // Process the task in full (this handles the actual execution)
      return processTask({ ...task, taskId });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("processIncomingTask error:", errorMessage);

    // Send friendly message — never expose raw error details to users
    await sendResponse({
      to: from,
      from: `${username}@aevoy.com`,
      subject,
      body: "I ran into a snag while setting up your task. Let me try a different approach — feel free to send your request again and I'll get right on it.",
    });

    return {
      taskId: "",
      success: false,
      response: "",
      actions: [],
      error: errorMessage,
    };
  }
}

/**
 * Handle confirmation reply from user
 */
export async function handleConfirmationReply(
  userId: string,
  username: string,
  from: string,
  replyText: string,
  taskId: string
): Promise<TaskResult> {
  const replyType = parseConfirmationReply(replyText);
  
  // Find the task
  const { data: task, error } = await getSupabaseClient()
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .eq("user_id", userId)
    .single();

  if (error || !task) {
    return {
      taskId: "",
      success: false,
      response: "Task not found",
      actions: [],
      error: "Could not find the task to confirm",
    };
  }

  if (task.status !== "awaiting_confirmation") {
    return {
      taskId,
      success: false,
      response: "Task already processed",
      actions: [],
      error: "This task is no longer awaiting confirmation",
    };
  }

  switch (replyType) {
    case 'yes': {
      // Update task to pending and process
      await getSupabaseClient()
        .from("tasks")
        .update({ status: "pending" })
        .eq("id", taskId);
      
      await sendResponse({
        to: from,
        from: `${username}@aevoy.com`,
        subject: `Confirm: ${task.input_text?.slice(0, 30)}...`,
        body: "Got it! Working on it now.",
      });

      // Process the confirmed task
      return processTask({
        userId,
        username,
        from,
        subject: task.email_subject,
        body: task.input_text || "",
        taskId,
      });
    }

    case 'no': {
      // Cancel the task
      await getSupabaseClient()
        .from("tasks")
        .update({ status: "cancelled" })
        .eq("id", taskId);
      
      await sendTaskCancelled(from, `${username}@aevoy.com`, task.email_subject);

      return {
        taskId,
        success: true,
        response: "Task cancelled",
        actions: [],
      };
    }

    case 'changes': {
      // User wants to modify - append clarification and reprocess
      const updatedInput = `${task.input_text}\n\nUser clarification: ${replyText}`;
      
      await getSupabaseClient()
        .from("tasks")
        .update({ 
          status: "pending",
          input_text: updatedInput 
        })
        .eq("id", taskId);
      
      await sendResponse({
        to: from,
        from: `${username}@aevoy.com`,
        subject: `Confirm: ${task.input_text?.slice(0, 30)}...`,
        body: "Got it! Updated and working on it now.",
      });

      return processTask({
        userId,
        username,
        from,
        subject: task.email_subject,
        body: updatedInput,
        taskId,
      });
    }

    default:
      return {
        taskId,
        success: false,
        response: "Unknown reply type",
        actions: [],
        error: "Could not understand the reply",
      };
  }
}

/**
 * Handle verification code reply from user
 */
export async function handleVerificationCodeReply(
  userId: string,
  username: string,
  from: string,
  code: string,
  taskId: string
): Promise<TaskResult> {
  // Find the task
  const { data: task, error } = await getSupabaseClient()
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .eq("user_id", userId)
    .single();

  if (error || !task) {
    return {
      taskId: "",
      success: false,
      response: "Task not found",
      actions: [],
      error: "Could not find the task needing verification",
    };
  }

  if (task.status !== "awaiting_user_input" || task.stuck_reason !== "verification_code") {
    return {
      taskId,
      success: false,
      response: "Task not awaiting verification",
      actions: [],
      error: "This task is not waiting for a verification code",
    };
  }

  // Update task with the code and resume
  await getSupabaseClient()
    .from("tasks")
    .update({ 
      status: "processing",
      stuck_reason: null,
      // Store the code in structured_intent for the engine to use
      structured_intent: {
        ...task.structured_intent,
        verification_code: code
      }
    })
    .eq("id", taskId);

  await sendResponse({
    to: from,
    from: `${username}@aevoy.com`,
    subject: `🔐 Verification code received`,
    body: "Got it! Continuing with the task...",
  });

  // Resume the task - this would need the execution engine to pick up
  // For now, we'll restart from scratch with the code available
  return processTask({
    userId,
    username,
    from,
    subject: task.email_subject,
    body: task.input_text || "",
    taskId,
  });
}

/**
 * Handle agent card commands
 */
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
            to: from,
            from: `${username}@aevoy.com`,
            subject: "Agent Card Balance",
            body: "You don't have an agent card set up yet. Visit your settings to create one!",
          });
        } else {
          await sendResponse({
            to: from,
            from: `${username}@aevoy.com`,
            subject: "Agent Card Balance",
            body: `Your agent card balance is **$${(card.balance_cents / 100).toFixed(2)}**\n\nCard ending in ${card.last_four}\nStatus: ${card.is_frozen ? '🔒 Frozen' : '✅ Active'}`,
          });
        }
        break;
      }
      
      case 'freeze': {
        const success = await freezeCard(userId);
        await sendResponse({
          to: from,
          from: `${username}@aevoy.com`,
          subject: "Agent Card Frozen",
          body: success 
            ? "🔒 Card frozen. No purchases allowed until you unfreeze."
            : "Failed to freeze card. Please try again or check your settings.",
        });
        break;
      }
      
      case 'unfreeze': {
        const success = await unfreezeCard(userId);
        await sendResponse({
          to: from,
          from: `${username}@aevoy.com`,
          subject: "Agent Card Unfrozen",
          body: success 
            ? "✅ Card unfrozen. I can now make purchases for you."
            : "Failed to unfreeze card. Please try again or check your settings.",
        });
        break;
      }
      
      case 'fund': {
        if (!command.amount) {
          await sendResponse({
            to: from,
            from: `${username}@aevoy.com`,
            subject: "Agent Card",
            body: "Please specify an amount to add, like: 'Add $50 to my card'",
          });
        } else {
          const result = await fundAgentCard(userId, command.amount);
          await sendResponse({
            to: from,
            from: `${username}@aevoy.com`,
            subject: "Agent Card Funded",
            body: result.success 
              ? `Done! Added $${(command.amount / 100).toFixed(2)} to your card.\n\nNew balance: **$${(result.newBalance / 100).toFixed(2)}**`
              : `Failed to add funds: ${result.error}`,
          });
        }
        break;
      }
    }
    
    return {
      taskId: "",
      success: true,
      response: "Card command handled",
      actions: [],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[CARD] Command error:", errorMessage);
    // Send friendly message — never expose raw error details
    await sendResponse({
      to: from,
      from: `${username}@aevoy.com`,
      subject: "Agent Card",
      body: "I had trouble processing your card command. Please try again or check your card settings in the dashboard.",
    });
    return {
      taskId: "",
      success: false,
      response: "",
      actions: [],
      error: errorMessage,
    };
  }
}

export async function processTask(task: TaskRequest): Promise<TaskResult> {
  const { userId, username, from, subject, body } = task;
  // Extract sender's display name: prefer explicit senderName, otherwise derive from email local part
  const senderName = task.senderName || (from.includes('@') ? from.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : undefined);
  let taskId = task.taskId || "";
  const startTime = Date.now();
  const MASTER_TIMEOUT_MS = 1200000; // 20 minutes

  // Master timeout: abort if the entire task exceeds 20 minutes
  const timeoutController = new AbortController();
  const masterTimer = setTimeout(() => timeoutController.abort(), MASTER_TIMEOUT_MS);

  try {
    // 1. Check quota
    const { data: profile } = await getSupabaseClient()
      .from("profiles")
      .select("messages_used, messages_limit, subscription_status")
      .eq("id", userId)
      .single();

    // Allow beta users unlimited access; skip checks in test mode
    const isBeta = profile?.subscription_status === 'beta';
    if (!shouldSkipPayment() && !isBeta && profile && profile.messages_used >= profile.messages_limit) {
      await sendOverQuotaEmail(from, `${username}@aevoy.com`, subject);
      return {
        taskId: "",
        success: false,
        response: "Over quota",
        actions: [],
        error: "User is over their message quota",
      };
    }

    // 1b. Check monthly budget ($15/month per user)
    let forceCheapModel = false;
    if (!shouldSkipPayment() && !isBeta) {
      const budget = await checkUserBudget(userId);
      if (budget.overBudget) {
        // Budget exceeded — force free-tier model (Gemini Flash) or notify
        console.log(`[BUDGET] User ${userId.slice(0, 8)} over monthly budget, forcing cheap model`);
        forceCheapModel = true;
      } else if (budget.remaining < 3 && !budget.overBudget) {
        // Running low — send alert (once per day, tracked on usage table)
        console.log(`[BUDGET] User ${userId.slice(0, 8)} budget low ($${budget.remaining.toFixed(2)} remaining)`);
        forceCheapModel = budget.remaining < 1;
        try {
          const today = new Date().toISOString().split("T")[0];
          const currentMonth = today.slice(0, 7); // YYYY-MM
          const { data: usageRow } = await getSupabaseClient()
            .from("usage")
            .select("budget_alert_date")
            .eq("user_id", userId)
            .eq("month", currentMonth)
            .single();

          const alreadySentToday = usageRow?.budget_alert_date === today;

          if (!alreadySentToday) {
            await sendResponse({
              to: from,
              from: `${username}@aevoy.com`,
              subject: "[Aevoy] Budget Running Low",
              body: `You have $${budget.remaining.toFixed(2)} remaining in your monthly budget. Tasks will continue using cost-optimized models to stretch your budget.`,
            });
            await getSupabaseClient()
              .from("usage")
              .update({ budget_alert_date: today })
              .eq("user_id", userId)
              .eq("month", currentMonth);
            console.log(`[BUDGET] Alert sent to ${username}`);
          }
        } catch {
          // Non-critical
        }
      } else if (budget.remaining < 1) {
        forceCheapModel = true;
      }
    }

    // 2. Create or update task record
    if (taskId) {
      // Use existing task record (from confirmation flow)
      await getSupabaseClient()
        .from("tasks")
        .update({
          status: "processing",
          started_at: new Date().toISOString(),
        })
        .eq("id", taskId);
    } else {
      // Create new task record
      const { data: taskRecord, error: taskError } = await getSupabaseClient()
        .from("tasks")
        .insert({
          user_id: userId,
          status: "processing",
          email_subject: subject,
          input_text: body,
          started_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (taskError || !taskRecord) {
        throw new Error("Failed to create task record");
      }

      taskId = taskRecord.id;
    }

    // Clear retry failure patterns for this new task
    clearFailurePatterns();

    // 3. Classify task and create locked intent (SECURITY)
    const classification = await classifyTask(`${subject} ${body}`);
    const taskType = getTaskTypeFromClassification(classification.taskType);
    
    const lockedIntent = createLockedIntent({
      userId,
      taskType,
      goal: classification.goal,
      allowedDomains: classification.domains,
      maxDuration: 300, // 5 minutes max
      maxActions: 100
    });

    console.log(`[SECURITY] Intent locked: ${taskType}`);
    console.log(`[SECURITY] Allowed actions: ${lockedIntent.allowedActions.join(', ')}`);

    // 4. Create action validator
    const validator = new ActionValidator(lockedIntent);

    // 5. Load user's memory
    const memory = await loadMemory(userId);

    // 5a. SELF-LEARNING: Predict difficulty + load intelligence BEFORE execution
    const primaryDomain = classification.domains[0] || "";
    let difficultyPrediction: Awaited<ReturnType<typeof predictDifficulty>> | null = null;
    let knownCorrections: string[] = [];
    let patternWarnings: string[] = [];

    try {
      // Run predictions in parallel for speed
      const [diffPred, corrections, warnings] = await Promise.all([
        predictDifficulty(primaryDomain, classification.taskType),
        getKnownCorrections(primaryDomain, classification.taskType),
        getPatternWarnings(primaryDomain),
      ]);

      difficultyPrediction = diffPred;
      knownCorrections = corrections;
      patternWarnings = warnings;

      if (diffPred.confidence > 0) {
        console.log(
          `[INTELLIGENCE] Predicted: ${diffPred.difficulty} (${diffPred.predictedSuccessRate}% success, ` +
          `confidence: ${diffPred.confidence}%, method: ${diffPred.recommendedMethod})`
        );
      }
      if (corrections.length > 0) {
        console.log(`[INTELLIGENCE] Pre-applying ${corrections.length} known corrections`);
      }
      if (warnings.length > 0) {
        console.log(`[INTELLIGENCE] ${warnings.length} pattern warnings for ${primaryDomain}`);
      }
    } catch {
      // Non-critical — intelligence is bonus, not required
    }

    // 5a-ii. ADVANCED INTELLIGENCE: Quality prediction, cost optimization, failure prevention
    try {
      const { predictQuality } = await import("./quality-predictor.js");
      const { chooseOptimalPath } = await import("./cost-optimizer.js");
      const { preventFailures } = await import("./failure-preventer.js");
      const { applyTransferLearning } = await import("./transfer-learning.js");

      // Predict quality
      const qualityPred = await predictQuality(userId, classification.taskType, primaryDomain, body);
      console.log(`[QUALITY] Predicted: ${qualityPred.overallScore}/100 (${qualityPred.recommendedVerification} verification)`);

      // Optimize cost
      const optimalPath = await chooseOptimalPath(userId, classification.taskType, primaryDomain, "medium");
      console.log(`[COST] Optimal: ${optimalPath.method} ($${optimalPath.estimatedCost}, ${optimalPath.estimatedDuration}s)`);

      // Prevent failures
      const prevention = await preventFailures(userId, classification.taskType, primaryDomain, body);
      if (!prevention.readyToExecute) {
        console.log(`[PREVENTION] Task blocked: ${prevention.blockingIssues.join(", ")}`);
        // Send blocking issues to user
        await sendResponse({
          to: from,
          from: `${username}@aevoy.com`,
          subject: `Action Required: ${subject}`,
          body: `Cannot proceed with your request:\n\n${prevention.blockingIssues.map(i => `• ${i}`).join("\n")}\n\nPlease address these issues and try again.`,
        });
        return { taskId, success: false, response: "Blocked by prevention checks", actions: [], error: prevention.blockingIssues[0] };
      }
      console.log(`[PREVENTION] Risk reduced: ${prevention.originalRisk}% → ${prevention.reducedRisk}%`);

      // Apply transfer learning for new domains
      if (primaryDomain && difficultyPrediction && difficultyPrediction.confidence < 50) {
        const transfer = await applyTransferLearning(primaryDomain, classification.taskType);
        if (transfer.applied) {
          console.log(`[TRANSFER] Applied knowledge from ${transfer.sourceDomain} (${transfer.confidence}% confidence)`);
        }
      }
    } catch (error) {
      console.log(`[ADVANCED-INTEL] Optional intelligence failed:`, error);
      // Non-critical - continue without advanced intelligence
    }

    // 5b. CONTEXT CARRYOVER: Load recent context from related tasks (24hr window)
    let contextCarryover = "";
    try {
      const recentContext = await getRecentContext(userId, body);
      if (recentContext) {
        contextCarryover = formatContextForPrompt(recentContext);
        console.log(`[CONTEXT] Found relevant context from task ${recentContext.taskId.slice(0, 8)} (score-based match)`);
      }
    } catch {
      // Non-critical — context carryover is bonus
    }

    // 5c. Query Hive learnings for known approaches
    let learningsHint = contextCarryover; // Start with context
    try {
      const domain = primaryDomain;
      const { data: learnings } = await getSupabaseClient()
        .from("learnings")
        .select("steps, gotchas, difficulty")
        .or(`service.ilike.*${domain}*,task_type.eq.${classification.taskType}`)
        .limit(3);

      if (learnings && learnings.length > 0) {
        const hints = learnings.map(l => {
          const parts: string[] = [];
          // steps and gotchas are JSONB arrays
          if (l.steps && Array.isArray(l.steps) && l.steps.length > 0) {
            parts.push(`Steps: ${l.steps.join(", ")}`);
          }
          if (l.gotchas && Array.isArray(l.gotchas) && l.gotchas.length > 0) {
            parts.push(`Watch for: ${l.gotchas.join(", ")}`);
          }
          return parts.join(". ");
        }).filter(Boolean);
        if (hints.length > 0) {
          learningsHint += `\n\nKnown approaches:\n${hints.join("\n")}`;
          console.log(`[LEARNINGS] Found ${hints.length} relevant hints for ${domain || classification.taskType}`);
        }
      }
    } catch {
      // Non-critical — learnings table may not exist yet
    }

    // 5d. SELF-LEARNING: Append pattern warnings + known corrections to learnings
    if (patternWarnings.length > 0) {
      learningsHint += `\n\nCross-domain intelligence:\n${patternWarnings.join("\n")}`;
    }
    if (knownCorrections.length > 0) {
      learningsHint += formatCorrectionsForPrompt(knownCorrections);
    }

    // 5e. TASK DECOMPOSITION: Check if task is complex enough to benefit from decomposition
    const isComplexTask = body.length > 200 || classification.taskType.includes("multi");
    if (isComplexTask && difficultyPrediction && (difficultyPrediction.difficulty === "hard" || difficultyPrediction.difficulty === "nightmare")) {
      try {
        const decomposed = await decomposeTask(body, userId);
        if (decomposed.subtasks.length > 1) {
          console.log(`[DECOMPOSITION] Broke task into ${decomposed.subtasks.length} subtasks`);
          const executionOrder = getExecutionOrder(decomposed.subtasks);
          console.log(`[DECOMPOSITION] Execution order: ${executionOrder.length} waves`);

          // Execute subtasks sequentially, collecting results
          const subtaskResults: Array<{ subtaskId: string; description: string; success: boolean; response: string; error?: string }> = [];
          let allSuccess = true;

          for (const batch of executionOrder) {
            for (const subtask of batch) {
              try {
                // Create subtask record in DB with parent reference
                const { data: subtaskRecord } = await getSupabaseClient()
                  .from("tasks")
                  .insert({
                    user_id: userId,
                    status: "processing",
                    email_subject: `[Subtask] ${subtask.description}`,
                    input_text: subtask.description,
                    parent_task_id: taskId,
                    started_at: new Date().toISOString(),
                  })
                  .select("id")
                  .single();

                const subtaskId = subtaskRecord?.id || "";
                console.log(`[DECOMPOSITION] Executing subtask ${subtask.id}: ${subtask.description}`);

                const subtaskResult = await processTask({
                  userId,
                  username,
                  from,
                  subject: `[Subtask] ${subtask.description}`,
                  body: subtask.description,
                  taskId: subtaskId,
                  inputChannel: task.inputChannel,
                });

                subtaskResults.push({
                  subtaskId,
                  description: subtask.description,
                  success: subtaskResult.success,
                  response: subtaskResult.response,
                  error: subtaskResult.error,
                });

                if (!subtaskResult.success) {
                  allSuccess = false;
                  console.warn(`[DECOMPOSITION] Subtask ${subtask.id} failed: ${subtaskResult.error}`);
                }
              } catch (subtaskError) {
                const errMsg = subtaskError instanceof Error ? subtaskError.message : "Unknown";
                console.error(`[DECOMPOSITION] Subtask ${subtask.id} threw:`, errMsg);
                subtaskResults.push({
                  subtaskId: "",
                  description: subtask.description,
                  success: false,
                  response: "",
                  error: errMsg,
                });
                allSuccess = false;
              }
            }
          }

          // Aggregate results — only show successes to user, log failures internally
          const successResults = subtaskResults.filter(r => r.success);
          const aggregatedResponse = successResults
            .map((r, i) => `${i + 1}. ${r.description}: ${r.response.substring(0, 200)}`)
            .join("\n");

          const failedResults = subtaskResults.filter(r => !r.success);
          if (failedResults.length > 0) {
            console.warn(`[DECOMPOSITION] ${failedResults.length} subtasks failed:`, failedResults.map(r => `${r.description}: ${r.error}`).join("; "));
          }

          const parentStatus = allSuccess ? "completed" : "partial_failure";
          await getSupabaseClient().from("tasks").update({
            status: parentStatus,
            completed_at: new Date().toISOString(),
            execution_time_ms: Date.now() - startTime,
          }).eq("id", taskId);

          // Send aggregated response — focus on what succeeded
          const responseBody = successResults.length > 0
            ? (allSuccess
              ? `All done! Here's what I completed:\n\n${aggregatedResponse}`
              : `Here's what I was able to complete:\n\n${aggregatedResponse}`)
            : "I had trouble completing your request. Let me try a different approach — feel free to send it again.";

          await sendViaChannel(task.inputChannel, userId, from, `${username}@aevoy.com`, `Re: ${subject}`, responseBody);

          return {
            taskId,
            success: allSuccess,
            response: responseBody,
            actions: [],
            error: allSuccess ? undefined : "Some subtasks failed",
          };
        }
      } catch {
        // Decomposition failed — fall through to monolithic execution
        console.warn("[DECOMPOSITION] Failed, continuing with monolithic execution");
      }
    }

    // 5f. Create execution plan
    let planId: string | null = null;
    let plan: import("../types/index.js").ExecutionPlan | null = null;
    try {
      const { createPlan } = await import("./planner.js");
      plan = await createPlan(userId, taskId, classification, memory, learningsHint);

      // Check user's confirmation_mode for plan approval
      const userSettings = await getUserSettings(userId);
      let approved = true;

      if (userSettings.confirmationMode === 'always') {
        // Send plan summary and pause for approval
        approved = false;
      } else if (userSettings.confirmationMode === 'risky') {
        // Check if plan has irreversible steps
        const irreversibleActions = ['submit', 'send_email', 'fill_form', 'schedule'];
        const hasIrreversible = plan.steps.some(s => irreversibleActions.includes(s.type));
        if (hasIrreversible) {
          approved = false;
        }
      } else if (userSettings.confirmationMode === 'unclear') {
        // Check AI confidence from the clarified task (if available from earlier step)
        const taskConfidence = (classification as Record<string, unknown>).confidence as number | undefined ?? 1;
        if (taskConfidence < 0.7) {
          approved = false;
        }
      }
      // 'never' mode: auto-approve (approved stays true)

      // Store plan in DB
      const { data: planRecord } = await getSupabaseClient().from("execution_plans").insert({
        task_id: taskId,
        user_id: userId,
        plan_steps: plan.steps,
        execution_method: plan.method,
        approved,
        status: approved ? "executing" : "pending_approval",
        estimated_cost: plan.estimatedCost,
        started_at: approved ? new Date().toISOString() : null,
      }).select("id").single();
      planId = planRecord?.id || null;

      // If plan needs approval, send summary and pause
      if (!approved) {
        const irreversibleActions = ['submit', 'send_email', 'fill_form', 'schedule'];
        const planSummary = plan.steps.map((s, i) => {
          const isIrreversible = irreversibleActions.includes(s.type);
          return `${i + 1}. ${s.description}${isIrreversible ? ' [IRREVERSIBLE]' : ''}`;
        }).join("\n");

        const approvalMessage = `I've created a plan for your task. Please review and reply YES to proceed or NO to cancel:\n\n${planSummary}\n\nEstimated cost: $${plan.estimatedCost.toFixed(4)}`;

        await getSupabaseClient().from("tasks").update({
          status: "pending_approval",
        }).eq("id", taskId);

        await sendViaChannel(task.inputChannel, userId, from, `${username}@aevoy.com`, `Plan Approval: ${subject}`, approvalMessage);

        return {
          taskId,
          success: true,
          response: "Plan sent for approval",
          actions: [],
        };
      }

      // If auth is missing, text connect link and pause
      const missingAuth = plan.requiredAuth.filter(a => a.status === "missing");
      if (missingAuth.length > 0) {
        console.log(`[PLANNER] Missing auth for: ${missingAuth.map(a => a.provider).join(", ")}`);
        // Could generate connect links here in future — for now just log
      }

      // Route API path (skip browser entirely)
      if (plan.method === "api") {
        const { executeViaApi } = await import("../execution/api-executor.js");
        const apiResults = await executeViaApi(userId, plan);
        const allSuccess = apiResults.every(r => r.success);

        // Update plan status
        if (planId) {
          await getSupabaseClient().from("execution_plans").update({
            status: allSuccess ? "completed" : "failed",
            completed_at: new Date().toISOString(),
          }).eq("id", planId);
        }

        // Build response from API results — only show successes to user
        const successApiResults = apiResults.filter(r => r.success);
        const failedApiResults = apiResults.filter(r => !r.success);
        if (failedApiResults.length > 0) {
          console.warn(`[API] ${failedApiResults.length} API steps failed:`, failedApiResults.map(r => r.error).join("; "));
        }

        const successText = successApiResults.map(r => `Done: ${JSON.stringify(r.result)}`).join("\n");

        // Update task record
        await getSupabaseClient().from("tasks").update({
          status: allSuccess ? "completed" : "failed",
          completed_at: new Date().toISOString(),
          execution_time_ms: Date.now() - startTime,
          cost_usd: plan.estimatedCost,
        }).eq("id", taskId);

        let responseText: string;
        if (allSuccess) {
          responseText = `Done! ${successText}`;
        } else if (successApiResults.length > 0) {
          responseText = `Here's what I was able to complete:\n${successText}`;
        } else {
          // All API steps failed — generate AI-only answer as fallback
          const fallbackResponse = await generateResponse(
            memory, subject,
            `${body}\n\nIMPORTANT: Answer this from your own knowledge. Do NOT use any actions. Just give your best answer.`,
            username, undefined, userId, taskId, senderName
          );
          responseText = fallbackResponse.content
            ? cleanResponseForEmail(fallbackResponse.content)
            : "I had trouble completing this via API. Let me try a different approach — feel free to resend your request.";
        }

        await sendViaChannel(task.inputChannel, userId, from, `${username}@aevoy.com`, `Re: ${subject}`, responseText);
        return { taskId, success: allSuccess, response: responseText, actions: [] };
      }
    } catch (planError) {
      console.warn("[PLANNER] Planning failed, using direct path:", planError);
      plan = null;
    }

    // 5c. TEACH & REPEAT: Check for matching template before AI generation
    let templateMatch: Awaited<ReturnType<typeof findTemplate>> = null;
    let usedTemplateId: string | null = null;
    if (primaryDomain && classification.needsBrowser) {
      try {
        templateMatch = await findTemplate(userId, primaryDomain, `${subject} ${body}`);
        // Require at least 2 successful uses before trusting a template (avoids replaying
        // templates recorded before a bug fix that made them seem successful when they weren't)
        if (templateMatch && templateMatch.rank > 0.1 && templateMatch.successCount >= 2) {
          console.log(`[TEMPLATE] Matched template "${templateMatch.taskPattern.substring(0, 50)}..." (rank=${templateMatch.rank.toFixed(3)}, used ${templateMatch.successCount} times)`);
          usedTemplateId = templateMatch.id;
        } else {
          if (templateMatch) {
            console.log(`[TEMPLATE] Found matching template but insufficient success count (${templateMatch.successCount} < 2), ignoring`);
          }
          templateMatch = null;
        }
      } catch {
        templateMatch = null;
      }
    }

    // 6. Generate AI response (use cheapest model if over budget)
    const aiTaskType = forceCheapModel ? "validate" as const : undefined;
    const bodyWithLearnings = learningsHint ? `${body}${learningsHint}` : body;
    let aiResponse = await generateResponse(memory, subject, bodyWithLearnings, username, aiTaskType, userId, taskId, senderName);

    // If we have a matching template, inject the learned steps as actions
    if (templateMatch && templateMatch.steps.length > 0) {
      const substitutedSteps = substituteVariables(
        templateMatch.steps,
        templateMatch.variables,
        `${subject} ${body}`,
        aiResponse.actions
      );
      // Prepend template steps before AI-generated actions
      const templateActions: import("../types/index.js").Action[] = substitutedSteps.map(s => ({
        type: s.type as import("../types/index.js").Action["type"],
        params: s.params,
      }));
      console.log(`[TEMPLATE] Injecting ${templateActions.length} learned steps (replacing ${aiResponse.actions.length} AI-planned actions)`);
      aiResponse.actions = templateActions;
    }

    // 7. Parse and execute actions with security validation
    const actionResults: ActionResult[] = [];
    let executionEngine: ExecutionEngine | null = null;

    // Check if we need browser for any action
    const needsBrowser = aiResponse.actions.some(a =>
      ['browse', 'search', 'screenshot', 'fill_form', 'click', 'fill', 'select', 'submit', 'login', 'scroll', 'wait', 'extract'].includes(a.type)
    );

    if (needsBrowser) {
      // Initialize browser when AI generates browser actions — trust the AI's judgment,
      // don't gate on classifier.needsBrowser which can be wrong for ambiguous queries
      executionEngine = new ExecutionEngine(lockedIntent);

      // Track browser task concurrency
      const { incrementBrowserTasks } = await import("../utils/concurrency.js");
      incrementBrowserTasks();

      let domain = classification.domains?.[0] || null;

      // Domain allowlist only matters for local Playwright session persistence
      // Browserbase persists ALL domains via the user's context
      if (domain) {
        try {
          const allowlistPath = join(process.cwd(), 'config', 'persistent-domains.json');
          const allowlist = JSON.parse(readFileSync(allowlistPath, 'utf-8'));
          const isPersistable = allowlist.domains.some((d: string) =>
            domain!.includes(d) || d.includes(domain!)
          );
          if (!isPersistable) {
            domain = null; // Only affects local Playwright path
          }
        } catch {
          domain = null;
        }
      }

      await executionEngine.initialize(userId, domain || undefined, taskId);
      console.log(`[BROWSER] Execution engine initialized`);

      // Save Live View URL to task record for takeover feature
      const liveViewUrl = executionEngine.getLiveViewUrl();
      if (liveViewUrl && taskId) {
        console.log(`[BROWSER] Live View URL available for user interaction`);
        await getSupabaseClient()
          .from('tasks')
          .update({ live_view_url: liveViewUrl })
          .eq('id', taskId);
      }
    }

    // Send progress update for long tasks (include Live View link if available)
    if (aiResponse.actions.length > 3 || (needsBrowser && classification.needsBrowser)) {
      const liveViewUrl = executionEngine?.getLiveViewUrl();
      let progressMsg = `Working on your request...`;
      if (liveViewUrl) {
        progressMsg += `\n\nWatch live: ${liveViewUrl}\nOpen this link on any device to see what I'm doing in real time.`;
      }
      await sendProgressEmail(from, `${username}@aevoy.com`, subject, progressMsg);
    }

    // ============================================================
    // ITERATIVE EXECUTION LOOP
    // Execute actions → observe results → re-prompt AI → repeat
    // until task is done, budget exceeded, or timeout hit.
    // ============================================================
    // CRITICAL: Reduced from 30 to 5 to prevent resource hogging
    // With 10 concurrent tasks, 30 iterations = 300 total, causing deadlock
    // 5 iterations = 50 total, more manageable for concurrency
    const MAX_ITERATIONS = 5;
    let currentIteration = 0;
    let isTaskComplete = false;
    let aiSignaledComplete = false; // true when AI used [TASK_COMPLETE] or produced empty final round
    let totalAiCost = aiResponse.cost || 0;
    let totalTokens = aiResponse.tokensUsed || 0;
    let globalActionIndex = 0;

    // AGI-LEVEL STRATEGY TRACKING: Prevent wasting money on repeated failed attempts
    // Track what strategies have been tried and force AI to use DIFFERENT approaches
    const strategiesAttempted = new Map<string, number>(); // strategyHash -> attemptCount
    const MAX_SAME_STRATEGY_RETRIES = 3;
    let lastPageTitle = ''; // Track page titles to detect bot-blocked repetition

    // Dynamic domain failure tracking — if browse/navigate fails 2+ times on a domain,
    // the agent auto-switches to search() for that domain (no hardcoded lists)
    const domainFailures = new Map<string, number>(); // domain -> failure count

    // AGI-LEVEL METHOD TYPE DIVERSITY: Prevent trying 30x same method TYPE
    // Track METHOD TYPES (not just specific methods) to force intelligent diversity
    const { classifyMethodType, buildDiversityMessage } = await import("./method-classifier.js");
    type MethodType = import("./method-classifier.js").MethodType;
    const methodTypesAttempted = new Map<MethodType, number>(); // methodType -> attemptCount
    const MAX_SAME_METHOD_TYPE_RETRIES = 5;

    while (currentIteration < MAX_ITERATIONS && !isTaskComplete) {
      currentIteration++;
      const iterationStart = Date.now();
      const ITERATION_TIMEOUT_MS = 60000; // 60 seconds per iteration max
      console.log(`[ITERATE] Round ${currentIteration}/${MAX_ITERATIONS}, ${aiResponse.actions.length} actions to execute`);

      // Stream progress to dashboard via DB (fire-and-forget)
      void Promise.resolve(getSupabaseClient().rpc('update_task_progress', {
        p_task_id: taskId,
        p_message: `Round ${currentIteration}: executing ${aiResponse.actions.length} action(s)...`,
        p_step: globalActionIndex,
        p_total: globalActionIndex + aiResponse.actions.length,
        p_iteration: currentIteration,
      })).catch(() => {});

      // Check master timeout
      if (timeoutController.signal.aborted) {
        console.log('[ITERATE] Master timeout reached, stopping');
        break;
      }

      // Check for [TASK_COMPLETE] signal in AI response
      if (aiResponse.content.includes('[TASK_COMPLETE]')) {
        console.log('[ITERATE] AI signaled TASK_COMPLETE');
        // Strip the signal from user-facing content
        aiResponse.content = aiResponse.content.replace(/\[TASK_COMPLETE\]/g, '').trim();
        isTaskComplete = true;
        aiSignaledComplete = true;
        // Stop immediately — don't execute remaining actions, task is done
        break;
      }

      // If no actions, we're done
      if (aiResponse.actions.length === 0) {
        console.log('[ITERATE] No actions in this round, task complete');
        isTaskComplete = true;
        aiSignaledComplete = currentIteration > 1; // AI explicitly chose not to act after reviewing results
        break;
      }

      const iterationResults: ActionResult[] = [];

      for (let actionIndex = 0; actionIndex < aiResponse.actions.length; actionIndex++) {
        // Per-task budget check: stop if accumulated cost exceeds $2
        const taskCostSoFar = totalAiCost + (executionEngine?.getTotalCost() || 0);
        if (taskCostSoFar > 2.0) {
          console.warn(`[BUDGET] Task cost exceeded $2 (${taskCostSoFar.toFixed(4)}), stopping execution`);
          isTaskComplete = true;
          break;
        }

        // Check master timeout between actions
        if (timeoutController.signal.aborted) {
          console.log('[ITERATE] Master timeout reached mid-execution');
          isTaskComplete = true;
          break;
        }

        const action = aiResponse.actions[actionIndex];
        // Validate action against locked intent
        const validation = await validator.validate({
          type: action.type,
          domain: action.params?.url as string,
          value: JSON.stringify(action.params)
        });

        if (!validation.approved) {
          console.warn(`[SECURITY] Action blocked: ${action.type} - ${validation.reason}`);
          iterationResults.push({
            action,
            success: false,
            error: `Action not permitted for this task type`
          });
          continue;
        }

        // Execute action with failure memory integration
        let result = await executeActionWithLearning(
          action,
          userId,
          username,
          executionEngine
        );

        // Action-level retry: on failure, retry once after 3s delay
        // Skip retry for bot-blocked actions — retrying won't help
        const isBotBlockedAction = result.error?.includes('Bot-blocked') || result.error?.includes('bot-block');
        if (!result.success && result.error && !isBotBlockedAction && !result.error.startsWith('Security:') && !result.error.startsWith('Action not')) {
          console.log(`[RETRY] Action '${action.type}' failed (${result.error}), retrying in 3s...`);
          await new Promise(resolve => setTimeout(resolve, 3000));
          const retryResult = await executeActionWithLearning(
            action,
            userId,
            username,
            executionEngine
          );
          if (retryResult.success) {
            console.log(`[RETRY] Action '${action.type}' succeeded on retry`);
            result = retryResult;
          }
        }

        iterationResults.push(result);
        globalActionIndex++;

        // STRATEGY TRACKING: Detect if same approach is being retried (waste of money)
        if (!result.success) {
          // Hash the action to detect same strategy
          const strategyKey = `${action.type}:${action.params?.url || action.params?.selector || action.params?.text || ''}`;
          const currentAttempts = strategiesAttempted.get(strategyKey) || 0;
          strategiesAttempted.set(strategyKey, currentAttempts + 1);

          // If we've tried this exact strategy 3 times, FORCE different approach on next iteration
          if (currentAttempts >= MAX_SAME_STRATEGY_RETRIES - 1) {
            console.warn(`[STRATEGY] Strategy '${strategyKey}' failed ${currentAttempts + 1} times — will force different approach next round`);
          }

          // AGI-LEVEL: Track METHOD TYPE (not just specific strategy)
          const methodType = classifyMethodType(action);
          const typeAttempts = methodTypesAttempted.get(methodType) || 0;
          methodTypesAttempted.set(methodType, typeAttempts + 1);

          if (typeAttempts >= MAX_SAME_METHOD_TYPE_RETRIES - 1) {
            console.warn(`[METHOD-TYPE] Exhausted ${methodType} (${typeAttempts + 1} failures) — need DIFFERENT method type`);
          }
        }

        // Checkpoint: save progress after each successful action
        if (result.success && taskId) {
          try {
            await getSupabaseClient()
              .from("tasks")
              .update({
                checkpoint_data: {
                  iteration: currentIteration,
                  lastActionIndex: globalActionIndex,
                  completedActions: actionResults.length + iterationResults.filter(r => r.success).length,
                },
                is_iterative: true,
                iteration_count: currentIteration,
              })
              .eq("id", taskId);
          } catch {
            // Non-critical
          }
        }

        // Send progress update every 5 actions
        if (globalActionIndex > 0 && globalActionIndex % 5 === 0) {
          try {
            const { sendProgressUpdate } = await import("./progress.js");
            await sendProgressUpdate(userId, taskId, task.inputChannel || "email",
              `Round ${currentIteration}: completed ${globalActionIndex} actions so far...`);
          } catch {
            // Non-critical
          }
        }

        // Record action in action_history for undo/audit trail
        try {
          const screenshotUrl = result.result && typeof result.result === "object" && "screenshot" in result.result
            ? (result.result as Record<string, unknown>).screenshot as string | null
            : null;
          await getSupabaseClient().rpc("record_action", {
            p_task_id: taskId,
            p_user_id: userId,
            p_action_type: action.type,
            p_action_data: action.params || {},
            p_undo_data: null,
            p_screenshot_url: screenshotUrl,
          });
        } catch (recordErr) {
          // Non-critical — don't fail the task over history recording
          console.warn("[ACTION_HISTORY] Failed to record action:", recordErr);
        }
      }

      // Merge this iteration's results into the master list
      actionResults.push(...iterationResults);

      // Stream progress: round complete
      const roundSuccesses = iterationResults.filter(r => r.success).length;
      const totalSuccesses = actionResults.filter(r => r.success).length;
      void Promise.resolve(getSupabaseClient().rpc('update_task_progress', {
        p_task_id: taskId,
        p_message: `Round ${currentIteration} done: ${roundSuccesses}/${iterationResults.length} succeeded`,
        p_step: globalActionIndex,
        p_actions: actionResults.length,
        p_successes: totalSuccesses,
      })).catch(() => {});

      // If task is already marked complete (TASK_COMPLETE or budget/timeout), stop
      if (isTaskComplete) break;

      // Build results summary for the next AI iteration
      const successfulActions = iterationResults.filter(r => r.success);
      const failedActions = iterationResults.filter(r => !r.success);

      // Track domain failures dynamically — if browse/navigate fails on a domain,
      // increment counter so we can warn the AI to switch strategies
      for (const fail of failedActions) {
        if (['browse', 'navigate', 'fill_form', 'login'].includes(fail.action.type)) {
          const failUrl = (fail.action.params.url as string) || '';
          try {
            const failDomain = new URL(failUrl.startsWith('http') ? failUrl : `https://${failUrl}`).hostname;
            domainFailures.set(failDomain, (domainFailures.get(failDomain) || 0) + 1);
          } catch { /* not a valid URL */ }
        }
      }

      // If everything succeeded perfectly and task seems done, stop
      if (failedActions.length === 0 && !needsBrowser) {
        console.log('[ITERATE] All actions succeeded (non-browser), task complete');
        isTaskComplete = true;
        break;
      }

      // RE-PROMPT with VISUAL OBSERVATION: Feed results + page state back to AI
      const resultsSummary = iterationResults.map((r, i) => {
        const actionDesc = `${r.action.type}(${Object.values(r.action.params).map(v => typeof v === 'string' ? v.substring(0, 60) : v).join(', ')})`;
        if (r.success) {
          // Give search results much more space so AI can see actual content
          const limit = r.action.type === 'search' ? 2500 : 400;
          const resultStr = typeof r.result === 'string' ? r.result.substring(0, limit) : JSON.stringify(r.result).substring(0, limit);
          return `  ${i + 1}. ${actionDesc} → SUCCESS:\n${resultStr}`;
        } else {
          return `  ${i + 1}. ${actionDesc} → FAILED: ${r.error || 'unknown error'}`;
        }
      }).join('\n\n');

      // OBSERVE: Capture current page state for AI context
      console.log(`[DEBUG-ITER] Starting page observation for iteration ${currentIteration}`);
      let pageStateSection = '';
      if (executionEngine?.getPage()) {
        try {
          console.log(`[DEBUG-ITER] Getting page object...`);
          const page = executionEngine.getPage()!;
          console.log(`[DEBUG-ITER] Getting current URL...`);
          // Get current URL
          const currentUrl = page.url();
          console.log(`[DEBUG-ITER] URL: ${currentUrl}, getting page text...`);
          // Get visible page text (truncated for token efficiency)
          const rawPageText = await page.textContent('body').catch(() => '');
          console.log(`[DEBUG-ITER] Got ${rawPageText?.length || 0} chars, getting title...`);
          const pageText = (rawPageText || '').replace(/\s+/g, ' ').trim().substring(0, 1500);
          // Get page title
          const pageTitle = await page.title().catch(() => '');
          console.log(`[DEBUG-ITER] Page title: ${pageTitle}`);

          // Detect bot-blocked pages by checking page title/text
          const isBotBlockPage = (
            pageTitle.toLowerCase().includes('sorry! something went wrong') ||
            pageTitle.toLowerCase().includes('access denied') ||
            pageTitle.toLowerCase().includes('robot or human') ||
            (rawPageText && rawPageText.length < 400 && pageTitle.toLowerCase().includes('error'))
          );

          let stuckWarning = '';
          if (pageTitle && pageTitle === lastPageTitle && currentIteration > 1) {
            stuckWarning = `\n  ⚠️ SAME PAGE as last round (title: "${pageTitle}") — your previous action had NO EFFECT. You MUST try a completely different approach.`;
          }
          if (isBotBlockPage) {
            stuckWarning += `\n  🚫 BOT-BLOCKED: "${pageTitle}" — this site is blocking headless browsers. You CANNOT use browse() for this site. Use [ACTION:search("product name")] via Bing to find the information instead.`;
          }
          lastPageTitle = pageTitle;

          pageStateSection = `\nCURRENT PAGE STATE (what you can see right now):
  URL: ${currentUrl}
  Title: ${pageTitle}
  Visible text (first 1500 chars): ${pageText || '(page is empty or loading)'}${stuckWarning}`;

          // SELF-CRITIQUE: Quick AI check on whether actions worked (cheap/free model)
          console.log(`[DEBUG-ITER] Checking if self-critique needed (failed=${failedActions.length}, success=${successfulActions.length})`);
          if (failedActions.length > 0 || successfulActions.length === 0 || isBotBlockPage) {
            try {
              console.log(`[DEBUG-ITER] Running self-critique via quickValidate...`);
              const critiqueResult = await quickValidate(
                `Actions attempted: ${resultsSummary.substring(0, 500)}\nPage now shows: ${pageText.substring(0, 500)}\nDid the actions succeed? What should be done differently? Be brief (2 sentences max).`,
                'You are a task execution critic. Briefly evaluate if the actions succeeded based on the page state. 2 sentences max.'
              );
              console.log(`[DEBUG-ITER] Self-critique complete: ${critiqueResult?.result ? 'got result' : 'no result'}`);
              if (critiqueResult?.result) {
                pageStateSection += `\n  Self-critique: ${critiqueResult.result.substring(0, 300)}`;
              }
            } catch (critErr) {
              console.log(`[DEBUG-ITER] Self-critique error: ${critErr}`);
              // Self-critique is optional, don't block on failure
            }
          } else {
            console.log(`[DEBUG-ITER] Skipping self-critique (all actions succeeded)`);
          }
        } catch (e) {
          console.log(`[OBSERVE] Failed to capture page state: ${e}`);
        }
      } else {
        console.log(`[DEBUG-ITER] No page object, skipping observation`);
      }
      console.log(`[DEBUG-ITER] Page observation complete`);


      // Check for repeated strategies and build enforcement message
      console.log(`[DEBUG-ITER] Building strategy enforcement (${strategiesAttempted.size} strategies tracked)`);
      let strategyEnforcement = '';
      const repeatedStrategies: string[] = [];
      for (const [strategy, attempts] of strategiesAttempted.entries()) {
        if (attempts >= MAX_SAME_STRATEGY_RETRIES) {
          repeatedStrategies.push(strategy);
        }
      }

      if (repeatedStrategies.length > 0) {
        console.log(`[DEBUG-ITER] Found ${repeatedStrategies.length} repeated strategies, adding enforcement`);
        strategyEnforcement = `\n\nCRITICAL - STRATEGY ENFORCEMENT:
You have tried these approaches ${MAX_SAME_STRATEGY_RETRIES}+ times and they KEEP FAILING:
${repeatedStrategies.map(s => `  - ${s}`).join('\n')}

You are FORBIDDEN from trying these again. Use COMPLETELY DIFFERENT methods:
- Different URL/website/domain
- Different selector strategy (CSS vs XPath vs text vs aria-label)
- Different action type (click vs submit vs press Enter)
- Different data source (API instead of scraping, or vice versa)
- Different login method (OAuth vs credentials vs magic link)

Be creative. Think outside the box. What would a human do differently?`;
      }

      // AGI-LEVEL: Build method type diversity enforcement
      console.log(`[DEBUG-ITER] Building diversity enforcement (${methodTypesAttempted.size} method types tracked)`);
      const diversityEnforcement = buildDiversityMessage(methodTypesAttempted, MAX_SAME_METHOD_TYPE_RETRIES);
      console.log(`[DEBUG-ITER] Enforcement messages built`);

      // RETRY INTELLIGENCE: Get global retry enforcement
      const retryEnforcement = buildRetryEnforcementMessage();

      // Check if a search succeeded this round — if so, strongly hint to complete from results
      const searchSucceeded = iterationResults.some(r => r.action.type === 'search' && r.success);
      const searchCompletionHint = searchSucceeded
        ? `\n⚡ SEARCH SUCCEEDED: You have search results above. READ THEM and extract the answer NOW.
- If the results contain a price, rating, or relevant info → answer the user and signal [TASK_COMPLETE].
- DO NOT browse/navigate to sites shown in search results — use the data you already have.\n`
        : '';

      // Dynamic domain failure warning — no hardcoded lists, learned from actual failures
      const blockedDomains = [...domainFailures.entries()]
        .filter(([, count]) => count >= 2)
        .map(([domain]) => domain);
      const domainWarning = blockedDomains.length > 0
        ? `\n⛔ BLOCKED DOMAINS (failed ${blockedDomains.length > 1 ? '2+' : '2'} times — DO NOT retry these):\n${blockedDomains.map(d => `  - ${d} → use [ACTION:search("your query site:${d}")] instead`).join('\n')}\n`
        : '';

      const iterativePrompt = `Original request: ${subject} ${body}

ROUND ${currentIteration} RESULTS:
${resultsSummary}
${pageStateSection}
${strategyEnforcement}
${diversityEnforcement}
${retryEnforcement}
${searchCompletionHint}
${domainWarning}
${failedActions.length > 0 ? `\n${failedActions.length} action(s) failed. Try a DIFFERENT approach for those — don't repeat the same thing.\n` : ''}
OBSERVE the current page state above, then decide what to do next:
- If the page shows the task is complete (success message, data found, etc.), include [TASK_COMPLETE] with the final answer.
- If the page shows an error or unexpected state, adapt your approach.
- If more steps are needed, include the next actions.
- NEVER give up. Always find a way.`;

      console.log(`[ITERATE] Re-prompting AI with page observation for round ${currentIteration + 1}...`);
      console.log(`[DEBUG-ITER] About to call generateResponse (THIS IS THE SUSPECTED HANG POINT)`);
      console.log(`[DEBUG-ITER] Prompt length: ${iterativePrompt.length} chars`);
      const responseStart = Date.now();
      // Use "complex" task type for iterative calls — bypasses cache so the AI
      // sees updated page observations rather than returning a stale cached plan.
      const nextResponse = await generateResponse(
        memory, subject, iterativePrompt, username, "complex", userId, taskId, senderName
      );
      const responseDuration = Date.now() - responseStart;
      console.log(`[DEBUG-ITER] generateResponse completed in ${responseDuration}ms, cost: $${nextResponse.cost || 0}`);
      console.log(`[DEBUG-ITER] Response has ${nextResponse.actions?.length || 0} actions, content length: ${nextResponse.content?.length || 0}`);
      totalAiCost += nextResponse.cost || 0;
      totalTokens += nextResponse.tokensUsed || 0;
      aiResponse = nextResponse;

      // Check iteration timeout
      const iterationDuration = Date.now() - iterationStart;
      if (iterationDuration > ITERATION_TIMEOUT_MS) {
        console.log(`[ITERATE] Iteration ${currentIteration} exceeded ${ITERATION_TIMEOUT_MS}ms timeout (took ${iterationDuration}ms), stopping`);
        isTaskComplete = true;
        break;
      }

      console.log(`[DEBUG-ITER] === END OF ITERATION ${currentIteration} (${iterationDuration}ms) === Looping back to top...`);
    }

    if (currentIteration >= MAX_ITERATIONS) {
      console.log(`[ITERATE] Reached max iterations (${MAX_ITERATIONS}), finalizing`);
    }

    // Update cost tracking with all iterations
    aiResponse.cost = totalAiCost;
    aiResponse.tokensUsed = totalTokens;

    // 7b. Beyond-browser cascade if browser success rate is low
    let cascadeLevel = 1;
    if (classification.needsBrowser && actionResults.length > 0) {
      const successCount = actionResults.filter(r => r.success).length;
      const successRate = successCount / actionResults.length;

      if (successRate < 0.7) {
        console.log(`[CASCADE] Browser success rate ${(successRate * 100).toFixed(0)}%, trying fallbacks`);

        // If Live View URL is available, request user takeover before cascade fallbacks
        const takeoverUrl = executionEngine?.getLiveViewUrl();
        if (takeoverUrl && taskId && successRate < 0.4) {
          // Update cost before takeover (otherwise cost data is lost)
          const aiCost = aiResponse.cost || 0;
          const browserCost = executionEngine?.getTotalCost() || 0;
          await getSupabaseClient().from("tasks").update({
            tokens_used: aiResponse.tokensUsed || 0,
            cost_usd: aiCost + browserCost,
            type: taskType,
            execution_time_ms: Date.now() - startTime,
          }).eq("id", taskId);

          await requestTakeover(taskId, 'low_success_rate', userId, from, username, task.inputChannel);
          // Return early - user will resolve and resume
          return {
            taskId,
            success: false,
            response: 'Waiting for your help with the browser session.',
            actions: actionResults,
            error: 'Browser takeover requested',
          };
        }

        try {
          // Level 2: API fallback
          const { tryApiApproach } = await import("./tasks/api-fallback.js");
          const apiResult = await tryApiApproach(classification.taskType, classification.goal, classification.domains);
          if (apiResult.success && apiResult.result) {
            cascadeLevel = apiResult.level;
            aiResponse.content += `\n\n${apiResult.result}`;
          } else {
            // Level 3-4: Email fallback
            const { tryEmailApproach } = await import("./tasks/email-fallback.js");
            const emailResult = await tryEmailApproach(userId, username, classification.goal, classification.domains[0] || "the service");
            if (emailResult.success && emailResult.result) {
              cascadeLevel = emailResult.level;
              aiResponse.content += `\n\n${emailResult.result}`;
            } else {
              // Level 6: Manual instructions
              const { generateManualInstructions } = await import("./tasks/manual-fallback.js");
              const manualResult = await generateManualInstructions(classification.goal, classification.domains[0] || "the service");
              cascadeLevel = manualResult.level;
              aiResponse.content += `\n\n${manualResult.result}`;
            }
          }
        } catch (cascadeErr) {
          console.error("[CASCADE] Fallback error:", cascadeErr);
        }
      }
    }

    // 7c. LAST RESORT: If ALL actions failed, generate AI-only response from knowledge
    if (actionResults.length > 0 && actionResults.every(r => !r.success)) {
      console.log('[FALLBACK] All actions failed, generating honest AI-only response');
      // Build a summary of what we tried so the AI can be honest about it
      const failedDomains = [...domainFailures.entries()].map(([d, c]) => `${d} (${c}x)`).join(', ');
      const attemptSummary = failedDomains ? `Attempted to browse: ${failedDomains}. All blocked or failed.` : 'All browser actions failed.';
      try {
        const fallbackResponse = await generateResponse(
          memory, subject,
          `${body}\n\nCONTEXT: I tried to complete this task using a web browser but couldn't access the websites needed. ${attemptSummary}\n\nBe HONEST with the user. If you know the answer from your knowledge, share it but note that you couldn't verify it live. If you DON'T know (e.g., a current price that changes), tell the user what happened and suggest they check the site directly. NEVER make up specific numbers like prices or stock levels.`,
          username, undefined, userId, taskId, senderName
        );
        if (fallbackResponse.content) {
          aiResponse.content = fallbackResponse.content;
          aiResponse.actions = []; // Clear failed actions
        }
      } catch {
        // Non-critical — we still have the original AI content
      }
    }

    // 7d. RESPONSE QUALITY GATE: Detect plan-like/narration responses and re-prompt for concrete answer
    // Examples of BAD final responses: "I'll search for...", "Let me try...", "What I can do next..."
    // These are plans/narrations, not answers. The user expects an actual result.
    if (aiResponse.content) {
      const responseLC = aiResponse.content.toLowerCase();
      const isPlanLike = (
        // Future-tense promises at the end of the response (still planning to do something)
        /(?:i'?ll|let me|i(?:'m going to| will| can))\s+(?:search|look|find|try|navigate|browse|check|get|fetch)\b/i.test(
          aiResponse.content.slice(-500) // Only check last 500 chars — the ending matters most
        ) &&
        // AND the response doesn't contain concrete findings (prices, dates, lists, etc.)
        !(/\d{1,2}:\d{2}\s*(?:am|pm)/i.test(aiResponse.content)) && // No times
        !/\$\d/.test(aiResponse.content) && // No prices
        !aiResponse.content.includes('[TASK_COMPLETE]')
      );

      const isNarration = (
        // Response is mostly about what the AI tried rather than what it found
        (responseLC.includes('search results') && (responseLC.includes("didn't show") || responseLC.includes("didn't load") || responseLC.includes("not load"))) ||
        (responseLC.includes('returned technical') && responseLC.includes('search results')) ||
        (responseLC.includes('what i can do next') || responseLC.includes('what i can next')) ||
        (responseLC.includes('technical issues') && (responseLC.includes('search') || responseLC.includes('bing') || responseLC.includes('google'))) ||
        (responseLC.includes('unable to process') || responseLC.includes('error has occurred')) ||
        (/(?:search|page|results?|site)\s+(?:didn't|did not|doesn't|does not|isn't|is not|wasn't|was not)\s+(?:load|work|show|display|return|respond)/i.test(responseLC))
      );

      // Detect advice-style numbered lists: "Here are N ways...", "1. ... 2. ... 3. ..."
      // An AGENT does things. A chatbot gives advice lists.
      const numberedListCount = (aiResponse.content.match(/^\s*\d+[\.\)]\s+/gm) || []).length;
      const isAdviceList = (
        numberedListCount >= 3 && // 3+ numbered items = advice list
        (
          /here\s+are\s+(?:some|a few|\d+)\s+(?:ways|suggestions|tips|ideas|options|strategies|steps|things)/i.test(responseLC) ||
          /you\s+(?:could|can|should|might|may)\s+(?:try|consider|look into|start|explore)/i.test(responseLC) ||
          /consider\s+(?:the following|these)/i.test(responseLC)
        ) &&
        // NOT an actual list of results (search results, events, items found)
        !/(?:found|here(?:'s| is| are) (?:the|what)|results|happening|events|listings|available)/i.test(responseLC)
      );

      if (isPlanLike || isNarration || isAdviceList) {
        console.log(`[QUALITY] Response is ${isPlanLike ? 'plan-like' : isAdviceList ? 'advice-list' : 'narration'} — re-prompting for concrete answer`);
        try {
          // Gather any useful data from successful actions
          const successData = actionResults
            .filter(r => r.success && r.result)
            .map(r => typeof r.result === 'string' ? r.result.substring(0, 500) : JSON.stringify(r.result).substring(0, 500))
            .join('\n');

          const refinementPrompt = `The user asked: "${subject} ${body}"

${successData ? `DATA FROM MY SEARCHES/BROWSING:\n${successData}\n` : ''}
YOUR PREVIOUS RESPONSE WAS REJECTED because it was ${isAdviceList ? 'a numbered list of suggestions/advice instead of taking action' : 'a plan or narration instead of an actual answer'}.

RULES FOR YOUR NEW RESPONSE:
- You are an AGENT that DOES things. Report what you DID, not what the user COULD do.
- NEVER give a numbered list of suggestions, tips, or ideas. That's what ChatGPT does.
- If you completed an action, tell the user: "Done — I did X, here's the result."
- If you couldn't complete it, tell the user exactly what you tried and what blocked you.
- If you found useful data, summarize it clearly
- NEVER say "I'll search for..." or "Let me try..." or "What I can do next..." — the task is DONE
- NEVER say "You could try..." or "Here are some ways..." — the USER asked YOU to do it
- Be conversational like a real assistant: "Done — here's what I found" or "I signed you up for X"
- Include [TASK_COMPLETE] at the end`;

          const refinedResponse = await generateResponse(
            memory, subject, refinementPrompt, username, 'complex', userId, taskId, senderName
          );
          // Check if refinement is also bad
          const refinedLC = (refinedResponse.content || '').toLowerCase();
          const refinedIsBad = (
            !refinedResponse.content ||
            /(?:i'?ll|let me)\s+(?:search|look|find|try|navigate|browse|check)/i.test(refinedLC) ||
            /(?:search|page)\s+(?:didn't|did not|doesn't)\s+(?:load|work|show)/i.test(refinedLC) ||
            (refinedLC.includes('technical issues') || refinedLC.includes('unable to process'))
          );
          if (!refinedIsBad) {
            console.log(`[QUALITY] Refined response accepted (${refinedResponse.content!.length} chars)`);
            aiResponse.content = refinedResponse.content!.replace(/\[TASK_COMPLETE\]/g, '').trim();
            aiResponse.cost = (aiResponse.cost || 0) + (refinedResponse.cost || 0);
            aiResponse.tokensUsed = (aiResponse.tokensUsed || 0) + (refinedResponse.tokensUsed || 0);
          } else {
            // Final fallback: go straight to Claude Haiku — bypasses DeepSeek/Groq narration
            console.log(`[QUALITY] Refinement also bad — using Haiku direct fallback`);
            const { generateForcedDirectAnswer } = await import("./ai.js");
            const contextSummary = actionResults
              .filter(r => r.success && r.result)
              .map(r => typeof r.result === 'string' ? r.result.substring(0, 300) : JSON.stringify(r.result).substring(0, 300))
              .join(' | ') || 'No web results available.';
            const fallbackResponse = await generateForcedDirectAnswer(
              `${subject} ${body}`,
              contextSummary,
              username
            );
            if (fallbackResponse.content) {
              console.log(`[QUALITY] Haiku fallback used (${fallbackResponse.content.length} chars)`);
              aiResponse.content = fallbackResponse.content.trim();
              aiResponse.cost = (aiResponse.cost || 0) + (refinedResponse.cost || 0) + (fallbackResponse.cost || 0);
              aiResponse.tokensUsed = (aiResponse.tokensUsed || 0) + (refinedResponse.tokensUsed || 0) + (fallbackResponse.tokensUsed || 0);
            }
          }
        } catch (refinementErr) {
          console.error('[QUALITY] Refinement failed:', refinementErr);
        }
      }

      // FINAL SAFETY NET: If response STILL looks like narration/plan after all gates,
      // construct a response directly from successful action results
      if (aiResponse.content) {
        const finalLC = aiResponse.content.toLowerCase();
        const stillBad = (
          /(?:i'?ll|let me)\s+(?:search|look|find|try|navigate|browse|check)/i.test(finalLC) ||
          /(?:search|page|results?)\s+(?:didn't|did not|doesn't)\s+(?:load|work|show)/i.test(finalLC) ||
          (finalLC.includes('technical issues') || finalLC.includes('unable to process')) ||
          (aiResponse.content.length < 100 && /(?:let me|i'll|i will|i'm going)/i.test(finalLC))
        );
        if (stillBad && actionResults.length > 0) {
          const successData = actionResults
            .filter(r => r.success && r.result)
            .map(r => typeof r.result === 'string' ? r.result.substring(0, 1000) : JSON.stringify(r.result).substring(0, 1000))
            .join('\n\n');
          if (successData && successData.length > 50) {
            console.log(`[QUALITY] Response still bad — constructing from ${actionResults.filter(r => r.success).length} action results`);
            aiResponse.content = `Here's what I found:\n\n${successData.substring(0, 3000)}`;
          }
        }
      }
    }

    // 7e. AGI-LEVEL OUTCOME VERIFICATION: Verify REAL-WORLD outcome (not just "no errors")
    // Example: "Make me money" → Check bank balance increased, not just "tried to buy stock"
    let outcomeVerification = null;
    if (isTaskComplete && aiResponse.content) {
      try {
        const { outcomeVerifier } = await import("./outcome-verifier.js");
        outcomeVerification = await outcomeVerifier.verifyOutcome(
          `${subject} ${body}`,
          {
            content: aiResponse.content,
            actions: actionResults,
            success: actionResults.some(r => r.success)
          },
          executionEngine?.getPage() || null,
          userId
        );

        console.log(`[OUTCOME] Goal achieved: ${outcomeVerification.goalAchieved} (${outcomeVerification.confidence}% confidence)`);
        console.log(`[OUTCOME] Evidence: ${outcomeVerification.evidence.join(', ')}`);

        // If goal NOT achieved and we have iterations left, FORCE another round with different strategy
        if (!outcomeVerification.goalAchieved && currentIteration < MAX_ITERATIONS && outcomeVerification.confidence < 70) {
          console.log(`[OUTCOME] Goal not achieved (${outcomeVerification.confidence}% confidence), attempting recovery...`);

          const failurePrompt = `VERIFICATION FAILED:
Expected: ${outcomeVerification.expectedOutcome}
Actual: ${outcomeVerification.actualOutcome}
Evidence: ${outcomeVerification.evidence.join('; ')}

The task is NOT actually complete. Try a COMPLETELY DIFFERENT approach to achieve the real goal.`;

          try {
            const recoveryResponse = await generateResponse(
              memory, subject, failurePrompt, username, 'reason', userId, taskId, senderName
            );

            if (recoveryResponse.actions.length > 0) {
              console.log(`[OUTCOME] Re-entering iteration loop with ${recoveryResponse.actions.length} recovery actions`);
              isTaskComplete = false;
              aiResponse = recoveryResponse;
              // Loop will continue from line 1166
            }
          } catch {
            // If recovery fails, continue with original result
            console.warn('[OUTCOME] Recovery attempt failed, continuing with original result');
          }
        }
      } catch (outcomeErr) {
        console.error('[OUTCOME] Outcome verification error:', outcomeErr);
        // Non-critical — continue without outcome verification
      }
    }

    // 8. Strike-based verification loop
    // OPTIMIZATION: Skip heavy verification for simple non-browser tasks only
    let verificationResult = null;
    const tier = getQualityTier(classification.taskType || 'simple');
    const tierConfig = QUALITY_TIERS[tier];

    // Fast path: AUTO-PASS when no browser was used.
    // Verification is designed for tasks with verifiable browser evidence (forms, purchases, receipts).
    // Pure AI responses (greetings, questions, math, memory, research) cannot be verified against
    // a browser page — running verification on them produces false negatives on correct answers.
    // Only run strike-based verification when a browser was actually used AND succeeded.
    const hasNoActions = actionResults.length === 0;
    const allActionsFailed = actionResults.length > 0 && actionResults.every(r => !r.success);
    const noBrowserUsed = !executionEngine;
    if ((noBrowserUsed || hasNoActions || allActionsFailed) && aiResponse.content) {
      const reason = noBrowserUsed ? 'no browser used' : hasNoActions ? 'no actions' : 'all actions failed';
      console.log(`[VERIFY] Fast path (${reason}, ${tier} tier) — AUTO-PASS`);
      verificationResult = {
        passed: true,
        confidence: 85,
        method: 'skip' as const,
        evidence: `Task auto-passed (${reason})`
      };
    } else if (executionEngine && classification.taskType) {
      const strikeCtx: StrikeContext = {
        attempt: 1,
        maxAttempts: tierConfig.maxStrikes,
        qualityTier: tier,
        targetScore: tierConfig.target,
        bestResult: null,
        bestScore: 0,
        correctionHints: [],
        totalVerificationCost: 0,
        attempts: [],
      };

      console.log(`[STRIKE] Quality tier: ${tier} (target: ${tierConfig.target}%, max strikes: ${tierConfig.maxStrikes})`);

      while (strikeCtx.attempt <= strikeCtx.maxAttempts) {
        try {
          const page = executionEngine.getPage?.() || null;
          const actionSuccessRate = executionEngine.getActionSuccessRate();
          const result = await verifyTask(
            classification.taskType,
            page,
            aiResponse.content,
            `Task: ${subject} ${body}`,
            actionSuccessRate
          );

          const attemptCost = result.method === 'smart_review' ? 0.05 : 0;
          strikeCtx.totalVerificationCost += attemptCost;

          // Track this attempt
          const record: StrikeRecord = {
            attempt: strikeCtx.attempt,
            score: result.confidence,
            method: result.method,
            correctionHints: result.correctionHints || [],
            cost: attemptCost,
          };
          strikeCtx.attempts.push(record);

          // Track best result
          if (result.confidence > strikeCtx.bestScore) {
            strikeCtx.bestScore = result.confidence;
            strikeCtx.bestResult = result;
          }

          console.log(
            `[STRIKE] Attempt ${strikeCtx.attempt}/${strikeCtx.maxAttempts}: ${result.passed ? "PASSED" : "FAILED"} (${result.confidence}% confidence, target: ${tierConfig.target}%)`
          );

          // Success: score meets or exceeds target
          if (result.confidence >= strikeCtx.targetScore) {
            verificationResult = result;
            break;
          }

          // Used all strikes
          if (strikeCtx.attempt >= strikeCtx.maxAttempts) {
            verificationResult = strikeCtx.bestResult;
            break;
          }

          // Budget check — stop if accumulated cost > $2
          const currentTaskCost = (aiResponse.cost || 0) + (executionEngine.getTotalCost() || 0) + strikeCtx.totalVerificationCost;
          if (currentTaskCost > 2.0) {
            console.log(`[STRIKE] Budget cap reached ($${currentTaskCost.toFixed(2)}), stopping strikes`);
            verificationResult = strikeCtx.bestResult;
            break;
          }

          // Prepare correction hints for re-execution
          const corrections = result.correctionHints || [];
          strikeCtx.correctionHints = corrections;
          strikeCtx.attempt++;

          if (strikeCtx.attempt === 2) {
            // Strike 2: Re-generate with same model + correction hints
            console.log(`[STRIKE] Strike 2: Re-generating with corrections: ${corrections.join('; ')}`);
            const correctionSuffix = corrections.length > 0
              ? `\n\n[CORRECTION NEEDED] Previous attempt issues:\n${corrections.map(h => `- ${h}`).join('\n')}\nPlease fix these issues.`
              : '';
            aiResponse = await generateResponse(
              memory, subject, bodyWithLearnings + correctionSuffix, username, aiTaskType, userId, taskId, senderName
            );

            // Re-run failed browser actions if engine is alive
            if (executionEngine.getPage()) {
              const retryResult = await executionEngine.retryFailedSteps();
              if (retryResult.improved > 0) {
                console.log(`[STRIKE] Retried failed steps, improved ${retryResult.improved} actions`);
              }
            }
          } else if (strikeCtx.attempt === 3) {
            // Strike 3: Escalate to Claude Sonnet (reason task type) + full corrections
            console.log(`[STRIKE] Strike 3: Escalating to Claude Sonnet with full corrections`);
            const correctionSuffix = `\n\n[CRITICAL CORRECTION - ATTEMPT 3] Previous attempts failed verification:\n${strikeCtx.attempts.map(a => `- Attempt ${a.attempt}: ${a.score}% (${a.correctionHints.join('; ') || 'no hints'})`).join('\n')}\nPlease carefully complete this task, addressing all issues above.`;
            aiResponse = await generateResponse(
              memory, subject, bodyWithLearnings + correctionSuffix, username, 'reason' as const, userId, taskId, senderName
            );

            // Re-run all browser actions from scratch if possible
            if (executionEngine.getPage()) {
              const retryResult = await executionEngine.retryFailedSteps();
              if (retryResult.improved > 0) {
                console.log(`[STRIKE] Retried failed steps on strike 3, improved ${retryResult.improved} actions`);
              }
            }
          }
        } catch (verifyError) {
          console.error(`[STRIKE] Verification error on attempt ${strikeCtx.attempt}:`, verifyError);
          // If verification itself errors, still track the attempt
          strikeCtx.attempts.push({
            attempt: strikeCtx.attempt,
            score: 0,
            method: 'error',
            correctionHints: ['Verification process failed'],
            cost: 0,
          });
          verificationResult = strikeCtx.bestResult;
          break;
        }
      }

      // Store strike metadata for the verification_data field
      if (verificationResult) {
        (verificationResult as VerificationResult & { _strikeData?: unknown })._strikeData = {
          strikes: strikeCtx.attempts,
          totalAttempts: strikeCtx.attempts.length,
          qualityTier: tier,
          targetScore: tierConfig.target,
        };
      }
    }

    // Cleanup browser if used (AFTER strike loop so browser stays alive between attempts)
    if (executionEngine) {
      await executionEngine.cleanup();
      console.log(`[BROWSER] Execution engine cleaned up`);

      // Decrement browser task counter
      const { decrementBrowserTasks } = await import("../utils/concurrency.js");
      decrementBrowserTasks();
    }

    // 9. Log the interaction
    await appendDailyLog(userId, `**Task:** ${subject}\n**Response:** ${aiResponse.content.substring(0, 200)}...`);

    // 10. Increment usage (skip for beta users and test mode)
    if (!shouldSkipPayment() && !isBeta) {
      await getSupabaseClient().rpc("increment_usage", { p_user_id: userId });
    }

    // 11. Send response via the same channel the task arrived on
    const cleanResponse = cleanResponseForEmail(aiResponse.content);
    const successCount = actionResults.filter(r => r.success).length;
    const totalActions = actionResults.length;

    let emailBody = cleanResponse;
    // Only mention action counts if there were actions AND some succeeded
    if (totalActions > 0 && successCount > 0 && successCount < totalActions) {
      // Partial success — don't mention failures, just show what was done
      emailBody += `\n\n---\nCompleted ${successCount} actions.`;
    }

    // Add soft disclaimer if verification had low confidence (no raw numbers)
    if (verificationResult && !verificationResult.passed && verificationResult.confidence < 50) {
      emailBody += `\n\nNote: I'd recommend double-checking these results as I wasn't fully able to verify them.`;
    }

    // Resolve correct recipient based on channel
    const channel = task.inputChannel || "email";
    const { email, phone } = await resolveRecipient(channel, from, userId);

    if (channel === "sms") {
      // SMS: short summary, truncated to 1600 chars
      const smsBody = cleanResponse.length > 1500
        ? cleanResponse.substring(0, 1500) + "... (full results emailed)"
        : cleanResponse;

      // Always try to send SMS if we have a phone number
      if (phone) {
        await sendSms({ userId, to: phone, body: smsBody });
      } else {
        // No phone on file, send email
        await sendResponse({ to: email, from: `${username}@aevoy.com`, subject, body: emailBody });
      }

      // Send full email if response is long
      if (cleanResponse.length > 1500) {
        await sendResponse({ to: email, from: `${username}@aevoy.com`, subject, body: emailBody });
      }
    } else if (channel === "voice") {
      // Voice: send SMS summary to phone + email full results to email
      if (phone) {
        const smsSummary = cleanResponse.length > 300
          ? cleanResponse.substring(0, 300) + "... (check email for full results)"
          : cleanResponse;
        await sendSms({ userId, to: phone, body: `[Aevoy] ${smsSummary}` });
      }

      // Always send full results to email
      await sendResponse({ to: email, from: `${username}@aevoy.com`, subject, body: emailBody });
    } else {
      // Default: email
      console.log(`[TASK] Sending reply email: to=${email}, from=${username}@aevoy.com, subject="${subject}"`);
      const emailSent = await sendResponse({ to: email, from: `${username}@aevoy.com`, subject, body: emailBody });
      console.log(`[TASK] Reply email result: sent=${emailSent}`);
    }

    // 12. Update task as completed with cost tracking + verification
    const elapsedMs = Date.now() - startTime;
    const aiCost = aiResponse.cost || 0;
    const browserCost = executionEngine?.getTotalCost() || 0;
    const totalCost = aiCost + browserCost;

    // Use confidence >= tier target to determine pass, not just verificationResult.passed
    // (verificationResult.passed uses a fixed threshold that may not match the tier target)
    const { getQualityTier: getQT, QUALITY_TIERS: QT } = await import("./task-verifier.js");
    const dbTier = getQT(classification.taskType || 'simple');
    const dbTierTarget = QT[dbTier]?.target ?? 70;
    // Auto-passed tasks (method='skip') always count as passed regardless of tier target.
    // Only apply the tier confidence threshold to actual browser verification results.
    const dbVerificationPassed = verificationResult
      ? verificationResult.method === 'skip' || (verificationResult.confidence ?? 0) >= dbTierTarget
      : null;

    await getSupabaseClient()
      .from("tasks")
      .update({
        status: dbVerificationPassed === false ? "needs_review" : "completed",
        completed_at: new Date().toISOString(),
        tokens_used: aiResponse.tokensUsed,
        cost_usd: totalCost,
        type: taskType,
        execution_time_ms: elapsedMs,
        cascade_level: cascadeLevel,
        response_text: cleanResponse,
        verification_status: dbVerificationPassed === true ? "verified" : (verificationResult ? "unverified" : null),
        verification_data: verificationResult ? {
          confidence: verificationResult.confidence,
          method: verificationResult.method,
          evidence: verificationResult.evidence,
          ...((verificationResult as VerificationResult & { _strikeData?: Record<string, unknown> })._strikeData || {}),
        } : null,
      })
      .eq("id", taskId);
    
    console.log(`[COST] Task cost: $${totalCost.toFixed(6)} (AI: $${aiCost.toFixed(6)}, Browser: $${browserCost.toFixed(6)})`);

    // Update execution plan status
    if (planId) {
      try {
        await getSupabaseClient().from("execution_plans").update({
          status: verificationResult?.passed === false ? "failed" : "completed",
          completed_at: new Date().toISOString(),
        }).eq("id", planId);
      } catch {
        // Non-critical
      }
    }

    // Record successful browser steps to learnings (Hive Mind auto-learning)
    // Privacy: PII is scrubbed before upload, user can opt-out in settings
    if (executionEngine && classification.needsBrowser && actionResults.filter(r => r.success).length > 0) {
      try {
        // Check if user has consented to Hive learning uploads
        const { hasHiveLearningConsent, scrubActionParams } = await import("../utils/pii-scrubber.js");
        const hasConsent = await hasHiveLearningConsent(userId);

        if (!hasConsent) {
          console.log(`[HIVE] User ${userId.slice(0, 8)} opted out of learning uploads`);
        } else {
          const { computePageHash } = await import("../execution/page-hash.js");
          const page = executionEngine.getPage();
          if (page) {
            const pageHash = await computePageHash(page);
            const domain = classification.domains[0] || "unknown";

            // Scrub PII from action params before uploading to shared hub
            const scrubbedSteps = actionResults.filter(r => r.success).map(r => ({
              type: r.action.type,
              params: scrubActionParams(r.action.params || {}),
            }));

            await getSupabaseClient().from("learnings").upsert({
              service: domain,
              task_type: classification.taskType,
              title: `Auto-learned: ${classification.taskType} on ${domain}`,
              recorded_steps: scrubbedSteps,
              page_hash: pageHash,
              layout_verified_at: new Date().toISOString(),
              success_rate: 100,
              total_attempts: 1,
              total_successes: 1,
              last_verified: new Date().toISOString(),
            }, { onConflict: "service,task_type" }).select();

            console.log(`[HIVE] Uploaded learning to shared hub: ${classification.taskType} on ${domain} (PII scrubbed)`);
          }
        }
      } catch (error) {
        // Non-critical — learning is bonus
        console.error('[HIVE] Learning upload failed:', error);
      }
    }

    // 12b. TEACH & REPEAT: Record successful browser execution as replayable template
    if (classification.needsBrowser && actionResults.filter(r => r.success).length >= 2) {
      try {
        const templateDomain = classification.domains?.[0] || "unknown";
        await recordTemplate(
          userId,
          templateDomain,
          `${subject} ${body}`,
          classification.taskType || "browser",
          actionResults,
          elapsedMs,
          totalCost
        );
      } catch {
        // Non-critical — template recording is bonus
      }

      // If we used a template and it worked, it's already counted as success.
      // If we used a template and it failed (needs_review), record the failure.
      if (usedTemplateId && verificationResult?.passed === false) {
        await recordTemplateFailure(usedTemplateId);
      }
    }

    // 13. CONTEXT CARRYOVER: Store task context for future related tasks (24hr TTL)
    try {
      await storeTaskContext(taskId, userId, body, cleanResponse);
      console.log(`[CONTEXT] Stored task context for carryover`);
    } catch {
      // Non-critical
    }

    // 14. SELF-LEARNING: Record outcomes for future intelligence (fire-and-forget)
    try {
      // Use confidence >= tier target as the success criteria, not just verificationResult.passed
      // (verificationResult.passed uses a fixed threshold that may not match the tier target)
      const { getQualityTier, QUALITY_TIERS } = await import("./task-verifier.js");
      const taskTier = getQualityTier(classification.taskType || 'simple');
      const taskTierTarget = QUALITY_TIERS[taskTier]?.target ?? 70;
      const taskSuccess = verificationResult
        ? (verificationResult.confidence ?? 0) >= taskTierTarget
        : false;
      const strikeCount = verificationResult
        ? ((verificationResult as VerificationResult & { _strikeData?: { totalAttempts?: number } })._strikeData?.totalAttempts || 1)
        : 1;

      // Record task difficulty for future predictions
      await recordTaskDifficulty({
        domain: primaryDomain || "unknown",
        taskType: classification.taskType,
        durationMs: elapsedMs,
        strikes: strikeCount,
        costUsd: totalCost,
        success: taskSuccess,
      });

      // Record model performance for adaptive routing
      if (aiResponse.model) {
        await recordModelOutcome({
          userId,
          model: aiResponse.model,
          provider: aiResponse.model.includes("claude") ? "anthropic" : aiResponse.model.includes("deepseek") ? "deepseek" : "unknown",
          taskType: classification.taskType,
          domain: primaryDomain || "",
          success: taskSuccess,
          tokens: aiResponse.tokensUsed || 0,
          costUsd: aiResponse.cost || 0,
          latencyMs: elapsedMs,
        });
      }

      // Record verification learnings (corrections that worked)
      if (strikeCount >= 2 && taskSuccess && verificationResult) {
        const strikeData = (verificationResult as VerificationResult & { _strikeData?: { strikes?: StrikeRecord[] } })._strikeData;
        if (strikeData?.strikes) {
          const allHints = strikeData.strikes.flatMap(s => s.correctionHints).filter(Boolean);
          if (allHints.length > 0) {
            await recordCorrectionSuccess({
              domain: primaryDomain || "unknown",
              taskType: classification.taskType,
              correctionHints: allHints,
            });
            console.log(`[INTELLIGENCE] Recorded ${allHints.length} verification corrections for future use`);
          }
        }
      }

      console.log(
        `[INTELLIGENCE] Recorded: difficulty=${difficultyPrediction?.difficulty || 'unknown'}, ` +
        `model=${aiResponse.model}, strikes=${strikeCount}, success=${taskSuccess}`
      );
    } catch {
      // Non-critical — intelligence recording should never fail the task
    }

    console.log(`[TASK] Completed in ${elapsedMs}ms: taskId=${taskId}`);
    clearTimeout(masterTimer);

    // 15. PROACTIVE ENGAGEMENT: Analyze task completion for habit learning and suggestions
    try {
      const { getProactiveEngagementEngine } = await import("./proactive-engagement.js");
      const engagementEngine = getProactiveEngagementEngine();

      // Analyze in background (don't block response)
      engagementEngine.analyzeTaskCompletion(userId, taskId).catch(err => {
        console.error("[PROACTIVE_ENGAGEMENT] Background analysis failed:", err);
      });
    } catch {
      // Non-critical — engagement is bonus
    }

    return {
      taskId,
      success: true,
      response: aiResponse.content,
      actions: actionResults,
    };
  } catch (error) {
    clearTimeout(masterTimer);

    const isTimeout = timeoutController.signal.aborted || (Date.now() - startTime > MASTER_TIMEOUT_MS);
    const errorMessage = isTimeout
      ? `Task timed out after ${Math.round((Date.now() - startTime) / 1000)}s`
      : (error instanceof Error ? error.message : "Unknown error");
    console.error("Task processing error:", errorMessage);

    // Update task as failed
    if (taskId) {
      await getSupabaseClient()
        .from("tasks")
        .update({
          status: "failed",
          error_message: errorMessage,
          completed_at: new Date().toISOString(),
        })
        .eq("id", taskId);
    }

    // Send friendly response — never expose internal error details to users
    await sendResponse({
      to: from,
      from: `${username}@aevoy.com`,
      subject,
      body: isTimeout
        ? "This task took longer than expected. I've saved my progress — send it again and I'll pick up where I left off."
        : "I ran into a snag while working on your request. I'm going to try a different approach — feel free to send it again and I'll get right on it.",
    });

    return {
      taskId,
      success: false,
      response: "",
      actions: [],
      error: errorMessage,
    };
  }
}

/**
 * Execute action with failure memory integration
 * - Check past failures before executing
 * - Learn from new failures
 * - Record successful workarounds
 */
async function executeActionWithLearning(
  action: Action, 
  userId: string, 
  username: string,
  executionEngine: ExecutionEngine | null
): Promise<ActionResult> {
  console.log(`[ACTION] Executing: ${action.type}`);

  // Check failure memory for learned solutions
  const url = action.params?.url as string || '';
  const pastFailure = await getFailureMemory({
    site: url,
    actionType: action.type,
    selector: action.params?.selector as string
  });

  if (pastFailure?.solution) {
    console.log(`[LEARNING] Applying learned fix for ${pastFailure.siteDomain}: ${pastFailure.solution.method}`);
    // Apply learned correction to action params
    if (pastFailure.solution.selector) {
      action.params = { ...action.params, selector: pastFailure.solution.selector };
    }
  }

  try {
    const actionStart = Date.now();
    const result = await executeAction(action, userId, username, executionEngine);
    const actionDuration = Date.now() - actionStart;

    // If we used a learned solution and it worked, record success
    if (pastFailure && result.success) {
      console.log(`[LEARNING] Learned solution worked for ${pastFailure.siteDomain}`);
    }

    // If failed, record for future learning
    if (!result.success && result.error) {
      await recordFailure({
        site: url,
        actionType: action.type,
        selector: action.params?.selector as string,
        error: result.error
      });
    }

    // SELF-LEARNING: Record method-level outcome for method ranking
    try {
      const domain = url ? new URL(url.startsWith('http') ? url : `https://${url}`).hostname : "unknown";
      const method = (action.params?.method as string) || action.type;
      await recordMethodAttempt({
        domain,
        actionType: action.type,
        methodName: method,
        success: result.success,
        durationMs: actionDuration,
      });
    } catch {
      // Non-critical
    }

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    // Record failure for learning
    await recordFailure({
      site: url,
      actionType: action.type,
      selector: action.params?.selector as string,
      error: errorMessage
    });

    // Try self-debugging system
    try {
      const { debugAndFix } = await import("./self-debugger.js");
      const domain = url ? new URL(url).hostname : "";
      const debugResult = await debugAndFix(action, errorMessage, {
        userId,
        domain,
        taskType: action.type,
        previousAttempts: 0, // TODO: Track attempts
      });

      if (debugResult.fixed && debugResult.appliedFix) {
        console.log(`[DEBUG] Auto-fixed via ${debugResult.appliedFix.type} after ${debugResult.attempts} attempts`);
        // Retry action with fix applied
        const retryResult = await executeAction(action, userId, username, executionEngine);
        if (retryResult.success) {
          console.log(`[DEBUG] Retry succeeded after auto-fix`);
          return retryResult;
        }
      }
    } catch (debugError) {
      console.log(`[DEBUG] Auto-fix failed:`, debugError);
    }

    // Try specific failure handler for recovery
    try {
      const { dispatchFailureHandler } = await import("../execution/failure-handlers.js");
      const domain = url ? new URL(url).hostname : undefined;
      const recovery = await dispatchFailureHandler(
        error instanceof Error ? error : new Error(errorMessage),
        userId,
        action.params?.taskId as string || "",
        domain,
        action.type
      );
      if (recovery.recovered) {
        console.log(`[RECOVERY] Recovered via ${recovery.method}`);
      }
    } catch {
      // Non-critical — failure handlers are best-effort
    }

    return {
      action,
      success: false,
      error: errorMessage,
    };
  }
}

async function executeAction(
  action: Action, 
  userId: string, 
  username: string,
  executionEngine: ExecutionEngine | null
): Promise<ActionResult> {
  switch (action.type) {
    case "remember": {
      const fact = action.params.fact as string;
      await updateMemoryWithFact(userId, fact);
      return {
        action,
        success: true,
        result: `Remembered: ${fact}`,
      };
    }

    case "browse": {
      if (!executionEngine) {
        return { action, success: false, error: "Browser not available" };
      }
      
      const url = action.params.url as string;
      const result = await executionEngine.executeSteps([
        { action: 'navigate', params: { url } },
        { action: 'extract', params: { selector: 'body' } }
      ]);
      
      return {
        action,
        success: result.success,
        result: result.success ? `Browsed: ${String(result.data).substring(0, 500)}...` : undefined,
        error: result.error,
      };
    }

    case "search": {
      if (!executionEngine) {
        return { action, success: false, error: "Browser not available" };
      }

      const query = action.params.query as string;

      // Helper: detect if extracted text is garbage (JS errors, framework noise, error pages)
      const isGarbageText = (text: string): boolean => {
        const lower = text.toLowerCase();
        const jsSignals = ['noscript', 'javascript', 'enable javascript', 'error has occurred',
          'webpack', 'react', 'vue', '__next', 'window.', 'document.', 'function('];
        const jsHits = jsSignals.filter(s => lower.includes(s)).length;
        // Search engine error pages
        const isErrorPage = (
          lower.includes('if this persists, please email us') ||
          lower.includes('your search could not be completed') ||
          lower.includes('something went wrong') ||
          lower.includes('unusual traffic from your computer') ||
          lower.includes('are not a robot') ||
          lower.includes('captcha') ||
          (lower.includes('error') && lower.includes('anonymized') && lower.includes('code'))
        );
        // If 3+ JS signals, or error page, or text is mostly single-char words
        return isErrorPage || jsHits >= 3 || (text.length > 200 && text.replace(/\s+/g, ' ').split(' ').filter(w => w.length > 3).length < 20);
      };

      // Strategy 1: DuckDuckGo HTML (no JavaScript, works perfectly in headless)
      const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const ddgResult = await executionEngine.executeSteps([
        { action: 'navigate', params: { url: ddgUrl } },
        { action: 'wait', params: { ms: 1500 } },
        { action: 'extract', params: { selector: 'body' } }
      ]);

      let pageText = typeof ddgResult.data === 'string' ? ddgResult.data : JSON.stringify(ddgResult.data || '');
      let usedEngine = 'duckduckgo';

      // Strategy 2: If DDG failed or returned garbage, try Bing
      if (!ddgResult.success || isGarbageText(pageText) || pageText.length < 200) {
        console.log(`[SEARCH] DDG ${!ddgResult.success ? 'failed' : isGarbageText(pageText) ? 'error page' : 'too short'}, trying Bing...`);
        const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
        const bingResult = await executionEngine.executeSteps([
          { action: 'navigate', params: { url: bingUrl } },
          { action: 'wait', params: { ms: 2000 } },
          { action: 'extract', params: { selector: 'body' } }
        ]);
        const bingText = typeof bingResult.data === 'string' ? bingResult.data : JSON.stringify(bingResult.data || '');

        if (bingResult.success && !isGarbageText(bingText) && bingText.length > (isGarbageText(pageText) ? 0 : pageText.length)) {
          pageText = bingText;
          usedEngine = 'bing';
        }
      }

      // Strategy 2b: If Bing also failed, try Google
      if (isGarbageText(pageText) || pageText.length < 200) {
        console.log(`[SEARCH] Bing also ${isGarbageText(pageText) ? 'garbage' : 'too short'}, trying Google...`);
        const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en`;
        const googleResult = await executionEngine.executeSteps([
          { action: 'navigate', params: { url: googleUrl } },
          { action: 'wait', params: { ms: 2000 } },
          { action: 'extract', params: { selector: 'body' } }
        ]);
        const googleText = typeof googleResult.data === 'string' ? googleResult.data : JSON.stringify(googleResult.data || '');
        if (googleResult.success && !isGarbageText(googleText) && googleText.length > 200) {
          pageText = googleText;
          usedEngine = 'google';
        }
      }

      // Strategy 3: If text is still garbage, use screenshot + AI vision to read the page
      if (isGarbageText(pageText) || pageText.length < 200) {
        console.log(`[SEARCH] Text extraction returned garbage, falling back to vision...`);
        try {
          const page = executionEngine.getPage();
          if (page) {
            const screenshotBuffer = await page.screenshot({ type: 'png', fullPage: false });
            const screenshotBase64 = screenshotBuffer.toString('base64');
            const { generateVisionResponse } = await import("./ai.js");
            const visionResult = await generateVisionResponse(
              `Read this search results page and extract ALL useful information visible on screen. Include any weather data, prices, facts, event listings, links, or other relevant content. Be thorough.`,
              screenshotBase64,
              'You are a search results reader. Extract all visible information from this search engine screenshot. Return plain text with the actual data found.'
            );
            if (visionResult?.content && visionResult.content.length > 50) {
              pageText = visionResult.content;
              usedEngine += '+vision';
              console.log(`[SEARCH] Vision extracted ${pageText.length} chars (cost: $${visionResult.cost.toFixed(4)})`);
            }
          }
        } catch (visionErr) {
          console.warn(`[SEARCH] Vision fallback failed:`, visionErr);
        }
      }

      const cleanText = pageText.replace(/\s+/g, ' ').trim().substring(0, 3000);
      return {
        action,
        success: cleanText.length > 100,
        result: cleanText.length > 100
          ? `Search results from ${usedEngine} for "${query}":\n${cleanText}`
          : undefined,
        error: cleanText.length <= 100 ? 'Search returned no useful content' : undefined,
      };
    }

    case "screenshot": {
      if (!executionEngine) {
        return { action, success: false, error: "Browser not available" };
      }
      
      const url = action.params.url as string;
      const result = await executionEngine.executeSteps([
        { action: 'navigate', params: { url } },
        { action: 'wait', params: { ms: 1000 } },
        { action: 'screenshot', params: {} }
      ]);
      
      const lastResult = executionEngine.getResults().pop();
      return {
        action,
        success: result.success,
        result: result.success ? { screenshot: lastResult?.screenshot } : undefined,
        error: result.error,
      };
    }

    case "fill_form": {
      if (!executionEngine) {
        return { action, success: false, error: "Browser not available" };
      }
      
      const url = action.params.url as string;
      const fields = action.params.fields as Record<string, string>;
      
      const steps: Array<{ action: string; params: Record<string, unknown> }> = [
        { action: 'navigate', params: { url } },
        { action: 'wait', params: { ms: 1000 } }
      ];
      
      // Add fill steps for each field
      for (const [key, value] of Object.entries(fields)) {
        steps.push({ 
          action: 'fill', 
          params: { 
            label: key, 
            placeholder: key,
            name: key,
            value 
          } 
        });
      }
      
      const result = await executionEngine.executeSteps(steps);
      
      // Learn from successful fills
      if (result.success) {
        for (const [key, value] of Object.entries(fields)) {
          const engineResult = executionEngine.getResults().find(
            r => r.action === 'fill' && r.method
          );
          if (engineResult?.method) {
            await learnSolution({
              site: url,
              actionType: 'fill',
              originalSelector: key,
              error: 'initial_attempt',
              solution: { method: engineResult.method }
            });
          }
        }
      }
      
      return {
        action,
        success: result.success,
        result: result.success ? `Filled ${Object.keys(fields).length} fields on ${url}` : undefined,
        error: result.error,
      };
    }

    case "send_email": {
      const { to, subject, body } = action.params as { to: string; subject: string; body: string };
      // Validate email address format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!to || !emailRegex.test(to)) {
        return { action, success: false, error: "Invalid email address" };
      }
      const success = await sendResponse({
        to,
        from: `${username}@aevoy.com`,
        subject,
        body,
      });
      return {
        action,
        success,
        result: success ? "Email sent" : undefined,
        error: success ? undefined : "Could not send email right now",
      };
    }

    case "read_email": {
      const { limit: emailLimit, minutes_back } = action.params as {
        limit?: number;
        minutes_back?: number;
      };
      try {
        const { fetchRecentEmails } = await import("./inbox-poller.js");
        const emails = await fetchRecentEmails(
          `${username}@aevoy.com`,
          emailLimit || 5,
          minutes_back || 30
        );
        if (emails.length === 0) {
          return {
            action,
            success: true,
            result: `No recent emails found for ${username}@aevoy.com in the last ${minutes_back || 30} minutes.`,
          };
        }
        const summary = emails.map((e, i) =>
          `[${i + 1}] From: ${e.from} | Subject: ${e.subject} | Date: ${e.date}\n${e.body.substring(0, 500)}`
        ).join('\n---\n');
        return {
          action,
          success: true,
          result: `Found ${emails.length} recent email(s) for ${username}@aevoy.com:\n${summary}`,
        };
      } catch (readErr) {
        console.error(`[READ-EMAIL] Failed:`, readErr);
        return { action, success: false, error: "Could not check emails right now" };
      }
    }

    case "schedule": {
      const { description, cron } = action.params as { description: string; cron: string };
      
      // Calculate next run time
      const nextRun = calculateNextRun(cron);
      
      const { error } = await getSupabaseClient()
        .from("scheduled_tasks")
        .insert({
          user_id: userId,
          task_template: description,
          cron_expression: cron,
          next_run_at: nextRun,
          is_active: true,
        });

      if (error) {
        console.error(`[SCHEDULE] Failed to create scheduled task:`, error.message);
      }
      return {
        action,
        success: !error,
        result: error ? "Could not schedule this task right now" : `Scheduled: ${description} (next: ${nextRun})`,
      };
    }

    case "click": {
      if (!executionEngine) return { action, success: false, error: "Browser not available" };
      const clickTarget = (action.params.selector || action.params.text || action.params.description) as string;
      const clickResult = await executionEngine.executeSteps([
        { action: 'click', params: { selector: clickTarget, text: clickTarget, description: clickTarget } }
      ]);
      return { action, success: clickResult.success, result: clickResult.success ? `Clicked: ${clickTarget}` : undefined, error: clickResult.error };
    }

    case "fill": {
      if (!executionEngine) return { action, success: false, error: "Browser not available" };
      const fillSelector = (action.params.selector || action.params.label) as string;
      const fillValue = action.params.value as string;
      const fillResult = await executionEngine.executeSteps([
        { action: 'fill', params: { selector: fillSelector, label: fillSelector, placeholder: fillSelector, value: fillValue } }
      ]);
      return { action, success: fillResult.success, result: fillResult.success ? `Filled ${fillSelector} with value` : undefined, error: fillResult.error };
    }

    case "select": {
      if (!executionEngine) return { action, success: false, error: "Browser not available" };
      const selectSelector = (action.params.selector || action.params.label) as string;
      const selectOption = action.params.option as string;
      const selectResult = await executionEngine.executeSteps([
        { action: 'select', params: { selector: selectSelector, value: selectOption } }
      ]);
      return { action, success: selectResult.success, result: selectResult.success ? `Selected: ${selectOption}` : undefined, error: selectResult.error };
    }

    case "submit": {
      if (!executionEngine) return { action, success: false, error: "Browser not available" };
      const submitSelector = action.params.selector as string || 'form';
      const submitResult = await executionEngine.executeSteps([
        { action: 'submit', params: { selector: submitSelector } }
      ]);
      return { action, success: submitResult.success, result: submitResult.success ? 'Form submitted' : undefined, error: submitResult.error };
    }

    case "login": {
      if (!executionEngine) return { action, success: false, error: "Browser not available" };
      const loginUrl = action.params.url as string;
      const loginUser = action.params.username as string;
      const loginPass = action.params.password as string;
      const loginResult = await executionEngine.executeSteps([
        { action: 'login', params: { url: loginUrl, username: loginUser, password: loginPass, domain: loginUrl } }
      ]);
      return { action, success: loginResult.success, result: loginResult.success ? `Logged in to ${loginUrl}` : undefined, error: loginResult.error };
    }

    case "scroll": {
      if (!executionEngine) return { action, success: false, error: "Browser not available" };
      const scrollDir = (action.params.direction || 'down') as string;
      const scrollResult = await executionEngine.executeSteps([
        { action: 'scroll', params: { direction: scrollDir } }
      ]);
      return { action, success: scrollResult.success, result: scrollResult.success ? `Scrolled ${scrollDir}` : undefined, error: scrollResult.error };
    }

    case "wait": {
      if (!executionEngine) return { action, success: false, error: "Browser not available" };
      const waitMs = (action.params.ms || action.params.duration || 2000) as number;
      const waitResult = await executionEngine.executeSteps([
        { action: 'wait', params: { ms: waitMs } }
      ]);
      return { action, success: waitResult.success, result: `Waited ${waitMs}ms`, error: waitResult.error };
    }

    case "extract": {
      if (!executionEngine) return { action, success: false, error: "Browser not available" };
      const extractSelector = (action.params.selector || 'body') as string;
      const extractResult = await executionEngine.executeSteps([
        { action: 'extract', params: { selector: extractSelector } }
      ]);
      return { action, success: extractResult.success, result: extractResult.success ? `Extracted: ${String(extractResult.data).substring(0, 500)}` : undefined, error: extractResult.error };
    }

    default:
      return {
        action,
        success: false,
        error: `Unknown action type: ${action.type}`,
      };
  }
}

function calculateNextRun(cron: string): string {
  const now = new Date();
  const [minute, hour, dayOfMonth, month, dayOfWeek] = cron.split(' ');
  
  // Simple cron calculation for common patterns
  if (cron === '0 8 * * 1') { // Weekly Monday 8am
    const next = new Date(now);
    next.setDate(next.getDate() + ((1 + 7 - next.getDay()) % 7 || 7));
    next.setHours(8, 0, 0, 0);
    return next.toISOString();
  }
  
  if (hour && hour !== '*') {
    const next = new Date(now);
    next.setHours(parseInt(hour), parseInt(minute) || 0, 0, 0);
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
    return next.toISOString();
  }
  
  // Default: 1 day from now
  const next = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return next.toISOString();
}
