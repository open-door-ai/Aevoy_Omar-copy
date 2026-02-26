/**
 * Agent Team Orchestration
 *
 * For complex multi-step goals, the Manager breaks the task into parallel subtasks,
 * routes each to a specialist, then synthesizes all results.
 *
 * Specialists:
 *   - ResearchAgent: web search, data gathering, price comparison
 *   - BrowserAgent: form filling, signups, purchases, clicks
 *   - CommunicationAgent: emails, SMS, calls, outreach
 *   - AnalysisAgent: data analysis, summarization, comparison
 *
 * Pattern: Manager → [parallel specialists] → Synthesizer → User
 */

import { quickValidate, generateResponse } from './ai.js';
import { getSupabaseClient } from '../utils/supabase.js';

// ---- Types ----

export type SubTaskType = 'research' | 'browser' | 'communication' | 'analysis';

export interface SubTask {
  id: string;
  description: string;
  type: SubTaskType;
  dependsOn: string[];
}

// System prompt prefixes per specialist type
const SPECIALIST_PREFIXES: Record<SubTaskType, string> = {
  research:
    'Focus ONLY on finding information via search and browse. Be thorough, verify 3+ sources.',
  browser:
    'Focus ONLY on browser interaction. Complete the form/signup/purchase on the page.',
  communication:
    'Focus ONLY on sending the message/email/call. Be concise and professional.',
  analysis:
    'Focus ONLY on analyzing the provided data and producing insights.',
};

// ---- Complexity Detection ----

/**
 * Returns true if the task is complex enough to benefit from multi-agent decomposition.
 * Heuristics:
 *  - Contains conjunctive connectors that imply multi-step intent
 *  - Contains multiple distinct action verbs
 *  - Word count exceeds 25 (likely a detailed compound request)
 *  - Contains explicit sequencing markers (first…then, after you…do)
 *  - Involves high-stakes actions (purchase/book/sign up + pay)
 */
export function isComplexTask(task: string): boolean {
  const lower = task.toLowerCase();

  // Conjunctive connectors implying multiple sub-goals
  const conjunctivePatterns = [
    /\band then\b/,
    /\balso\b/,
    /\bplus\b/,
    /\bas well as\b/,
    /\bin addition\b/,
    /\bfurthermore\b/,
    /\bmoreover\b/,
    /\bafterward(?:s)?\b/,
  ];
  if (conjunctivePatterns.some((p) => p.test(lower))) return true;

  // Multiple distinct action verbs (≥ 3 unique ones)
  const actionVerbs = [
    'find', 'search', 'look', 'book', 'reserve', 'buy', 'purchase', 'order',
    'send', 'email', 'call', 'text', 'post', 'write', 'draft', 'schedule',
    'sign', 'register', 'create', 'make', 'download', 'upload', 'fill',
    'research', 'compare', 'check', 'analyze', 'summarize', 'translate',
  ];
  const foundVerbs = actionVerbs.filter((v) => new RegExp(`\\b${v}\\b`).test(lower));
  if (foundVerbs.length >= 3) return true;

  // Explicit sequencing markers
  const sequencingPatterns = [
    /\bfirst\b.{0,60}\bthen\b/s,
    /\bafter you\b.{0,60}\bdo\b/s,
    /\bonce you\b.{0,60}\bthen\b/s,
    /\bstep 1\b/,
    /\bstep one\b/,
  ];
  if (sequencingPatterns.some((p) => p.test(lower))) return true;

  // High-stakes sensitive actions combined with payment/signup
  const hasSensitiveAction = /\b(purchase|buy|order|book|sign[\s-]up|register)\b/.test(lower);
  const hasPayment = /\b(pay|payment|checkout|credit card|card)\b/.test(lower);
  if (hasSensitiveAction && hasPayment) return true;

  // Long detailed request
  const wordCount = task.trim().split(/\s+/).length;
  if (wordCount > 25) return true;

  return false;
}

// ---- Task Decomposition ----

/**
 * Uses quickValidate (free Gemini/DeepSeek) to decompose a task into SubTasks.
 * Returns at most 4 subtasks. If decomposition fails or returns garbage, falls back
 * to a single subtask of type 'research' so the caller always gets something useful.
 */
async function decomposeTaskWithAI(task: string): Promise<SubTask[]> {
  const systemPrompt = `You are a task decomposition engine. Output ONLY valid JSON. No markdown, no explanation.`;
  const prompt = `Decompose this task into parallel subtasks. Return a JSON array with at most 4 items:
[{"id":"t1","description":"...","type":"research|browser|communication|analysis","dependsOn":[]}]

Rules:
- "dependsOn" contains IDs of tasks that must complete first (empty = can run in parallel)
- Use only these types: research, browser, communication, analysis
- Max 4 subtasks
- Output ONLY the JSON array, nothing else

Task: "${task}"`;

  try {
    const { result } = await quickValidate(prompt, systemPrompt);
    // Strip markdown code fences if present
    const cleaned = result.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    // Find the JSON array
    const arrayStart = cleaned.indexOf('[');
    const arrayEnd = cleaned.lastIndexOf(']');
    if (arrayStart === -1 || arrayEnd === -1) throw new Error('No JSON array in response');
    const parsed: SubTask[] = JSON.parse(cleaned.slice(arrayStart, arrayEnd + 1));
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Empty array');
    // Validate and sanitise each subtask
    const validTypes: SubTaskType[] = ['research', 'browser', 'communication', 'analysis'];
    return parsed.slice(0, 4).map((s, i) => ({
      id: String(s.id || `t${i + 1}`),
      description: String(s.description || task),
      type: validTypes.includes(s.type as SubTaskType) ? (s.type as SubTaskType) : 'research',
      dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn.map(String) : [],
    }));
  } catch (err) {
    console.warn('[AGENT-TEAM] Decomposition failed, using single subtask:', err);
    return [{ id: 't1', description: task, type: 'research', dependsOn: [] }];
  }
}

// ---- Subtask Execution ----

/**
 * Executes one subtask by calling processTask() with a specialist system prompt prefix.
 * Uses dynamic import to avoid circular-import issues at module load time.
 */
async function executeSubtask(
  subtask: SubTask,
  userId: string,
  username: string,
  previousResults: Map<string, string>
): Promise<string> {
  const prefix = SPECIALIST_PREFIXES[subtask.type];

  // Build context from dependencies
  let depContext = '';
  if (subtask.dependsOn.length > 0) {
    const depResults = subtask.dependsOn
      .map((depId) => previousResults.get(depId))
      .filter(Boolean)
      .join('\n\n');
    if (depResults) {
      depContext = `\n\nContext from previous steps:\n${depResults}`;
    }
  }

  const enrichedDescription = `${prefix}\n\n${subtask.description}${depContext}`;

  const { processTask } = await import('./processor.js');

  const result = await processTask({
    userId,
    username,
    from: `${username}@aevoy.com`,
    subject: subtask.description.slice(0, 120),
    body: enrichedDescription,
    inputChannel: 'web',
    suppressEmail: true,
  });

  return result.response || '';
}

// ---- Result Synthesis ----

/**
 * Combines all subtask results into one coherent user-facing response.
 */
async function synthesizeResults(
  originalTask: string,
  results: Map<string, string>,
  subtasks: SubTask[]
): Promise<string> {
  const resultBlocks = subtasks
    .map((s) => {
      const r = results.get(s.id) || '(no result)';
      return `[${s.type.toUpperCase()} — ${s.description}]\n${r}`;
    })
    .join('\n\n---\n\n');

  const systemPrompt = `You are a synthesis agent. Combine the specialist results into a single clear, concise response for the user.
Be direct. Use bullet points where helpful. Do NOT mention the internal agents or decomposition process.`;

  const prompt = `Original task: "${originalTask}"

Specialist results:
${resultBlocks}

Synthesize these into a single helpful response:`;

  try {
    const { result } = await quickValidate(prompt, systemPrompt);
    if (result && result.length > 30) return result;
  } catch {
    // Fall through to manual concatenation
  }

  // Fallback: concatenate results directly
  return subtasks
    .map((s) => results.get(s.id) || '')
    .filter(Boolean)
    .join('\n\n');
}

// ---- AgentTeam Class ----

export class AgentTeam {
  /**
   * Orchestrate a complex task using parallel specialist agents.
   * Returns the synthesized response, or an empty string if the team could not help.
   */
  async executeWithTeam(
    task: string,
    userId: string,
    username: string,
    context: string
  ): Promise<string> {
    const teamStart = Date.now();
    const TEAM_TIMEOUT_MS = 90_000; // 90 seconds total

    console.log('[AGENT-TEAM] Starting team execution for task:', task.slice(0, 80));

    // 1. Decompose the task into subtasks
    const subtasks = await decomposeTaskWithAI(task);
    console.log(`[AGENT-TEAM] Decomposed into ${subtasks.length} subtasks:`, subtasks.map((s) => `${s.id}(${s.type})`).join(', '));

    const results = new Map<string, string>();

    // 2. Topological execution: group subtasks by wave (parallel within wave, sequential across waves)
    // Wave 0 = no dependencies; Wave N = depends only on wave < N
    const waves: SubTask[][] = [];
    const placed = new Set<string>();

    let remaining = [...subtasks];
    while (remaining.length > 0) {
      const wave = remaining.filter((s) => s.dependsOn.every((dep) => placed.has(dep)));
      if (wave.length === 0) {
        // Circular dependency guard — put everything remaining in one wave
        wave.push(...remaining);
      }
      waves.push(wave);
      wave.forEach((s) => placed.add(s.id));
      remaining = remaining.filter((s) => !placed.has(s.id));
    }

    // 3. Execute wave by wave
    for (const wave of waves) {
      if (Date.now() - teamStart > TEAM_TIMEOUT_MS) {
        console.warn('[AGENT-TEAM] Timeout reached, stopping early');
        break;
      }

      const wavePromises = wave.map(async (subtask) => {
        try {
          const result = await executeSubtask(subtask, userId, username, results);
          results.set(subtask.id, result);
          console.log(`[AGENT-TEAM] Subtask ${subtask.id} completed (${subtask.type}), ${result.length} chars`);
        } catch (err) {
          console.error(`[AGENT-TEAM] Subtask ${subtask.id} failed:`, err);
          results.set(subtask.id, '');
        }
      });

      await Promise.allSettled(wavePromises);
    }

    // 4. Synthesize
    const anyResult = [...results.values()].some((r) => r && r.length > 20);
    if (!anyResult) {
      console.warn('[AGENT-TEAM] No subtasks returned useful results');
      return '';
    }

    const synthesized = await synthesizeResults(task, results, subtasks);
    const elapsed = Date.now() - teamStart;
    console.log(`[AGENT-TEAM] Team completed in ${elapsed}ms, response length: ${synthesized.length}`);

    return synthesized;
  }
}

// ---- Singleton ----

let agentTeamInstance: AgentTeam | null = null;

export function getAgentTeam(): AgentTeam {
  if (!agentTeamInstance) {
    agentTeamInstance = new AgentTeam();
  }
  return agentTeamInstance;
}
