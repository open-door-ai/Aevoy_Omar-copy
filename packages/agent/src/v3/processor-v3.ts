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
// Phase 2: Individual browser tools ONLY — no vision agent wrapper
// browser_session removed to force direct browser control (browser_go, browser_click, browser_fill)
import './tools/browser-actions.js';
// Cleanup is handled by cleanupTaskPage from browser-actions.ts
// No need for cleanupTaskEngine since browser_session is disabled
const cleanupTaskEngine = async (_taskId: string) => { /* no-op */ };
import { cleanupTaskPage } from './tools/browser-actions.js';

// ── Constants ──

const MAX_ITERATIONS = 500; // No artificial limit — budget and timeout are the real constraints
const TASK_TIMEOUT_MS = 40 * 60 * 1000; // 40 minutes (browser sessions can take 13min each)
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
        })
        .select()
        .single();
      taskId = taskRecord?.id || '';
    } else {
      await getSupabaseClient().from('tasks').update({
        status: 'processing',
        started_at: new Date().toISOString(),
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

    // ── Security: strip any leaked credentials from response ──
    response = stripCredentialLeaks(response);

    // ── Quality gate: cross-reference AI claims against actual actions ──
    const executionTime = Date.now() - startTime;
    // Quality gate applies to ALL tiers — even "instant" can hallucinate
    // The classifier sometimes misclassifies browser tasks as instant
    const isMultiStep = true; // Apply to everything — better safe than hallucinated
    const responseLower = response.toLowerCase();

    // 1. Detect explicit failure admissions (expanded patterns)
    const admitsFailure = /\b(I was unable|couldn't complete|wasn't able to|cannot complete|cannot access|no login attempt|no specific data|did not yield|could not|failed to|failed due|process failed|creation.*failed|having trouble|I apologize|was unsuccessful|no concrete findings|no results|was blocked|completely blocked|IP.*blocked|IP.*flagged|Ray ID|access denied|403 forbidden|captcha.*blocked|0 job postings|0 results found|no postings found|not available due|browser disconn|encountered.*notification|JavaScript needed|need to resolve|contact.*support|approximate data|exact.*not available|all my attempts|attempts.*are failing|websites.*failing|couldn't access|can't access|cannot reach|unreachable|site.*down|doesn't exist yet|hasn't been (released|announced)|not yet (available|released)|no.*product.*found|external websites.*failing|search results.*failing|connection errors|technical issue)\b/i.test(response);
    const credPlaceholderLeaked = /\[CRED_/.test(response);

    // 2. Detect HALLUCINATED ACTIONS — AI claims it did something the system can't do
    const claimsPhoneCall = /\b(I called|called them|called the|phone call|spoke with|spoke to|reached them by phone|contacted.*by phone|made a call)\b/i.test(response);
    const claimsEmailSent = /\b(sent.*email|emailed them|confirmation email.*sent|email.*delivered|forwarded.*email)\b/i.test(response);
    const claimsBooked = /\b(booked|reservation.*made|reservation.*confirmed|table.*reserved|booking.*confirmed|appointment.*scheduled)\b/i.test(response);
    const claimsAccountCreated = /\b(account.*created|signed up|registered|account.*ready|successfully.*registered|profile.*created)\b/i.test(response);
    const claimsPurchased = /\b(purchased|order.*placed|bought|added to cart.*checked out|payment.*processed)\b/i.test(response);

    // 3. Detect VAGUE responses — no concrete data
    const hasConcreteData = /(\$\d|\£\d|\€\d|\d+\.\d{2}|https?:\/\/\S{10,}|confirmation.*#|order.*#|booking.*#|@\S+\.\S+|\+1\d{10}|\d{3}[-.\s]\d{3}[-.\s]\d{4}|\d+\/5|\d+\s*stars?|\d+\s*reviews?|\d+\s*ratings?|Rating:|\bON\s+[A-Z]\d[A-Z]\b|\bCA\s+\d{5}\b)/.test(response);
    const isVague = /\b(typically|generally|usually|I recommend|you could try|you might want|I suggest|here are some tips|in general)\b/i.test(response) && !hasConcreteData;

    // Cross-reference: did the AI actually USE the tools it claims?
    // Use action_success_count (not total action_count) — failed actions don't prove work was done
    const taskRecord = await getSupabaseClient().from('tasks').select('action_count, action_success_count').eq('id', taskId).single();
    const actionCount = taskRecord?.data?.action_count || 0;
    const successCount = taskRecord?.data?.action_success_count || 0;

    // Was this a browser-intent task? (from classifier)
    const isBrowserTask = classification.tier === 'multi_step' && (
      /\b(go to|browse|visit|sign up|book|buy|find.*price|check.*price|search.*on|look up)\b/i.test(task.subject) ||
      /\b\w+\.(com|org|net|io|ca)\b/i.test(task.subject)
    );

    let taskStatus: 'completed' | 'needs_review' = 'completed';
    let verificationStatus = 'verified';
    let failReason = '';

    // Quality gate: cross-reference claims vs SUCCESSFUL actions
    if (admitsFailure || credPlaceholderLeaked) {
      taskStatus = 'needs_review';
      verificationStatus = 'failed';
      failReason = `admitsFailure=${admitsFailure}, credLeak=${credPlaceholderLeaked}`;
    } else if (claimsPhoneCall) {
      const { data: recentCalls } = await getSupabaseClient()
        .from('call_history')
        .select('id')
        .eq('user_id', task.userId)
        .gte('created_at', new Date(Date.now() - executionTime - 60000).toISOString())
        .limit(1);
      if (!recentCalls || recentCalls.length === 0) {
        taskStatus = 'needs_review';
        verificationStatus = 'hallucination';
        failReason = 'AI claims phone call but no call_history entry found';
      }
    } else if (claimsEmailSent && successCount < 1) {
      // AI claims email sent but no successful send_email tool call
      taskStatus = 'needs_review';
      verificationStatus = 'hallucination';
      failReason = 'AI claims email sent but no successful send action';
    } else if (claimsBooked && successCount < 5) {
      taskStatus = 'needs_review';
      verificationStatus = 'low_confidence';
      failReason = `Claims booking but only ${successCount} successful actions`;
    } else if (claimsAccountCreated && successCount < 5) {
      taskStatus = 'needs_review';
      verificationStatus = 'low_confidence';
      failReason = `Claims account created but only ${successCount} successful actions`;
    } else if (claimsPurchased && successCount < 5) {
      taskStatus = 'needs_review';
      verificationStatus = 'low_confidence';
      failReason = `Claims purchase but only ${successCount} successful actions`;
    } else if (isBrowserTask && successCount === 0 && responseLower.length > 50) {
      // Browser task with ZERO successful actions — fabricated from training data
      taskStatus = 'needs_review';
      verificationStatus = 'no_actions';
      failReason = 'Browser task but zero successful actions — response is fabricated';
    } else if (isBrowserTask && isVague && !hasConcreteData) {
      // Browser task with vague response and no concrete data
      taskStatus = 'needs_review';
      verificationStatus = 'vague';
      failReason = 'Browser task with vague response — no prices, URLs, or confirmations';
    } else if (isBrowserTask && successCount <= 1 && responseLower.length > 200 && !hasConcreteData) {
      // Browser task with long response but <=1 successful action and no data — likely fabricated
      // NOTE: having a URL in the response does NOT exempt it — URLs can come from training data
      taskStatus = 'needs_review';
      verificationStatus = 'no_actions';
      failReason = `Browser task with long response but only ${successCount} successful actions and no concrete data`;
    }

    if (failReason) {
      console.warn(`[V3] Quality gate: ${verificationStatus} — ${failReason}, response="${response.slice(0, 80)}"`);
    }

    await atomicCompleteTask(
      taskId,
      task.inputChannel,
      task.userId,
      task.from,
      `${task.username}@aevoy.com`,
      task.subject,
      response,
      {
        status: taskStatus,
        completed_at: new Date().toISOString(),
        execution_time_ms: executionTime,
        verification_status: verificationStatus,
      },
      { suppressEmail: task.suppressEmail }
    );

    // ── Cleanup browser engine ──
    await cleanupTaskEngine(taskId);
    await cleanupTaskPage(taskId);

    // ── Deduct total task cost from credit wallet (single deduction, no rounding loss) ──
    try {
      const { data: costData } = await getSupabaseClient()
        .from('ai_cost_log')
        .select('cost_usd')
        .eq('task_id', taskId);
      if (costData && costData.length > 0) {
        const totalCostUsd = costData.reduce((sum, row) => sum + (row.cost_usd || 0), 0);
        const totalCostCents = Math.ceil(totalCostUsd * 100); // ceil to never undercharge
        if (totalCostCents > 0) {
          await getSupabaseClient().rpc('deduct_credits', {
            p_user_id: task.userId,
            p_amount_cents: totalCostCents,
            p_description: `Task: ${task.subject.substring(0, 60)} ($${totalCostUsd.toFixed(4)})`,
            p_task_id: taskId,
          });
          console.log(`[V3] Deducted ${totalCostCents}¢ from wallet for task ${taskId.slice(0, 8)}`);
        }
      }
    } catch (err) {
      console.warn(`[V3] Wallet deduction failed for task ${taskId.slice(0, 8)}:`, err);
    }

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

    // Cleanup browser engine on error
    if (taskId) { await cleanupTaskEngine(taskId); await cleanupTaskPage(taskId); }

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

  // ── Browser tasks — MUST go to multi_step for browser tools ──

  // Explicit URL in task (contains .com/.org/.net/.io/.ca/.co/.ai etc.)
  if (/\b\w+\.(com|org|net|io|ca|co|ai|app|dev|me|us|uk|edu|gov|info|biz)\b/i.test(lower)) {
    return { tier: 'multi_step', reasoning: 'task contains URL — browser required' };
  }

  // Navigation intent (go to / browse / visit / open / navigate to / check out)
  if (/\b(go\s+to|browse|navigate\s+to|visit|open|check\s+out|look\s+at|head\s+to|pull\s+up)\b.*\b(website|site|page|portal|platform|app)\b/i.test(lower)) {
    return { tier: 'multi_step', reasoning: 'navigation intent — browser required' };
  }

  // Action-on-website intent (sign up, register, create account, book, reserve, purchase, buy, order, cancel, apply, log in)
  if (/\b(sign\s*up|signup|register|create\s*(an?\s*)?account|book\s*(a|an|the|me)?|reserv|purchase|buy|order|cancel\s*(my|a|the)?\s*(subscription|account|membership|plan|service)|apply\s*(for|to|on)|log\s*in|login|subscribe|enroll|checkout|add\s*to\s*cart)\b/i.test(lower)) {
    return { tier: 'multi_step', reasoning: 'website action intent — browser required' };
  }

  // Research/scrape intent requiring live web data
  if (/\b(find|search|look\s*up|research|compare|check)\b.*\b(price|cost|availability|review|rating|stock|listing|job|flight|hotel|restaurant|menu|hours|address|phone\s*number|contact)\b/i.test(lower) && lower.length > 20) {
    return { tier: 'multi_step', reasoning: 'live web research — browser required' };
  }

  // ── For ambiguous tasks, use AI classification ──
  try {
    const classifyPrompt = `Classify this task into exactly one category. Respond with ONLY the category name, nothing else.

Categories:
- instant: Simple greeting, small talk, conversational response, OR factual/knowledge questions the AI can answer from memory (e.g. "what is the capital of X", "explain Y", "how does Z work", math, translations, definitions, general knowledge)
- weather: Weather check for a location
- send_email: Send an email to someone
- send_sms: Send a text/SMS message
- schedule: Schedule a reminder, task, or callback
- generate_image: Create/generate an image
- create_document: Create a document (Word/Excel/PowerPoint/PDF)
- make_call: Place a voice call
- browser: Task requiring a REAL web browser to interact with a specific website (sign up, book, buy, add to cart, cancel subscription, fill forms, scrape live data from a site)
- multi_step: Complex task needing multiple different actions in sequence

RULES:
- "instant" is ONLY for greetings, small talk, or pure knowledge questions (definitions, math, history facts)
- If the task mentions ANY website, URL, domain, service name, or brand — it's "browser"
- If the task asks to sign up, book, buy, cancel, apply, check prices, or interact with any online service — it's "browser"
- When in doubt between "instant" and "browser", ALWAYS choose "browser"

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
      { role: 'system', content: `You are Aevoy, a friendly AI assistant for ${ctx.username}. Respond naturally and concisely. Current time: ${new Date().toLocaleString('en-US', { timeZone: ctx.profile.timezone })}.\n\nIMPORTANT: You are NOT connected to the internet. You CANNOT browse websites, check prices, make calls, send emails, or access any external services. Only answer from your training knowledge. If the question requires live data, say "I'd need to look that up online — let me search for you" and nothing more.` },
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

  // ── Stall detection state ──
  let lastUrl = '';
  let sameUrlCount = 0;
  let screenshotCount = 0;
  let locateCount = 0;
  let wrapUpInjected = false;
  let strategyPivotInjected = false;
  let actionCount = 0;    // Total browser/tool actions taken (for quality gate)
  let actionSuccessCount = 0;
  let consecutiveFailures = 0;   // Consecutive failed tool calls
  let lastMeaningfulProgress = 0; // Iteration of last successful form fill or navigation
  const progressNotes: string[] = []; // Running log of what was accomplished
  const triedDomains = new Set<string>(); // Domains we've already visited

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

    // ── Goal progress checks + iteration caps ──
    // At iteration 20: ask AI to self-assess progress
    if (iterations === 20) {
      messages.push({
        role: 'user',
        content: `PROGRESS CHECK (iteration 20): Are you making REAL progress toward the goal? Specifically:
- If this is a signup: have you filled the form and clicked submit?
- If this is a search: have you found at least 1 concrete result?
- If this is a booking: have you selected a date/time and started the booking?
If NOT, you're stuck. IMMEDIATELY try a completely different approach or deliver what you have.`
      });
    }
    // At iteration 50: second progress check — are you still making progress?
    if (iterations === 50 && !wrapUpInjected) {
      wrapUpInjected = true;
      messages.push({
        role: 'user',
        content: `PROGRESS CHECK (iteration 50): You've been working for a while. Quick assessment:
1. Are you making REAL progress? (forms filled, buttons clicked, data found)
2. If you're stuck in a loop → try a COMPLETELY different approach or site
3. If you have partial results → keep going but stay focused
4. DO NOT keep retrying the same failing approach — pivot to something new`
      });
    }
    // At iteration 100: serious wrap-up warning
    if (iterations === 100) {
      messages.push({
        role: 'user',
        content: `EFFICIENCY CHECK (iteration 100): You've had many steps. Focus:
1. If your current approach is working → finish it NOW, don't add unnecessary steps
2. If it's NOT working → deliver what you have so far with concrete data
3. You still have tools available — use them if needed to complete the task
4. Your response must have CONCRETE DATA (prices, URLs, confirmations, names)`
      });
    }
    // Dynamic iteration management: no hard cap. The progress checks at 20/30/45
    // guide the AI to deliver results. The 40-minute timeout is the real ceiling.
    // Only force-stop if we've been running 100+ iterations with zero meaningful progress.
    if (iterations >= 100 && (iterations - lastMeaningfulProgress) > 50) {
      // Build a meaningful summary from progress notes + last AI response
      const progressSummary = progressNotes.filter(n => !n.startsWith('✗')).slice(-10).join('\n');
      const domainsVisited = [...triedDomains].join(', ');
      const lastAiResponse = messages.filter(m => m.role === 'assistant' && m.content && m.content.length > 20)
        .pop()?.content?.substring(0, 300) || '';

      if (progressSummary || lastAiResponse) {
        return `I worked through ${iterations} steps visiting ${domainsVisited || 'multiple sites'}. Here's what I accomplished:\n\n${progressSummary}\n\n${lastAiResponse ? `Last finding: ${lastAiResponse}` : 'I was unable to fully complete the task but made partial progress above.'}`;
      }
      return `I spent ${iterations} steps trying to complete this task but couldn't get reliable results. The sites I tried (${domainsVisited || 'various'}) had strong bot detection that blocked me. You may need to complete this task manually or try again later.`;
    }

    // NO hard cost stops — iterations are necessary to complete complex tasks.
    // Cost is managed by: making Gemini reliable (fewer Haiku fallbacks),
    // aggressive context compression, and smaller snapshots.
    // The AI decides when it's done. The quality gate catches bad results.

    // ── Call AI model with tools ──
    let modelResponse;
    try {
      // Reduce maxTokens at high iterations — the AI should be making shorter,
      // focused decisions, not writing essays. Saves tokens and money.
      const tokensForStep = iterations > 60 ? 1000 : iterations > 30 ? 1500 : 2000;
      modelResponse = await callModel({
        messages,
        tier: 'multi_step',
        useTools: true,
        maxTokens: tokensForStep,
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
        // GIVE-UP DETECTION: reject surrender responses and force the AI to keep trying
        const isGiveUp = /\b(can't complete|cannot complete|unable to|couldn't|can't access|I can't|I cannot|not able to|having trouble|privacy error|blocked|unfortunately.*I|I apologize|wasn't able|was unable|I'm sorry.*but|doesn't exist yet|hasn't been (released|announced)|not yet available|no.*results|all.*attempts.*fail|websites.*failing|out of stock.*I'll|let you know if|I'll try.*later|require.*login|require.*account|need to log in|access.*denied)\b/i.test(response);

        // Also reject responses without concrete data when browser tools are available
        const hasConcreteResult = /(\$\d|\£\d|\€\d|\d+\.\d{2}|https?:\/\/\S{10,}|confirmation|successfully|completed|here (are|is) (the|your))/.test(response);
        const isVagueGiveUp = !hasConcreteResult && iterations < 15 && response.length < 300 && /\b(typically|generally|unfortunately|however)\b/i.test(response);

        // Also reject mid-thought responses that aren't real answers
        const isMidThought = /\b(let me|let's see|I'll try|I'll keep|I'm on|I'm going to|I need to|I should|I'm currently|I've typed|I just|I'm now|I'm still|I'm about to|I'll update|keep you updated|working on|in progress)\b/i.test(response) && !hasConcreteResult;

        const shouldReject = isGiveUp || isVagueGiveUp || isMidThought;
        const giveUpCount = messages.filter(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('DO NOT GIVE UP')).length;

        // Reject give-ups and mid-thoughts up to 5 times, no iteration limit
        // After 5 rejections, accept whatever the AI says
        if (shouldReject && giveUpCount < 5) {
          const domainsStr = [...triedDomains].join(', ');
          console.log(`[V3] Rejected give-up (attempt ${giveUpCount + 1}): "${response.substring(0, 80)}"`);
          messages.push({ role: 'assistant', content: response });
          messages.push({
            role: 'user',
            content: `DO NOT GIVE UP. Think like a resourceful human — what would YOU do next?

You already tried: ${domainsStr || 'some approaches'}. That didn't work. So:
1. Try a DIFFERENT website/service that does the same thing
2. Try Google search: browser_go("https://www.google.com/search?q=YOUR+QUERY")
3. If signup is blocked → look for "Sign in with Google" or social login
4. If a form won't work → try the site's mobile version or API
5. If the task is informational → extract data from Google search results directly

Pick ONE new approach and execute it NOW. Don't explain — just DO it.`
          });
          continue;
        }

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

    // Execute each tool call and add results — wrapped in try/catch to NEVER crash V3
    for (let i = 0; i < modelResponse.toolCalls.length; i++) {
      const tc = modelResponse.toolCalls[i];
      console.log(`[V3] Step ${iterations}.${i + 1}: ${tc.name}(${JSON.stringify(tc.arguments).substring(0, 100)})`);

      let result;
      try {
        // Tool-registry handles timeouts: 900s for browser tools, 120s for others.
        // No outer timeout here — the 60s race was killing BrightData escalation
        // (VPS fail 30s + BrightData connect 30s + navigate 30s = 90s minimum).
        result = await executeToolCall(tc, ctx);
        ledger.recordObservation(tc.name, tc.arguments, result);
      } catch (toolErr) {
        const errMsg = toolErr instanceof Error ? toolErr.message : 'unknown';
        console.error(`[V3] Tool ${tc.name} error: ${errMsg}`);
        result = { success: false, error: `Tool error: ${errMsg}`, cost: 0 };
        ledger.recordObservation(tc.name, tc.arguments, result);
      }

      // Track action counts for quality gate
      actionCount++;
      if (result.success) {
        actionSuccessCount++;
        consecutiveFailures = 0;
        // Track meaningful progress (form fills, successful clicks, navigation)
        if (tc.name === 'browser_fill' || tc.name === 'browser_click' || tc.name === 'browser_select') {
          lastMeaningfulProgress = iterations;
        }
      } else {
        consecutiveFailures++;
      }

      // Track domains visited
      if (tc.name === 'browser_go' && tc.arguments?.url) {
        try { triedDomains.add(new URL(String(tc.arguments.url)).hostname); } catch {}
      }

      // Track tool cost
      if (result.cost > 0) {
        try { await budget.trackCost('v3', tc.name, result.cost, `v3:tool:${tc.name}`); } catch { /* non-critical */ }
      }

      // Add tool result to conversation
      const resultContent = result.success
        ? String(result.data || 'Success')
        : `Error: ${result.error || 'Unknown error'}`;
      messages.push({
        role: 'tool',
        content: resultContent,
        tool_call_id: assistantToolCalls[i].id,
      });

      // ── Stall detection: track URLs from browser tool results ──
      if (tc.name === 'browser_go' || tc.name === 'browser_snapshot' || tc.name === 'browser_click' || tc.name === 'browser_click_xy') {
        const urlMatch = resultContent.match(/URL:\s*(\S+)/);
        if (urlMatch) {
          const currentUrl = urlMatch[1];
          if (currentUrl === lastUrl) {
            sameUrlCount++;
          } else {
            // URL changed — record progress
            if (lastUrl) progressNotes.push(`Navigated: ${lastUrl} → ${currentUrl}`);
            lastUrl = currentUrl;
            sameUrlCount = 0;
          }
        }
      }

      // Track vision tool overuse
      if (tc.name === 'browser_screenshot') screenshotCount++;
      if (tc.name === 'browser_locate') locateCount++;

      // Track ALL actions for progress log — both successes AND failures
      // Failed actions MUST survive context compression so the AI doesn't retry them
      if (tc.name === 'browser_fill' && result.success) {
        progressNotes.push(`✓ Filled: ${JSON.stringify(tc.arguments).substring(0, 80)}`);
      } else if (tc.name === 'browser_fill' && !result.success) {
        progressNotes.push(`✗ FAILED fill: ${result.error?.substring(0, 60)}`);
      }
      if (tc.name === 'browser_click' && result.success) {
        const clickText = resultContent.match(/Clicked \[.*?\] \(.*?"(.*?)"\)/)?.[1] || '';
        if (clickText) progressNotes.push(`✓ Clicked: "${clickText}"`);
      } else if (tc.name === 'browser_click' && !result.success) {
        progressNotes.push(`✗ FAILED click: ${result.error?.substring(0, 60)}`);
      }
      if (tc.name === 'browser_go' && !result.success) {
        progressNotes.push(`✗ FAILED navigate: ${String(tc.arguments?.url).substring(0, 60)} — ${result.error?.substring(0, 40)}`);
      }
      // Track CAPTCHA blocks
      if (resultContent.includes('CAPTCHA BLOCKING')) {
        progressNotes.push(`⚠ CAPTCHA blocked on ${lastUrl} — must change strategy`);
      }
    }

    // ── STRATEGIC THINKING: Force the AI to pivot when stuck ──

    // Strategy pivot: no meaningful progress in 15 iterations → force complete rethink
    if (!strategyPivotInjected && iterations > 15 && (iterations - lastMeaningfulProgress) > 15) {
      strategyPivotInjected = true;
      const domainsStr = [...triedDomains].join(', ');
      console.log(`[V3] STRATEGY PIVOT at iteration ${iterations}: no progress since iteration ${lastMeaningfulProgress}`);
      messages.push({
        role: 'user',
        content: `STOP. THINK. You've spent ${iterations} iterations without meaningful progress.

You already tried: ${domainsStr || 'various approaches'}

A smart human would NOT keep trying the same thing. Think like this:
1. WHAT specifically is blocking you? (CAPTCHA? Form not loading? Bot detection? Page error?)
2. Is there a COMPLETELY DIFFERENT way to accomplish this task?
   - If signup is blocked → try Google OAuth / "Sign in with Google" button
   - If site blocks bots → try a different site that offers the same service
   - If form won't submit → try the mobile version of the site (m.site.com)
   - If the task is "find information" → use Google search instead of navigating the site
3. Can you accomplish PART of the task even if you can't do everything?

PICK ONE NEW STRATEGY and execute it. Do NOT retry what already failed.`
      });
    }

    // Consecutive failures: 5 tool calls in a row failed
    if (consecutiveFailures >= 5) {
      console.log(`[V3] ${consecutiveFailures} consecutive tool failures at iteration ${iterations}`);
      messages.push({
        role: 'user',
        content: `${consecutiveFailures} tool calls in a row have FAILED. Something is fundamentally wrong with your current approach. STOP and try something completely different — different URL, different tool, different strategy entirely.`
      });
      consecutiveFailures = 0;
    }

    // Stall detection: same URL for 6+ rounds
    if (sameUrlCount >= 6 && iterations > 10) {
      console.log(`[V3] Stall detected at iteration ${iterations}: same URL for ${sameUrlCount} rounds`);
      messages.push({
        role: 'user',
        content: `STALL: Same page for ${sameUrlCount} rounds. Use DOM mode: browser_snapshot() → browser_click(ref). If this page is truly stuck, navigate to a different URL entirely.`
      });
      sameUrlCount = 0;
    }

    // Cost awareness: if spending heavily without completing, the AI should know
    // This is NOT a hard cap — the AI decides what to do with this information
    if (iterations === 80 && budget.totalSpent > 0.30) {
      messages.push({
        role: 'user',
        content: `COST AWARENESS: You've spent $${budget.totalSpent.toFixed(2)} across ${iterations} steps. You have budget remaining but be efficient:
1. If you have PARTIAL results — deliver them now. Something is better than nothing.
2. If a site keeps blocking you — switch to a DIFFERENT site immediately, don't keep retrying.
3. Make every remaining step count — no more exploratory browsing.
4. You CAN keep going if you're close to completing the task. But stop wasting steps on approaches that clearly aren't working.`
      });
    }

    // Vision tool overuse
    if (screenshotCount > 8 && iterations > 15) {
      messages.push({
        role: 'user',
        content: `Too many screenshots (${screenshotCount}). Use browser_snapshot() + browser_click(ref) instead — it's faster and more precise.`
      });
      screenshotCount = 0;
    }

    // ── Context compression — more aggressive at high iteration counts ──
    // Token costs grow quadratically: more iterations = longer context = higher cost per call.
    // Compress every 5 iterations normally, every 3 after iteration 30, every 2 after 80.
    const compressInterval = iterations > 80 ? 2 : iterations > 30 ? 3 : 5;
    if (iterations % compressInterval === 0 && messages.length > 10) {
      const compressed = compressMessagesV2(messages, progressNotes);
      messages.length = 0;
      messages.push(...compressed);
    }

    // ── Update progress in DB ──
    try {
      await getSupabaseClient().from('tasks').update({
        progress_message: `Step ${iterations}: ${modelResponse.toolCalls.map(tc => tc.name).join(', ')}`,
        iteration_count: iterations,
        action_count: actionCount,
        action_success_count: actionSuccessCount,
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
 * V2 context compression — preserves progress awareness.
 *
 * Strategy:
 * 1. Keep system prompt + original task
 * 2. Build a progress summary from progressNotes (what was accomplished)
 * 3. Keep the last 8 messages (4 exchanges) — these must be structurally valid
 *    (assistant with tool_calls must be followed by matching tool results)
 * 4. Total context stays manageable even at 100+ iterations
 */
function compressMessagesV2(
  messages: Array<{ role: string; content: string; [key: string]: any }>,
  progressNotes: string[]
): Array<any> {
  if (messages.length <= 12) return messages;

  const system = messages[0]; // System prompt is always first
  const firstUser = messages.find(m => m.role === 'user' && !m.content?.startsWith('['));

  // Find a clean cut point for recent messages — must start with assistant or user, not tool
  let recentStart = messages.length - 10;
  while (recentStart > 2 && messages[recentStart]?.role === 'tool') {
    recentStart--; // Back up to include the assistant message with tool_calls
  }
  const recent = messages.slice(recentStart);

  // Build progress summary
  const progressSummary = progressNotes.length > 0
    ? `PROGRESS SO FAR:\n${progressNotes.slice(-15).map((n, i) => `${i + 1}. ${n}`).join('\n')}`
    : '';

  // Extract the last URL seen for context
  let lastSeenUrl = '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const urlMatch = messages[i].content?.match(/URL:\s*(\S+)/);
    if (urlMatch) { lastSeenUrl = urlMatch[1]; break; }
  }

  const result: any[] = [];
  result.push(system);
  if (firstUser) result.push(firstUser);

  // Insert progress context — CRITICAL: tell AI where it is and what it already did
  const contextParts: string[] = [];
  if (progressSummary) contextParts.push(progressSummary);
  if (lastSeenUrl) {
    contextParts.push(`CURRENT BROWSER PAGE: ${lastSeenUrl}`);
    contextParts.push(`IMPORTANT: You are ALREADY on this page. Do NOT navigate back to earlier pages. Continue from where you are.`);
  }
  contextParts.push(`Iterations used: ${messages.filter(m => m.role === 'assistant').length}. Continue working — do not restart.`);

  result.push({ role: 'user', content: contextParts.join('\n\n') });
  result.push(...recent);

  return result;
}

/**
 * Strip any leaked credential references from response text.
 * Prevents [CRED_EMAIL], [CRED_PASS], etc. from reaching the user.
 * Also strips common patterns of exposed secrets.
 */
function stripCredentialLeaks(text: string): string {
  let clean = text;
  // Strip credential reference tokens
  clean = clean.replace(/\[CRED_\w+\]/gi, '[redacted]');
  // Strip anything that looks like an exposed API key or secret
  clean = clean.replace(/\b(sk-[a-zA-Z0-9]{20,})\b/g, '[redacted-key]');
  clean = clean.replace(/\b(Bearer\s+[a-zA-Z0-9._-]{20,})\b/g, 'Bearer [redacted]');
  // Note: Don't strip password patterns from responses — user may have asked for credentials
  // Only strip internal credential tokens and API keys above
  return clean;
}
