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
import { getAdaptiveChain, recordModelOutcome } from "./model-intelligence.js";

// ---- Response Cache (LRU, 100 entries, 5-min TTL) ----

interface CacheEntry {
  response: AIResponse;
  timestamp: number;
}

const responseCache = new Map<string, CacheEntry>();
const CACHE_MAX_SIZE = 100;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCacheKey(taskType: string, prompt: string, subject?: string): string {
  // Hash the full prompt to avoid collisions when recent-activity pushes subject past 1000 chars
  const input = `${taskType}:${subject || ''}:${prompt}`;
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
    { provider: 'groq', model: 'llama-3.3-70b-versatile', costPerMInput: 0.59, costPerMOutput: 0.79 },
    { provider: 'deepseek', model: 'deepseek-chat', costPerMInput: 0.25, costPerMOutput: 0.38 },
    { provider: 'kimi', model: 'kimi-k2', costPerMInput: 0.60, costPerMOutput: 2.50 },
    { provider: 'gemini', model: 'gemini-2.0-flash', costPerMInput: 0, costPerMOutput: 0 },
    { provider: 'haiku', model: 'claude-3-5-haiku-latest', costPerMInput: 0.25, costPerMOutput: 1.25 },
  ],
  plan: [
    { provider: 'groq', model: 'llama-3.3-70b-versatile', costPerMInput: 0.59, costPerMOutput: 0.79 },
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
    { provider: 'groq', model: 'llama-3.3-70b-versatile', costPerMInput: 0.59, costPerMOutput: 0.79 },
    { provider: 'gemini', model: 'gemini-2.0-flash', costPerMInput: 0, costPerMOutput: 0 },
    { provider: 'deepseek', model: 'deepseek-chat', costPerMInput: 0.25, costPerMOutput: 0.38 },
  ],
  respond: [
    { provider: 'groq', model: 'llama-3.3-70b-versatile', costPerMInput: 0.59, costPerMOutput: 0.79 },
    { provider: 'deepseek', model: 'deepseek-chat', costPerMInput: 0.25, costPerMOutput: 0.38 },
    { provider: 'haiku', model: 'claude-3-5-haiku-latest', costPerMInput: 0.25, costPerMOutput: 1.25 },
  ],
  local: [
    { provider: 'ollama', model: 'llama3', costPerMInput: 0, costPerMOutput: 0 },
    { provider: 'ollama', model: 'mistral', costPerMInput: 0, costPerMOutput: 0 },
    { provider: 'deepseek', model: 'deepseek-chat', costPerMInput: 0.25, costPerMOutput: 0.38 },
  ],
  classify: [
    { provider: 'groq', model: 'llama-3.3-70b-versatile', costPerMInput: 0.59, costPerMOutput: 0.79 },
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

    // Track usage via RPC (handles upsert + increment atomically)
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

export const SYSTEM_PROMPT = `You are an AI AGENT — not a chatbot. You DO things. You don't give advice.

CRITICAL RULE — ACTION OVER ADVICE:
- When a user says "make me money" → you GO to a freelancing site, CREATE a listing, SIGN UP for opportunities. You don't list "7 ways to make money."
- When a user says "book me a flight" → you GO to an airline site and START booking. You don't say "here are some airlines you could check."
- When a user says "find me a job" → you GO to job boards and APPLY. You don't list job search tips.
- NEVER give a bullet-point list of suggestions. ALWAYS take the first concrete step yourself.
- If you can't fully complete a task (e.g., need payment info), do EVERYTHING you can and then tell the user exactly what's left for them to finish.
- You have a browser. You have email. You have memory. USE THEM. Act like a real employee, not a search engine.

ACTIONS AVAILABLE:
Include these in your response in this EXACT format:

BROWSER ACTIONS (require a browser - I'll open one automatically):
[ACTION:browse("url")] — Navigate to URL and extract all text content
[ACTION:search("query")] — Search the web (DuckDuckGo → Bing → Google → vision fallback)
[ACTION:screenshot("url")] — Take a screenshot of a webpage
[ACTION:click("selector_or_text")] — Click an element (CSS selector, button text, or description)
[ACTION:fill("selector_or_label", "value")] — Type into a form field
[ACTION:select("selector_or_label", "option_text")] — Choose a dropdown option
[ACTION:submit("selector")] — Submit a form
[ACTION:login("url", "username", "password")] — Log into a website using credentials
[ACTION:scroll("down")] — Scroll the page (up/down)
[ACTION:wait(2000)] — Wait for page to load (milliseconds)
[ACTION:extract("css_selector")] — Extract text from a specific page element
[ACTION:fill_form("url", {"field": "value"})] — Navigate to a URL and fill multiple form fields at once

NON-BROWSER ACTIONS:
[ACTION:send_email("to@email.com", "Subject", "Body text")] — Send an email from your @aevoy.com address
[ACTION:read_email()] — Check your @aevoy.com inbox for recent emails (verification codes, replies, etc.)
[ACTION:read_email(5, 60)] — Check last 5 emails from the past 60 minutes
[ACTION:remember("important fact")] — Save information to long-term memory
[ACTION:schedule("task description", "0 9 * * 1")] — Schedule a recurring task (cron format)
[ACTION:create_excel("filename", [{"name":"Sheet1", "headers":["Col1","Col2"], "data":[["A",1],["B",2]]}])] — Create Excel spreadsheet with data, styling, formulas
[ACTION:create_powerpoint("filename", [{"title":"Slide 1", "bullets":["Point 1","Point 2"]}, {"title":"Slide 2", "content":"Text"}])] — Create PowerPoint presentation with slides, themes, layouts
[ACTION:create_word("filename", [{"type":"heading", "text":"Title", "level":1}, {"type":"paragraph", "text":"Content"}])] — Create Word document with headings, paragraphs, tables, lists
[ACTION:create_pdf("filename", [{"type":"title", "text":"Document Title"}, {"type":"paragraph", "text":"Content"}, {"type":"table", "tableData":{"headers":["H1","H2"], "rows":[["A","B"]]}}])] — Create PDF document with text, images, tables, professional formatting
[ACTION:screenshot_ocr({"fullPage": true, "engine": "auto", "languages": ["eng"], "detectTables": true, "detectForms": true, "format": "structured"})] — Capture screenshot and extract text using OCR (Tesseract offline + AI vision fallback). Supports table/form detection, multi-language, region-specific extraction
[ACTION:generate_image("detailed image prompt", "1024x1024")] — Generate an image using DALL-E 3. Returns a URL to the generated image. Use for creating marketing graphics, logos, social media images, illustrations, etc. Sizes: "1024x1024" (square), "1792x1024" (landscape), "1024x1792" (portrait)
[ACTION:post_tweet("Your tweet text here (max 280 chars)")] — Post a tweet to Twitter/X on behalf of the user. Use this for social media marketing, announcements, updates. Combine with generate_image() to create and post visual content.
[ACTION:create_campaign("Campaign Name", [{"task": "Post tweet about topic X", "days_from_now": 0, "hour": 9}, {"task": "Post tweet about topic Y", "days_from_now": 1, "hour": 9}, {"task": "Post tweet about topic Z", "days_from_now": 2, "hour": 9}])] — Create a multi-day campaign: schedules a sequence of one-time tasks to run at specific times over multiple days. Perfect for drip campaigns, tweet series, email sequences, or any multi-step marketing workflow. days_from_now=0 means today, hour is UTC hour (0-23).

CRITICAL — NON-BROWSER ACTIONS MUST USE TAGS TOO:
- "Schedule a daily weather check" → [ACTION:schedule("Check weather in Tokyo", "0 9 * * *")] [TASK_COMPLETE]
- "Remember my favorite color is blue" → [ACTION:remember("User's favorite color is blue")] [TASK_COMPLETE]
- "Email John about the meeting" → [ACTION:send_email("john@example.com", "Meeting Update", "Hi John, ...")] [TASK_COMPLETE]
- If you write "I've scheduled it" or "I'll remember that" WITHOUT the [ACTION:...] tag, NOTHING HAPPENS. The tag IS the execution.
- Cron format: "0 9 * * *" = daily at 9 AM UTC, "0 9 * * 1" = every Monday at 9 AM, "0 */6 * * *" = every 6 hours

SOCIAL MEDIA & MARKETING STRATEGY:
- For "make me money online" → use search to find opportunities, generate_image to create marketing content, post_tweet to announce/promote
- For "grow my Twitter" → research trending topics with search, write engaging tweets, post_tweet them
- For "market my product" → generate_image (logo/banner), post_tweet (announcement), send_email (outreach)
- DALL-E image URL from generate_image() can be shared in tweet text or remembered for later use
- Always post actionable, engaging content — not generic filler

EXECUTION MODEL (Reason → Observe → Plan → Act):
- FIRST: If the task has conditional logic ("if X then Y", "if this fails try that"), EXPLICITLY reason through the branches BEFORE acting.
- After each action round, I'll show you: (1) action results, (2) current page text, (3) a screenshot description.
- OBSERVE the current state before planning your next actions.
- If the page shows an error, a CAPTCHA, a login wall, or unexpected content — adapt your plan.
- If an action fails, TRY A DIFFERENT APPROACH. Don't repeat the same thing.
- You can interact with ANY website freely. No restrictions.
- If you need a tool you don't have API access to, USE THE BROWSER to go to that tool's website.
- If browse() or navigate FAILS on a site (bot-block, error page, CAPTCHA, empty page), DO NOT retry the same site.
  Switch to [ACTION:search("your query site:thatdomain.com")] instead — search can often show the data directly.
- SMART SEARCH STRATEGY: Search results are automatically extracted from DuckDuckGo (no-JS), then Bing, with
  vision fallback if text extraction fails. You don't need to worry about which search engine — just use search().
- When search() returns content, READ THE RESULTS carefully. If you can see the answer (price, info, link, etc.)
  in the search results, answer the user IMMEDIATELY and signal [TASK_COMPLETE]. No need to click through.
- VISION: If you get a search result that says "JavaScript error" or looks like garbage text, use
  [ACTION:screenshot_ocr({})] to take a screenshot and read it with AI vision. Vision can read anything on screen.
- WEATHER SHORTCUT: For weather queries, browse("https://wttr.in/CITY?format=4") returns plain-text weather data
  instantly (no JS needed). Example: [ACTION:browse("https://wttr.in/West+Vancouver?format=4")]
- BE RESOURCEFUL: If one approach fails, try a COMPLETELY different approach. Use APIs, plain-text websites,
  mobile versions of sites (m.site.com), or cached pages. Figure it out — don't give up.
- JOBS/MONEY/FREELANCE STRATEGY: Never go directly to Upwork/Fiverr/Freelancer homepages (they block bots).
  Instead: [ACTION:search("upwork writing jobs 2025 site:upwork.com")] or [ACTION:search("fiverr gig listings")]
  to find SPECIFIC PUBLIC listing URLs, then browse those individual pages. Job boards and public RSS feeds work.
  Alternative: search for "jobs.json" or public job APIs, or browse LinkedIn/Indeed public pages.
- If after 2 failed attempts you still can't get the information, BE HONEST with the user. Tell them what you
  tried, what went wrong, and suggest they check the site directly. Never make up data or give a vague answer.
- For complex tasks, break them into steps. Execute 2-5 actions MAX per round, observe results, then plan more.
- To signal you're done, include [TASK_COMPLETE] in your response with the final answer.
- NEVER say "I can't do this." ALWAYS try. Use the browser creatively.
- EMAIL CAPABILITIES: You have your own email address. Use it for:
  • Signing up for services — enter your email, then use read_email() to get verification codes
  • Sending emails — use send_email()
  • Checking inbox for replies or confirmations — use read_email()
  • Workflow: browse to site → fill email field → submit → wait 10s → read_email() → extract code → enter it
  • When the user says "check my email" → use [ACTION:read_email()] ONCE to check YOUR inbox
  • If read_email() says "no recent emails" → report that directly. Do NOT call read_email() again. One check is enough.

CONDITIONAL LOGIC & REASONING:
- When given "if X then Y else Z" instructions, THINK THROUGH THE LOGIC FIRST:
  1. What condition needs to be checked? (e.g., "if there are results")
  2. How will I know if the condition is true or false? (e.g., check page text after search)
  3. What action should I take in each case?
- Execute MINIMAL actions to check the condition FIRST (e.g., just search, don't click yet)
- OBSERVE the result (page text, action success)
- THEN execute the appropriate branch based on what you observed
- Example: "Search for X. If results exist, click first. If not, search for Y instead."
  → Round 1: [ACTION:search("X")] → WAIT for result
  → Round 2: Check page text. If results → [ACTION:click(...)]. If no results → [ACTION:search("Y")]
- DO NOT plan out both branches up front. Execute ONE branch at a time based on observations.
- AGI means: reason about causality, understand conditionals, make money through intelligent decision-making.

SELF-CRITIQUE (between rounds):
- Before planning next actions, ask yourself: "Did my last actions succeed? What do I see on the page now?"
- If the page hasn't changed or shows errors, your actions likely failed — try something different.
- If you see a success confirmation, the task may be done — include [TASK_COMPLETE].
- If you see a login wall, try [ACTION:login(...)]. If you see a CAPTCHA, try waiting or a different URL.

IMPORTANT:
- CONVERSATIONAL MESSAGES (greetings, thanks, casual chat): If the user says "hi", "hello", "how are you", "thanks", "ok", or any other conversational message — respond naturally and include [TASK_COMPLETE] immediately. Do NOT search, browse, or use any actions. Just reply.
- DATE/TIME QUESTIONS: The current date and time is always provided at the top of each request as "CURRENT DATE & TIME". If the user asks what day it is, what the date is, what time it is, etc. — answer DIRECTLY from that provided date, include [TASK_COMPLETE], and do NOT search or browse. Never search for information you already have.
- Be concise and action-oriented. Plan 2-5 actions per round MAX. More rounds is better than cramming 30+ actions into one.
- If you learn something about the user (preferences, location, etc.), use [ACTION:remember("fact")]
- Always complete the task, don't just explain how to do it
- NEVER give up. Try multiple approaches if needed.
- When you receive page state between rounds, use it to make INFORMED decisions about next steps.
- RESPONSE QUALITY — YOUR RESPONSE IS SENT DIRECTLY TO THE USER VIA EMAIL:
  * NEVER describe what you "tried" or narrate your process. The user doesn't care about your journey.
  * NEVER say "I'll search for..." or "Let me try..." or "What I can do next..." — give RESULTS, not plans.
  * NEVER give a numbered list of suggestions/advice. That's what ChatGPT does. You're an AGENT — you DO things.
  * If the user wants something done, DO IT and tell them what you did. Don't tell them how they could do it.
  * If you have search results, EXTRACT the actual information and present it clearly.
  * If you couldn't find what the user wanted, say "I couldn't find X" and give your best answer from knowledge.
  * Your response should read like a real assistant reporting back: "Done — I signed you up for X, here's your link."
- REASONING: Before generating actions, explicitly think: "What's the goal? What's the minimal path? What could go wrong?"
- TASTE: Choose elegant, simple solutions. Don't over-engineer. The best code is the least code.
- LOGIC: Understand cause and effect. If A fails, why? What different approach B would work?
- MONEY-MAKING: If asked to make money, reason about value creation, market opportunities, automation, and execution paths.`;

function buildUserPrompt(memory: Memory, taskSubject: string, taskBody: string): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
  return `CURRENT DATE & TIME: ${dateStr}, ${timeStr}

MEMORY (what I know about you):
${memory.facts}

RECENT ACTIVITY:
${memory.recentLogs || "No recent activity"}

---

USER'S REQUEST:
Subject: ${taskSubject}
${taskBody}

---

Please process this request. You MUST include [ACTION:...] tags for EVERY action — including non-browser ones like schedule, remember, send_email. Writing "I've scheduled it" without an [ACTION:schedule(...)] tag means NOTHING happened. The action ONLY executes if you output the tag.`;
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
  taskId?: string,
  senderName?: string
): Promise<AIResponse> {
  if (process.env.AI_MOCK_MODE === "true") {
    return generateMockResponse(username, taskSubject, taskBody);
  }

  // Use personality system for system prompt — ALWAYS includes AGI base prompt
  const systemPromptWithUser = await getCompiledPrompt(
    userId || "anonymous",
    username,
    memory,
    senderName,
    SYSTEM_PROMPT
  );
  const userPrompt = buildUserPrompt(memory, taskSubject, taskBody);

  // Check response cache (skip for vision/complex types)
  if (taskType !== "vision" && taskType !== "complex") {
    const cacheKey = getCacheKey(taskType, userPrompt, taskSubject);
    const cached = getCachedResponse(cacheKey);
    if (cached) {
      console.log(`[AI] Cache hit for ${taskType}`);
      return cached;
    }
  }

  // Get the fallback chain for this task type — adaptive if we have history
  const defaultChain = ROUTING_TABLE[taskType] || ROUTING_TABLE.understand;
  const chain = userId
    ? await getAdaptiveChain(userId, taskType, "", defaultChain)
    : defaultChain;

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
      const startTime = Date.now();
      const result = await withTimeout(
        callProvider(config, systemPromptWithUser, userPrompt),
        timeout,
        `${config.provider}/${config.model}`
      );
      const latencyMs = Date.now() - startTime;
      const cost = calculateCost(config, result.inputTokens, result.outputTokens);
      const totalTokens = result.inputTokens + result.outputTokens;

      console.log(`[AI] ${config.provider}/${config.model} success | Tokens: ${totalTokens} | Cost: $${cost.toFixed(6)}`);
      cb.recordSuccess();

      // Track cost
      await trackApiCall(userId, config.model, result.inputTokens, result.outputTokens, cost, config.provider, taskId, taskType);

      // SELF-LEARNING: Record model success for adaptive routing
      if (userId) {
        recordModelOutcome({
          userId,
          model: config.model,
          provider: config.provider,
          taskType,
          domain: "",
          success: true,
          tokens: totalTokens,
          costUsd: cost,
          latencyMs,
        }).catch(() => {}); // fire-and-forget
      }

      const aiResponse: AIResponse = {
        content: result.content,
        actions: parseActions(result.content),
        tokensUsed: totalTokens,
        cost,
        model: config.model,
      };

      // Cache the response (skip vision/complex)
      if (taskType !== "vision" && taskType !== "complex") {
        const cacheKey = getCacheKey(taskType, userPrompt, taskSubject);
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

  // All models failed — return a generic helpful response (never expose internals)
  console.error("[AI] All models in chain failed for task type:", taskType);
  return {
    content: `I'm processing your request about "${taskSubject}". This is taking longer than expected — I'll follow up shortly with results.`,
    actions: [],
    tokensUsed: 0,
    cost: 0,
    model: "fallback",
  };
}

/**
 * Emergency quality-gate fallback: skip routing table, go straight to Claude Haiku.
 * Produces a short direct answer with no narration. Used when normal pipeline fails.
 */
export async function generateForcedDirectAnswer(
  userRequest: string,
  context: string,
  username: string
): Promise<{ content: string; cost: number; tokensUsed: number }> {
  const hasContext = context && context !== 'No actions completed with results.';

  const systemPrompt = `You are Aevoy, a done-state AI reporter. You have ALREADY run browser and search actions. Your ONLY job is to share results.

FORBIDDEN phrases (NEVER use these): "I'll", "I will", "Let me", "I'm going to", "I can try", "I'll search", "I'll find", "Let me look"

GOOD examples:
- "The top freelance writing platforms are Upwork (upwork.com) and Fiverr (fiverr.com). Upwork has 1,000+ writing jobs posted right now."
- "Vancouver events tonight include the Jazz Festival at Orpheum Theatre and a Comedy Night at The Biltmore."
- "The weather in Toronto is 31°F with cloudy skies and west winds at 12 mph."

Rules: Use past or present tense only. If no live data: give specific knowledge-based answer with a real URL. Max 3 sentences. No numbered lists.`;

  const userContent = hasContext
    ? `The user asked: "${userRequest}"\n\nMY COMPLETED ACTION RESULTS:\n${context}\n\nReport these results concisely. No "I'll" or "Let me".`
    : `The user asked: "${userRequest}"\n\nGive the best specific knowledge-based answer. Name real websites with URLs. Start with a concrete fact. No "I'll" or "Let me".`;

  // Helper: strip narration lines from any model output
  const stripNarration = (text: string): string => {
    const lines = text.split('\n');
    const clean = lines.filter(line => {
      const lc = line.toLowerCase().trim();
      return !(/^(?:i'?ll|i\u2019ll|let me|i will|i'm going to|i\u2019m going to|i can try|i need to)\s/i.test(lc));
    }).join('\n').trim();
    return clean; // Return empty string if ALL lines were narration
  };

  // Try Claude Haiku first (best instruction following)
  if (process.env.ANTHROPIC_API_KEY) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 1500)); // 1.5s retry delay for rate limits
      try {
        const client = getAnthropicClient();
        const response = await client.messages.create({
          model: "claude-3-5-haiku-latest",
          max_tokens: 300,
          system: systemPrompt,
          messages: [{ role: "user", content: userContent }]
        });
        const content = response.content[0]?.type === "text" ? response.content[0].text : "";
        const inputTokens = response.usage?.input_tokens || 0;
        const outputTokens = response.usage?.output_tokens || 0;
        const cost = inputTokens * 0.25 / 1_000_000 + outputTokens * 1.25 / 1_000_000;
        const clean = stripNarration(content);
        if (clean && clean.length > 20) {
          console.log(`[FALLBACK-HAIKU] Direct answer via Haiku attempt ${attempt+1} (${clean.length} chars, $${cost.toFixed(5)})`);
          return { content: clean, cost, tokensUsed: inputTokens + outputTokens };
        }
      } catch (haikuErr) {
        const msg = haikuErr instanceof Error ? haikuErr.message : String(haikuErr);
        console.warn(`[FALLBACK-HAIKU] Haiku attempt ${attempt+1} failed: ${msg}`);
        if (!msg.includes('429') && !msg.includes('rate') && !msg.includes('overloaded')) break; // Non-rate-limit error, don't retry
      }
    }
  }

  // Second fallback: Groq (llama-3.3-70b) — better instruction following than DeepSeek
  if (process.env.GROQ_API_KEY) {
    try {
      const groqClient = getGroqClient();
      const groqSystem = `You are a results reporter. Answer ONLY in factual present tense. NEVER start with "I'll", "Let me", "I will", or "I'm going to". Start directly with the answer. Include a real URL. Max 2-3 sentences.`;
      const res = await groqClient.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 200,
        temperature: 0.1,
        messages: [
          { role: 'system', content: groqSystem },
          { role: 'user', content: userContent }
        ]
      });
      const content = res.choices[0]?.message?.content || '';
      const clean = stripNarration(content);
      if (clean && clean.length > 20) {
        console.log(`[FALLBACK-GROQ] Direct answer via Groq (${clean.length} chars)`);
        return { content: clean, cost: 0.0001, tokensUsed: 200 };
      }
    } catch (groqErr) {
      console.warn(`[FALLBACK-GROQ] Groq fallback failed: ${groqErr instanceof Error ? groqErr.message : String(groqErr)}`);
    }
  }

  // Last resort: DeepSeek with ultra-strict prompt
  if (process.env.DEEPSEEK_API_KEY) {
    try {
      const strictSystem = `RESULTS REPORT: Answer in present tense only. Start with a fact. Include a URL. Max 2 sentences. Do NOT begin with "I'll", "Let me", or "I will".`;
      const client = getDeepSeekClient();
      const res = await client.chat.completions.create({
        model: "deepseek-chat",
        max_tokens: 200,
        temperature: 0.1,
        messages: [
          { role: "system", content: strictSystem },
          { role: "user", content: userContent }
        ]
      });
      const content = res.choices[0]?.message?.content || "";
      const clean = stripNarration(content);
      if (clean && clean.length > 20) {
        console.log(`[FALLBACK-DEEPSEEK] Direct answer (${clean.length} chars)`);
        return { content: clean, cost: 0.0001, tokensUsed: 200 };
      }
    } catch (dsErr) {
      console.warn(`[FALLBACK-DEEPSEEK] DeepSeek fallback failed: ${dsErr instanceof Error ? dsErr.message : String(dsErr)}`);
    }
  }

  return { content: "", cost: 0, tokensUsed: 0 };
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

  // All models failed — fail closed for safety
  return { result: "false", cost: 0 };
}

/**
 * Generate a mock response for testing
 */
function generateMockResponse(username: string, taskSubject: string, taskBody: string): AIResponse {
  console.log("[AI] Using mock response mode");

  const mockContent = `Hello ${username}! I received your request about "${taskSubject}".

I understand you're asking: "${taskBody.substring(0, 150)}${taskBody.length > 150 ? "..." : ""}"

I'm working on this for you. I'll get back to you with results shortly.

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

    case "read_email": {
      // [ACTION:read_email()] or [ACTION:read_email(5, 60)]
      const nums = paramsStr.match(/\d+/g);
      const limit = nums?.[0] ? parseInt(nums[0], 10) : 5;
      const minutes_back = nums?.[1] ? parseInt(nums[1], 10) : 30;
      return { type: "read_email", params: { limit, minutes_back } };
    }

    case "schedule": {
      const parts = paramsStr.match(/["']([^"']+)["']/g);
      if (!parts || parts.length < 2) return null;

      const description = parts[0].replace(/^["']|["']$/g, "");
      const cron = parts[1].replace(/^["']|["']$/g, "");

      return { type: "schedule", params: { description, cron } };
    }

    case "click": {
      const target = paramsStr.replace(/^["']|["']$/g, "");
      return { type: "click", params: { selector: target, text: target, description: target } };
    }

    case "fill": {
      const fillParts = paramsStr.match(/["']([^"']+)["']/g);
      if (!fillParts || fillParts.length < 2) return null;
      const selector = fillParts[0].replace(/^["']|["']$/g, "");
      const value = fillParts[1].replace(/^["']|["']$/g, "");
      return { type: "fill", params: { selector, label: selector, placeholder: selector, value } };
    }

    case "select": {
      const selectParts = paramsStr.match(/["']([^"']+)["']/g);
      if (!selectParts || selectParts.length < 2) return null;
      const sel = selectParts[0].replace(/^["']|["']$/g, "");
      const option = selectParts[1].replace(/^["']|["']$/g, "");
      return { type: "select", params: { selector: sel, label: sel, option } };
    }

    case "submit": {
      const submitSel = paramsStr.replace(/^["']|["']$/g, "") || "form";
      return { type: "submit", params: { selector: submitSel } };
    }

    case "login": {
      const loginParts = paramsStr.match(/["']([^"']+)["']/g);
      if (!loginParts || loginParts.length < 3) return null;
      const loginUrl = loginParts[0].replace(/^["']|["']$/g, "");
      const username = loginParts[1].replace(/^["']|["']$/g, "");
      const password = loginParts[2].replace(/^["']|["']$/g, "");
      return { type: "login", params: { url: loginUrl, username, password } };
    }

    case "scroll": {
      const direction = paramsStr.replace(/^["']|["']$/g, "") || "down";
      return { type: "scroll", params: { direction } };
    }

    case "wait": {
      const ms = parseInt(paramsStr.replace(/^["']|["']$/g, ""), 10) || 2000;
      return { type: "wait", params: { ms } };
    }

    case "extract": {
      const extractSel = paramsStr.replace(/^["']|["']$/g, "") || "body";
      return { type: "extract", params: { selector: extractSel } };
    }

    case "create_excel": {
      // Parse: create_excel("filename", [sheet_definitions])
      const firstComma = paramsStr.indexOf(",");
      if (firstComma === -1) return null;

      const filename = paramsStr.substring(0, firstComma).trim().replace(/^["']|["']$/g, "");
      const sheetsStr = paramsStr.substring(firstComma + 1).trim();

      try {
        const sheets = JSON.parse(sheetsStr);
        return { type: "create_excel", params: { filename, sheets } };
      } catch (error) {
        console.error('[EXCEL] Failed to parse sheets JSON:', error);
        return null;
      }
    }

    case "create_powerpoint": {
      // Parse: create_powerpoint("filename", [slide_definitions])
      const firstComma = paramsStr.indexOf(",");
      if (firstComma === -1) return null;

      const filename = paramsStr.substring(0, firstComma).trim().replace(/^["']|["']$/g, "");
      const slidesStr = paramsStr.substring(firstComma + 1).trim();

      try {
        const slides = JSON.parse(slidesStr);
        return { type: "create_powerpoint", params: { filename, slides } };
      } catch (error) {
        console.error('[POWERPOINT] Failed to parse slides JSON:', error);
        return null;
      }
    }

    case "create_word": {
      // Parse: create_word("filename", [section_definitions])
      const firstComma = paramsStr.indexOf(",");
      if (firstComma === -1) return null;

      const filename = paramsStr.substring(0, firstComma).trim().replace(/^["']|["']$/g, "");
      const sectionsStr = paramsStr.substring(firstComma + 1).trim();

      try {
        const sections = JSON.parse(sectionsStr);
        return { type: "create_word", params: { filename, sections } };
      } catch (error) {
        console.error('[WORD] Failed to parse sections JSON:', error);
        return null;
      }
    }

    case "create_pdf": {
      // Parse: create_pdf("filename", [content_definitions])
      const firstComma = paramsStr.indexOf(",");
      if (firstComma === -1) return null;

      const filename = paramsStr.substring(0, firstComma).trim().replace(/^["']|["']$/g, "");
      const contentStr = paramsStr.substring(firstComma + 1).trim();

      try {
        const content = JSON.parse(contentStr);
        return { type: "create_pdf", params: { filename, content } };
      } catch (error) {
        console.error('[PDF] Failed to parse content JSON:', error);
        return null;
      }
    }

    case "screenshot_ocr": {
      // Parse: screenshot_ocr({...params})
      try {
        const params = JSON.parse(paramsStr);
        return { type: "screenshot_ocr", params };
      } catch (error) {
        console.error('[OCR] Failed to parse params JSON:', error);
        // Fallback: empty params = full page screenshot with default settings
        return { type: "screenshot_ocr", params: {} };
      }
    }

    case "generate_image": {
      // Parse: generate_image("prompt", "1024x1024")
      const imgParts = paramsStr.match(/["']([^"']+)["']/g);
      if (!imgParts || imgParts.length < 1) return null;
      const prompt = imgParts[0].replace(/^["']|["']$/g, "");
      const size = imgParts[1]?.replace(/^["']|["']$/g, "") || "1024x1024";
      return { type: "generate_image", params: { prompt, size } };
    }

    case "post_tweet": {
      // Parse: post_tweet("tweet text")
      const tweetText = paramsStr.replace(/^["']|["']$/g, "");
      if (!tweetText) return null;
      return { type: "post_tweet", params: { text: tweetText } };
    }

    case "create_campaign": {
      // Parse: create_campaign("name", [{...steps}])
      const firstComma = paramsStr.indexOf(",");
      if (firstComma === -1) return null;
      const name = paramsStr.substring(0, firstComma).trim().replace(/^["']|["']$/g, "");
      const stepsStr = paramsStr.substring(firstComma + 1).trim();
      try {
        const steps = JSON.parse(stepsStr);
        return { type: "create_campaign", params: { name, steps } };
      } catch (error) {
        console.error('[CAMPAIGN] Failed to parse steps JSON:', error);
        return null;
      }
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
  // Normalize curly/smart apostrophes before filtering — same as processor.ts normalizer
  const normalized = response
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');
  // Strip action tags — use [\s\S]*? to match multiline JSON blobs in create_word/excel/etc
  let cleaned = normalized.replace(/\[ACTION:[\s\S]*?\]\s*/g, "").trim();

  // Strip plan-like paragraphs — the user sees a finished email, not a live process
  const paragraphs = cleaned.split(/\n\n/);
  const filtered = [];
  for (const p of paragraphs) {
    const lower = p.toLowerCase().trim();
    // Skip paragraphs that describe what the AI will/is going to do (plans, not results)
    if (
      (lower.startsWith('what i can do next') || lower.startsWith('what i can next')) ||
      (lower.startsWith('this should take me') || lower.startsWith('this will take me')) ||
      (lower.startsWith('next, i') || lower.startsWith("next i'll")) ||
      (lower.startsWith('i need to find') || lower.startsWith('i need to search')) ||
      (lower.startsWith('let me try') || lower.startsWith('let me search') || lower.startsWith('let me find')) ||
      (/^(?:i'll|let me|i'm going to|i will)\s+(?:navigate|browse|search|look|try|check|go|find|get|fetch|head|visit|begin|open|access|sign|create|make|build|write|post|apply|use|take)\b/.test(lower) && p.length < 300) ||
      // Drop narration about search/page failures
      (/(?:search results?|the page|bing|google|duckduckgo)\s+(?:didn't|did not|doesn't|isn't|wasn't|seems? to have)\s+/i.test(lower) && p.length < 300) ||
      (lower.includes('technical issues') && (lower.includes('search') || lower.includes('bing'))) ||
      (lower.includes('unable to process') || lower.includes('error has occurred')) ||
      // Drop "looking at the current state" type narration
      (lower.startsWith('looking at the current') || lower.startsWith('i can see the search') || lower.startsWith('i can see that the'))
    ) {
      continue; // Drop this paragraph
    }
    filtered.push(p);
  }

  const result = filtered.join('\n\n').trim();
  // If filtering would remove EVERYTHING, don't filter at all — something is better than nothing.
  // The quality gate handles truly bad responses; cleanResponseForEmail is just cosmetic cleanup.
  return result || cleaned;
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
  // AGI DEFAULT: Browser is ALWAYS available unless task is trivially simple.
  // An agent without tools is just a chatbot. Default to having tools.
  let needsBrowser = true;
  const domains: string[] = [];

  // ---- AI-ONLY fast paths: disable browser only for trivially simple tasks ----

  // 1. Pure math/calculation
  const mathPatterns = [
    /\b\d+\s*[\+\-\*\/×÷]\s*\d+/,
    /what\s+(is|are)\s+\d+/i,
    /calculate\s+/i,
    /\bdivided\s+by\b/i,
    /\bmultiplied\s+by\b/i,
  ];
  if (mathPatterns.some(p => p.test(text)) && text.length < 100) {
    console.log("[AI] Math task detected, skipping browser");
    return { taskType: "general", goal: userMessage, needsBrowser: false, domains: [] };
  }

  // 2. Greetings / conversational
  const greetingPatterns = [
    /^(hi|hello|hey|thanks|thank you|ok|okay|bye|good morning|good night|how are you)\b/i,
  ];
  if (greetingPatterns.some(p => p.test(text)) && text.length < 80) {
    console.log("[AI] Greeting detected, skipping browser");
    return { taskType: "general", goal: userMessage, needsBrowser: false, domains: [] };
  }

  // 3. Memory commands
  if (/^remember\b/i.test(text) && text.length < 200) {
    console.log("[AI] Memory task detected, skipping browser");
    return { taskType: "general", goal: userMessage, needsBrowser: false, domains: [] };
  }

  // 4. Simple factual questions that AI can answer from knowledge
  // Only skip browser for short, definitional questions with NO live data need
  const knowledgePatterns = [
    /^(what|who|when|where|why|how)\s+(is|are|was|were|does|do|did)\s+/i,
    /^explain\s+/i,
    /^define\s+/i,
  ];
  const hasLiveDataIntent = /\b(price|cost|buy|purchase|money|earn|make|order|amazon|walmart|ebay|store|shop|deal|sale|stock|available|shipping|delivery|rating|review|weather|news|today|current|latest|now|sign up|register|create|account|apply|job|gig|freelance|opportunity)\b/i.test(text);
  const hasUrl = /https?:\/\//i.test(text) || /www\./i.test(text);

  if (knowledgePatterns.some(p => p.test(text)) && !hasUrl && !hasLiveDataIntent && text.length < 150) {
    console.log("[AI] Simple knowledge question, skipping browser");
    return { taskType: "general", goal: userMessage, needsBrowser: false, domains: [] };
  }

  // ---- Task type classification (browser is already enabled by default) ----

  if (text.includes("research") || text.includes("find") || text.includes("search") || text.includes("look up")) {
    taskType = "research";
  } else if (text.includes("book") || text.includes("reservation") || text.includes("schedule appointment")) {
    taskType = "booking";
  } else if (text.includes("schedule") || text.includes("recurring") || text.includes("every day") || text.includes("every morning") || text.includes("daily task") || text.includes("weekly task") || text.includes("campaign") || text.includes("cron")) {
    taskType = "reminder";
    // Schedule/campaign tasks are pure DB operations — no browser needed.
    // Browser init on Railway often times out and wastes resources.
    needsBrowser = false;
  } else if (text.includes("form") || text.includes("fill") || text.includes("apply") || text.includes("submit")) {
    taskType = "form";
  } else if (text.includes("buy") || text.includes("purchase") || text.includes("order") || text.includes("shop")) {
    taskType = "shopping";
  } else if (text.includes("email") || text.includes("send") || text.includes("write to")) {
    taskType = "email";
  } else if (text.includes("remind") || text.includes("alert") || text.includes("notify")) {
    taskType = "reminder";
    needsBrowser = false;
  } else if (text.includes("write") || text.includes("draft") || text.includes("compose")) {
    taskType = "writing";
  } else if (text.includes("call") || text.includes("phone") || text.includes("dial")) {
    taskType = "voice";
  }

  // Extract URLs/domains
  const urlRegex = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+(?:\.[a-zA-Z]{2,})+)/g;
  let urlMatch;
  while ((urlMatch = urlRegex.exec(userMessage)) !== null) {
    domains.push(urlMatch[1]);
  }

  console.log(`[AI] classifyTask: type="${taskType}", needsBrowser=${needsBrowser}, domains=${domains.length}`);
  return { taskType, goal: userMessage, needsBrowser, domains };
}
