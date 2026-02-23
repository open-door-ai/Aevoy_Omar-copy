/**
 * AGI-Level Autonomous Executor — AI-Driven, Zero Hardcoding
 *
 * This executor handles truly autonomous, long-running tasks that require
 * parallel work streams, adaptive strategy, and outcome verification.
 *
 * Key principles:
 * - NO hardcoded task patterns — AI plans everything dynamically
 * - Delegates to processTask() for actual execution (proven pipeline)
 * - Parallel execution for independent sub-tasks
 * - AI-driven verification and re-planning
 * - Credential vault integration for account operations
 * - Email verification code auto-reading
 *
 * Used by handleAutonomousWorkflow() for complex multi-stream goals.
 */

import { MultiUserBrowserService } from './multi-user-browser.js';
import { getSupabaseClient } from '../utils/supabase.js';
import { processTask } from './processor.js';
import { sendResponse } from './email.js';
import type { TaskRequest, TaskResult } from '../types/index.js';

interface AGITask {
  id: string;
  goal: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  priority: number;
  context: string; // Accumulated context from prior tasks
  dependencies: string[]; // Task IDs this depends on
  results?: string;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  attempts: number;
  maxAttempts: number;
}

interface AGIResult {
  success: boolean;
  totalTasks: number;
  completed: number;
  failed: number;
  results: Array<{ goal: string; result: string }>;
  errors: Array<{ goal: string; error: string }>;
  durationMs: number;
}

export class AGIExecutor {
  private userId: string;
  private userEmail: string;
  private username: string;
  private tasks: Map<string, AGITask> = new Map();
  private maxParallelTasks = 3; // Conservative — each processTask uses browser resources
  private globalTimeout: number;
  private startTime: number = 0;

  constructor(
    userId: string,
    userEmail: string,
    username: string,
    options?: { maxParallel?: number; timeoutMs?: number }
  ) {
    this.userId = userId;
    this.userEmail = userEmail;
    this.username = username;
    this.maxParallelTasks = options?.maxParallel ?? 3;
    this.globalTimeout = options?.timeoutMs ?? 30 * 60 * 1000; // 30 min default
  }

  /**
   * Execute any goal by breaking it into AI-planned sub-tasks.
   * No hardcoded patterns — the AI decides everything.
   */
  async execute(goal: string, inputChannel?: string): Promise<AGIResult> {
    this.startTime = Date.now();
    console.log(`[AGI-EXEC] Starting: ${goal}`);

    // Step 1: AI decomposes the goal into tasks
    const tasks = await this.planTasks(goal);
    for (const task of tasks) {
      this.tasks.set(task.id, task);
    }

    console.log(`[AGI-EXEC] Planned ${tasks.length} tasks:`,
      tasks.map(t => `${t.id}: ${t.goal.substring(0, 50)}`).join(', '));

    // Step 2: Execute tasks respecting dependencies and parallelism
    await this.executeTasks(inputChannel);

    // Step 3: Compile results
    const result = this.compileResults();
    console.log(`[AGI-EXEC] Complete: ${result.completed}/${result.totalTasks} succeeded in ${result.durationMs}ms`);

    return result;
  }

  /**
   * Use AI to plan tasks — no hardcoded patterns.
   */
  private async planTasks(goal: string): Promise<AGITask[]> {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          max_tokens: 1500,
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content: `Break down this goal into 2-5 concrete tasks for an AI agent. The agent has: browser, email, search, phone, memory, file creation.

Reply with ONLY a JSON array:
[{"goal": "specific task", "priority": 10, "dependencies": [], "maxAttempts": 3}]

Rules:
- Each task must be a single concrete action (search, browse, create account, send email, etc.)
- dependencies: array of task indices (0-based) that must complete first. Use [] for independent tasks.
- priority: 1-10, higher = more important
- Independent tasks can run in parallel
- Include specific URLs, search queries, and details
- maxAttempts: how many retries (1-5, default 3)`,
            },
            { role: "user", content: goal.substring(0, 800) },
          ],
        }),
      });

      if (!res.ok) throw new Error(`Groq failed: ${res.status}`);
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = data.choices?.[0]?.message?.content?.trim() ?? "";
      const jsonStr = content.replace(/^```json?\s*/i, "").replace(/\s*```$/, "").trim();
      const planned = JSON.parse(jsonStr) as Array<{
        goal: string;
        priority?: number;
        dependencies?: number[];
        maxAttempts?: number;
      }>;

      return planned.slice(0, 7).map((p, i) => ({
        id: `agi_${Date.now()}_${i}`,
        goal: p.goal,
        status: 'pending' as const,
        priority: p.priority ?? 5,
        context: '',
        dependencies: (p.dependencies || []).map(d => `agi_${Date.now()}_${d}`),
        attempts: 0,
        maxAttempts: p.maxAttempts ?? 3,
      }));
    } catch (err) {
      console.warn('[AGI-EXEC] Planning failed, treating as single task:', err);
      return [{
        id: `agi_${Date.now()}_0`,
        goal,
        status: 'pending',
        priority: 10,
        context: '',
        dependencies: [],
        attempts: 0,
        maxAttempts: 3,
      }];
    }
  }

  /**
   * Execute tasks with dependency resolution and controlled parallelism.
   */
  private async executeTasks(inputChannel?: string): Promise<void> {
    const running = new Map<string, Promise<void>>();

    const tick = async () => {
      // Get runnable tasks (pending, dependencies met, not running)
      const runnable = Array.from(this.tasks.values())
        .filter(t =>
          t.status === 'pending' &&
          !running.has(t.id) &&
          t.dependencies.every(depId => {
            const dep = this.tasks.get(depId);
            return dep?.status === 'completed';
          })
        )
        .sort((a, b) => b.priority - a.priority);

      // Start tasks up to parallel limit
      const slotsAvailable = this.maxParallelTasks - running.size;
      const toStart = runnable.slice(0, slotsAvailable);

      for (const task of toStart) {
        task.status = 'in_progress';
        task.startedAt = new Date();

        // Collect context from completed dependencies
        const depContext = task.dependencies
          .map(depId => this.tasks.get(depId))
          .filter(dep => dep?.status === 'completed' && dep.results)
          .map(dep => `[${dep!.goal}]: ${dep!.results!.substring(0, 500)}`)
          .join('\n');
        if (depContext) {
          task.context = depContext;
        }

        const promise = this.executeOne(task, inputChannel).finally(() => {
          running.delete(task.id);
        });
        running.set(task.id, promise);
      }
    };

    // Main loop: keep ticking until all tasks are done or timeout
    while (!this.isTimedOut()) {
      await tick();

      // Check if all tasks are terminal
      const allDone = Array.from(this.tasks.values()).every(
        t => t.status === 'completed' || t.status === 'failed'
      );
      if (allDone) break;

      // If nothing is running and nothing is runnable, we're stuck (circular deps or all failed)
      if (running.size === 0) {
        const pendingTasks = Array.from(this.tasks.values()).filter(t => t.status === 'pending');
        if (pendingTasks.length === 0) break;
        // Mark stuck tasks as failed
        for (const t of pendingTasks) {
          t.status = 'failed';
          t.error = 'Blocked by failed dependencies';
        }
        break;
      }

      // Wait for at least one task to finish
      await Promise.race([
        ...Array.from(running.values()),
        new Promise(r => setTimeout(r, 5000)), // Or timeout
      ]);
    }

    // Wait for any still-running tasks to finish
    if (running.size > 0) {
      await Promise.allSettled(Array.from(running.values()));
    }
  }

  /**
   * Execute a single task via the processTask pipeline.
   */
  private async executeOne(task: AGITask, inputChannel?: string): Promise<void> {
    console.log(`[AGI-EXEC] Running: ${task.goal.substring(0, 60)} (attempt ${task.attempts + 1}/${task.maxAttempts})`);

    try {
      // Build enriched body with dependency context
      let body = task.goal;
      if (task.context) {
        body += `\n\nCONTEXT FROM PRIOR STEPS:\n${task.context}`;
      }

      const result = await processTask({
        userId: this.userId,
        username: this.username,
        from: this.userEmail,
        subject: task.goal.substring(0, 100),
        body,
        inputChannel: (inputChannel || 'web') as any,
      });

      if (result.success) {
        task.status = 'completed';
        task.results = result.response;
        task.completedAt = new Date();
        console.log(`[AGI-EXEC] Completed: ${task.goal.substring(0, 50)}`);
      } else {
        throw new Error(result.error || 'Task failed without error message');
      }
    } catch (error) {
      task.attempts++;
      const errMsg = error instanceof Error ? error.message : String(error);

      if (task.attempts < task.maxAttempts) {
        console.warn(`[AGI-EXEC] Failed attempt ${task.attempts}: ${errMsg} — will retry`);
        task.status = 'pending'; // Put back in queue
        task.context += `\n[PREVIOUS ATTEMPT FAILED: ${errMsg}. Try a different approach.]`;
      } else {
        console.error(`[AGI-EXEC] Failed permanently: ${task.goal.substring(0, 50)} — ${errMsg}`);
        task.status = 'failed';
        task.error = errMsg;
      }
    }
  }

  private isTimedOut(): boolean {
    return (Date.now() - this.startTime) > this.globalTimeout;
  }

  private compileResults(): AGIResult {
    const completed = Array.from(this.tasks.values()).filter(t => t.status === 'completed');
    const failed = Array.from(this.tasks.values()).filter(t => t.status === 'failed');

    return {
      success: completed.length > 0,
      totalTasks: this.tasks.size,
      completed: completed.length,
      failed: failed.length,
      results: completed.map(t => ({ goal: t.goal, result: t.results || '' })),
      errors: failed.map(t => ({ goal: t.goal, error: t.error || 'Unknown error' })),
      durationMs: Date.now() - this.startTime,
    };
  }
}

/**
 * Create AGI executor instance.
 */
export function createAGIExecutor(
  userId: string,
  userEmail: string,
  username: string,
  options?: { maxParallel?: number; timeoutMs?: number }
): AGIExecutor {
  return new AGIExecutor(userId, userEmail, username, options);
}
