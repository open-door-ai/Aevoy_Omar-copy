/**
 * AI Service — V2 Model Routing
 *
 * Routes to the appropriate AI model based on task type and cost.
 * Fallback chain ensures tasks always complete.
 *
 * Model Hierarchy:
 * - DeepSeek V3.2: $0.25/M input, $0.38/M output (default)
 * - Kimi K2: $0.60/M input, $2.50/M output (75% cache savings)
 * - Gemini 2.0 Flash: Free tier (validation, fallback)
 * - Claude Sonnet 4: $3/M input, $15/M output (complex, vision)
 * - Claude Haiku: $0.25/M input, $1.25/M output (fast fallback)
 * - Ollama (local): Free (privacy mode, offline)
 */

import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { getSupabaseClient } from "../utils/supabase.js";
import { getCompiledPrompt } from "./personality.js";
import type { Memory, Action, AIResponse, TaskType, ModelProvider } from "../types/index.js";
import { withTimeout } from "../utils/timeout.js";
import { CircuitBreaker } from "../execution/retry.js";

// ---- Response Cache (LRU, 100 entries, 5-min TTL) ----

interface CacheEntry {
  response: AIResponse;
  timestamp: number;
}

const responseCache = new Map<string, CacheEntry>();
const CACHE_MAX_SIZE = 100;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCacheKey(taskType: string, prompt: string): string {
  const input = `${taskType}:${prompt.substring(0, 200)}`;
  return crypto.createHash("sha256").update(input).digest("hex");
}

function getCachedResponse(key: string): AIResponse | null {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    responseCache.delete(key);
    return null;
  }
  return entry.response;
}

function setCachedResponse(key: string, response: AIResponse): void {
  // Evict oldest if at capacity
  if (responseCache.size >= CACHE_MAX_SIZE) {
    const oldest = responseCache.keys().next().value;
    if (oldest !== undefined) {
      responseCache.delete(oldest);
    }
  }
  responseCache.set(key, { response, timestamp: Date.now() });
}

// Lazy initialization of clients
let anthropicClient: Anthropic | null = null;
let deepseekClient: OpenAI | null = null;
let geminiClient: OpenAI | null = null;
let kimiClient: OpenAI | null = null;
let groqClient: OpenAI | null = null;
let ollamaClient: OpenAI | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY || "",
    });
  }
  return anthropicClient;
}

function getDeepSeekClient(): OpenAI {
  if (!deepseekClient) {
    deepseekClient = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY || "",
      baseURL: "https://api.deepseek.com",
    });
  }
  return deepseekClient;
}

function getGeminiClient(): OpenAI {
  if (!geminiClient) {
    geminiClient = new OpenAI({
      apiKey: process.env.GOOGLE_API_KEY || "",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    });
  }
  return geminiClient;
}

function getKimiClient(): OpenAI {
  if (!kimiClient) {
    kimiClient = new OpenAI({
      apiKey: process.env.KIMI_API_KEY || "",
      baseURL: "https://api.moonshot.cn/v1",
    });
  }
  return kimiClient;
}

function getGroqClient(): OpenAI {
  if (!groqClient) {
    groqClient = new OpenAI({
      apiKey: process.env.GROQ_API_KEY || "",
      baseURL: "https://api.groq.com/openai/v1",
    });
  }
  return groqClient;
}

function getOllamaClient(): OpenAI | null {
  if (!ollamaClient) {
    const host = process.env.OLLAMA_HOST || "http://localhost:11434";
    ollamaClient = new OpenAI({
      apiKey: "ollama", // Ollama doesn't need a real key
      baseURL: `${host}/v1`,
    });
  }
  return ollamaClient;
}

// ---- Model Configuration ----

interface ModelConfig {
  provider: ModelProvider;
  model: string;
  costPerMInput: number;  // Cost per 1M input tokens
  costPerMOutput: number; // Cost per 1M output tokens
}

// Task type → ordered list of models to try
const ROUTING_TABLE: Record<TaskType, ModelConfig[]> = {
  understand: [
    { provider: 'groq', model: 'llama-3.1-70b-versatile', costPerMInput: 0.59, costPerMOutput: 0.79 },
    { provider: 'deepseek', model: 'deepseek-chat', costPerMInput: 0.25, costPerMOutput: 0.38 },
    { provider: 'kimi', model: 'kimi-k2', costPerMInput: 0.60, costPerMOutput: 2.50 },
    { provider: 'gemini', model: 'gemini-2.0-flash', costPerMInput: 0, costPerMOutput: 0 },
    { provider: 'haiku', model: 'claude-3-5-haiku-latest', costPerMInput: 0.25, costPerMOutput: 1.25 },
  ],
  plan: [
    { provider: 'groq', model: 'llama-3.1-70b-versatile', costPerMInput: 0.59, costPerMOutput: 0.79 },
    { provider: 'deepseek', model: 'deepseek-chat', costPerMInput: 0.25, costPerMOutput: 0.38 },
    { provider: 'kimi', model: 'kimi-k2', costPerMInput: 0.60, costPerMOutput: 2.50 },
    { provider: 'haiku', model: 'claude-3-5-haiku-latest', costPerMInput: 0.25, costPerMOutput: 1.25 },
  ],
  reason: [
    { provider: 'sonnet', model: 'claude-sonnet-4-20250514', costPerMInput: 3.00, costPerMOutput: 15.00 },
    { provider: 'kimi', model: 'kimi-k2', costPerMInput: 0.60, costPerMOutput: 2.50 },
    { provider: 'deepseek', model: 'deepseek-chat', costPerMInput: 0.25, costPerMOutput: 0.38 },
  ],
  vision: [
    { provider: 'sonnet', model: 'claude-sonnet-4-20250514', costPerMInput: 3.00, costPerMOutput: 15.00 },
    { provider: 'gemini', model: 'gemini-2.0-flash', costPerMInput: 0, costPerMOutput: 0 },
  ],
  validate: [
    { provider: 'groq', model: 'llama-3.1-70b-versatile', costPerMInput: 0.59, costPerMOutput: 0.79 },
    { provider: 'gemini', model: 'gemini-2.0-flash', costPerMInput: 0, costPerMOutput: 0 },
    { provider: 'deepseek', model: 'deepseek-chat', costPerMInput: 0.25, costPerMOutput: 0.38 },
  ],
  respond: [
    { provider: 'groq', model: 'llama-3.1-70b-versatile', costPerMInput: 0.59, costPerMOutput: 0.79 },
    { provider: 'deepseek', model: 'deepseek-chat', costPerMInput: 0.25, costPerMOutput: 0.38 },
    { provider: 'haiku', model: 'claude-3-5-haiku-latest', costPerMInput: 0.25, costPerMOutput: 1.25 },
  ],
  local: [
    { provider: 'ollama', model: 'llama3', costPerMInput: 0, costPerMOutput: 0 },
    { provider: 'ollama', model: 'mistral', costPerMInput: 0, costPerMOutput: 0 },
    { provider: 'deepseek', model: 'deepseek-chat', costPerMInput: 0.25, costPerMOutput: 0.38 },
  ],
  classify: [
    { provider: 'groq', model: 'llama-3.1-70b-versatile', costPerMInput: 0.59, costPerMOutput: 0.79 },
    { provider: 'deepseek', model: 'deepseek-chat', costPerMInput: 0.25, costPerMOutput: 0.38 },
    { provider: 'gemini', model: 'gemini-2.0-flash', costPerMInput: 0, costPerMOutput: 0 },
  ],
  generate: [
    { provider: 'deepseek', model: 'deepseek-chat', costPerMInput: 0.25, costPerMOutput: 0.38 },
    { provider: 'kimi', model: 'kimi-k2', costPerMInput: 0.60, costPerMOutput: 2.50 },
    { provider: 'haiku', model: 'claude-3-5-haiku-latest', costPerMInput: 0.25, costPerMOutput: 1.25 },
  ],
  complex: [
    { provider: 'sonnet', model: 'claude-sonnet-4-20250514', costPerMInput: 3.00, costPerMOutput: 15.00 },
    { provider: 'kimi', model: 'kimi-k2', costPerMInput: 0.60, costPerMOutput: 2.50 },
    { provider: 'deepseek', model: 'deepseek-chat', costPerMInput: 0.25, costPerMOutput: 0.38 },
  ],
};

// ---- Per-model timeouts (ms) ----
const MODEL_TIMEOUTS: Record<ModelProvider, number> = {
  deepseek: 30000,
  kimi: 30000,
  gemini: 15000,
  groq: 15000,
  sonnet: 45000,
  haiku: 20000,
  ollama: 60000,
};

// ---- Circuit breakers per provider ----
const providerCircuitBreakers: Map<ModelProvider, CircuitBreaker> = new Map();

function getCircuitBreaker(provider: ModelProvider): CircuitBreaker {
  let cb = providerCircuitBreakers.get(provider);
  if (!cb) {
    cb = new CircuitBreaker({ threshold: 5, windowMs: 600000, cooldownMs: 60000 });
    providerCircuitBreakers.set(provider, cb);
  }
  return cb;
}

// ---- Provider availability checks ----

function isProviderAvailable(provider: ModelProvider): boolean {
  switch (provider) {
    case 'deepseek': return !!process.env.DEEPSEEK_API_KEY;
    case 'kimi': return !!process.env.KIMI_API_KEY;
    case 'gemini': return !!process.env.GOOGLE_API_KEY;
    case 'groq': return !!process.env.GROQ_API_KEY;
    case 'sonnet':
    case 'haiku': return !!process.env.ANTHROPIC_API_KEY;
    case 'ollama': return !!process.env.OLLAMA_HOST;
    default: return false;
  }
}

// ---- Core chat completion by provider ----

async function callProvider(
  config: ModelConfig,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 4096
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  switch (config.provider) {
    case 'deepseek': {
      const response = await getDeepSeekClient().chat.completions.create({
        model: config.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: maxTokens,
        temperature: 0.7,
      });
      return {
        content: response.choices[0]?.message?.content || "",
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
      };
    }

    case 'kimi': {
      const response = await getKimiClient().chat.completions.create({
        model: config.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: maxTokens,
        temperature: 0.7,
      });
      return {
        content: response.choices[0]?.message?.content || "",
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
      };
    }

    case 'gemini': {
      const response = await getGeminiClient().chat.completions.create({
        model: config.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: maxTokens,
      });
      return {
        content: response.choices[0]?.message?.content || "",
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
      };
    }

    case 'ollama': {
      const client = getOllamaClient();
      if (!client) throw new Error("Ollama not available");
      const response = await client.chat.completions.create({
        model: config.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: maxTokens,
      });
      return {
        content: response.choices[0]?.message?.content || "",
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
      };
    }

    case 'groq': {
      const response = await getGroqClient().chat.completions.create({
        model: config.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: maxTokens,
        temperature: 0.7,
      });
      return {
        content: response.choices[0]?.message?.content || "",
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
      };
    }

    case 'sonnet':
    case 'haiku': {
      const response = await getAnthropicClient().messages.create({
        model: config.model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });
      const content = response.content[0].type === "text" ? response.content[0].text : "";
      return {
        content,
        inputTokens: response.usage?.input_tokens || 0,
        outputTokens: response.usage?.output_tokens || 0,
      };
    }

    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

// ---- Cost calculation & tracking ----

function calculateCost(config: ModelConfig, inputTokens: number, outputTokens: number): number {
  return (inputTokens * config.costPerMInput + outputTokens * config.costPerMOutput) / 1_000_000;
}

async function trackApiCall(
  userId: string | undefined,
  model: string,
  inputTokens: number,
  outputTokens: number,
  costUsd: number,
  provider?: string,
  taskId?: string,
  purpose?: string
): Promise<void> {
  if (!userId) return;
  try {
    const costCents = Math.round(costUsd * 100);
    const month = new Date().toISOString().slice(0, 7);

    await getSupabaseClient()
      .from("usage")
      .upsert(
        {
          user_id: userId,
          month,
          ai_cost_cents: costCents,
        },
        { onConflict: "user_id,month" }
      )
      .select();

    // If upsert didn't increment, do it manually
    await getSupabaseClient().rpc("track_usage", {
      p_user_id: userId,
      p_task_type: "ai_call",
      p_ai_cost_cents: costCents,
    });

    // Per-call cost logging for granular tracking
    await getSupabaseClient().from("ai_cost_log").insert({
      user_id: userId,
      task_id: taskId || null,
      provider: provider || "unknown",
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: costUsd,
      purpose: purpose || null,
      cached: false,
    });
  } catch {
    // Non-critical — don't fail the task over tracking
  }
}

// ---- Budget enforcement ----

const MONTHLY_BUDGET_USD = 15;

/**
 * Check remaining monthly budget for a user.
 * Returns remaining budget in USD. If over budget, returns 0.
 */
export async function checkUserBudget(userId: string): Promise<{ remaining: number; overBudget: boolean }> {
  try {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { data, error } = await getSupabaseClient()
      .from("tasks")
      .select("cost_usd")
      .eq("user_id", userId)
      .gte("created_at", startOfMonth.toISOString());

    if (error || !data) {
      return { remaining: MONTHLY_BUDGET_USD, overBudget: false };
    }

    const totalSpent = data.reduce((sum, row) => sum + (row.cost_usd || 0), 0);

    // Also include estimated cost for in-progress tasks
    const { data: inProgress } = await getSupabaseClient()
      .from("tasks")
      .select("cost_usd")
      .eq("user_id", userId)
      .eq("status", "processing")
      .gte("created_at", startOfMonth.toISOString());

    const inProgressCost = (inProgress || []).reduce((sum, row) => sum + (row.cost_usd || 0), 0);
    const totalWithInProgress = totalSpent + inProgressCost;
    const remaining = Math.max(0, MONTHLY_BUDGET_USD - totalWithInProgress);

    return { remaining, overBudget: totalWithInProgress >= MONTHLY_BUDGET_USD };
  } catch {
    // If we can't check budget, don't block the task
    return { remaining: MONTHLY_BUDGET_USD, overBudget: false };
  }
}

// ---- System prompt ----

const SYSTEM_PROMPT = `You are an AI assistant that can actually DO things for your user. You're not just a chatbot - you complete real tasks.

ACTIONS AVAILABLE:
You can perform these actions by including them in your response in this exact format:
[ACTION:browse("url")] - Navigate to a webpage and read its content
[ACTION:search("query")] - Search the web for information
[ACTION:screenshot("url")] - Take a screenshot of a webpage
[ACTION:fill_form("url", {"field": "value"})] - Fill out a form on a website
[ACTION:send_email("to", "subject", "body")] - Send an email
[ACTION:remember("fact")] - Save an important fact to your memory
[ACTION:schedule("task description", "cron expression")] - Schedule a recurring task

RESPONSE FORMAT:
1. First, briefly acknowledge what the user wants
2. Explain your plan to accomplish it
3. Include any actions you need to perform
4. Provide the results or next steps

IMPORTANT:
- Be concise and action-oriented
- If you learn something about the user (preferences, location, etc.), use [ACTION:remember("fact")]
- Always complete the task, don't just explain how to do it
- If you can't complete something, explain why and suggest alternatives
- NEVER give up. Try multiple approaches if needed.`;

function buildUserPrompt(memory: Memory, taskSubject: string, taskBody: string): string {
  return `MEMORY (what I know about you):
${memory.facts}

RECENT ACTIVITY:
${memory.recentLogs || "No recent activity"}

---

USER'S REQUEST:
Subject: ${taskSubject}
${taskBody}

---

Please process this request. Remember to include [ACTION:...] for any actions you need to perform.`;
}

// ---- Main entry point ----

/**
 * Generate AI response with automatic model routing and fallback.
 * Uses the task type to select the optimal model, then falls back through the chain.
 */
export async function generateResponse(
  memory: Memory,
  taskSubject: string,
  taskBody: string,
  username: string,
  taskType: TaskType = "understand",
  userId?: string,
  taskId?: string
): Promise<AIResponse> {
  if (process.env.AI_MOCK_MODE === "true") {
    return generateMockResponse(username, taskSubject, taskBody);
  }

  // Use personality system for system prompt (falls back to SYSTEM_PROMPT if files missing)
  const systemPromptWithUser = await getCompiledPrompt(
    userId || "anonymous",
    username,
    memory
  );
  const userPrompt = buildUserPrompt(memory, taskSubject, taskBody);

  // Check response cache (skip for vision/complex types)
  if (taskType !== "vision" && taskType !== "complex") {
    const cacheKey = getCacheKey(taskType, userPrompt);
    const cached = getCachedResponse(cacheKey);
    if (cached) {
      console.log(`[AI] Cache hit for ${taskType}`);
      return cached;
    }
  }

  // Get the fallback chain for this task type
  const chain = ROUTING_TABLE[taskType] || ROUTING_TABLE.understand;

  for (const config of chain) {
    if (!isProviderAvailable(config.provider)) {
      continue;
    }

    // Check circuit breaker
    const cb = getCircuitBreaker(config.provider);
    if (!cb.canExecute()) {
      console.log(`[AI] ${config.provider} circuit breaker open, skipping`);
      continue;
    }

    try {
      const timeout = MODEL_TIMEOUTS[config.provider] || 30000;
      const result = await withTimeout(
        callProvider(config, systemPromptWithUser, userPrompt),
        timeout,
        `${config.provider}/${config.model}`
      );
      const cost = calculateCost(config, result.inputTokens, result.outputTokens);
      const totalTokens = result.inputTokens + result.outputTokens;

      console.log(`[AI] ${config.provider}/${config.model} success | Tokens: ${totalTokens} | Cost: $${cost.toFixed(6)}`);
      cb.recordSuccess();

      // Track cost
      await trackApiCall(userId, config.model, result.inputTokens, result.outputTokens, cost, config.provider, taskId, taskType);

      const aiResponse: AIResponse = {
        content: result.content,
        actions: parseActions(result.content),
        tokensUsed: totalTokens,
        cost,
        model: config.model,
      };

      // Cache the response (skip vision/complex)
      if (taskType !== "vision" && taskType !== "complex") {
        const cacheKey = getCacheKey(taskType, userPrompt);
        setCachedResponse(cacheKey, aiResponse);
      }

      return aiResponse;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`[AI] ${config.provider}/${config.model} failed: ${errorMessage}`);

      // Handle 429 rate limit: check Retry-After header
      if (errorMessage.includes('429') || errorMessage.includes('rate limit')) {
        const retryMatch = errorMessage.match(/retry.after[:\s]*(\d+)/i);
        const retryAfterSec = retryMatch ? parseInt(retryMatch[1]) : 0;
        if (retryAfterSec > 0 && retryAfterSec <= 10) {
          console.log(`[AI] Rate limited, waiting ${retryAfterSec}s and retrying same model...`);
          await new Promise(resolve => setTimeout(resolve, retryAfterSec * 1000));
          try {
            const timeout = MODEL_TIMEOUTS[config.provider] || 30000;
            const retryResult = await withTimeout(
              callProvider(config, systemPromptWithUser, userPrompt),
              timeout,
              `${config.provider}/${config.model} retry`
            );
            const cost = calculateCost(config, retryResult.inputTokens, retryResult.outputTokens);
            const totalTokens = retryResult.inputTokens + retryResult.outputTokens;
            cb.recordSuccess();
            await trackApiCall(userId, config.model, retryResult.inputTokens, retryResult.outputTokens, cost, config.provider, taskId, taskType);
            return {
              content: retryResult.content,
              actions: parseActions(retryResult.content),
              tokensUsed: totalTokens,
              cost,
              model: config.model,
            };
          } catch {
            // Retry also failed, fall through
          }
        }
      }

      cb.recordFailure();
    }
  }

  // All models failed — return mock
  console.log("[AI] All models failed, using mock response");
  return generateMockResponse(username, taskSubject, taskBody);
}

/**
 * Generate response for vision tasks (requires Claude Sonnet or Gemini Flash)
 */
export async function generateVisionResponse(
  prompt: string,
  imageBase64: string,
  systemPrompt?: string
): Promise<{ content: string; cost: number }> {
  // Try Claude Sonnet first (best vision)
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const response = await getAnthropicClient().messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: systemPrompt || "Analyze this image and respond concisely.",
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: imageBase64 }
            },
            { type: "text", text: prompt }
          ]
        }]
      });

      const content = response.content[0].type === "text" ? response.content[0].text : "";
      const cost = (response.usage.input_tokens * 3.00 + response.usage.output_tokens * 15.00) / 1_000_000;

      console.log(`[AI] Vision (Sonnet) | Cost: $${cost.toFixed(6)}`);
      return { content, cost };
    } catch (error) {
      console.error("[AI] Vision (Sonnet) failed:", error);
    }
  }

  // Fallback to Gemini Flash (free vision)
  if (process.env.GOOGLE_API_KEY) {
    try {
      const response = await getGeminiClient().chat.completions.create({
        model: "gemini-2.0-flash",
        max_tokens: 1024,
        messages: [{
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${imageBase64}` }
            },
            { type: "text", text: prompt }
          ] as OpenAI.Chat.Completions.ChatCompletionContentPart[],
        }],
      });

      const content = response.choices[0]?.message?.content || "";
      console.log("[AI] Vision (Gemini Flash) | Cost: FREE");
      return { content, cost: 0 };
    } catch (error) {
      console.error("[AI] Vision (Gemini) failed:", error);
    }
  }

  // Fallback to Claude Haiku (cheaper vision)
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const response = await getAnthropicClient().messages.create({
        model: "claude-3-5-haiku-latest",
        max_tokens: 1024,
        system: systemPrompt || "Analyze this image and respond concisely.",
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: imageBase64 }
            },
            { type: "text", text: prompt }
          ]
        }]
      });

      const content = response.content[0].type === "text" ? response.content[0].text : "";
      const cost = (response.usage.input_tokens * 0.25 + response.usage.output_tokens * 1.25) / 1_000_000;

      console.log(`[AI] Vision (Haiku) | Cost: $${cost.toFixed(6)}`);
      return { content, cost };
    } catch (error) {
      console.error("[AI] Vision (Haiku) failed:", error);
    }
  }

  return { content: "Vision capability requires Claude or Gemini API key", cost: 0 };
}

/**
 * Quick validation using cheapest available model.
 * Tries: Gemini Flash (free) → DeepSeek → Claude Haiku
 */
export async function quickValidate(
  prompt: string,
  systemPrompt?: string
): Promise<{ result: string; cost: number }> {
  const sys = systemPrompt || "Respond with only 'true' or 'false'.";

  // Try Gemini Flash first (free)
  if (process.env.GOOGLE_API_KEY) {
    try {
      const response = await getGeminiClient().chat.completions.create({
        model: "gemini-2.0-flash",
        max_tokens: 256,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: prompt },
        ],
      });
      const content = response.choices[0]?.message?.content || "";
      return { result: content.trim(), cost: 0 };
    } catch {
      // Fall through
    }
  }

  // Try DeepSeek
  if (process.env.DEEPSEEK_API_KEY) {
    try {
      const response = await getDeepSeekClient().chat.completions.create({
        model: "deepseek-chat",
        max_tokens: 256,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: prompt },
        ],
      });
      const content = response.choices[0]?.message?.content || "";
      const cost = ((response.usage?.prompt_tokens || 0) * 0.25 + (response.usage?.completion_tokens || 0) * 0.38) / 1_000_000;
      return { result: content.trim(), cost };
    } catch {
      // Fall through
    }
  }

  // Try Claude Haiku
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const response = await getAnthropicClient().messages.create({
        model: "claude-3-5-haiku-latest",
        max_tokens: 256,
        system: sys,
        messages: [{ role: "user", content: prompt }],
      });
      const content = response.content[0].type === "text" ? response.content[0].text : "";
      const cost = (response.usage.input_tokens * 0.25 + response.usage.output_tokens * 1.25) / 1_000_000;
      return { result: content.trim(), cost };
    } catch {
      // Fall through
    }
  }

  return { result: "true", cost: 0 };
}

/**
 * Generate a mock response for testing
 */
function generateMockResponse(username: string, taskSubject: string, taskBody: string): AIResponse {
  console.log("[AI] Using mock response mode");

  const mockContent = `Hello ${username}! I received your request about "${taskSubject}".

I understand you're asking: "${taskBody.substring(0, 150)}${taskBody.length > 150 ? "..." : ""}"

I'm your AI assistant and I'm processing your request. Note: This is a test response because no AI API is currently available.

To enable real AI responses, set up at least one of: DEEPSEEK_API_KEY, KIMI_API_KEY, GOOGLE_API_KEY, ANTHROPIC_API_KEY

[ACTION:remember("${username} sent a message about ${taskSubject.substring(0, 50)}")]`;

  return {
    content: mockContent,
    actions: parseActions(mockContent),
    tokensUsed: 100,
    cost: 0,
    model: "mock",
  };
}

/**
 * Parse action tags from AI response
 */
export function parseActions(response: string): Action[] {
  const actions: Action[] = [];

  const actionRegex = /\[ACTION:(\w+)\((.*?)\)\]/g;
  let match;

  while ((match = actionRegex.exec(response)) !== null) {
    const actionType = match[1];
    const paramsStr = match[2];

    try {
      const action = parseAction(actionType, paramsStr);
      if (action) {
        actions.push(action);
      }
    } catch (error) {
      console.error(`Failed to parse action: ${match[0]}`, error);
    }
  }

  return actions;
}

function parseAction(type: string, paramsStr: string): Action | null {
  switch (type) {
    case "browse":
    case "screenshot": {
      const url = paramsStr.replace(/^["']|["']$/g, "");
      return { type: type as "browse" | "screenshot", params: { url } };
    }

    case "search": {
      const query = paramsStr.replace(/^["']|["']$/g, "");
      return { type: "search", params: { query } };
    }

    case "remember": {
      const fact = paramsStr.replace(/^["']|["']$/g, "");
      return { type: "remember", params: { fact } };
    }

    case "fill_form": {
      const firstComma = paramsStr.indexOf(",");
      if (firstComma === -1) return null;

      const url = paramsStr.substring(0, firstComma).trim().replace(/^["']|["']$/g, "");
      const fieldsStr = paramsStr.substring(firstComma + 1).trim();

      try {
        const fields = JSON.parse(fieldsStr);
        return { type: "fill_form", params: { url, fields } };
      } catch {
        return null;
      }
    }

    case "send_email": {
      const parts = paramsStr.match(/["']([^"']+)["']/g);
      if (!parts || parts.length < 3) return null;

      const to = parts[0].replace(/^["']|["']$/g, "");
      const subject = parts[1].replace(/^["']|["']$/g, "");
      const body = parts[2].replace(/^["']|["']$/g, "");

      return { type: "send_email", params: { to, subject, body } };
    }

    case "schedule": {
      const parts = paramsStr.match(/["']([^"']+)["']/g);
      if (!parts || parts.length < 2) return null;

      const description = parts[0].replace(/^["']|["']$/g, "");
      const cron = parts[1].replace(/^["']|["']$/g, "");

      return { type: "schedule", params: { description, cron } };
    }

    default:
      console.warn(`Unknown action type: ${type}`);
      return null;
  }
}

/**
 * Clean the response by removing action tags for display in emails
 */
export function cleanResponseForEmail(response: string): string {
  return response.replace(/\[ACTION:.*?\]/g, "").trim();
}

/**
 * Valid task classifications returned by classifyTask.
 */
const VALID_TASK_TYPES = [
  "research", "booking", "form", "shopping", "email",
  "reminder", "writing", "voice", "general",
] as const;

type ClassifiedTaskType = typeof VALID_TASK_TYPES[number];

/**
 * Map of task types that require browser access.
 */
const BROWSER_TASK_TYPES: ReadonlySet<string> = new Set([
  "research", "booking", "form", "shopping",
]);

/**
 * Classify a task using keyword heuristics first, then AI fallback for ambiguous cases.
 */
export async function classifyTask(userMessage: string): Promise<{
  taskType: string;
  goal: string;
  needsBrowser: boolean;
  domains: string[];
}> {
  const text = userMessage.toLowerCase();

  let taskType: ClassifiedTaskType = "general";
  let needsBrowser = false;
  const domains: string[] = [];

  // Fast path: keyword matching
  if (text.includes("research") || text.includes("find") || text.includes("search") || text.includes("look up")) {
    taskType = "research";
    needsBrowser = true;
  } else if (text.includes("book") || text.includes("reservation") || text.includes("schedule appointment")) {
    taskType = "booking";
    needsBrowser = true;
  } else if (text.includes("form") || text.includes("fill") || text.includes("apply") || text.includes("submit")) {
    taskType = "form";
    needsBrowser = true;
  } else if (text.includes("buy") || text.includes("purchase") || text.includes("order") || text.includes("shop")) {
    taskType = "shopping";
    needsBrowser = true;
  } else if (text.includes("email") || text.includes("send") || text.includes("write to")) {
    taskType = "email";
  } else if (text.includes("remind") || text.includes("alert") || text.includes("notify")) {
    taskType = "reminder";
  } else if (text.includes("write") || text.includes("draft") || text.includes("compose")) {
    taskType = "writing";
  } else if (text.includes("call") || text.includes("phone") || text.includes("dial")) {
    taskType = "voice";
  }

  // AI fallback: when keyword matching produces low-confidence "general" result
  if (taskType === "general") {
    try {
      const classificationPrompt = `Classify this user task into exactly one category. Respond with ONLY the category name, nothing else.

Categories: research, booking, form, shopping, email, reminder, writing, voice, general

Task: "${userMessage.substring(0, 500)}"`;

      const { result } = await quickValidate(
        classificationPrompt,
        "You are a task classifier. Respond with exactly one word: the task category."
      );

      const aiType = result.toLowerCase().trim().replace(/[^a-z]/g, "");
      const validTypes: readonly string[] = VALID_TASK_TYPES;
      if (validTypes.includes(aiType)) {
        taskType = aiType as ClassifiedTaskType;
        needsBrowser = BROWSER_TASK_TYPES.has(taskType);
        console.log(`[AI] classifyTask AI fallback: "${taskType}"`);
      }
    } catch {
      // AI classification failed — keep keyword-based "general" result
      console.log("[AI] classifyTask AI fallback failed, using keyword result");
    }
  }

  // Extract URLs/domains
  const urlRegex = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+(?:\.[a-zA-Z]{2,})+)/g;
  let urlMatch;
  while ((urlMatch = urlRegex.exec(userMessage)) !== null) {
    domains.push(urlMatch[1]);
  }

  return { taskType, goal: userMessage, needsBrowser, domains };
}
