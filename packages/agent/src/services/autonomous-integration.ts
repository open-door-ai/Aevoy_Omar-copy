/**
 * Autonomous Workflow Integration
 *
 * Detects complex tasks that require autonomous planning and execution.
 * Integrates AGI-level executor for never-fail, multi-threaded execution.
 */

import crypto from "crypto";
import {
  planAutonomousWorkflow,
  executeWorkflowStep,
  getWorkflowExecutionOrder,
  formatClarificationMessage,
  parseClarificationResponse,
  incorporateClarifications,
  type WorkflowPlan,
  type WorkflowStepResult,
  type WorkflowStep,
} from "./autonomous-workflow.js";
import { loadMemory } from "./memory.js";
import { sendResponse } from "./email.js";
import { getSupabaseClient } from "../utils/supabase.js";
import { createAGIExecutor } from "./agi-executor.js";
import { createRecursiveAGI } from "./agi-recursive.js";
import { MultiUserBrowserService } from "./multi-user-browser.js";
import type { TaskRequest, TaskResult } from "../types/index.js";

/**
 * Detect if a task requires autonomous workflow planning.
 * Returns true for complex, multi-step goals like "go get customers", "make money", "create an image", etc.
 *
 * AGI-Level Detection: Catches vague, high-level goals that require creative problem-solving.
 */
export function requiresAutonomousPlanning(subject: string, body: string | undefined): boolean {
  const combined = `${subject ?? ''} ${body ?? ''}`.toLowerCase();

  // AGI-LEVEL PATTERNS: Vague goals that require breaking down and trying multiple approaches
  const agiPatterns = [
    // Revenue generation (e.g., "make money")
    /make (me )?(money|profit|revenue|income)/,
    /earn (money|income)/,
    /generate (revenue|income|profit)/,
    /start (a )?(business|side hustle)/,

    // Customer acquisition (e.g., "get me customers")
    /go get (me )?(customers|clients|users|leads|sales)/,
    /find (me )?(customers|clients|users)/,
    /get (me )?(customers|sales|clients)/,
    /(acquire|bring in|attract) customers/,

    // Content/media creation (e.g., "make an image")
    /(create|make|generate|design) (an? )?(image|picture|photo|graphic|logo)/,
    /(create|make|generate|write) (an? )?(video|animation)/,
    /(create|make|generate|compose) (music|audio|sound)/,

    // Complex multi-step tasks
    /find (and )?(contact|reach out to|email)/,
    /research .+ and (create|build|make|write)/,
    /build (me )?(a )?(customer|lead|prospect) (list|database)/,
    /run (a )?(campaign|outreach|marketing)/,
    /organize my (inbox|email|files|documents)/,
    /automate .+ (process|workflow|task)/,
    /schedule \d+ .+ (calls|meetings|interviews)/,
    /apply to \d+ (jobs|positions|companies)/,
    /create (a )?(detailed|comprehensive) (report|analysis|summary)/,
    /monitor .+ and (notify|alert|report)/,
    /set up (automated|recurring|scheduled)/,

    // Service discovery (e.g., "find a tool to do X")
    /find (a )?(tool|service|app|platform) (to|for)/,
    /recommend (a )?(tool|service|app)/,
    /what (tool|service|app) (can|should)/,

    // Account/access management
    /create (an? )?account/,
    /sign (me )?up (for|on)/,
    /register (me )?(for|on)/,
    /(request|get|obtain) access/,
  ];

  const hasAGIPattern = agiPatterns.some(p => p.test(combined));

  // Also check for complexity indicators
  const complexityIndicators = [
    /then/,           // Sequential steps: "do X then Y"
    /after/,          // Sequential: "after X, do Y"
    /once/,           // Conditional: "once X is done, Y"
    /if .+ then/,     // Conditional logic
    /for each/,       // Iteration
    /while waiting/,  // Parallel execution
    /\d+ (times|people|companies|items)/, // Scale/iteration
  ];

  const hasComplexity = complexityIndicators.filter(p => p.test(combined)).length >= 2;

  // Length-based heuristic: tasks >300 chars describing steps are likely complex
  const isLongDescription = (body ?? '').length > 300;

  const isAutonomous = hasAGIPattern || (hasComplexity && isLongDescription);

  if (isAutonomous) {
    console.log(`[AGI] Detected AGI-level task: hasPattern=${hasAGIPattern}, hasComplexity=${hasComplexity}, long=${isLongDescription}`);
  }

  return isAutonomous;
}

/**
 * Handle autonomous workflow execution from start to finish.
 * Routes to AGI executor for true AGI-level tasks, or standard workflow for complex multi-step tasks.
 */
export async function handleAutonomousWorkflow(task: TaskRequest): Promise<TaskResult> {
  const { userId, username, from, subject, body } = task;
  let taskId = task.taskId;

  console.log(`[AGI] Starting autonomous workflow for user ${username}`);

  // Detect if this is a true AGI-level task (vague, requires discovery & creativity)
  const combined = `${subject} ${body}`.toLowerCase();
  const isAGILevel =
    /make (money|profit|income)/.test(combined) ||
    /(get|find).+(customers|clients)/.test(combined) ||
    /(create|make|generate).+(image|picture|video)/.test(combined) ||
    /find.+(tool|service)/.test(combined) ||
    /start.+(business|hustle)/.test(combined);

  // AGI-LEVEL EXECUTION: Use recursive self-sufficient executor
  if (isAGILevel) {
    console.log('[RECURSIVE-AGI] Routing to recursive AGI (never-stop, self-sufficient)');

    try {
      // Create or update task record
      if (!taskId) {
        const { data: taskRecord } = await getSupabaseClient()
          .from("tasks")
          .insert({
            user_id: userId,
            status: "processing",
            email_subject: subject,
            input_text: body,
            type: "agi_recursive",
            started_at: new Date().toISOString(),
          })
          .select()
          .single();

        taskId = taskRecord?.id;
        if (!taskId) {
          throw new Error("Failed to create task record");
        }
      }

      // Get user's email for notifications
      const { data: profile } = await getSupabaseClient()
        .from("profiles")
        .select("email")
        .eq("id", userId)
        .single();

      const userEmail = profile?.email || from;

      // Initialize browser (may be VPS or local Playwright)
      const browser = new MultiUserBrowserService(userId);
      const page = await browser.init();

      // Create RECURSIVE AGI executor (never stops, generates own resources)
      const executor = createRecursiveAGI(userId, userEmail, browser);

      // Execute the goal (will run until achieved, no matter how long)
      const result = await executor.execute(`${subject} ${body}`);

      // Update task record
      await getSupabaseClient()
        .from("tasks")
        .update({
          status: result.success ? "completed" : "failed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", taskId);

      // Send results to user
      const resultMessage = result.success
        ? `Mission accomplished! 🎯\n\n${result.completed}/${result.totalTasks} tasks completed\n\n${result.results.map((r: any) => `✅ ${r.goal}\n   ${JSON.stringify(r.results)}`).join('\n\n')}`
        : `I hit some challenges:\n\n${result.errors.map((e: any) => `❌ ${e.goal}: ${e.error}`).join('\n\n')}\n\nCompleted: ${result.completed}/${result.totalTasks} tasks`;

      await sendResponse({
        to: userEmail,
        from: `${username}@aevoy.com`,
        subject: `Re: ${subject}`,
        body: resultMessage,
      });

      // Clean up browser
      await browser.close();

      return {
        taskId: taskId || "",
        success: result.success,
        response: resultMessage,
        actions: [],
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[AGI] Executor error:', errorMsg);

      await sendResponse({
        to: from,
        from: `${username}@aevoy.com`,
        subject: `Re: ${subject}`,
        body: "I ran into an issue, but I'm learning from it. Let me try a different approach — send your request again.",
      });

      return {
        taskId: taskId || "",
        success: false,
        response: "",
        actions: [],
        error: errorMsg,
      };
    }
  }

  // STANDARD WORKFLOW EXECUTION: Use existing workflow planner
  try {
    // 1. Load user memory
    const memory = await loadMemory(userId);

    // 2. Plan the workflow
    console.log('[AUTONOMOUS] Planning workflow...');
    let plan = await planAutonomousWorkflow(`${subject} ${body}`, userId, memory);

    // 3. Create or update task record with workflow flag
    if (!taskId) {
      const { data: taskRecord } = await getSupabaseClient()
        .from("tasks")
        .insert({
          user_id: userId,
          status: plan.canAutoExecute ? "processing" : "awaiting_clarification",
          email_subject: subject,
          input_text: body,
          type: "autonomous_workflow",
          started_at: new Date().toISOString(),
        })
        .select()
        .single();

      taskId = taskRecord?.id;
      if (!taskId) {
        throw new Error("Failed to create task record");
      }
    }

    if (!taskId) {
      throw new Error("taskId is required");
    }

    // 4. If clarification needed, send questions and pause
    if (!plan.canAutoExecute && plan.clarificationQuestions.length > 0) {
      console.log(`[AUTONOMOUS] Need ${plan.clarificationQuestions.length} clarifications`);

      const clarificationMsg = formatClarificationMessage(plan);

      await sendResponse({
        to: from,
        from: `${username}@aevoy.com`,
        subject: `Re: ${subject}`,
        body: clarificationMsg,
      });

      // Store plan in DB for later continuation
      await getSupabaseClient()
        .from("tasks")
        .update({
          structured_intent: {
            workflow_plan: plan,
            awaiting_clarification: true,
          },
        })
        .eq("id", taskId);

      return {
        taskId: taskId || "",
        success: true,
        response: "Awaiting clarification for autonomous workflow",
        actions: [],
      };
    }

    // 5. Execute workflow steps
    console.log(`[AUTONOMOUS] Executing ${plan.steps.length} workflow steps...`);

    const executionOrder = getWorkflowExecutionOrder(plan.steps);
    const results = new Map<string, WorkflowStepResult>();
    let totalCost = 0;

    for (let waveIdx = 0; waveIdx < executionOrder.length; waveIdx++) {
      const wave = executionOrder[waveIdx];
      console.log(`[AUTONOMOUS] Wave ${waveIdx + 1}/${executionOrder.length}: ${wave.length} step(s)`);

      // Execute wave steps (parallel if non-blocking, sequential if blocking)
      const blockingSteps = wave.filter(s => s.isBlocking);
      const nonBlockingSteps = wave.filter(s => !s.isBlocking);

      // Execute blocking steps sequentially
      for (const step of blockingSteps) {
        const result = await executeWorkflowStep(step, {
          userId,
          username,
          email: from,
          memory,
          previousResults: results,
        });

        results.set(step.id, result);
        totalCost += result.cost;

        console.log(`[AUTONOMOUS] Step ${step.id}: ${result.success ? 'SUCCESS' : 'FAILED'}${result.error ? ` (${result.error})` : ''}`);

        // Update task progress
        await getSupabaseClient()
          .from("tasks")
          .update({
            progress_message: `Completed: ${step.description}`,
            progress_step: results.size,
            progress_total: plan.steps.length,
          })
          .eq("id", taskId);

        // If a blocking step fails, stop the workflow
        if (!result.success) {
          console.error(`[AUTONOMOUS] Blocking step ${step.id} failed, stopping workflow`);

          await getSupabaseClient()
            .from("tasks")
            .update({
              status: "failed",
              completed_at: new Date().toISOString(),
              cost_usd: totalCost,
            })
            .eq("id", taskId);

          await sendResponse({
            to: from,
            from: `${username}@aevoy.com`,
            subject: `Re: ${subject}`,
            body: `I encountered a problem while working on your task:\n\nStep: ${step.description}\nError: ${result.error}\n\nCompleted ${results.size - 1} of ${plan.steps.length} steps so far. Let me try a different approach — feel free to send your request again.`,
          });

          return {
            taskId: taskId || crypto.randomUUID(),
            success: false,
            response: `Workflow failed at step: ${step.description}`,
            actions: [],
            error: result.error,
          };
        }
      }

      // Execute non-blocking steps in parallel (if any)
      if (nonBlockingSteps.length > 0) {
        const nonBlockingPromises = nonBlockingSteps.map(step =>
          executeWorkflowStep(step, {
            userId,
            username,
            email: from,
            memory,
            previousResults: results,
          })
        );

        const nonBlockingResults = await Promise.all(nonBlockingPromises);

        for (let i = 0; i < nonBlockingSteps.length; i++) {
          const step = nonBlockingSteps[i];
          const result = nonBlockingResults[i];
          results.set(step.id, result);
          totalCost += result.cost;

          console.log(`[AUTONOMOUS] Step ${step.id} (non-blocking): ${result.success ? 'SUCCESS' : 'FAILED'}`);
        }
      }
    }

    // 6. Compile final report
    const successfulSteps = Array.from(results.values()).filter(r => r.success);
    const failedSteps = Array.from(results.values()).filter(r => !r.success);

    console.log(`[AUTONOMOUS] Workflow complete: ${successfulSteps.length}/${plan.steps.length} steps succeeded`);

    const allSuccess = failedSteps.length === 0;

    // Build detailed results summary
    const stepSummaries = Array.from(results.entries())
      .map(([stepId, result]) => {
        const step = plan.steps.find(s => s.id === stepId);
        const status = result.success ? '✅' : '❌';
        const output = typeof result.output === 'string'
          ? result.output.substring(0, 300)
          : JSON.stringify(result.output).substring(0, 300);

        return `${status} ${step?.description || stepId}\n   ${output}${result.error ? `\n   Error: ${result.error}` : ''}`;
      })
      .join('\n\n');

    const finalMessage = allSuccess
      ? `Mission accomplished! Here's what I completed:\n\n${stepSummaries}\n\nTotal cost: $${totalCost.toFixed(4)}`
      : `I completed ${successfulSteps.length} of ${plan.steps.length} steps:\n\n${stepSummaries}\n\nTotal cost: $${totalCost.toFixed(4)}`;

    // Update task record
    await getSupabaseClient()
      .from("tasks")
      .update({
        status: allSuccess ? "completed" : "partial_failure",
        completed_at: new Date().toISOString(),
        cost_usd: totalCost,
        execution_time_ms: Date.now() - (results.size > 0 ? Math.min(...Array.from(results.values()).map(r => r.startTime)) : Date.now()),
      })
      .eq("id", taskId);

    // Send final report to user
    await sendResponse({
      to: from,
      from: `${username}@aevoy.com`,
      subject: `Re: ${subject}`,
      body: finalMessage,
    });

    return {
      taskId: taskId || "",
      success: allSuccess,
      response: finalMessage,
      actions: [],
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[AUTONOMOUS] Workflow error:', errorMsg);

    // Send friendly error message
    await sendResponse({
      to: from,
      from: `${username}@aevoy.com`,
      subject: `Re: ${subject}`,
      body: "I ran into an issue while planning your workflow. Let me try a simpler approach — feel free to send your request again.",
    });

    return {
      taskId: taskId || "",
      success: false,
      response: "",
      actions: [],
      error: errorMsg,
    };
  }
}

/**
 * Handle clarification response for autonomous workflows.
 * Continues the workflow after user provides missing info.
 */
export async function handleAutonomousClarification(
  task: TaskRequest,
  clarificationText: string
): Promise<TaskResult> {
  const { userId, username, from, subject } = task;
  const taskId = task.taskId || "";

  console.log('[AUTONOMOUS] Handling clarification response');

  try {
    // 1. Retrieve stored plan from task record
    const { data: taskRecord } = await getSupabaseClient()
      .from("tasks")
      .select("structured_intent, input_text")
      .eq("id", taskId)
      .single();

    if (!taskRecord?.structured_intent?.workflow_plan) {
      throw new Error("No workflow plan found in task record");
    }

    const storedPlan = taskRecord.structured_intent.workflow_plan as WorkflowPlan;
    const originalInput = (taskRecord as { input_text?: string }).input_text || '';

    // 2. Parse user's answers
    const answers = parseClarificationResponse(clarificationText);
    console.log(`[AUTONOMOUS] Parsed ${answers.size} answers from clarification`);

    // 3. Incorporate answers into plan
    const updatedPlan = await incorporateClarifications(storedPlan, answers, userId);

    // 4. Update task record
    await getSupabaseClient()
      .from("tasks")
      .update({
        status: "processing",
        structured_intent: {
          workflow_plan: updatedPlan,
          awaiting_clarification: false,
        },
        input_text: `${originalInput}\n\nClarifications:\n${clarificationText}`,
      })
      .eq("id", taskId);

    // 5. Continue with workflow execution
    return handleAutonomousWorkflow({
      ...task,
      body: originalInput,
      taskId: taskId || "",
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[AUTONOMOUS] Clarification handling error:', errorMsg);

    await sendResponse({
      to: from,
      from: `${username}@aevoy.com`,
      subject: `Re: ${subject}`,
      body: "I had trouble processing your clarifications. Could you try rephrasing your answers?",
    });

    return {
      taskId: taskId || "",
      success: false,
      response: "",
      actions: [],
      error: errorMsg,
    };
  }
}
