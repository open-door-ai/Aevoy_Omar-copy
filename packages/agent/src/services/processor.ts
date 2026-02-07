/**
 * Task Processor
 * 
 * Orchestrates task processing with security, execution engine, and failure learning.
 * Includes confirmation flow for unclear tasks based on user settings.
 */

import { loadMemory, appendDailyLog, updateMemoryWithFact } from "./memory.js";
import { generateResponse, cleanResponseForEmail, classifyTask, checkUserBudget } from "./ai.js";
import { sendResponse, sendErrorEmail, sendOverQuotaEmail, sendProgressEmail, sendConfirmationEmail, sendTaskAccepted, sendTaskCancelled } from "./email.js";
import { sendSms } from "./twilio.js";
import { createLockedIntent, getTaskTypeFromClassification, validateAction } from "../security/intent-lock.js";
import { ActionValidator } from "../security/validator.js";
import { ExecutionEngine } from "../execution/engine.js";
import { getFailureMemory, recordFailure, learnSolution } from "../memory/failure-db.js";
import { clarifyTask, formatConfirmationMessage, parseConfirmationReply, parseCardCommand, getUserSettings, type ClarifiedTask } from "./clarifier.js";
import { verifyTask, quickVerify, getQualityTier, QUALITY_TIERS } from "./task-verifier.js";
import { detectWorkflow, createWorkflow } from "./workflow.js";
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

/**
 * Send a message back to the user via the same channel they used.
 * SMS/voice channels get SMS replies; email/web/other get email replies.
 * Falls back to email if SMS delivery fails or no phone number on file.
 */
async function sendViaChannel(
  channel: InputChannel | undefined,
  userId: string,
  to: string,
  aevoyFrom: string,
  subject: string,
  body: string
): Promise<void> {
  if (channel === "sms" || channel === "voice") {
    try {
      const { data: profile } = await getSupabaseClient()
        .from("profiles")
        .select("twilio_number")
        .eq("id", userId)
        .single();
      if (profile?.twilio_number) {
        const smsBody = body.length > 1500
          ? body.substring(0, 1500) + "... (full results emailed)"
          : body;
        await sendSms({ userId, to, body: smsBody });
        return;
      }
    } catch {
      // Fall through to email
    }
  }
  await sendResponse({ to, from: aevoyFrom, subject, body });
}

// ---- Test Mode / Payment Skip ----
function isTestMode(): boolean {
  return process.env.TEST_MODE === "true" || process.env.NODE_ENV === "development";
}

function shouldSkipPayment(): boolean {
  return process.env.SKIP_PAYMENT_CHECKS === "true" || isTestMode();
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
    
    await sendErrorEmail(from, `${username}@aevoy.com`, subject, errorMessage);
    
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
    await sendErrorEmail(from, `${username}@aevoy.com`, "Agent Card", errorMessage);
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
  let taskId = task.taskId || "";
  const startTime = Date.now();

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
          console.log(`[DECOMPOSITION] Execution order: ${executionOrder.length} waves (parallel within wave)`);
          // Note: Full decomposition execution would require recursive processTask calls
          // For now, just log the plan — future: execute subtasks sequentially/parallel
        }
      } catch {
        // Non-critical — decomposition is optimization, not required
      }
    }

    // 5f. Create execution plan
    let planId: string | null = null;
    let plan: import("../types/index.js").ExecutionPlan | null = null;
    try {
      const { createPlan } = await import("./planner.js");
      plan = await createPlan(userId, taskId, classification, memory, learningsHint);

      // Store plan in DB
      const { data: planRecord } = await getSupabaseClient().from("execution_plans").insert({
        task_id: taskId,
        user_id: userId,
        plan_steps: plan.steps,
        execution_method: plan.method,
        approved: true,
        status: "executing",
        estimated_cost: plan.estimatedCost,
        started_at: new Date().toISOString(),
      }).select("id").single();
      planId = planRecord?.id || null;

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

        // Build response from API results
        const resultText = apiResults.map(r =>
          r.success ? `Done: ${JSON.stringify(r.result)}` : `Failed: ${r.error}`
        ).join("\n");

        // Update task record
        await getSupabaseClient().from("tasks").update({
          status: allSuccess ? "completed" : "failed",
          completed_at: new Date().toISOString(),
          execution_time_ms: Date.now() - startTime,
          cost_usd: plan.estimatedCost,
        }).eq("id", taskId);

        const responseText = allSuccess
          ? `Done! ${resultText}`
          : `I completed some steps but ran into issues:\n${resultText}`;

        await sendViaChannel(task.inputChannel, userId, from, `${username}@aevoy.com`, `Re: ${subject}`, responseText);
        return { taskId, success: allSuccess, response: responseText, actions: [] };
      }
    } catch (planError) {
      console.warn("[PLANNER] Planning failed, using direct path:", planError);
      plan = null;
    }

    // 6. Generate AI response (use cheapest model if over budget)
    const aiTaskType = forceCheapModel ? "validate" as const : undefined;
    const bodyWithLearnings = learningsHint ? `${body}${learningsHint}` : body;
    let aiResponse = await generateResponse(memory, subject, bodyWithLearnings, username, aiTaskType, userId, taskId);

    // 7. Parse and execute actions with security validation
    const actionResults: ActionResult[] = [];
    let executionEngine: ExecutionEngine | null = null;

    // Check if we need browser for any action
    const needsBrowser = aiResponse.actions.some(a =>
      ['browse', 'search', 'screenshot', 'fill_form'].includes(a.type)
    );

    if (needsBrowser && classification.needsBrowser) {
      // Initialize execution engine for browser tasks
      // Browserbase handles session persistence natively via Contexts API (always signed in)
      // Local Playwright fallback still uses domain allowlist for manual cookie persistence
      executionEngine = new ExecutionEngine(lockedIntent);

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

      await executionEngine.initialize(userId, domain || undefined);
      console.log(`[BROWSER] Execution engine initialized`);

      // Log Live View URL availability
      const liveViewUrl = executionEngine.getLiveViewUrl();
      if (liveViewUrl) {
        console.log(`[BROWSER] Live View URL available for user interaction`);
      }
    }

    // Send progress update for long tasks (include Live View link if available)
    if (aiResponse.actions.length > 3) {
      const liveViewUrl = executionEngine?.getLiveViewUrl();
      let progressMsg = `Working on your request. Processing ${aiResponse.actions.length} actions...`;
      if (liveViewUrl) {
        progressMsg += `\n\nWatch live: ${liveViewUrl}\nOpen this link on any device to see what I'm doing in real time.`;
      }
      await sendProgressEmail(from, `${username}@aevoy.com`, subject, progressMsg);
    }
    
    for (let actionIndex = 0; actionIndex < aiResponse.actions.length; actionIndex++) {
      // Per-task budget check: stop if accumulated cost exceeds $2
      const taskCostSoFar = actionResults.reduce((sum, r) => sum + ((r.result && typeof r.result === "object" && "cost" in r.result ? (r.result as Record<string, unknown>).cost as number : 0) || 0), 0) + (aiResponse.cost || 0);
      if (taskCostSoFar > 2.0) {
        console.warn(`[BUDGET] Task cost exceeded $2 (${taskCostSoFar.toFixed(4)}), stopping execution`);
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
        actionResults.push({
          action,
          success: false,
          error: `Security: ${validation.reason}`
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
      if (!result.success && result.error && !result.error.startsWith('Security:')) {
        console.log(`[RETRY] Action '${action.type}' failed, retrying in 3s...`);
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

      actionResults.push(result);

      // Checkpoint: save progress after each successful action
      if (result.success && taskId) {
        try {
          await getSupabaseClient()
            .from("tasks")
            .update({ checkpoint_data: { lastActionIndex: actionIndex, completedActions: actionIndex + 1 } })
            .eq("id", taskId);
        } catch {
          // Non-critical
        }
      }

      // Send progress update every 3 successful actions
      if (actionIndex > 0 && actionIndex % 3 === 0 && result.success) {
        try {
          const { sendProgressUpdate } = await import("./progress.js");
          await sendProgressUpdate(userId, taskId, task.inputChannel || "email",
            `Completed ${actionIndex + 1}/${aiResponse.actions.length} actions...`);
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

    // 7b. Beyond-browser cascade if browser success rate is low
    let cascadeLevel = 1;
    if (classification.needsBrowser && actionResults.length > 0) {
      const successCount = actionResults.filter(r => r.success).length;
      const successRate = successCount / actionResults.length;

      if (successRate < 0.7) {
        console.log(`[CASCADE] Browser success rate ${(successRate * 100).toFixed(0)}%, trying fallbacks`);
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

    // 8. Strike-based verification loop
    let verificationResult = null;
    const tier = getQualityTier(classification.taskType || 'simple');
    const tierConfig = QUALITY_TIERS[tier];

    if (executionEngine && classification.taskType) {
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
              memory, subject, bodyWithLearnings + correctionSuffix, username, aiTaskType, userId, taskId
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
              memory, subject, bodyWithLearnings + correctionSuffix, username, 'reason' as const, userId, taskId
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
    } else if (aiResponse.content) {
      // Quick verify for non-browser tasks
      try {
        verificationResult = await quickVerify(
          classification.taskType || "research",
          aiResponse.content
        );
      } catch {
        // Non-critical — continue
      }
    }

    // Cleanup browser if used (AFTER strike loop so browser stays alive between attempts)
    if (executionEngine) {
      await executionEngine.cleanup();
      console.log(`[BROWSER] Execution engine cleaned up`);
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
    if (totalActions > 0) {
      emailBody += `\n\n---\nCompleted ${successCount}/${totalActions} actions.`;
    }

    // Add disclaimer if verification failed or had low confidence
    if (verificationResult && !verificationResult.passed && verificationResult.confidence < 50) {
      emailBody += `\n\n⚠️ Note: I wasn't fully able to verify this task completed successfully (confidence: ${verificationResult.confidence}%). Please double-check the results.`;
    }

    const channel = task.inputChannel || "email";
    if (channel === "sms") {
      // SMS: short summary, truncated to 1600 chars
      const smsBody = cleanResponse.length > 1500
        ? cleanResponse.substring(0, 1500) + "... (full results emailed)"
        : cleanResponse;
      try {
        const { data: profile } = await getSupabaseClient()
          .from("profiles")
          .select("twilio_number")
          .eq("id", userId)
          .single();
        if (profile?.twilio_number) {
          await sendSms({ userId, to: from, body: smsBody });
        } else {
          // No phone on file, fall back to email
          await sendResponse({ to: from, from: `${username}@aevoy.com`, subject, body: emailBody });
        }
      } catch {
        await sendResponse({ to: from, from: `${username}@aevoy.com`, subject, body: emailBody });
      }
      // Always send full results by email too if response is long
      if (cleanResponse.length > 1500) {
        await sendResponse({ to: from, from: `${username}@aevoy.com`, subject, body: emailBody });
      }
    } else if (channel === "voice") {
      // Voice: send SMS summary + email full results
      try {
        const { data: profile } = await getSupabaseClient()
          .from("profiles")
          .select("twilio_number")
          .eq("id", userId)
          .single();
        const smsSummary = cleanResponse.length > 300
          ? cleanResponse.substring(0, 300) + "... (check email for full results)"
          : cleanResponse;
        if (profile?.twilio_number) {
          await sendSms({ userId, to: from, body: `[Aevoy] ${smsSummary}` });
        }
      } catch {
        // Non-critical
      }
      await sendResponse({ to: from, from: `${username}@aevoy.com`, subject, body: emailBody });
    } else {
      // Default: email
      await sendResponse({ to: from, from: `${username}@aevoy.com`, subject, body: emailBody });
    }

    // 12. Update task as completed with cost tracking + verification
    const elapsedMs = Date.now() - startTime;
    const aiCost = aiResponse.cost || 0;
    const browserCost = executionEngine?.getTotalCost() || 0;
    const totalCost = aiCost + browserCost;

    await getSupabaseClient()
      .from("tasks")
      .update({
        status: verificationResult?.passed === false ? "needs_review" : "completed",
        completed_at: new Date().toISOString(),
        tokens_used: aiResponse.tokensUsed,
        cost_usd: totalCost,
        type: taskType,
        execution_time_ms: elapsedMs,
        cascade_level: cascadeLevel,
        verification_status: verificationResult?.passed ? "verified" : (verificationResult ? "unverified" : null),
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
    if (executionEngine && classification.needsBrowser && actionResults.filter(r => r.success).length > 0) {
      try {
        const { computePageHash } = await import("../execution/page-hash.js");
        const page = executionEngine.getPage();
        if (page) {
          const pageHash = await computePageHash(page);
          const domain = classification.domains[0] || "unknown";
          await getSupabaseClient().from("learnings").upsert({
            service: domain,
            task_type: classification.taskType,
            title: `Auto-learned: ${classification.taskType} on ${domain}`,
            recorded_steps: actionResults.filter(r => r.success).map(r => ({
              type: r.action.type,
              params: r.action.params,
            })),
            page_hash: pageHash,
            layout_verified_at: new Date().toISOString(),
            success_rate: 100,
            total_attempts: 1,
            total_successes: 1,
            last_verified: new Date().toISOString(),
          }, { onConflict: "service,task_type" }).select();
        }
      } catch {
        // Non-critical — learning is bonus
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
      const taskSuccess = verificationResult?.passed !== false;
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

    return {
      taskId,
      success: true,
      response: aiResponse.content,
      actions: actionResults,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
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

    // Send generic error email — never expose internal error details to users
    await sendErrorEmail(from, `${username}@aevoy.com`, subject, "Something went wrong processing your task. Please try again or contact support.");

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
      const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=web`;
      
      const result = await executionEngine.executeSteps([
        { action: 'navigate', params: { url: searchUrl } },
        { action: 'wait', params: { ms: 2000 } },
        { action: 'extract', params: { selector: 'body' } }
      ]);
      
      return {
        action,
        success: result.success,
        result: result.success ? `Search results: ${String(result.data).substring(0, 1000)}` : undefined,
        error: result.error,
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
        result: success ? "Email sent" : "Failed to send email",
      };
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

      return {
        action,
        success: !error,
        result: error ? `Failed: ${error.message}` : `Scheduled: ${description} (next: ${nextRun})`,
      };
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
