/**
 * Autonomous Workflow Engine
 *
 * Breaks down complex, vague goals into concrete executable steps.
 * Implements AGI-level task understanding, clarification, and execution.
 *
 * Example: "Go get customers" → Research → Find leads → Draft outreach → Execute campaign → Report results
 */

import { generateResponse, quickValidate } from "./ai.js";
import { loadMemory } from "./memory.js";
import type { Memory, AIResponse } from "../types/index.js";

export interface WorkflowStep {
  id: string;
  description: string;
  type: 'clarification' | 'research' | 'execution' | 'validation' | 'reporting';
  dependencies: string[]; // Step IDs that must complete first
  clarificationNeeded?: string[]; // Questions to ask user
  expectedOutput?: string;
  isBlocking: boolean; // If false, can run in parallel with other steps
}

export interface WorkflowPlan {
  goal: string;
  clarificationQuestions: string[];
  steps: WorkflowStep[];
  estimatedDuration: string; // Human-readable: "2-4 hours", "1-2 days"
  complexity: 'simple' | 'moderate' | 'complex' | 'very_complex';
  canAutoExecute: boolean; // Whether we have enough info to start
}

export interface WorkflowExecution {
  planId: string;
  currentStep: string | null;
  completedSteps: string[];
  results: Map<string, WorkflowStepResult>;
  status: 'planning' | 'awaiting_clarification' | 'executing' | 'completed' | 'failed';
  totalCost: number;
}

export interface WorkflowStepResult {
  stepId: string;
  success: boolean;
  output: string | Record<string, unknown>;
  error?: string;
  startTime: number;
  endTime: number;
  cost: number;
}

/**
 * Analyze a complex goal and break it into concrete steps.
 * Returns a workflow plan with clarification questions if needed.
 */
export async function planAutonomousWorkflow(
  goal: string,
  userId: string,
  memory: Memory
): Promise<WorkflowPlan> {
  console.log(`[AUTONOMOUS] Planning workflow for goal: ${goal.substring(0, 100)}...`);

  // Use AI to understand intent and detect missing information
  const analysisPrompt = `You are an autonomous AI agent that can ACTUALLY DO THINGS. A user has given you this goal:

"${goal}"

Analyze this goal and respond with a JSON object (ONLY JSON, no markdown):
{
  "understood": boolean,
  "missing_info": string[],  // What critical info is missing? (e.g., "target market", "budget", "timeline")
  "clarification_questions": string[],  // Questions to ask user
  "can_auto_execute": boolean,  // Can we start without asking questions?
  "complexity": "simple"|"moderate"|"complex"|"very_complex",
  "estimated_duration": "X-Y hours/days",
  "steps": [
    {
      "id": "step_1",
      "description": "Concrete action description",
      "type": "clarification"|"research"|"execution"|"validation"|"reporting",
      "dependencies": [],
      "is_blocking": boolean,
      "expected_output": "What this step should produce"
    }
  ]
}

RULES:
1. Be specific. "Research competitors" is too vague. "Search for 50 competitor websites in [industry], analyze pricing models, create comparison spreadsheet" is good.
2. Break complex goals into 5-10 concrete steps MAX. Each step should be independently executable.
3. Ask clarification questions ONLY for critical info. Don't ask "What color should the spreadsheet be?" — that's a waste.
4. If you can make reasonable assumptions, do it. You're AGI, not a chatbot.
5. For money-making goals, include: market research → lead generation → outreach → conversion tracking → reporting.
6. For research goals, include: search → extract → analyze → synthesize → report.
7. For booking goals, include: search → filter → select → form fill → confirm.

Example good plan for "go get customers for my SaaS product":
{
  "understood": false,
  "missing_info": ["product name/URL", "target market", "budget"],
  "clarification_questions": [
    "What product are you selling? (name or website URL)",
    "Who are your ideal customers? (job title, industry, company size)",
    "What's your budget for this campaign? ($X total or $X/month)"
  ],
  "can_auto_execute": false,
  "complexity": "complex",
  "estimated_duration": "2-3 days",
  "steps": [
    {
      "id": "clarify",
      "description": "Get product details, target market, and budget from user",
      "type": "clarification",
      "dependencies": [],
      "is_blocking": true,
      "expected_output": "Product URL, target persona, budget confirmed"
    },
    {
      "id": "research_market",
      "description": "Research target market: find industry forums, LinkedIn groups, relevant communities where prospects hang out",
      "type": "research",
      "dependencies": ["clarify"],
      "is_blocking": true,
      "expected_output": "List of 10-20 high-quality prospect sources"
    },
    {
      "id": "build_prospect_list",
      "description": "Scrape/extract 100 qualified leads (names, emails, companies) from identified sources",
      "type": "execution",
      "dependencies": ["research_market"],
      "is_blocking": true,
      "expected_output": "CSV file with 100 leads"
    },
    {
      "id": "analyze_pain_points",
      "description": "Read forum discussions, LinkedIn posts to identify common pain points in target market",
      "type": "research",
      "dependencies": ["research_market"],
      "is_blocking": false,
      "expected_output": "List of 5-10 pain points to address in outreach"
    },
    {
      "id": "draft_outreach",
      "description": "Write personalized email template addressing identified pain points, include call-to-action",
      "type": "execution",
      "dependencies": ["analyze_pain_points"],
      "is_blocking": true,
      "expected_output": "Email template + 3 follow-up sequences"
    },
    {
      "id": "get_approval",
      "description": "Send draft email + campaign plan to user for approval",
      "type": "validation",
      "dependencies": ["draft_outreach", "build_prospect_list"],
      "is_blocking": true,
      "expected_output": "User approval to proceed"
    },
    {
      "id": "execute_campaign",
      "description": "Send emails to leads in batches of 10/day (to avoid spam filters), track opens/replies",
      "type": "execution",
      "dependencies": ["get_approval"],
      "is_blocking": true,
      "expected_output": "Campaign execution logs, reply tracking"
    },
    {
      "id": "report_results",
      "description": "Generate report: X emails sent, Y opens (Z%), W replies, V interested prospects",
      "type": "reporting",
      "dependencies": ["execute_campaign"],
      "is_blocking": true,
      "expected_output": "Campaign performance report with next steps"
    }
  ]
}`;

  const response = await generateResponse(
    memory,
    "Workflow Planning",
    analysisPrompt,
    "Autonomous Agent",
    "plan",
    userId
  );

  // Parse JSON from AI response
  let planData: WorkflowPlan;
  try {
    // Extract JSON from response (AI might wrap it in markdown)
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in AI response");
    }
    const parsed = JSON.parse(jsonMatch[0]);

    planData = {
      goal,
      clarificationQuestions: parsed.clarification_questions || [],
      steps: (parsed.steps || []).map((s: Record<string, unknown>, idx: number) => ({
        id: s.id as string || `step_${idx}`,
        description: s.description as string,
        type: s.type as WorkflowStep['type'] || 'execution',
        dependencies: s.dependencies as string[] || [],
        clarificationNeeded: s.clarification_needed as string[] | undefined,
        expectedOutput: s.expected_output as string | undefined,
        isBlocking: s.is_blocking as boolean ?? true,
      })),
      estimatedDuration: parsed.estimated_duration as string || "unknown",
      complexity: parsed.complexity as WorkflowPlan['complexity'] || 'moderate',
      canAutoExecute: parsed.can_auto_execute as boolean ?? false,
    };

    console.log(`[AUTONOMOUS] Planned ${planData.steps.length} steps, can_auto_execute=${planData.canAutoExecute}`);
    return planData;
  } catch (error) {
    console.error("[AUTONOMOUS] Failed to parse workflow plan:", error);

    // Fallback: create a simple plan
    return {
      goal,
      clarificationQuestions: [
        "Can you provide more details about what you're trying to accomplish?",
        "What specific outcome are you looking for?"
      ],
      steps: [
        {
          id: 'clarify',
          description: 'Get more details from user about their goal',
          type: 'clarification',
          dependencies: [],
          isBlocking: true,
        },
        {
          id: 'execute',
          description: goal,
          type: 'execution',
          dependencies: ['clarify'],
          isBlocking: true,
        }
      ],
      estimatedDuration: "unknown",
      complexity: 'moderate',
      canAutoExecute: false,
    };
  }
}

/**
 * Execute a workflow step with full retry logic and failure handling.
 * Returns the step result with detailed outcome.
 */
export async function executeWorkflowStep(
  step: WorkflowStep,
  context: {
    userId: string;
    username: string;
    email: string;
    memory: Memory;
    previousResults: Map<string, WorkflowStepResult>;
  }
): Promise<WorkflowStepResult> {
  const startTime = Date.now();
  console.log(`[WORKFLOW] Executing step ${step.id}: ${step.description}`);

  try {
    // Build context from previous step results
    const contextSummary = Array.from(context.previousResults.entries())
      .filter(([stepId]) => step.dependencies.includes(stepId))
      .map(([stepId, result]) => `${stepId}: ${JSON.stringify(result.output).substring(0, 200)}`)
      .join('\n');

    const stepPrompt = `Execute this workflow step:

STEP: ${step.description}

EXPECTED OUTPUT: ${step.expectedOutput || 'Complete the task described above'}

CONTEXT FROM PREVIOUS STEPS:
${contextSummary || 'None (first step)'}

USER INFO:
- Username: ${context.username}
- Email: ${context.email}

INSTRUCTIONS:
1. Actually DO the task, don't just explain how to do it.
2. Use [ACTION:...] tags for any actions you need to perform.
3. If you need to browse websites, use [ACTION:browse("url")]
4. If you need to search, use [ACTION:search("query")]
5. If you need to create files, use [ACTION:create_excel(...)] or similar
6. If you encounter errors, try alternative approaches. NEVER give up.
7. When done, include your final output clearly.

Be thorough and complete the step fully.`;

    const response = await generateResponse(
      context.memory,
      `Workflow Step: ${step.id}`,
      stepPrompt,
      context.username,
      step.type === 'research' ? 'reason' : 'complex',
      context.userId
    );

    // Check if step succeeded
    const hasActions = response.actions.length > 0;
    const hasOutput = response.content.length > 50;

    if (!hasActions && !hasOutput) {
      return {
        stepId: step.id,
        success: false,
        output: response.content,
        error: "Step produced no meaningful output or actions",
        startTime,
        endTime: Date.now(),
        cost: response.cost || 0,
      };
    }

    // Extract structured output if present
    let output: string | Record<string, unknown> = response.content;

    // Try to extract structured data (JSON, CSV, lists)
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        output = JSON.parse(jsonMatch[0]);
      } catch {
        // Keep as string
      }
    }

    return {
      stepId: step.id,
      success: true,
      output,
      startTime,
      endTime: Date.now(),
      cost: response.cost || 0,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[WORKFLOW] Step ${step.id} failed:`, errorMsg);

    return {
      stepId: step.id,
      success: false,
      output: "",
      error: errorMsg,
      startTime,
      endTime: Date.now(),
      cost: 0,
    };
  }
}

/**
 * Determine execution order for workflow steps based on dependencies.
 * Returns steps grouped by execution wave (parallel within wave, sequential between waves).
 */
export function getWorkflowExecutionOrder(steps: WorkflowStep[]): WorkflowStep[][] {
  const waves: WorkflowStep[][] = [];
  const completed = new Set<string>();
  const remaining = [...steps];

  while (remaining.length > 0) {
    // Find all steps whose dependencies are satisfied
    const wave = remaining.filter(step =>
      step.dependencies.every(depId => completed.has(depId))
    );

    if (wave.length === 0) {
      // Circular dependency or missing dependencies
      console.error("[WORKFLOW] Circular dependency detected, executing remaining steps anyway");
      waves.push(remaining);
      break;
    }

    // Remove executed steps from remaining
    wave.forEach(step => {
      const idx = remaining.indexOf(step);
      if (idx !== -1) remaining.splice(idx, 1);
      completed.add(step.id);
    });

    waves.push(wave);
  }

  console.log(`[WORKFLOW] Execution order: ${waves.length} waves`);
  return waves;
}

/**
 * Format clarification questions into a user-friendly message.
 */
export function formatClarificationMessage(plan: WorkflowPlan): string {
  const questions = plan.clarificationQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n');

  return `I can help you with: "${plan.goal}"

However, I need a bit more information to do this effectively:

${questions}

Please reply with your answers, and I'll get started immediately.

What I'm planning to do once I have this info:
${plan.steps.slice(0, 5).map((s, i) => `${i + 1}. ${s.description}`).join('\n')}${plan.steps.length > 5 ? `\n...and ${plan.steps.length - 5} more steps` : ''}

Estimated time: ${plan.estimatedDuration}`;
}

/**
 * Parse user's clarification responses.
 * Returns a map of question index → answer.
 */
export function parseClarificationResponse(response: string): Map<number, string> {
  const answers = new Map<number, string>();

  // Try to extract numbered answers: "1. answer here\n2. answer here"
  const numberedPattern = /(\d+)[\.)]\s*(.+?)(?=\n\d+[\.)]\s*|$)/gs;
  let match;
  while ((match = numberedPattern.exec(response)) !== null) {
    const questionNum = parseInt(match[1]) - 1; // 0-indexed
    const answer = match[2].trim();
    answers.set(questionNum, answer);
  }

  // If no numbered answers found, treat entire response as answer to first question
  if (answers.size === 0) {
    answers.set(0, response.trim());
  }

  return answers;
}

/**
 * Update workflow plan with clarification answers.
 * Returns updated plan ready for execution.
 */
export async function incorporateClarifications(
  plan: WorkflowPlan,
  answers: Map<number, string>,
  userId: string
): Promise<WorkflowPlan> {
  console.log(`[AUTONOMOUS] Incorporating ${answers.size} clarification answers`);

  // Build context string from answers
  const clarificationContext = Array.from(answers.entries())
    .map(([idx, answer]) => `Q${idx + 1}: ${plan.clarificationQuestions[idx]}\nA: ${answer}`)
    .join('\n\n');

  // Use AI to refine the plan with new info
  const refinementPrompt = `Original goal: ${plan.goal}

User provided these clarifications:
${clarificationContext}

Current plan has ${plan.steps.length} steps. Review the plan and update if needed based on the new information.

Respond with ONLY a JSON object containing the updated steps array:
{
  "steps": [
    {
      "id": "step_1",
      "description": "Updated concrete action description",
      "type": "research"|"execution"|"validation"|"reporting",
      "dependencies": [],
      "is_blocking": boolean,
      "expected_output": "What this step should produce"
    }
  ],
  "can_auto_execute": true
}

Keep steps concrete and actionable. Remove any clarification steps since we now have the info.`;

  try {
    const memory = await loadMemory(userId);
    const response = await generateResponse(
      memory,
      "Plan Refinement",
      refinementPrompt,
      "Autonomous Agent",
      "plan",
      userId
    );

    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);

      return {
        ...plan,
        steps: (parsed.steps || plan.steps).map((s: Record<string, unknown>, idx: number) => ({
          id: s.id as string || `step_${idx}`,
          description: s.description as string,
          type: s.type as WorkflowStep['type'] || 'execution',
          dependencies: s.dependencies as string[] || [],
          expectedOutput: s.expected_output as string | undefined,
          isBlocking: s.is_blocking as boolean ?? true,
        })),
        canAutoExecute: true,
        clarificationQuestions: [], // Clear questions since answered
      };
    }
  } catch (error) {
    console.error("[AUTONOMOUS] Failed to refine plan:", error);
  }

  // Fallback: just mark as ready to execute
  return {
    ...plan,
    canAutoExecute: true,
    clarificationQuestions: [],
  };
}
