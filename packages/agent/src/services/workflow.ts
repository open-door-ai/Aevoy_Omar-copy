/**
 * Workflow Engine
 *
 * Handles complex multi-step autonomous projects.
 * A workflow is a project broken into sequential/parallel steps,
 * each step executed as a regular task with full security + verification.
 *
 * Flow: Detect → Gather → Plan → Execute Steps → Monitor → Complete
 */

import { generateResponse, classifyTask } from "./ai.js";
import { loadMemory } from "./memory.js";
import { sendResponse, sendProgressEmail } from "./email.js";
import { getSupabaseClient } from "../utils/supabase.js";
// NOTE: processTask is imported dynamically in executeNextStep() to avoid
// circular dependency (processor.ts imports from workflow.ts).
import type { TaskRequest, TaskResult } from "../types/index.js";

interface WorkflowStep {
  title: string;
  description: string;
  actionType: "task" | "research" | "call" | "email" | "wait" | "decision" | "purchase";
  dependencies: number[]; // step numbers that must complete first
  inputData?: Record<string, unknown>;
}

interface WorkflowPlan {
  title: string;
  steps: WorkflowStep[];
  estimatedSteps: number;
  gatheringQuestions?: string[];
}

/**
 * Detect whether a task should be treated as a workflow (multi-step project)
 * rather than a single task.
 */
export async function detectWorkflow(
  subject: string,
  body: string
): Promise<{ isWorkflow: boolean; reason: string }> {
  const text = `${subject} ${body}`.toLowerCase();

  // Pattern matching for multi-step indicators
  const workflowIndicators = [
    /project.?manag/i,
    /step.?by.?step/i,
    /manage.*(?:building|renovation|construction|launch|migration)/i,
    /plan and (?:execute|build|create|launch)/i,
    /research.*(?:and|then).*(?:buy|book|order|hire|call|negotiate)/i,
    /find.*(?:best|cheapest|multiple).*(?:and|then)/i,
    /compare.*(?:and|then).*(?:choose|buy|book)/i,
    /(?:trade|invest|portfolio).*(?:stocks?|crypto|options)/i,
    /organize.*(?:event|wedding|party|move|trip)/i,
    /(?:10|20|50|100|thousand|hundreds).*(?:questions?|tasks?|items?|calls?)/i,
    /autonomous/i,
    /(?:entire|whole|full|complete).*(?:project|process|workflow)/i,
  ];

  const matchCount = workflowIndicators.filter((r) => r.test(text)).length;

  if (matchCount >= 1) {
    return {
      isWorkflow: true,
      reason: `Detected multi-step project pattern (${matchCount} indicators)`,
    };
  }

  // If the text is very long (>500 chars) with multiple action verbs, it's likely a workflow
  const actionVerbs = text.match(
    /\b(find|search|call|email|book|buy|order|compare|negotiate|schedule|research|hire|contact|send|create|build|plan|organize|manage|track|monitor|review|analyze|compile)\b/gi
  );
  if (actionVerbs && actionVerbs.length >= 4) {
    return {
      isWorkflow: true,
      reason: `Multiple action verbs detected (${actionVerbs.length})`,
    };
  }

  return { isWorkflow: false, reason: "Single task" };
}

/**
 * Create a workflow from a user's request.
 * Phase 1: Plan the workflow steps using AI.
 */
export async function createWorkflow(
  userId: string,
  username: string,
  from: string,
  subject: string,
  body: string
): Promise<string> {
  const memory = await loadMemory(userId);

  // Use AI to plan the workflow
  const planPrompt = `You are planning a multi-step autonomous workflow for the user. Break their request into concrete, actionable steps.

User request: ${subject} ${body}

User context/memory: ${JSON.stringify(memory).substring(0, 2000)}

Return a JSON object with:
{
  "title": "Short workflow title",
  "steps": [
    {
      "title": "Step title",
      "description": "What to do in detail",
      "actionType": "research|task|call|email|wait|decision|purchase",
      "dependencies": [] // step numbers (0-indexed) that must complete first
    }
  ],
  "gatheringQuestions": ["Question 1?", "Question 2?"] // Questions to ask user before starting (if info is missing)
}

Rules:
- Each step should be independently executable
- Order steps logically with dependencies
- Use "research" for information gathering
- Use "call" for phone calls
- Use "email" for sending emails
- Use "purchase" for buying things
- Use "decision" for steps that need user input
- Use "wait" for time-dependent steps
- Be thorough but practical
- Max 20 steps for any project

Return ONLY valid JSON, no markdown.`;

  const aiResult = await generateResponse(
    memory,
    "Workflow Planning",
    planPrompt,
    username,
    "plan",
    userId
  );

  let plan: WorkflowPlan;
  try {
    // Extract JSON from AI response (handle markdown code blocks)
    let jsonStr = aiResult.content;
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }
    plan = JSON.parse(jsonStr.trim());
  } catch {
    // If AI didn't return valid JSON, create a simple plan
    plan = {
      title: subject || "Workflow",
      steps: [
        {
          title: "Research and gather information",
          description: body,
          actionType: "research",
          dependencies: [],
        },
        {
          title: "Execute based on findings",
          description: `Complete the task based on research: ${body}`,
          actionType: "task",
          dependencies: [0],
        },
        {
          title: "Verify and report results",
          description: "Confirm everything was done correctly and send summary",
          actionType: "task",
          dependencies: [1],
        },
      ],
      estimatedSteps: 3,
    };
  }

  // Create workflow record
  const { data: workflow, error } = await getSupabaseClient()
    .from("workflows")
    .insert({
      user_id: userId,
      title: plan.title,
      description: body,
      status:
        plan.gatheringQuestions && plan.gatheringQuestions.length > 0
          ? "gathering"
          : "executing",
      plan: plan.steps,
      total_steps: plan.steps.length,
    })
    .select()
    .single();

  if (error || !workflow) {
    throw new Error(`Failed to create workflow: ${error?.message}`);
  }

  // Create step records
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    await getSupabaseClient()
      .from("workflow_steps")
      .insert({
        workflow_id: workflow.id,
        step_number: i,
        title: step.title,
        description: step.description,
        action_type: step.actionType,
        dependencies: step.dependencies,
        status: "pending",
      });
  }

  // If we have gathering questions, send them to the user
  if (plan.gatheringQuestions && plan.gatheringQuestions.length > 0) {
    const questionsFormatted = plan.gatheringQuestions
      .map((q, i) => `${i + 1}. ${q}`)
      .join("\n");

    await sendResponse({
      to: from,
      from: `${username}@aevoy.com`,
      subject: `[Workflow] ${plan.title} — Questions before I start`,
      body: `I'm setting up a workflow for: **${plan.title}**

I have ${plan.steps.length} steps planned, but I need some information first:

${questionsFormatted}

Reply to this email with your answers and I'll get started right away.`,
    });
  } else {
    // No questions needed — start executing
    await sendResponse({
      to: from,
      from: `${username}@aevoy.com`,
      subject: `[Workflow] ${plan.title} — Starting (${plan.steps.length} steps)`,
      body: `Starting workflow: **${plan.title}**

Plan:
${plan.steps.map((s, i) => `${i + 1}. ${s.title}`).join("\n")}

I'll send you updates as I complete each step.`,
    });

    // Start executing the first available step
    executeNextStep(workflow.id, userId, username, from).catch((err) =>
      console.error("[WORKFLOW] Execution error:", err)
    );
  }

  return workflow.id;
}

/**
 * Execute the next available step in a workflow.
 * Respects dependencies — only runs steps whose dependencies are all completed.
 */
export async function executeNextStep(
  workflowId: string,
  userId: string,
  username: string,
  userEmail: string
): Promise<void> {
  // Get workflow and all steps
  const { data: workflow } = await getSupabaseClient()
    .from("workflows")
    .select("*")
    .eq("id", workflowId)
    .single();

  if (!workflow || workflow.status === "completed" || workflow.status === "failed" || workflow.status === "cancelled") {
    return;
  }

  const { data: steps } = await getSupabaseClient()
    .from("workflow_steps")
    .select("*")
    .eq("workflow_id", workflowId)
    .order("step_number");

  if (!steps || steps.length === 0) return;

  // Find completed step numbers
  const completedSteps = new Set(
    steps.filter((s) => s.status === "completed").map((s) => s.step_number)
  );

  // Find next executable step (all dependencies completed, not yet started)
  const nextStep = steps.find((s) => {
    if (s.status !== "pending") return false;
    const deps = (s.dependencies as number[]) || [];
    return deps.every((d) => completedSteps.has(d));
  });

  if (!nextStep) {
    // Check if all steps are completed
    const allDone = steps.every(
      (s) => s.status === "completed" || s.status === "skipped"
    );
    if (allDone) {
      await completeWorkflow(workflowId, userId, username, userEmail, steps);
    }
    return;
  }

  // Mark step as in_progress
  await getSupabaseClient()
    .from("workflow_steps")
    .update({ status: "in_progress" })
    .eq("id", nextStep.id);

  // Update workflow current step
  await getSupabaseClient()
    .from("workflows")
    .update({
      current_step: nextStep.step_number,
      updated_at: new Date().toISOString(),
    })
    .eq("id", workflowId);

  console.log(
    `[WORKFLOW] Executing step ${nextStep.step_number + 1}/${steps.length}: ${nextStep.title}`
  );

  // Gather results from dependency steps for context
  const depResults: Record<string, unknown> = {};
  const deps = (nextStep.dependencies as number[]) || [];
  for (const depNum of deps) {
    const depStep = steps.find((s) => s.step_number === depNum);
    if (depStep?.result_data) {
      depResults[`step_${depNum}_result`] = depStep.result_data;
    }
  }

  // Build task description with context from previous steps
  let taskBody = nextStep.description || nextStep.title;
  if (Object.keys(depResults).length > 0) {
    taskBody += `\n\nContext from previous steps:\n${JSON.stringify(depResults, null, 2).substring(0, 3000)}`;
  }

  // Execute as a regular task
  try {
    const taskRequest: TaskRequest = {
      userId,
      username,
      from: userEmail,
      subject: `[Workflow Step ${nextStep.step_number + 1}] ${nextStep.title}`,
      body: taskBody,
      inputChannel: "workflow",
    };

    // Dynamic import to avoid circular dependency with processor.ts
    const { processTask } = await import("./processor.js");
    const result = await processTask(taskRequest);

    // Update step with result
    await getSupabaseClient()
      .from("workflow_steps")
      .update({
        status: result.success ? "completed" : "failed",
        task_id: result.taskId || null,
        result_data: {
          success: result.success,
          response: result.response?.substring(0, 5000),
          actionsCompleted: result.actions?.filter((a) => a.success).length || 0,
          error: result.error,
        },
        completed_at: new Date().toISOString(),
        retry_count: nextStep.retry_count + (result.success ? 0 : 1),
      })
      .eq("id", nextStep.id);

    // Send progress update
    const completedCount = steps.filter(
      (s) => s.status === "completed"
    ).length + (result.success ? 1 : 0);

    await sendProgressEmail(
      userEmail,
      `${username}@aevoy.com`,
      `[Workflow] ${workflow.title}`,
      `Step ${nextStep.step_number + 1}/${steps.length}: ${nextStep.title}\n` +
        `Status: ${result.success ? "Completed" : "Failed"}\n` +
        `Progress: ${completedCount}/${steps.length} steps done\n\n` +
        (result.response ? `Result: ${result.response.substring(0, 500)}` : "")
    );

    // If step failed and has retries left, retry
    if (!result.success && nextStep.retry_count < (nextStep.max_retries || 3)) {
      console.log(
        `[WORKFLOW] Step ${nextStep.step_number + 1} failed, retrying (${nextStep.retry_count + 1}/${nextStep.max_retries || 3})`
      );
      await getSupabaseClient()
        .from("workflow_steps")
        .update({ status: "pending" })
        .eq("id", nextStep.id);
    }

    // Continue to next step
    await executeNextStep(workflowId, userId, username, userEmail);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error(`[WORKFLOW] Step ${nextStep.step_number + 1} error:`, errorMessage);

    await getSupabaseClient()
      .from("workflow_steps")
      .update({
        status: "failed",
        result_data: { error: errorMessage },
        completed_at: new Date().toISOString(),
      })
      .eq("id", nextStep.id);

    // If critical failure, pause workflow
    if (nextStep.retry_count >= (nextStep.max_retries || 3)) {
      await getSupabaseClient()
        .from("workflows")
        .update({
          status: "paused",
          error_message: `Step ${nextStep.step_number + 1} failed after ${nextStep.max_retries || 3} retries: ${errorMessage}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", workflowId);

      await sendResponse({
        to: userEmail,
        from: `${username}@aevoy.com`,
        subject: `[Workflow] ${workflow.title} — Paused`,
        body: `Workflow paused at step ${nextStep.step_number + 1}: ${nextStep.title}\n\nReason: ${errorMessage}\n\nReply "continue" to retry or "cancel" to stop the workflow.`,
      });
    } else {
      // Retry
      await getSupabaseClient()
        .from("workflow_steps")
        .update({ status: "pending" })
        .eq("id", nextStep.id);
      await executeNextStep(workflowId, userId, username, userEmail);
    }
  }
}

/**
 * Complete a workflow — send final summary to user.
 */
async function completeWorkflow(
  workflowId: string,
  userId: string,
  username: string,
  userEmail: string,
  steps: Array<Record<string, unknown>>
): Promise<void> {
  // Calculate total cost
  const taskIds = steps
    .map((s) => s.task_id)
    .filter(Boolean) as string[];

  let totalCost = 0;
  if (taskIds.length > 0) {
    const { data: tasks } = await getSupabaseClient()
      .from("tasks")
      .select("cost_usd")
      .in("id", taskIds);

    totalCost = (tasks || []).reduce(
      (sum, t) => sum + (Number(t.cost_usd) || 0),
      0
    );
  }

  // Get workflow title
  const { data: workflow } = await getSupabaseClient()
    .from("workflows")
    .select("title")
    .eq("id", workflowId)
    .single();

  // Mark workflow as completed
  await getSupabaseClient()
    .from("workflows")
    .update({
      status: "completed",
      total_cost_usd: totalCost,
      updated_at: new Date().toISOString(),
    })
    .eq("id", workflowId);

  // Build summary
  const stepSummary = steps
    .map((s) => {
      const result = s.result_data as Record<string, unknown> | null;
      const statusIcon = s.status === "completed" ? "+" : s.status === "skipped" ? "-" : "x";
      return `[${statusIcon}] Step ${(s.step_number as number) + 1}: ${s.title}\n    ${result?.response ? String(result.response).substring(0, 200) : "No result"}`;
    })
    .join("\n\n");

  const successCount = steps.filter(
    (s) => s.status === "completed"
  ).length;

  await sendResponse({
    to: userEmail,
    from: `${username}@aevoy.com`,
    subject: `[Workflow Complete] ${workflow?.title || "Workflow"}`,
    body: `Workflow completed: **${workflow?.title}**

**Results:** ${successCount}/${steps.length} steps completed
**Total cost:** $${totalCost.toFixed(4)}

---

${stepSummary}

---

Reply if you need any follow-up or adjustments.`,
  });

  console.log(
    `[WORKFLOW] Completed: ${workflowId} (${successCount}/${steps.length} steps, $${totalCost.toFixed(4)})`
  );
}

/**
 * Handle workflow-related email replies (continue, cancel, answers to questions).
 */
export async function handleWorkflowReply(
  userId: string,
  username: string,
  from: string,
  replyText: string,
  workflowId: string
): Promise<void> {
  const { data: workflow } = await getSupabaseClient()
    .from("workflows")
    .select("*")
    .eq("id", workflowId)
    .eq("user_id", userId)
    .single();

  if (!workflow) return;

  const text = replyText.toLowerCase().trim();

  if (text === "cancel" || text === "stop") {
    await getSupabaseClient()
      .from("workflows")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", workflowId);

    await sendResponse({
      to: from,
      from: `${username}@aevoy.com`,
      subject: `[Workflow] ${workflow.title} — Cancelled`,
      body: "Workflow cancelled. No further steps will be executed.",
    });
    return;
  }

  if (workflow.status === "gathering") {
    // User is answering gathering questions — store answers and start executing
    await getSupabaseClient()
      .from("workflows")
      .update({
        status: "executing",
        gathered_data: { userAnswers: replyText },
        updated_at: new Date().toISOString(),
      })
      .eq("id", workflowId);

    await sendResponse({
      to: from,
      from: `${username}@aevoy.com`,
      subject: `[Workflow] ${workflow.title} — Starting`,
      body: `Got your answers. Starting the workflow now.`,
    });

    executeNextStep(workflowId, userId, username, from).catch((err) =>
      console.error("[WORKFLOW] Execution error:", err)
    );
    return;
  }

  if (workflow.status === "paused" && (text === "continue" || text === "retry")) {
    await getSupabaseClient()
      .from("workflows")
      .update({
        status: "executing",
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", workflowId);

    await sendResponse({
      to: from,
      from: `${username}@aevoy.com`,
      subject: `[Workflow] ${workflow.title} — Resuming`,
      body: "Resuming workflow. I'll continue from where I left off.",
    });

    executeNextStep(workflowId, userId, username, from).catch((err) =>
      console.error("[WORKFLOW] Execution error:", err)
    );
    return;
  }
}
