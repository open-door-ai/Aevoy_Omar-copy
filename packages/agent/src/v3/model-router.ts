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

// ── Model configurations ──

interface ModelConfig {
  provider: 'groq' | 'gemini' | 'haiku' | 'deepseek' | 'openrouter' | 'cerebras';
  model: string;
  costPerMInput: number;
  costPerMOutput: number;
  supportsToolCalling: boolean;
}

const TIER_MODELS: Record<string, ModelConfig[]> = {
  // Tier 1 (instant): fast, free models
  classify: [
    { provider: 'groq', model: 'llama-3.1-8b-instant', costPerMInput: 0, costPerMOutput: 0, supportsToolCalling: false },
    { provider: 'gemini', model: 'gemini-2.5-flash', costPerMInput: 0.15, costPerMOutput: 0.60, supportsToolCalling: true },
  ],
  // Tier 1/2 (instant/single_tool): quick response
  instant: [
    { provider: 'groq', model: 'llama-3.1-8b-instant', costPerMInput: 0, costPerMOutput: 0, supportsToolCalling: false },
    { provider: 'groq', model: 'meta-llama/llama-4-scout-17b-16e-instruct', costPerMInput: 0, costPerMOutput: 0, supportsToolCalling: false },
    { provider: 'gemini', model: 'gemini-2.5-flash', costPerMInput: 0.15, costPerMOutput: 0.60, supportsToolCalling: true },
    { provider: 'haiku', model: 'claude-haiku-4-5-20251001', costPerMInput: 1.00, costPerMOutput: 5.00, supportsToolCalling: true },
  ],
  // Tier 3 (multi_step): needs tool calling
  multi_step: [
    { provider: 'gemini', model: 'gemini-2.5-flash', costPerMInput: 0.15, costPerMOutput: 0.60, supportsToolCalling: true },
    { provider: 'groq', model: 'moonshotai/kimi-k2-instruct-0905', costPerMInput: 0, costPerMOutput: 0, supportsToolCalling: false },
    { provider: 'groq', model: 'meta-llama/llama-4-scout-17b-16e-instruct', costPerMInput: 0, costPerMOutput: 0, supportsToolCalling: false },
    { provider: 'haiku', model: 'claude-haiku-4-5-20251001', costPerMInput: 1.00, costPerMOutput: 5.00, supportsToolCalling: true },
  ],
};

// ── Rate limit tracking ──

const backoffUntil = new Map<string, number>();

function isBackedOff(key: string): boolean {
  const until = backoffUntil.get(key) || 0;
  return Date.now() < until;
}

function setBackoff(key: string, durationMs: number): void {
  backoffUntil.set(key, Date.now() + durationMs);
  console.log(`[V3-MODEL] ${key} backed off for ${Math.round(durationMs / 1000)}s`);
}

// ── Client initialization ──

let groqClient: OpenAI | null = null;
let geminiClient: OpenAI | null = null;

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
  maxTokens?: number;
  temperature?: number;
}

/**
 * Call an AI model with fast fallback.
 * Tries primary model, immediately falls back to paid model on rate limit.
 */
export async function callModel(opts: CallOptions): Promise<ModelResponse> {
  const models = TIER_MODELS[opts.tier] || TIER_MODELS.instant;
  const tools = opts.useTools ? buildFunctionSchemas() : undefined;

  for (const model of models) {
    const key = `${model.provider}:${model.model}`;
    if (isBackedOff(key)) continue;
    if (!hasApiKey(model.provider)) continue;

    // For tool calling, skip models that don't support it (unless no tools needed)
    if (opts.useTools && !model.supportsToolCalling) continue;

    try {
      const result = await callProvider(model, opts.messages, tools, opts.maxTokens, opts.temperature);
      return result;
    } catch (err: any) {
      if (err?.status === 429 || err?.status === 402 || err?.message?.includes('429') || err?.message?.includes('rate')) {
        setBackoff(key, 120000); // 2 min backoff
        continue;
      }
      if (err?.status === 503 || err?.status === 500) {
        setBackoff(key, 30000); // 30s backoff for server errors
        continue;
      }
      console.warn(`[V3-MODEL] ${key} error:`, err?.message || err);
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
  const timeoutMs = model.provider === 'groq' ? 15000 : model.provider === 'gemini' ? 45000 : 30000;

  if (model.provider === 'haiku') {
    return callAnthropic(model, messages, tools, maxTokens, temperature);
  }

  const client = model.provider === 'groq' ? getGroqClient() : getGeminiClient();

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
          console.warn(`[V3-MODEL] Failed to parse tool call args: ${tc.function.arguments}`);
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
  const anthropicMessages: any[] = nonSystemMsgs.map(m => {
    if (m.role === 'tool') {
      return {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: m.tool_call_id || 'unknown', content: m.content }],
      };
    }
    if (m.tool_calls && m.tool_calls.length > 0) {
      const content: any[] = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const tc of m.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id || `call_${Date.now()}`,
          name: tc.function?.name || tc.name,
          input: typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : (tc.arguments || {}),
        });
      }
      return { role: 'assistant', content };
    }
    return { role: m.role === 'user' ? 'user' : 'assistant', content: m.content };
  });

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
