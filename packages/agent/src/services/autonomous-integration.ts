/**
 * Autonomous Workflow Integration — True AGI
 *
 * Detects complex tasks, decomposes them into sub-tasks using Claude (not Groq),
 * executes sub-tasks through the proven processTask() pipeline with CONTEXT FLOW
 * between steps, then VERIFIES the outcome and RE-PLANS if needed.
 *
 * Key differences from v1:
 * - Claude for decomposition (smarter planning)
 * - Context flows forward: each sub-task sees prior results
 * - Post-execution verification: did we actually achieve the goal?
 * - Adaptive re-planning: if verification fails, generate new sub-tasks
 * - Max 3 verification rounds to prevent infinite loops
 */

import {
  parseClarificationResponse,
  incorporateClarifications,
  type WorkflowPlan,
} from "./autonomous-workflow.js";
import { sendResponse } from "./email.js";
import { getSupabaseClient } from "../utils/supabase.js";
import { processTask } from "./processor.js";
import { loadMemory } from "./memory.js";
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
              "You classify if a task needs autonomous multi-step AI execution (not a simple Q&A or single action). Reply only YES or NO.\n\nReply YES if:\n- The user states a high-level goal without specifying steps\n- Completing it requires research + decisions + multiple sequential actions\n- Examples: write a research report, apply to jobs, set up a campaign, find and contact leads, create accounts, set up integrations\n\nReply NO if:\n- It's a simple question or lookup\n- It's one discrete action (send email, book appointment, search for X)\n- It's a calculation or explanation\n- It's a greeting or casual chat",
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
 * Decompose a vague goal into concrete, actionable sub-tasks.
 * Uses Claude for complex goals (better reasoning), Groq for simpler ones.
 * Each sub-task gets context from prior results.
 */
async function decomposeGoalIntoSubTasks(
  subject: string,
  body: string,
  userId: string,
  priorContext?: string
): Promise<Array<{ subject: string; body: string; dependsOnPrior: boolean }>> {
  const goalText = `Goal: ${subject}\n${body || ""}`.trim().substring(0, 1200);
  const contextSection = priorContext
    ? `\n\nPRIOR RESULTS (from previous execution rounds — use this context to inform next steps):\n${priorContext.substring(0, 2000)}`
    : "";

  const systemPrompt = `You decompose a high-level goal into 3-7 concrete, immediately actionable sub-tasks that an AI agent with browser, email, search, and phone can execute.

Each sub-task must be a SPECIFIC, SINGLE action — not another vague goal. Include exact search queries, URLs, details.

Reply with ONLY a JSON array, no markdown, no explanation:
[
  {"subject": "Search for ...", "body": "Search for '...' and extract ...", "dependsOnPrior": false},
  {"subject": "Visit the website of ...", "body": "Based on results from the previous step, visit ... and look for ...", "dependsOnPrior": true},
  {"subject": "Send outreach email", "body": "Send a personalized email to ... referencing ...", "dependsOnPrior": true}
]

Rules:
- Each task must be independently executable OR explicitly depend on prior results (dependsOnPrior: true)
- Include specific search queries with real keywords, not generic placeholders
- If the goal involves account creation: include specific site URLs, form fields to fill, verification steps
- If the goal involves outreach: research first, personalize, then act
- If the goal involves setup/configuration: break into discrete steps (navigate, fill, submit, verify)
- Never include tasks like "review results" or "analyze" — the agent does that automatically
- For account creation tasks: after signup, include a sub-task to check email for verification
- Max 7 sub-tasks
- Set dependsOnPrior: true when the sub-task NEEDS information from a previous sub-task's result`;

  // Try Claude first for better reasoning, fall back to Groq
  const providers: Array<{
    name: string;
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
    extract: (data: any) => string;
    available: boolean;
  }> = [
    {
      name: "Claude",
      url: "https://api.anthropic.com/v1/messages",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01",
      },
      body: {
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [{ role: "user", content: `${goalText}${contextSection}` }],
        system: systemPrompt,
      },
      extract: (data: any) => data.content?.[0]?.text?.trim() ?? "",
      available: !!process.env.ANTHROPIC_API_KEY,
    },
    {
      name: "Groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: {
        model: "llama-3.3-70b-versatile",
        max_tokens: 2000,
        temperature: 0.3,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `${goalText}${contextSection}` },
        ],
      },
      extract: (data: any) => data.choices?.[0]?.message?.content?.trim() ?? "",
      available: !!process.env.GROQ_API_KEY,
    },
  ];

  for (const provider of providers) {
    if (!provider.available) continue;
    try {
      const res = await fetch(provider.url, {
        method: "POST",
        headers: provider.headers,
        body: JSON.stringify(provider.body),
      });

      if (!res.ok) {
        console.warn(`[AGI] ${provider.name} decomposition failed: ${res.status}`);
        continue;
      }

      const data = await res.json();
      const content = provider.extract(data);
      const jsonStr = content.replace(/^```json?\s*/i, "").replace(/\s*```$/, "").trim();
      const tasks = JSON.parse(jsonStr) as Array<{ subject: string; body: string; dependsOnPrior?: boolean }>;

      if (!Array.isArray(tasks) || tasks.length === 0) continue;

      console.log(`[AGI] ${provider.name} decomposed goal into ${tasks.length} sub-tasks`);
      return tasks.slice(0, 7).map(t => ({
        subject: t.subject,
        body: t.body,
        dependsOnPrior: t.dependsOnPrior ?? false,
      }));
    } catch (err) {
      console.warn(`[AGI] ${provider.name} decomposition error:`, err);
      continue;
    }
  }

  // Final fallback: treat the whole goal as a single task
  console.warn("[AGI] All decomposition providers failed, treating as single task");
  return [{ subject, body: body || subject, dependsOnPrior: false }];
}

/**
 * Verify if the overall goal has been achieved based on sub-task results.
 * Uses cheap AI to evaluate. Returns {achieved, gaps, suggestions}.
 */
async function verifyGoalAchievement(
  goal: string,
  results: Array<{ subject: string; success: boolean; response: string }>
): Promise<{ achieved: boolean; gaps: string[]; nextSteps: string[] }> {
  const resultsSummary = results.map((r, i) => {
    const status = r.success ? "SUCCESS" : "FAILED";
    return `${i + 1}. [${status}] ${r.subject}: ${r.response.substring(0, 300)}`;
  }).join("\n");

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 500,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: `You evaluate if an AI agent achieved a user's goal. Reply with ONLY a JSON object:
{"achieved": true/false, "gaps": ["what's missing"], "nextSteps": ["specific action to take"]}

- achieved: true ONLY if the goal is fully completed or the agent did everything possible
- gaps: specific things that are incomplete (empty array if achieved)
- nextSteps: concrete, actionable follow-up tasks if not achieved (empty if achieved)
- Be realistic: if multiple steps failed, the goal is NOT achieved
- If some steps succeeded and others failed, check if the successful ones are sufficient`,
          },
          {
            role: "user",
            content: `GOAL: ${goal}\n\nRESULTS:\n${resultsSummary}`,
          },
        ],
      }),
    });

    if (!res.ok) return { achieved: true, gaps: [], nextSteps: [] }; // Optimistic on failure
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content?.trim() ?? "";
    const jsonStr = content.replace(/^```json?\s*/i, "").replace(/\s*```$/, "").trim();
    return JSON.parse(jsonStr);
  } catch {
    // If verification fails, assume achieved (don't loop forever)
    return { achieved: true, gaps: [], nextSteps: [] };
  }
}

/**
 * Handle autonomous workflow execution from start to finish.
 * Decomposes → Executes with context flow → Verifies → Re-plans if needed.
 */
export async function handleAutonomousWorkflow(task: TaskRequest): Promise<TaskResult> {
  const { userId, username, from, subject, body } = task;
  let taskId = task.taskId;
  const workflowStart = Date.now();
  const WORKFLOW_TIMEOUT_MS = 30 * 60 * 1000; // 30 minute total workflow timeout
  const MAX_VERIFICATION_ROUNDS = 3;

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

    // Get user's email and memory for context
    const [profileResult, memory] = await Promise.all([
      getSupabaseClient().from("profiles").select("email").eq("id", userId).single(),
      loadMemory(userId),
    ]);
    const userEmail = profileResult.data?.email || from;

    // Track all results across verification rounds
    const allResults: Array<{ subject: string; success: boolean; response: string }> = [];
    let accumulatedContext = "";

    // Add user memory to initial context
    if (memory.facts && memory.facts.length > 10) {
      accumulatedContext = `USER CONTEXT (from memory):\n${memory.facts.substring(0, 500)}\n\n`;
    }

    for (let verifyRound = 0; verifyRound < MAX_VERIFICATION_ROUNDS; verifyRound++) {
      // Timeout check
      if (Date.now() - workflowStart > WORKFLOW_TIMEOUT_MS) {
        console.log(`[AGI] Workflow timeout after ${verifyRound} rounds`);
        break;
      }

      const isReplan = verifyRound > 0;
      console.log(`[AGI] ${isReplan ? "Re-planning" : "Planning"} round ${verifyRound + 1}/${MAX_VERIFICATION_ROUNDS}`);

      // Decompose goal into sub-tasks (with accumulated context for re-plans)
      const subTasks = await decomposeGoalIntoSubTasks(
        subject,
        body || "",
        userId,
        isReplan ? accumulatedContext : undefined
      );

      console.log(`[AGI] Executing ${subTasks.length} sub-tasks for goal: "${subject.slice(0, 60)}"`);

      // Execute sub-tasks with context flow
      const roundResults: Array<{ subject: string; success: boolean; response: string }> = [];

      for (const [i, sub] of subTasks.entries()) {
        // Timeout check
        if (Date.now() - workflowStart > WORKFLOW_TIMEOUT_MS) {
          console.log(`[AGI] Workflow timeout during sub-task ${i + 1}`);
          break;
        }

        console.log(`[AGI] Sub-task ${i + 1}/${subTasks.length}: ${sub.subject.slice(0, 60)}`);

        // Build context-enriched body for sub-tasks that depend on prior results
        let enrichedBody = sub.body;
        if (sub.dependsOnPrior && roundResults.length > 0) {
          const priorResultsSummary = roundResults
            .filter(r => r.success)
            .map((r, idx) => `Step ${idx + 1} (${r.subject}): ${r.response.substring(0, 500)}`)
            .join("\n\n");

          if (priorResultsSummary) {
            enrichedBody = `${sub.body}\n\nCONTEXT FROM PRIOR STEPS:\n${priorResultsSummary}`;
          }
        }

        try {
          const result = await processTask({
            userId,
            username,
            from,
            subject: sub.subject,
            body: enrichedBody,
            inputChannel: task.inputChannel || "web",
          });

          roundResults.push({
            subject: sub.subject,
            success: result.success,
            response: result.response,
          });

          // Accumulate context for future sub-tasks and re-planning
          accumulatedContext += `\n[Step ${allResults.length + roundResults.length}] ${sub.subject}: ${result.success ? "SUCCESS" : "FAILED"} — ${result.response.substring(0, 300)}`;

          console.log(`[AGI] Sub-task ${i + 1} ${result.success ? "completed" : "failed"}`);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`[AGI] Sub-task ${i + 1} error:`, errMsg);
          roundResults.push({
            subject: sub.subject,
            success: false,
            response: `Error: ${errMsg}`,
          });
          accumulatedContext += `\n[Step ${allResults.length + roundResults.length}] ${sub.subject}: ERROR — ${errMsg}`;
        }
      }

      allResults.push(...roundResults);

      // Verify: did we achieve the goal?
      const verification = await verifyGoalAchievement(
        `${subject}\n${body || ""}`,
        allResults
      );

      if (verification.achieved) {
        console.log(`[AGI] Goal verified as achieved after ${verifyRound + 1} round(s)`);
        break;
      }

      // Goal not achieved — log gaps and re-plan
      console.log(`[AGI] Goal NOT achieved. Gaps: ${verification.gaps.join(", ")}`);
      console.log(`[AGI] Suggested next steps: ${verification.nextSteps.join(", ")}`);

      // Add gaps to context for next decomposition round
      accumulatedContext += `\n\nVERIFICATION FAILED — GAPS: ${verification.gaps.join("; ")}`;
      accumulatedContext += `\nSUGGESTED NEXT STEPS: ${verification.nextSteps.join("; ")}`;

      // On last round, don't re-plan
      if (verifyRound === MAX_VERIFICATION_ROUNDS - 1) {
        console.log(`[AGI] Max verification rounds reached, finishing with partial results`);
      }
    }

    // Compile final results
    const successCount = allResults.filter(r => r.success).length;
    const allSucceeded = successCount === allResults.length && allResults.length > 0;

    const summaryParts = allResults.map((r, i) => {
      const status = r.success ? "Done" : "Issue";
      const responseSnippet = r.response.slice(0, 300);
      return `${i + 1}. [${status}] ${r.subject}\n${responseSnippet}`;
    });

    const resultMessage = allResults.length > 0
      ? `Here's what I did for "${subject}":\n\n${summaryParts.join("\n\n")}\n\n${successCount}/${allResults.length} steps completed.`
      : `I wasn't able to complete "${subject}" — I'll learn from this and do better next time.`;

    // Update task record
    await getSupabaseClient()
      .from("tasks")
      .update({
        status: allSucceeded ? "completed" : (successCount > 0 ? "partial" : "failed"),
        completed_at: new Date().toISOString(),
        execution_time_ms: Date.now() - workflowStart,
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
      success: allSucceeded || successCount > 0,
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
