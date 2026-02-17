/**
 * Autonomous Workflow Integration
 *
 * Detects complex tasks that require autonomous planning and execution.
 * Integrates AGI-level executor for never-fail, multi-threaded execution.
 */

import {
  parseClarificationResponse,
  incorporateClarifications,
  type WorkflowPlan,
} from "./autonomous-workflow.js";
import { sendResponse } from "./email.js";
import { getSupabaseClient } from "../utils/supabase.js";
import { createRecursiveAGI } from "./agi-recursive.js";
import { MultiUserBrowserService } from "./multi-user-browser.js";
import type { TaskRequest, TaskResult } from "../types/index.js";

/**
 * Use AI to determine if a task needs autonomous multi-step planning.
 * Returns true when the task is open-ended (user states a goal, not steps),
 * requires discovery (the HOW is unknown), or has interdependent sub-goals.
 *
 * Uses Groq for <200ms classification — never hardcoded keywords.
 */
export async function requiresAutonomousPlanning(
  subject: string,
  body: string | undefined
): Promise<boolean> {
  const taskText = `${subject ?? ''}\n${body ?? ''}`.trim();

  // Short or trivial tasks never need autonomous planning
  if (taskText.length < 30) return false;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 5,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You classify if a task needs autonomous multi-step AI execution (not a simple Q&A or single action). Reply only YES or NO.\n\nReply YES if:\n- The user states a high-level goal without specifying steps\n- Completing it requires research + decisions + multiple sequential actions\n- Examples: write a research report, apply to jobs, set up a campaign, find and contact leads\n\nReply NO if:\n- It's a simple question or lookup\n- It's one discrete action (send email, book appointment, search for X)\n- It's a calculation or explanation",
          },
          { role: "user", content: taskText.substring(0, 600) },
        ],
      }),
    });

    if (!res.ok) return false;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const answer = data.choices?.[0]?.message?.content?.trim().toUpperCase() ?? "";
    const isAutonomous = answer.startsWith("YES");
    if (isAutonomous) console.log("[AGI] AI classifier: autonomous planning needed");
    return isAutonomous;
  } catch {
    // If classification fails, fall through to standard processor
    return false;
  }
}

/**
 * Handle autonomous workflow execution from start to finish.
 * Routes to AGI executor for true AGI-level tasks, or standard workflow for complex multi-step tasks.
 */
export async function handleAutonomousWorkflow(task: TaskRequest): Promise<TaskResult> {
  const { userId, username, from, subject, body } = task;
  let taskId = task.taskId;

  console.log(`[AGI] Starting autonomous workflow for user ${username}`);

  // All tasks routed here use recursive AGI execution (multi-goal, self-reflective)
  {
    console.log('[RECURSIVE-AGI] Starting recursive execution');

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
