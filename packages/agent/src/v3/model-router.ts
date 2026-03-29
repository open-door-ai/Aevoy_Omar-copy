/**
 * V3 Model Router
 *
 * Handles AI model calls for the V3 processor.
 * Uses native function/tool calling where possible.
 * Fast fallback to paid models when free models are rate-limited.
 */

import OpenAI from 'openai';
import type { ToolCall, ModelResponse, TaskTier } from './types.js';
import { buildFunctionSchemas } from './tool-registry.js';
import { trackError } from '../utils/error-tracker.js';
import { logger } from '../utils/logger.js';

// ── Model configurations ──

interface ModelConfig {
  provider: 'groq' | 'gemini' | 'haiku' | 'deepseek' | 'openrouter' | 'cerebras';
  model: string;
  costPerMInput: number;
  costPerMOutput: number;
  supportsToolCalling: boolean;
}

/** Exported cost constants for DeepSeek (used by cost calculators) */
export const DEEPSEEK_COST = { perMInput: 0.28, perMOutput: 0.42 } as const;

const TIER_MODELS: Record<string, ModelConfig[]> = {
  // Classification: fast + free
  classify: [
    { provider: 'groq', model: 'llama-3.1-8b-instant', costPerMInput: 0, costPerMOutput: 0, supportsToolCalling: false },
    { provider: 'deepseek', model: 'deepseek-chat', costPerMInput: 0.28, costPerMOutput: 0.42, supportsToolCalling: true },
  ],
  // Instant responses: free first, then cheap
  instant: [
    { provider: 'groq', model: 'llama-3.1-8b-instant', costPerMInput: 0, costPerMOutput: 0, supportsToolCalling: false },
    { provider: 'groq', model: 'meta-llama/llama-4-scout-17b-16e-instruct', costPerMInput: 0, costPerMOutput: 0, supportsToolCalling: false },
    { provider: 'deepseek', model: 'deepseek-chat', costPerMInput: 0.28, costPerMOutput: 0.42, supportsToolCalling: true },
    { provider: 'gemini', model: 'gemini-2.5-flash', costPerMInput: 0.15, costPerMOutput: 0.60, supportsToolCalling: true },
  ],
  // Simple steps within multi-step (snapshot reads, simple clicks): DeepSeek first (no quota wall)
  simple_step: [
    { provider: 'deepseek', model: 'deepseek-chat', costPerMInput: 0.28, costPerMOutput: 0.42, supportsToolCalling: true },
    { provider: 'gemini', model: 'gemini-2.5-flash', costPerMInput: 0.15, costPerMOutput: 0.60, supportsToolCalling: true },
  ],
  // Multi-step browser/tool tasks (complex reasoning, planning, multi-field forms):
  // DeepSeek first (no quota wall, $0.28/$0.42) → Gemini → Haiku
  multi_step: [
    { provider: 'deepseek', model: 'deepseek-chat', costPerMInput: 0.28, costPerMOutput: 0.42, supportsToolCalling: true },
    { provider: 'gemini', model: 'gemini-2.5-flash', costPerMInput: 0.15, costPerMOutput: 0.60, supportsToolCalling: true },
    { provider: 'haiku', model: 'claude-haiku-4-5-20251001', costPerMInput: 1.00, costPerMOutput: 5.00, supportsToolCalling: true },
  ],
};

// ── Session-level model performance tracking ──
// Tracks success/failure per model within a process lifetime.
// Helps the router learn which models are working for the current session.

interface ModelPerformance {
  successes: number;
  failures: number;
  lastFailure: number; // timestamp
}

const sessionModelPerf = new Map<string, ModelPerformance>();

function recordModelSuccess(modelKey: string): void {
  const perf = sessionModelPerf.get(modelKey) || { successes: 0, failures: 0, lastFailure: 0 };
  perf.successes++;
  sessionModelPerf.set(modelKey, perf);
}

function recordModelFailure(modelKey: string): void {
  const perf = sessionModelPerf.get(modelKey) || { successes: 0, failures: 0, lastFailure: 0 };
  perf.failures++;
  perf.lastFailure = Date.now();
  sessionModelPerf.set(modelKey, perf);
}

/** Check if a model has been unreliable recently (>60% failure rate, min 3 attempts) */
function isModelUnreliable(modelKey: string): boolean {
  const perf = sessionModelPerf.get(modelKey);
  if (!perf) return false;
  const total = perf.successes + perf.failures;
  if (total < 3) return false; // Need enough data
  const failRate = perf.failures / total;
  // If it failed >60% of the time and last failure was in the last 5 minutes
  return failRate > 0.6 && (Date.now() - perf.lastFailure) < 5 * 60 * 1000;
}

/** Get exported session performance data (for logging/diagnostics) */
export function getSessionModelStats(): Record<string, ModelPerformance> {
  return Object.fromEntries(sessionModelPerf);
}

/** Get current backoff status for all providers (for health checks) */
export function getBackoffStatus(): Record<string, { backedOff: boolean; remainingMs: number }> {
  const now = Date.now();
  const status: Record<string, { backedOff: boolean; remainingMs: number }> = {};
  for (const [key, until] of backoffUntil.entries()) {
    status[key] = {
      backedOff: now < until,
      remainingMs: Math.max(0, until - now),
    };
  }
  return status;
}

// ── Rate limit tracking ──

const backoffUntil = new Map<string, number>();

function isBackedOff(key: string): boolean {
  const until = backoffUntil.get(key) || 0;
  return Date.now() < until;
}

function setBackoff(key: string, durationMs: number): void {
  backoffUntil.set(key, Date.now() + durationMs);
  logger.info({ key, durationMs: Math.round(durationMs / 1000) }, `[V3-MODEL] ${key} backed off for ${Math.round(durationMs / 1000)}s`);
}

// ── Client initialization ──

let groqClient: OpenAI | null = null;
let geminiClient: OpenAI | null = null;
let deepseekClient: OpenAI | null = null;

function getDeepseekClient(): OpenAI {
  if (!deepseekClient) {
    deepseekClient = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY || '',
      baseURL: 'https://api.deepseek.com/v1',
    });
  }
  return deepseekClient;
}

function getGroqClient(): OpenAI {
  if (!groqClient) {
    groqClient = new OpenAI({
      apiKey: process.env.GROQ_API_KEY || '',
      baseURL: 'https://api.groq.com/openai/v1',
    });
  }
  return groqClient;
}

function getGeminiClient(): OpenAI {
  if (!geminiClient) {
    geminiClient = new OpenAI({
      apiKey: process.env.GOOGLE_API_KEY || '',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    });
  }
  return geminiClient;
}

// ── Core call function ──

export interface CallOptions {
  messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; tool_calls?: any[] }>;
  tier: string;
  useTools?: boolean;
  toolCategory?: string | string[]; // Filter tools by category string (e.g., 'browser') or by explicit tool name list
  maxTokens?: number;
  temperature?: number;
  /** Step complexity hint: 'simple' for snapshot reads/basic clicks, 'complex' for planning/multi-field forms */
  stepComplexity?: 'simple' | 'complex';
}

/**
 * Call an AI model with fast fallback.
 * Tries primary model, immediately falls back to paid model on rate limit.
 *
 * Smart model selection: when stepComplexity is provided, routes to the
 * appropriate tier automatically. 'simple' uses the cheapest models,
 * 'complex' uses the full multi_step chain.
 */
export async function callModel(opts: CallOptions): Promise<ModelResponse> {
  // Smart tier selection based on step complexity hint
  let effectiveTier = opts.tier;
  if (opts.tier === 'multi_step' && opts.stepComplexity === 'simple') {
    effectiveTier = 'simple_step';
  }

  const models = TIER_MODELS[effectiveTier] || TIER_MODELS.instant;
  const tools = opts.useTools ? buildFunctionSchemas(opts.toolCategory) : undefined;

  for (const model of models) {
    const key = `${model.provider}:${model.model}`;
    if (isBackedOff(key)) continue;
    if (!hasApiKey(model.provider)) continue;

    // Skip models that have been unreliable this session (>60% failure rate)
    if (isModelUnreliable(key)) {
      logger.info({ model: key }, '[V3-MODEL] Skipping unreliable model (session failure rate too high)');
      continue;
    }

    // For tool calling, skip models that don't support it (unless no tools needed)
    if (opts.useTools && !model.supportsToolCalling) continue;

    try {
      const result = await callProvider(model, opts.messages, tools, opts.maxTokens, opts.temperature);
      recordModelSuccess(key);
      return result;
    } catch (err: any) {
      recordModelFailure(key);
      trackError('ai');
      if (err?.status === 429 || err?.status === 402 || err?.message?.includes('429') || err?.message?.includes('rate')) {
        if (model.provider === 'gemini') {
          // Gemini TPM (tokens per minute) rate limit — tool-calling requests are large.
          // Wait 10s first, then 30s, then 60s. The per-minute limit resets over ~60s.
          // Haiku account is EMPTY — Gemini is the ONLY working model. Must wait and retry.
          // With reduced tool schemas (6 instead of 38), requests are 75% smaller.
          // Shorter waits should work now. Try 5s, 15s, 30s.
          for (const waitMs of [5000, 15000, 30000]) {
            logger.info({ waitSec: waitMs / 1000 }, `[V3-MODEL] Gemini 429 — waiting ${waitMs/1000}s then retrying`);
            await new Promise(r => setTimeout(r, waitMs));
            try {
              return await callProvider(model, opts.messages, tools, opts.maxTokens, opts.temperature);
            } catch (retryErr: any) {
              if (retryErr?.status !== 429) {
                // Non-rate-limit error — set backoff and try next model
                setBackoff(key, 5000);
                break;
              }
              // Still 429 — try next wait duration
            }
          }
          // All retries exhausted — set backoff and try next model
          setBackoff(key, 10000);
          continue;
        }
        const backoffMs = model.provider === 'groq' ? 60000 : 30000;
        setBackoff(key, backoffMs);
        continue;
      }
      if (err?.status === 503 || err?.status === 500) {
        setBackoff(key, 10000); // 10s backoff for server errors (was 30s)
        continue;
      }
      // Timeout/abort: don't back off, just skip this attempt (next call retries Gemini)
      const isTimeout = err?.name === 'AbortError' || err?.message?.includes('abort') || err?.message?.includes('Timeout');
      if (isTimeout) {
        logger.warn({ model: key }, '[V3-MODEL] timeout — will retry next call');
      } else {
        logger.warn({ model: key, err: err?.message || err }, '[V3-MODEL] model error');
        setBackoff(key, 5000); // Brief 5s backoff for unknown errors
      }
      continue;
    }
  }

  throw new Error('All AI models are currently unavailable. Please try again shortly.');
}

/**
 * Fast classify call — uses cheapest model, no tool calling needed.
 */
export async function classifyCall(prompt: string): Promise<string> {
  const result = await callModel({
    messages: [{ role: 'user', content: prompt }],
    tier: 'classify',
    maxTokens: 100,
    temperature: 0,
  });
  return result.content;
}

// ── Provider-specific call logic ──

async function callProvider(
  model: ModelConfig,
  messages: CallOptions['messages'],
  tools?: ReturnType<typeof buildFunctionSchemas>,
  maxTokens?: number,
  temperature?: number
): Promise<ModelResponse> {
  const timeoutMs = model.provider === 'groq' ? 15000 : model.provider === 'deepseek' ? 30000 : model.provider === 'gemini' ? 45000 : 30000;

  if (model.provider === 'haiku') {
    return callAnthropic(model, messages, tools, maxTokens, temperature);
  }

  const client = model.provider === 'deepseek' ? getDeepseekClient()
    : model.provider === 'groq' ? getGroqClient()
    : getGeminiClient();

  const requestBody: any = {
    model: model.model,
    messages: messages.map(m => {
      // Convert tool_calls format for OpenAI-compatible APIs
      if (m.tool_calls) {
        return { role: m.role, content: m.content || null, tool_calls: m.tool_calls };
      }
      if (m.role === 'tool' && m.tool_call_id) {
        return { role: 'tool', content: m.content, tool_call_id: m.tool_call_id };
      }
      return { role: m.role, content: m.content };
    }),
    max_tokens: maxTokens || 2000,
    temperature: temperature ?? 0.3,
  };

  if (tools && tools.length > 0) {
    requestBody.tools = tools;
    requestBody.tool_choice = 'auto';
  }

  // Promise.race timeout — more compatible than AbortController across providers
  const response = await Promise.race([
    client.chat.completions.create(requestBody),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]) as OpenAI.Chat.Completions.ChatCompletion;

  const choice = response.choices[0];
  const content = choice?.message?.content || '';
  const toolCalls: ToolCall[] = [];

  // Parse native tool calls
  if (choice?.message?.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      if (tc.type === 'function') {
        try {
          const args = JSON.parse(tc.function.arguments || '{}');
          toolCalls.push({ name: tc.function.name, arguments: args });
        } catch {
          logger.warn({ args: tc.function.arguments }, '[V3-MODEL] Failed to parse tool call args');
        }
      }
    }
  }

  // Calculate cost
  const inputTokens = response.usage?.prompt_tokens || 0;
  const outputTokens = response.usage?.completion_tokens || 0;
  const cost = (inputTokens * model.costPerMInput + outputTokens * model.costPerMOutput) / 1_000_000;

  // Strip <think> tags from some models
  const cleanContent = content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*/gi, '')
    .replace(/<\/think>/gi, '')
    .trim();

  return {
    content: cleanContent,
    toolCalls,
    tokensUsed: inputTokens + outputTokens,
    cost,
    model: model.model,
  };
}

async function callAnthropic(
  model: ModelConfig,
  messages: CallOptions['messages'],
  tools?: ReturnType<typeof buildFunctionSchemas>,
  maxTokens?: number,
  temperature?: number
): Promise<ModelResponse> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

  // Convert messages to Anthropic format
  const systemMsg = messages.find(m => m.role === 'system');
  const nonSystemMsgs = messages.filter(m => m.role !== 'system');

  // Convert tool schemas to Anthropic format
  const anthropicTools = tools?.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters as any,
  }));

  // Convert messages - handle tool results
  // CRITICAL: Anthropic requires alternating user/assistant roles.
  // Multiple consecutive tool results must be merged into ONE user message
  // with multiple tool_result blocks. Otherwise Anthropic rejects the request.
  const rawMapped = nonSystemMsgs.map(m => {
    if (m.role === 'tool') {
      return {
        role: 'user' as const,
        content: [{ type: 'tool_result', tool_use_id: m.tool_call_id || 'unknown', content: m.content }],
      };
    }
    if (m.tool_calls && m.tool_calls.length > 0) {
      const content: any[] = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const tc of m.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: tc.function?.name || tc.name,
          input: typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : (tc.arguments || {}),
        });
      }
      return { role: 'assistant' as const, content };
    }
    return { role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant', content: m.content };
  });

  // Merge consecutive same-role messages (especially tool results → single user message)
  const anthropicMessages: any[] = [];
  for (const msg of rawMapped) {
    const prev = anthropicMessages[anthropicMessages.length - 1];
    if (prev && prev.role === msg.role) {
      // Merge: combine content arrays or concatenate strings
      if (Array.isArray(prev.content) && Array.isArray(msg.content)) {
        prev.content.push(...msg.content);
      } else if (Array.isArray(prev.content)) {
        prev.content.push({ type: 'text', text: String(msg.content) });
      } else if (Array.isArray(msg.content)) {
        prev.content = [{ type: 'text', text: String(prev.content) }, ...msg.content];
      } else {
        prev.content = `${prev.content}\n\n${msg.content}`;
      }
    } else {
      anthropicMessages.push({ ...msg });
    }
  }

  const response = await Promise.race([
    client.messages.create({
      model: model.model,
      max_tokens: maxTokens || 2000,
      ...(systemMsg ? { system: systemMsg.content } : {}),
      messages: anthropicMessages,
      ...(anthropicTools?.length ? { tools: anthropicTools } : {}),
      temperature: temperature ?? 0.3,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Anthropic timeout after 30s')), 30000)
    ),
  ]) as any;

  let content = '';
  const toolCalls: ToolCall[] = [];

  for (const block of response.content || []) {
    if (block.type === 'text') {
      content += block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push({ name: block.name, arguments: block.input || {} });
    }
  }

  const inputTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;
  const cost = (inputTokens * model.costPerMInput + outputTokens * model.costPerMOutput) / 1_000_000;

  return {
    content,
    toolCalls,
    tokensUsed: inputTokens + outputTokens,
    cost,
    model: model.model,
  };
}

function hasApiKey(provider: string): boolean {
  switch (provider) {
    case 'groq': return !!process.env.GROQ_API_KEY;
    case 'gemini': return !!process.env.GOOGLE_API_KEY;
    case 'haiku': return !!process.env.ANTHROPIC_API_KEY;
    case 'deepseek': return !!process.env.DEEPSEEK_API_KEY;
    case 'openrouter': return !!process.env.OPENROUTER_API_KEY;
    case 'cerebras': return !!process.env.CEREBRAS_API_KEY;
    default: return false;
  }
}
