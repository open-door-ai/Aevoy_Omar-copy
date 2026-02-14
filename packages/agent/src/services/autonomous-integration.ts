/**
 * Autonomous Workflow Integration
 *
 * Detects complex tasks that require autonomous planning and execution.
 * Integrates with the existing processor.ts without breaking changes.
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
import type { TaskRequest, TaskResult } from "../types/index.js";

/**
 * Detect if a task requires autonomous workflow planning.
 * Returns true for complex, multi-step goals like "go get customers", "research and create report", etc.
 */
export function requiresAutonomousPlanning(subject: string, body: string): boolean {
  const combined = `${subject} ${body}`.toLowerCase();

  // Patterns that indicate complex, multi-step autonomous goals
  const autonomousPatterns = [
    /go get (me )?(customers|clients|users|leads|sales)/,
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
  ];

  const hasAutonomousPattern = autonomousPatterns.some(p => p.test(combined));

  // Also check for complexity indicators
  const complexityIndicators = [
    /then/,           // Sequential steps: "do X then Y"
    /after/,          // Sequential: "after X, do Y"
    /once/,           // Conditional: "once X is done, Y"
    /if .+ then/,     // Conditional logic
    /for each/,       // Iteration
    /\d+ (times|people|companies|items)/, // Scale/iteration
  ];

  const hasComplexity = complexityIndicators.filter(p => p.test(combined)).length >= 2;

  // Length-based heuristic: tasks >300 chars describing steps are likely complex
  const isLongDescription = body.length > 300;

  const isAutonomous = hasAutonomousPattern || (hasComplexity && isLongDescription);

  if (isAutonomous) {
    console.log(`[AUTONOMOUS] Detected autonomous task: hasPattern=${hasAutonomousPattern}, hasComplexity=${hasComplexity}, long=${isLongDescription}`);
  }

  return isAutonomous;
}

/**
 * Handle autonomous workflow execution from start to finish.
 * Returns a TaskResult with the full workflow outcome.
 */
export async function handleAutonomousWorkflow(task: TaskRequest): Promise<TaskResult> {
  const { userId, username, from, subject, body } = task;
  let taskId = task.taskId;

  console.log(`[AUTONOMOUS] Starting autonomous workflow for user ${username}`);

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
