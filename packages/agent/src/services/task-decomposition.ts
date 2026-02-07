/**
 * Task Decomposition Intelligence
 *
 * Automatically breaks complex tasks into subtasks.
 * Executes in sequence or parallel based on dependencies.
 *
 * Example: "Plan my vacation to Japan" →
 *   1. Research flights to Tokyo
 *   2. Find hotels in Tokyo/Kyoto
 *   3. Book JR Pass
 *   4. Create itinerary
 *   5. Set calendar reminders
 */

import { generateResponse } from "./ai.js";

export interface Subtask {
  id: string;
  description: string;
  dependencies: string[]; // IDs of subtasks that must complete first
  estimatedDuration: number;
  priority: number; // 1-10
  canRunInParallel: boolean;
}

export interface DecomposedTask {
  originalTask: string;
  subtasks: Subtask[];
  executionStrategy: "sequential" | "parallel" | "hybrid";
  estimatedTotalDuration: number;
}

/**
 * Analyze task complexity and decide if decomposition would help
 */
export function shouldDecomposeTask(description: string): boolean {
  // Decompose if:
  // 1. Multiple verbs (book + research + create)
  // 2. Multiple domains (flights + hotels + calendar)
  // 3. Conjunctions (and, then, after)
  // 4. Word count > 15

  const verbs = ["book", "find", "research", "create", "send", "schedule", "buy", "order", "plan", "organize"];
  const verbCount = verbs.filter(v => description.toLowerCase().includes(v)).length;

  const hasConjunctions = /\b(and|then|after|before|also|plus)\b/i.test(description);
  const wordCount = description.split(/\s+/).length;

  const shouldDecompose = verbCount >= 2 || hasConjunctions || wordCount > 15;

  console.log(`[DECOMPOSE] Analysis: verbs=${verbCount}, conjunctions=${hasConjunctions}, words=${wordCount} → ${shouldDecompose ? "DECOMPOSE" : "SKIP"}`);

  return shouldDecompose;
}

/**
 * Decompose complex task into subtasks using AI
 */
export async function decomposeTask(description: string, userId: string): Promise<DecomposedTask> {
  console.log(`[DECOMPOSE] Breaking down: "${description}"`);

  const prompt = `Decompose this task into 3-7 clear, actionable subtasks.
Task: "${description}"

Return JSON:
{
  "subtasks": [
    {
      "id": "1",
      "description": "Research flights to Tokyo",
      "dependencies": [],
      "estimatedDuration": 300,
      "priority": 10,
      "canRunInParallel": true
    },
    ...
  ],
  "executionStrategy": "parallel" | "sequential" | "hybrid"
}

Rules:
- Each subtask should be independently executable
- Mark dependencies (e.g., "book hotel" depends on "research hotels")
- Estimate duration in seconds
- Priority 1-10 (10 = most important)
- Mark if can run in parallel with others`;

  try {
    const { generateResponse } = await import("./ai.js");
    const { loadMemory } = await import("./memory.js");

    const memory = await loadMemory(userId);
    const response = await generateResponse(memory, "Task Decomposition", prompt, "system", "plan", userId);

    // Extract JSON from response
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON in response");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    const decomposed: DecomposedTask = {
      originalTask: description,
      subtasks: parsed.subtasks.map((st: any, idx: number) => ({
        id: String(idx + 1),
        description: st.description,
        dependencies: st.dependencies || [],
        estimatedDuration: st.estimatedDuration || 60,
        priority: st.priority || 5,
        canRunInParallel: st.canRunInParallel !== false,
      })),
      executionStrategy: parsed.executionStrategy || "hybrid",
      estimatedTotalDuration: 0,
    };

    // Calculate total duration based on strategy
    if (decomposed.executionStrategy === "sequential") {
      decomposed.estimatedTotalDuration = decomposed.subtasks.reduce((sum, st) => sum + st.estimatedDuration, 0);
    } else if (decomposed.executionStrategy === "parallel") {
      decomposed.estimatedTotalDuration = Math.max(...decomposed.subtasks.map(st => st.estimatedDuration));
    } else {
      // Hybrid: some sequential, some parallel
      decomposed.estimatedTotalDuration = decomposed.subtasks.reduce((sum, st) => sum + st.estimatedDuration, 0) / 2;
    }

    console.log(`[DECOMPOSE] Created ${decomposed.subtasks.length} subtasks (${decomposed.executionStrategy} strategy, ~${Math.round(decomposed.estimatedTotalDuration)}s)`);
    decomposed.subtasks.forEach(st => {
      console.log(`[DECOMPOSE]   ${st.id}. ${st.description} (${st.estimatedDuration}s, deps: [${st.dependencies.join(",")}])`);
    });

    return decomposed;
  } catch (error) {
    console.error("[DECOMPOSE] Failed:", error);
    // Fallback: return original task as single subtask
    return {
      originalTask: description,
      subtasks: [{
        id: "1",
        description,
        dependencies: [],
        estimatedDuration: 60,
        priority: 10,
        canRunInParallel: false,
      }],
      executionStrategy: "sequential",
      estimatedTotalDuration: 60,
    };
  }
}

/**
 * Get optimal execution order based on dependencies and priorities
 */
export function getExecutionOrder(subtasks: Subtask[]): Subtask[][] {
  const ordered: Subtask[][] = []; // Array of parallel batches
  const completed = new Set<string>();

  while (completed.size < subtasks.length) {
    // Find all tasks whose dependencies are met
    const ready = subtasks.filter(st =>
      !completed.has(st.id) &&
      st.dependencies.every(dep => completed.has(dep))
    );

    if (ready.length === 0) {
      // Circular dependency or error - just take remaining tasks
      const remaining = subtasks.filter(st => !completed.has(st.id));
      if (remaining.length > 0) {
        ordered.push(remaining);
        remaining.forEach(st => completed.add(st.id));
      }
      break;
    }

    // Group by parallelizable vs sequential
    const parallel = ready.filter(st => st.canRunInParallel);
    const sequential = ready.filter(st => !st.canRunInParallel);

    // Add parallel batch
    if (parallel.length > 0) {
      ordered.push(parallel.sort((a, b) => b.priority - a.priority));
      parallel.forEach(st => completed.add(st.id));
    }

    // Add sequential one at a time (highest priority first)
    if (sequential.length > 0) {
      const next = sequential.sort((a, b) => b.priority - a.priority)[0];
      ordered.push([next]);
      completed.add(next.id);
    }
  }

  console.log(`[DECOMPOSE] Execution order: ${ordered.length} batches`);
  ordered.forEach((batch, i) => {
    console.log(`[DECOMPOSE]   Batch ${i + 1}: [${batch.map(st => st.id).join(",")}] (${batch.length} tasks${batch.length > 1 ? " in parallel" : ""})`);
  });

  return ordered;
}
