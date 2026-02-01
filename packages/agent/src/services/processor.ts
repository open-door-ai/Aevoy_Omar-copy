/**
 * Task Processor
 * 
 * Orchestrates task processing with security, execution engine, and failure learning.
 * Includes confirmation flow for unclear tasks based on user settings.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { loadMemory, appendDailyLog, updateMemoryWithFact } from "./memory.js";
import { generateResponse, cleanResponseForEmail, classifyTask } from "./ai.js";
import { sendResponse, sendErrorEmail, sendOverQuotaEmail, sendProgressEmail, sendConfirmationEmail, sendTaskAccepted, sendTaskCancelled } from "./email.js";
import { createLockedIntent, getTaskTypeFromClassification, validateAction } from "../security/intent-lock.js";
import { ActionValidator } from "../security/validator.js";
import { ExecutionEngine } from "../execution/engine.js";
import { getFailureMemory, recordFailure, learnSolution } from "../memory/failure-db.js";
import { clarifyTask, formatConfirmationMessage, parseConfirmationReply, parseCardCommand, getUserSettings, type ClarifiedTask } from "./clarifier.js";
import type { TaskRequest, TaskResult, Action, ActionResult } from "../types/index.js";

let supabase: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      process.env.SUPABASE_SERVICE_ROLE_KEY || ""
    );
  }
  return supabase;
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
    if (!isBeta && profile && profile.messages_used >= profile.messages_limit) {
      await sendOverQuotaEmail(from, `${username}@aevoy.ai`, subject);
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
        `${username}@aevoy.ai`,
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
      await sendTaskAccepted(from, `${username}@aevoy.ai`, clarified.structuredIntent.goal);
      
      // Process the task in full (this handles the actual execution)
      return processTask({ ...task, taskId });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("processIncomingTask error:", errorMessage);
    
    await sendErrorEmail(from, `${username}@aevoy.ai`, subject, errorMessage);
    
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
        from: `${username}@aevoy.ai`,
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
      
      await sendTaskCancelled(from, `${username}@aevoy.ai`, task.email_subject);

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
        from: `${username}@aevoy.ai`,
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
    from: `${username}@aevoy.ai`,
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
            from: `${username}@aevoy.ai`,
            subject: "Agent Card Balance",
            body: "You don't have an agent card set up yet. Visit your settings to create one!",
          });
        } else {
          await sendResponse({
            to: from,
            from: `${username}@aevoy.ai`,
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
          from: `${username}@aevoy.ai`,
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
          from: `${username}@aevoy.ai`,
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
            from: `${username}@aevoy.ai`,
            subject: "Agent Card",
            body: "Please specify an amount to add, like: 'Add $50 to my card'",
          });
        } else {
          const result = await fundAgentCard(userId, command.amount);
          await sendResponse({
            to: from,
            from: `${username}@aevoy.ai`,
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
    await sendErrorEmail(from, `${username}@aevoy.ai`, "Agent Card", errorMessage);
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

    // Allow beta users unlimited access
    const isBeta = profile?.subscription_status === 'beta';
    if (!isBeta && profile && profile.messages_used >= profile.messages_limit) {
      await sendOverQuotaEmail(from, `${username}@aevoy.ai`, subject);
      return {
        taskId: "",
        success: false,
        response: "Over quota",
        actions: [],
        error: "User is over their message quota",
      };
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

    console.log(`[SECURITY] Intent locked: ${taskType} for ${username}`);
    console.log(`[SECURITY] Allowed actions: ${lockedIntent.allowedActions.join(', ')}`);

    // 4. Create action validator
    const validator = new ActionValidator(lockedIntent);

    // 5. Load user's memory
    const memory = await loadMemory(userId);

    // 6. Generate AI response
    const aiResponse = await generateResponse(memory, subject, body, username);

    // 7. Parse and execute actions with security validation
    const actionResults: ActionResult[] = [];
    let executionEngine: ExecutionEngine | null = null;
    
    // Check if we need browser for any action
    const needsBrowser = aiResponse.actions.some(a => 
      ['browse', 'search', 'screenshot', 'fill_form'].includes(a.type)
    );

    if (needsBrowser && classification.needsBrowser) {
      // Initialize execution engine for browser tasks
      executionEngine = new ExecutionEngine(lockedIntent);
      await executionEngine.initialize();
      console.log(`[BROWSER] Execution engine initialized for ${username}`);
    }

    // Send progress update for long tasks
    if (aiResponse.actions.length > 3) {
      await sendProgressEmail(from, `${username}@aevoy.ai`, subject, 
        `Working on your request. Processing ${aiResponse.actions.length} actions...`);
    }
    
    for (const action of aiResponse.actions) {
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
      const result = await executeActionWithLearning(
        action, 
        userId, 
        username, 
        executionEngine
      );
      actionResults.push(result);
    }

    // Cleanup browser if used
    if (executionEngine) {
      await executionEngine.cleanup();
      console.log(`[BROWSER] Execution engine cleaned up`);
    }

    // 8. Log the interaction
    await appendDailyLog(userId, `**Task:** ${subject}\n**Response:** ${aiResponse.content.substring(0, 200)}...`);

    // 9. Increment usage (skip for beta users)
    if (!isBeta) {
      await getSupabaseClient().rpc("increment_usage", { p_user_id: userId });
    }

    // 10. Send response email
    const cleanResponse = cleanResponseForEmail(aiResponse.content);
    const successCount = actionResults.filter(r => r.success).length;
    const totalActions = actionResults.length;
    
    let emailBody = cleanResponse;
    if (totalActions > 0) {
      emailBody += `\n\n---\n✅ Completed ${successCount}/${totalActions} actions.`;
    }

    await sendResponse({
      to: from,
      from: `${username}@aevoy.ai`,
      subject,
      body: emailBody,
    });

    // 11. Update task as completed with cost tracking
    const elapsedMs = Date.now() - startTime;
    const aiCost = aiResponse.cost || 0;
    const browserCost = executionEngine?.getTotalCost() || 0;
    const totalCost = aiCost + browserCost;
    
    await getSupabaseClient()
      .from("tasks")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        tokens_used: aiResponse.tokensUsed,
        cost_usd: totalCost,
        type: taskType,
        execution_time_ms: elapsedMs
      })
      .eq("id", taskId);
    
    console.log(`[COST] Task cost: $${totalCost.toFixed(6)} (AI: $${aiCost.toFixed(6)}, Browser: $${browserCost.toFixed(6)})`);

    console.log(`[TASK] Completed in ${elapsedMs}ms: ${subject.substring(0, 50)}`);

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

    // Send error email
    await sendErrorEmail(from, `${username}@aevoy.ai`, subject, errorMessage);

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
  console.log(`[ACTION] Executing: ${action.type}`, action.params);

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
    const result = await executeAction(action, userId, username, executionEngine);
    
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
      const success = await sendResponse({
        to,
        from: `${username}@aevoy.ai`,
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
