/**
 * V3 Processor — Tiered Architecture
 *
 * Replaces the 12,732-line processor.ts with a clean tiered approach:
 *   Tier 1 (instant):      Greetings, weather — sub-second, no planning
 *   Tier 2 (single_tool):  Email, SMS, doc creation — one tool call, no planning
 *   Tier 3 (multi_step):   Browser, research, signups — full tool-calling loop
 *   Tier 4 (autonomous):   Multi-day campaigns — deferred to Phase 5
 *
 * Core principle: TRUST THE AI MODEL. No hardcoded gates, no regex classifiers,
 * no strategy diversity tracking. The AI decides what to do; tools report results.
 */

import { getSupabaseClient } from '../utils/supabase.js';
import { appendDailyLog, updateMemoryWithFact } from '../services/memory.js';
import { sendOverQuotaEmail } from '../services/email.js';
import { trackServiceCost } from '../services/ai.js';
import type { TaskRequest, TaskResult, InputChannel } from '../types/index.js';
import type { TaskContext, TierClassification, ToolCall } from './types.js';
import { buildTaskContext, loadTaskMemory, loadPersonality, buildSystemPrompt, buildTaskPrompt } from './context-builder.js';
import { atomicCompleteTask, sendViaChannel } from './channel-router.js';
import { BudgetManager } from './budget-manager.js';
import { TaskLedger } from './task-ledger.js';
import { executeToolCall, formatToolDescriptions, buildFunctionSchemas, parseToolCallsFromText } from './tool-registry.js';
import { callModel, classifyCall } from './model-router.js';

// ── Register all tools on module load ──
import './tools/communication.js';
import './tools/data.js';
import './tools/files.js';
import './tools/system.js';
import './tools/browser.js';

// ── Constants ──

const MAX_ITERATIONS = 15;
const TASK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const BUDGET_PER_TASK = 5.0;

// ══════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ══════════════════════════════════════════════════════════════════

export async function processTaskV3(task: TaskRequest): Promise<TaskResult> {
  const startTime = Date.now();
  let taskId = task.taskId || '';

  try {
    // ── Quota check ──
    const { data: profile } = await getSupabaseClient()
      .from('profiles')
      .select('messages_used, messages_limit, subscription_status')
      .eq('id', task.userId)
      .single();

    const isBeta = profile?.subscription_status === 'beta';
    if (!isBeta && profile && profile.messages_used >= profile.messages_limit) {
      await sendOverQuotaEmail(task.from, `${task.username}@aevoy.com`, task.subject);
      return { taskId: '', success: false, response: 'Over quota', actions: [], error: 'User is over their message quota' };
    }

    // ── Create task record ──
    if (!taskId) {
      const { data: taskRecord } = await getSupabaseClient()
        .from('tasks')
        .insert({
          user_id: task.userId,
          status: 'processing',
          email_subject: task.subject,
          input_text: task.body,
          started_at: new Date().toISOString(),
          input_channel: task.inputChannel || 'email',
          processor_version: 'v3',
        })
        .select()
        .single();
      taskId = taskRecord?.id || '';
    } else {
      await getSupabaseClient().from('tasks').update({
        status: 'processing',
        started_at: new Date().toISOString(),
        processor_version: 'v3',
      }).eq('id', taskId);
    }

    // ── Build context ──
    const ctx = await buildTaskContext(task, taskId);

    // ── Classify task tier ──
    const classification = await classifyTaskTier(task.subject, task.body);
    console.log(`[V3] Task ${taskId.slice(0, 8)} classified as ${classification.tier}${classification.tool ? ` (${classification.tool})` : ''}`);

    // ── Route by tier ──
    let response: string;

    switch (classification.tier) {
      case 'instant':
        response = await handleInstant(task, ctx);
        break;
      case 'single_tool':
        response = await handleSingleTool(task, ctx, classification.tool!);
        break;
      case 'multi_step':
      case 'autonomous':
        response = await handleMultiStep(task, ctx);
        break;
      default:
        response = await handleMultiStep(task, ctx);
    }

    // ── Prepend response prefix if set ──
    if (task.responsePrefix) {
      response = `${task.responsePrefix}\n\n${response}`;
    }

    // ── Complete task ──
    const executionTime = Date.now() - startTime;
    await atomicCompleteTask(
      taskId,
      task.inputChannel,
      task.userId,
      task.from,
      `${task.username}@aevoy.com`,
      task.subject,
      response,
      {
        status: 'completed',
        completed_at: new Date().toISOString(),
        execution_time_ms: executionTime,
        verification_status: 'verified',
      },
      { suppressEmail: task.suppressEmail }
    );

    // ── Update usage counter ──
    try { await getSupabaseClient().rpc('increment_messages_used', { p_user_id: task.userId }); } catch { /* non-critical */ }

    // ── Append to daily log ──
    appendDailyLog(task.userId, `Task: ${task.subject} → ${response.substring(0, 200)}`).catch(() => {});

    console.log(`[V3] Task ${taskId.slice(0, 8)} completed in ${executionTime}ms`);

    return {
      taskId,
      success: true,
      response,
      actions: [],
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[V3] Task ${taskId.slice(0, 8)} failed:`, errorMsg);

    // Update task as failed
    if (taskId) {
      try {
        await getSupabaseClient().from('tasks').update({
          status: 'internal_error',
          error_message: errorMsg.substring(0, 1000),
          completed_at: new Date().toISOString(),
          execution_time_ms: Date.now() - startTime,
        }).eq('id', taskId);
      } catch { /* ignore DB failure during error handling */ }
    }

    // Notify user of error
    try {
      await sendViaChannel(
        task.inputChannel,
        task.userId,
        task.from,
        `${task.username}@aevoy.com`,
        `Re: ${task.subject}`,
        'I ran into an issue processing your request. Please try again, or rephrase your task.'
      );
    } catch { /* ignore delivery failure */ }

    return {
      taskId,
      success: false,
      response: 'I ran into an issue processing your request.',
      actions: [],
      error: errorMsg,
    };
  }
}

// ══════════════════════════════════════════════════════════════════
// TIER CLASSIFICATION
// ══════════════════════════════════════════════════════════════════

async function classifyTaskTier(subject: string, body: string): Promise<TierClassification> {
  const taskText = subject === body ? subject : `${subject} ${body}`;
  const lower = taskText.toLowerCase().trim();

  // ── Ultra-fast pattern detection (no AI call needed) ──

  // Greetings
  if (/^(hi|hello|hey|sup|yo|howdy|good\s*(morning|afternoon|evening|night)|what'?s\s*up|hola)[\s!?.]*$/i.test(lower)) {
    return { tier: 'instant', reasoning: 'greeting' };
  }

  // Weather
  if (/\b(weather|temperature|forecast|rain|snow|sunny|cloudy)\b/i.test(lower) && lower.length < 100) {
    return { tier: 'single_tool', tool: 'weather', reasoning: 'weather query' };
  }

  // Email send
  if (/\b(send|compose|draft|write)\b.*\b(email|mail|message)\b.*\b(to)\b/i.test(lower) && /\S+@\S+\.\S+/.test(lower)) {
    return { tier: 'single_tool', tool: 'send_email', reasoning: 'email send' };
  }

  // SMS send
  if (/\b(send|text)\b.*\b(sms|text\s*message)\b/i.test(lower)) {
    return { tier: 'single_tool', tool: 'send_sms', reasoning: 'SMS send' };
  }

  // Schedule/remind
  if (/\b(remind|schedule|call\s*me\s*back|timer|alarm)\b/i.test(lower)) {
    return { tier: 'single_tool', tool: 'schedule_task', reasoning: 'schedule/remind' };
  }

  // Image generation
  if (/\b(generate|create|make|draw)\b.*\b(image|picture|photo|illustration|logo|art)\b/i.test(lower)) {
    return { tier: 'single_tool', tool: 'generate_image', reasoning: 'image generation' };
  }

  // Document creation
  if (/\b(create|make|generate|build)\b.*\b(excel|spreadsheet|word|document|powerpoint|presentation|pdf|report)\b/i.test(lower)) {
    return { tier: 'single_tool', tool: 'create_document', reasoning: 'document creation' };
  }

  // ── For ambiguous tasks, use AI classification ──
  try {
    const classifyPrompt = `Classify this task into exactly one category. Respond with ONLY the category name, nothing else.

Categories:
- instant: Simple greeting, small talk, or conversational response
- weather: Weather check for a location
- send_email: Send an email to someone
- send_sms: Send a text/SMS message
- schedule: Schedule a reminder, task, or callback
- generate_image: Create/generate an image
- create_document: Create a document (Word/Excel/PowerPoint/PDF)
- make_call: Place a voice call
- browser: Any task requiring a web browser (search, sign up, book, buy, research, cancel subscription, fill forms)
- multi_step: Complex task needing multiple actions

Task: "${taskText.substring(0, 300)}"

Category:`;

    const result = await classifyCall(classifyPrompt);
    const category = result.trim().toLowerCase().replace(/[^a-z_]/g, '');

    const categoryToTier: Record<string, TierClassification> = {
      instant: { tier: 'instant', reasoning: 'AI: greeting/chat' },
      weather: { tier: 'single_tool', tool: 'weather', reasoning: 'AI: weather' },
      send_email: { tier: 'single_tool', tool: 'send_email', reasoning: 'AI: email' },
      send_sms: { tier: 'single_tool', tool: 'send_sms', reasoning: 'AI: SMS' },
      schedule: { tier: 'single_tool', tool: 'schedule_task', reasoning: 'AI: schedule' },
      generate_image: { tier: 'single_tool', tool: 'generate_image', reasoning: 'AI: image' },
      create_document: { tier: 'single_tool', tool: 'create_document', reasoning: 'AI: document' },
      make_call: { tier: 'single_tool', tool: 'make_call', reasoning: 'AI: call' },
      browser: { tier: 'multi_step', reasoning: 'AI: browser task' },
      multi_step: { tier: 'multi_step', reasoning: 'AI: multi-step' },
    };

    return categoryToTier[category] || { tier: 'multi_step', reasoning: 'AI: default to multi-step' };
  } catch (err) {
    console.warn('[V3] Classification failed, defaulting to multi_step:', err);
    return { tier: 'multi_step', reasoning: 'classification failed' };
  }
}

// ══════════════════════════════════════════════════════════════════
// TIER 1: INSTANT (sub-second, no tools)
// ══════════════════════════════════════════════════════════════════

async function handleInstant(task: TaskRequest, ctx: TaskContext): Promise<string> {
  const taskText = task.subject === task.body ? task.subject : `${task.subject} ${task.body}`;

  // Use a fast, free model for conversational responses
  const result = await callModel({
    messages: [
      { role: 'system', content: `You are Aevoy, a friendly AI assistant for ${ctx.username}. Respond naturally and concisely. Current time: ${new Date().toLocaleString('en-US', { timeZone: ctx.profile.timezone })}.` },
      { role: 'user', content: taskText },
    ],
    tier: 'instant',
    maxTokens: 500,
    temperature: 0.7,
  });

  return result.content || "Hey! How can I help you today?";
}

// ══════════════════════════════════════════════════════════════════
// TIER 2: SINGLE TOOL (one tool call, no planning)
// ══════════════════════════════════════════════════════════════════

async function handleSingleTool(task: TaskRequest, ctx: TaskContext, toolName: string): Promise<string> {
  const taskText = task.subject === task.body ? task.subject : `${task.subject} ${task.body}`;

  // Ask the AI to extract parameters for the tool
  const paramPrompt = buildParamExtractionPrompt(toolName, taskText, ctx);

  const result = await callModel({
    messages: [{ role: 'user', content: paramPrompt }],
    tier: 'instant',
    maxTokens: 500,
    temperature: 0.1,
  });

  // Parse the AI's response to extract tool parameters
  let params: Record<string, unknown>;
  try {
    // Look for JSON in the response
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      params = JSON.parse(jsonMatch[0]);
    } else {
      // Fall through to multi-step if we can't extract params
      console.warn(`[V3] Could not extract params for ${toolName}, falling back to multi_step`);
      return handleMultiStep(task, ctx);
    }
  } catch {
    return handleMultiStep(task, ctx);
  }

  // Execute the tool
  const toolResult = await executeToolCall({ name: toolName, arguments: params }, ctx);

  if (toolResult.success) {
    // Track cost
    if (toolResult.cost > 0) {
      await trackServiceCost(ctx.userId, 'v3', toolName, toolResult.cost, `v3:${toolName}`, ctx.taskId);
    }
    return String(toolResult.data || `Done — ${toolName} completed successfully.`);
  }

  // Tool failed — fall back to multi-step for a more thorough attempt
  console.warn(`[V3] ${toolName} failed: ${toolResult.error}, falling back to multi_step`);
  return handleMultiStep(task, ctx);
}

function buildParamExtractionPrompt(toolName: string, taskText: string, ctx: TaskContext): string {
  const paramHelpers: Record<string, string> = {
    weather: `Extract the location. User timezone: ${ctx.profile.timezone}.
Respond with JSON: {"location": "city name"}`,

    send_email: `Extract email recipient, subject, and body.
User's name: ${ctx.username}. User's email: ${ctx.email}.
Respond with JSON: {"to": "email@example.com", "subject": "Subject", "body": "Email body"}`,

    send_sms: `Extract recipient phone number and message.
User's phone: ${ctx.profile.phone || 'unknown'}.
Respond with JSON: {"to": "+1234567890", "body": "Message text"}`,

    schedule_task: `Extract what to schedule and when.
User timezone: ${ctx.profile.timezone}. Current time: ${new Date().toLocaleString('en-US', { timeZone: ctx.profile.timezone })}.
Respond with JSON: {"description": "what to do", "time": "when", "action_type": "reminder|call|task"}`,

    generate_image: `Extract image description and optional style.
Respond with JSON: {"prompt": "detailed description", "style": "style or empty"}`,

    create_document: `Extract document type, title, and content.
Respond with JSON: {"type": "word|excel|powerpoint|pdf", "title": "doc title", "content": "document content"}`,

    make_call: `Extract phone number to call and message to speak.
User's phone: ${ctx.profile.phone || 'unknown'}.
Respond with JSON: {"to": "+1234567890", "message": "what to say"}`,
  };

  return `User request: "${taskText}"

${paramHelpers[toolName] || `Extract parameters for the "${toolName}" tool. Respond with JSON.`}

Respond with ONLY the JSON object, no other text.`;
}

// ══════════════════════════════════════════════════════════════════
// TIER 3: MULTI-STEP (full tool-calling loop)
// ══════════════════════════════════════════════════════════════════

async function handleMultiStep(task: TaskRequest, ctx: TaskContext): Promise<string> {
  const taskText = task.subject === task.body ? task.subject : `${task.subject} ${task.body}`;

  // ── Load memory and personality for multi-step tasks ──
  const memory = await loadTaskMemory(ctx.userId, task.subject);
  const personality = await loadPersonality(ctx.userId, ctx.username, memory, ctx.senderName, ctx.email);

  // ── Build budget manager ──
  const budget = new BudgetManager(ctx.userId, ctx.taskId, BUDGET_PER_TASK);
  await budget.initialize();

  // ── Build system prompt with tools ──
  const toolDescriptions = formatToolDescriptions();
  const memoryContext = memory.facts ? `Known facts about user:\n${memory.facts}` : '';
  const systemPrompt = buildSystemPrompt(
    personality,
    memoryContext,
    budget.formatForPrompt(),
    toolDescriptions,
    ctx.profile.timezone
  );

  // ── Build conversation ──
  type Message = {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_call_id?: string;
    tool_calls?: any[];
  };

  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: buildTaskPrompt(task.subject, task.body, task.responsePrefix) },
  ];

  // ── Task ledger ──
  const ledger = new TaskLedger(ctx.taskId, { maxIterations: MAX_ITERATIONS, timeoutMs: TASK_TIMEOUT_MS });

  // ── Multi-step loop ──
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    // Check termination conditions
    if (ledger.isTimedOut()) {
      const partial = ledger.getPartialResults();
      return partial !== 'No results gathered yet.'
        ? `I ran out of time, but here's what I found so far:\n\n${partial}`
        : 'I ran out of time working on your task. Could you try a simpler version of the request?';
    }

    if (budget.isExceeded()) {
      const partial = ledger.getPartialResults();
      return partial !== 'No results gathered yet.'
        ? `Budget limit reached. Here's what I accomplished:\n\n${partial}`
        : 'Budget limit reached before I could complete the task.';
    }

    // ── Call AI model with tools ──
    let modelResponse;
    try {
      modelResponse = await callModel({
        messages,
        tier: 'multi_step',
        useTools: true,
        maxTokens: 2000,
      });
    } catch (err) {
      console.error(`[V3] Model call failed at iteration ${iterations}:`, err);
      if (iterations >= 3) {
        return 'I encountered an issue with AI services. Please try again shortly.';
      }
      // Wait briefly and retry
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }

    // Track AI cost
    if (modelResponse.cost > 0) {
      await budget.trackCost('v3', modelResponse.model, modelResponse.cost, `v3:step${iterations}`);
    }

    // ── No tool calls = AI provided final answer ──
    if (modelResponse.toolCalls.length === 0) {
      const response = modelResponse.content.trim();
      if (response) {
        ledger.complete(response);
        return response;
      }
      // Empty response — retry
      if (iterations >= MAX_ITERATIONS - 1) {
        return 'I was unable to complete your request. Please try again with more details.';
      }
      messages.push({ role: 'assistant', content: '' });
      messages.push({ role: 'user', content: 'Please provide your response or continue working on the task.' });
      continue;
    }

    // ── Execute tool calls ──
    // Build assistant message with tool calls (for conversation history)
    const assistantToolCalls = modelResponse.toolCalls.map((tc, i) => ({
      id: `call_${Date.now()}_${i}`,
      type: 'function' as const,
      function: {
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
      },
    }));

    messages.push({
      role: 'assistant',
      content: modelResponse.content || '',
      tool_calls: assistantToolCalls,
    });

    // Execute each tool call and add results
    for (let i = 0; i < modelResponse.toolCalls.length; i++) {
      const tc = modelResponse.toolCalls[i];
      console.log(`[V3] Step ${iterations}.${i + 1}: ${tc.name}(${JSON.stringify(tc.arguments).substring(0, 100)})`);

      const result = await executeToolCall(tc, ctx);
      ledger.recordObservation(tc.name, tc.arguments, result);

      // Track tool cost
      if (result.cost > 0) {
        await budget.trackCost('v3', tc.name, result.cost, `v3:tool:${tc.name}`);
      }

      // Add tool result to conversation
      messages.push({
        role: 'tool',
        content: result.success
          ? String(result.data || 'Success')
          : `Error: ${result.error || 'Unknown error'}`,
        tool_call_id: assistantToolCalls[i].id,
      });
    }

    // ── Context compression after 5 iterations ──
    if (iterations % 5 === 0 && messages.length > 10) {
      const compressed = compressMessages(messages);
      messages.length = 0;
      messages.push(...compressed);
    }

    // ── Update progress in DB ──
    try {
      await getSupabaseClient().from('tasks').update({
        progress_message: `Step ${iterations}: ${modelResponse.toolCalls.map(tc => tc.name).join(', ')}`,
        iteration_count: iterations,
        cost_usd: budget.totalSpent,
      }).eq('id', ctx.taskId);
    } catch { /* non-critical progress update */ }
  }

  // Max iterations reached
  const partial = ledger.getPartialResults();
  return partial !== 'No results gathered yet.'
    ? `I've been working on this but reached the step limit. Here's what I have so far:\n\n${partial}`
    : 'I reached the maximum number of steps without completing the task. Could you try a simpler version?';
}

// ══════════════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════════════

/**
 * Compress message history to prevent context overflow.
 * Keeps system prompt, first user message, and last 3 exchanges.
 */
function compressMessages(messages: Array<{ role: string; content: string; [key: string]: any }>): Array<any> {
  if (messages.length <= 8) return messages;

  const system = messages.find(m => m.role === 'system');
  const firstUser = messages.find(m => m.role === 'user');
  const recent = messages.slice(-6); // Last 3 exchanges (assistant+tool pairs)

  // Summarize middle messages
  const middle = messages.slice(
    messages.indexOf(firstUser!) + 1,
    messages.length - 6
  );

  const middleSummary = middle
    .filter(m => m.role === 'tool')
    .map(m => m.content?.substring(0, 100) || '')
    .filter(Boolean)
    .join(' | ');

  const result: any[] = [];
  if (system) result.push(system);
  if (firstUser) result.push(firstUser);
  if (middleSummary) {
    result.push({ role: 'user', content: `[Previous tool results summary: ${middleSummary}]` });
  }
  result.push(...recent);

  return result;
}
