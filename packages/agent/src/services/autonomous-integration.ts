/**
 * Autonomous Workflow Integration
 *
 * Detects complex tasks that require autonomous planning and execution.
 * Decomposes vague goals into concrete sub-tasks via Groq, then delegates
 * each sub-task to the proven processTask() pipeline.
 */

import {
  parseClarificationResponse,
  incorporateClarifications,
  type WorkflowPlan,
} from "./autonomous-workflow.js";
import { sendResponse } from "./email.js";
import { getSupabaseClient } from "../utils/supabase.js";
import { processTask } from "./processor.js";
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
 * Decompose a vague goal into 3-5 concrete, immediately actionable sub-tasks.
 * Each sub-task has a specific subject + body that processTask() can execute.
 */
async function decomposeGoalIntoSubTasks(
  subject: string,
  body: string,
  userId: string
): Promise<Array<{ subject: string; body: string }>> {
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 1000,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: `You decompose a high-level goal into 3-5 concrete, immediately actionable sub-tasks that an AI agent can execute sequentially.

Each sub-task must be a SPECIFIC, SINGLE action — not another vague goal. Include exact search queries, URLs, email text, etc.

Reply with ONLY a JSON array, no markdown, no explanation:
[
  {"subject": "Search for web design agencies in Vancouver", "body": "Search for 'web design agencies Vancouver hiring freelancers 2026' and extract company names, websites, and contact emails from the results."},
  {"subject": "Research top 3 prospects", "body": "Visit the websites of the top 3 companies found and note what services they offer, recent projects, and any job/freelancer pages."},
  {"subject": "Send outreach email to first prospect", "body": "Send a personalized cold email to the first prospect referencing their recent work. Keep it to 3 sentences with a clear ask."}
]

Rules:
- Each task must be independently executable (search, browse, email, etc.)
- Include specific search queries, not generic ones
- If the goal involves outreach, the first tasks should be research, later tasks should be action
- Never include tasks like "review results" or "analyze" — the agent does that automatically
- Max 5 sub-tasks`,
          },
          {
            role: "user",
            content: `Goal: ${subject}\n${body || ""}`.trim().substring(0, 800),
          },
        ],
      }),
    });

    if (!res.ok) {
      console.error(`[AGI] Groq decomposition failed: ${res.status}`);
      // Fallback: treat the whole goal as a single task
      return [{ subject, body: body || subject }];
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content?.trim() ?? "";

    // Parse JSON (handle potential markdown wrapping)
    const jsonStr = content.replace(/^```json?\s*/i, "").replace(/\s*```$/, "").trim();
    const tasks = JSON.parse(jsonStr) as Array<{ subject: string; body: string }>;

    if (!Array.isArray(tasks) || tasks.length === 0) {
      return [{ subject, body: body || subject }];
    }

    console.log(`[AGI] Decomposed goal into ${tasks.length} sub-tasks`);
    return tasks.slice(0, 5); // Cap at 5
  } catch (err) {
    console.error("[AGI] Goal decomposition error:", err);
    // Fallback: treat the whole goal as a single task
    return [{ subject, body: body || subject }];
  }
}

/**
 * Handle autonomous workflow execution from start to finish.
 * Decomposes the goal into sub-tasks and delegates each to processTask().
 */
export async function handleAutonomousWorkflow(task: TaskRequest): Promise<TaskResult> {
  const { userId, username, from, subject, body } = task;
  let taskId = task.taskId;

  console.log(`[AGI] Starting autonomous workflow for user ${username}`);

  try {
    // Create task record if needed
    if (!taskId) {
      const { data: taskRecord } = await getSupabaseClient()
        .from("tasks")
        .insert({
          user_id: userId,
          status: "processing",
          email_subject: subject,
          input_text: body,
          type: "agi_autonomous",
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

    // Decompose the vague goal into concrete sub-tasks
    const subTasks = await decomposeGoalIntoSubTasks(subject, body || "", userId);
    console.log(`[AGI] Executing ${subTasks.length} sub-tasks for goal: "${subject.slice(0, 60)}"`);

    // Execute each sub-task through the proven processTask pipeline
    const results: Array<{ subject: string; success: boolean; response: string }> = [];

    for (const [i, sub] of subTasks.entries()) {
      console.log(`[AGI] Sub-task ${i + 1}/${subTasks.length}: ${sub.subject.slice(0, 60)}`);

      try {
        const result = await processTask({
          userId,
          username,
          from,
          subject: sub.subject,
          body: sub.body,
          inputChannel: task.inputChannel || "web",
        });

        results.push({
          subject: sub.subject,
          success: result.success,
          response: result.response,
        });

        console.log(`[AGI] Sub-task ${i + 1} ${result.success ? "completed" : "failed"}`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[AGI] Sub-task ${i + 1} error:`, errMsg);
        results.push({
          subject: sub.subject,
          success: false,
          response: `Error: ${errMsg}`,
        });
      }
    }

    // Compile results
    const successCount = results.filter(r => r.success).length;
    const allSucceeded = successCount === results.length;

    // Build a clean summary from all sub-task responses
    const summaryParts = results.map((r, i) => {
      const status = r.success ? "Done" : "Issue";
      const responseSnippet = r.response.slice(0, 300);
      return `${i + 1}. [${status}] ${r.subject}\n${responseSnippet}`;
    });

    const resultMessage = `Here's what I did for "${subject}":\n\n${summaryParts.join("\n\n")}\n\n${successCount}/${results.length} steps completed.`;

    // Update task record
    await getSupabaseClient()
      .from("tasks")
      .update({
        status: allSucceeded ? "completed" : "failed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", taskId);

    // Email results to user
    await sendResponse({
      to: userEmail,
      from: `${username}@aevoy.com`,
      subject: `Re: ${subject}`,
      body: resultMessage,
    });

    return {
      taskId: taskId || "",
      success: allSucceeded,
      response: resultMessage,
      actions: [],
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[AGI] Workflow error:', errorMsg);

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
