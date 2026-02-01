/**
 * AI Service
 * 
 * Routes to the appropriate AI model based on task type and cost.
 * Priority: DeepSeek V3 (cheapest) > Claude Haiku (fast) > Gemini Flash (free) > Mock
 * 
 * Cost optimization:
 * - DeepSeek V3: $0.14/M input, $0.28/M output (cheapest)
 * - Claude Haiku: $0.25/M input, $1.25/M output
 * - Gemini Flash: Free tier available
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { Memory, Action, AIResponse } from "../types/index.js";

// Lazy initialization of clients
let anthropicClient: Anthropic | null = null;
let deepseekClient: OpenAI | null = null;
let geminiClient: OpenAI | null = null;

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

// Task type to model routing
type TaskType = 'classify' | 'plan' | 'generate' | 'validate' | 'vision' | 'complex';

interface ModelConfig {
  provider: 'deepseek' | 'haiku' | 'sonnet' | 'gemini';
  model: string;
  costPer1kInput: number;
  costPer1kOutput: number;
}

const MODEL_ROUTING: Record<TaskType, ModelConfig> = {
  classify: { provider: 'deepseek', model: 'deepseek-chat', costPer1kInput: 0.00014, costPer1kOutput: 0.00028 },
  plan: { provider: 'deepseek', model: 'deepseek-chat', costPer1kInput: 0.00014, costPer1kOutput: 0.00028 },
  generate: { provider: 'deepseek', model: 'deepseek-chat', costPer1kInput: 0.00014, costPer1kOutput: 0.00028 },
  validate: { provider: 'haiku', model: 'claude-3-5-haiku-latest', costPer1kInput: 0.00025, costPer1kOutput: 0.00125 },
  vision: { provider: 'sonnet', model: 'claude-sonnet-4-20250514', costPer1kInput: 0.003, costPer1kOutput: 0.015 },
  complex: { provider: 'sonnet', model: 'claude-sonnet-4-20250514', costPer1kInput: 0.003, costPer1kOutput: 0.015 },
};

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

/**
 * Generate AI response with automatic model fallback
 * Fallback chain: DeepSeek -> Claude Haiku -> Gemini Flash -> Mock
 */
export async function generateResponse(
  memory: Memory,
  taskSubject: string,
  taskBody: string,
  username: string
): Promise<AIResponse> {
  // Check if we should use mock mode (for testing without valid API keys)
  if (process.env.AI_MOCK_MODE === "true") {
    return generateMockResponse(username, taskSubject, taskBody);
  }

  const systemPromptWithUser = `${SYSTEM_PROMPT}

You are ${username}'s personal AI assistant. Address them by name when appropriate.`;

  const userPrompt = buildUserPrompt(memory, taskSubject, taskBody);
  
  let totalCost = 0;

  // 1. Try DeepSeek first (cheapest - $0.14/M input)
  if (process.env.DEEPSEEK_API_KEY) {
    try {
      const response = await getDeepSeekClient().chat.completions.create({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: systemPromptWithUser },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 4096,
        temperature: 0.7,
      });

      const content = response.choices[0]?.message?.content || "";
      const inputTokens = response.usage?.prompt_tokens || 0;
      const outputTokens = response.usage?.completion_tokens || 0;
      totalCost = (inputTokens * 0.00014 + outputTokens * 0.00028) / 1000;

      console.log(`[AI] DeepSeek success | Tokens: ${inputTokens + outputTokens} | Cost: $${totalCost.toFixed(6)}`);
      return {
        content,
        actions: parseActions(content),
        tokensUsed: inputTokens + outputTokens,
        cost: totalCost,
        model: 'deepseek-chat'
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log("[AI] DeepSeek failed:", errorMessage);
    }
  }

  // 2. Try Claude Haiku (fast, reasonably cheap)
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const response = await getAnthropicClient().messages.create({
        model: "claude-3-5-haiku-latest",
        max_tokens: 4096,
        system: systemPromptWithUser,
        messages: [{ role: "user", content: userPrompt }],
      });

      const content = response.content[0].type === "text" ? response.content[0].text : "";
      const inputTokens = response.usage?.input_tokens || 0;
      const outputTokens = response.usage?.output_tokens || 0;
      totalCost = (inputTokens * 0.00025 + outputTokens * 0.00125) / 1000;

      console.log(`[AI] Claude Haiku success | Tokens: ${inputTokens + outputTokens} | Cost: $${totalCost.toFixed(6)}`);
      return {
        content,
        actions: parseActions(content),
        tokensUsed: inputTokens + outputTokens,
        cost: totalCost,
        model: 'claude-3-5-haiku-latest'
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log("[AI] Claude Haiku failed:", errorMessage);
    }
  }

  // 3. Try Gemini Flash (free tier)
  if (process.env.GOOGLE_API_KEY) {
    try {
      const response = await getGeminiClient().chat.completions.create({
        model: "gemini-2.0-flash",
        messages: [
          { role: "system", content: systemPromptWithUser },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 4096,
      });

      const content = response.choices[0]?.message?.content || "";
      const tokensUsed = (response.usage?.prompt_tokens || 0) + (response.usage?.completion_tokens || 0);

      console.log(`[AI] Gemini Flash success | Tokens: ${tokensUsed} | Cost: FREE`);
      return {
        content,
        actions: parseActions(content),
        tokensUsed,
        cost: 0,
        model: 'gemini-2.0-flash'
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log("[AI] Gemini Flash failed:", errorMessage);
    }
  }

  // 4. Fall back to mock mode if all APIs fail
  console.log("[AI] All APIs failed, using mock response");
  return generateMockResponse(username, taskSubject, taskBody);
}

/**
 * Generate response for vision tasks (requires Claude Sonnet)
 */
export async function generateVisionResponse(
  prompt: string,
  imageBase64: string,
  systemPrompt?: string
): Promise<{ content: string; cost: number }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { content: "Vision capability requires Claude API key", cost: 0 };
  }

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
    const cost = (response.usage.input_tokens * 0.003 + response.usage.output_tokens * 0.015) / 1000;

    console.log(`[AI] Vision (Sonnet) | Cost: $${cost.toFixed(6)}`);
    return { content, cost };
  } catch (error) {
    console.error("[AI] Vision failed:", error);
    return { content: "Failed to analyze image", cost: 0 };
  }
}

/**
 * Quick validation using Claude Haiku
 */
export async function quickValidate(
  prompt: string,
  systemPrompt?: string
): Promise<{ result: string; cost: number }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { result: "true", cost: 0 }; // Default to true if no API
  }

  try {
    const response = await getAnthropicClient().messages.create({
      model: "claude-3-5-haiku-latest",
      max_tokens: 256,
      system: systemPrompt || "Respond with only 'true' or 'false'.",
      messages: [{ role: "user", content: prompt }]
    });

    const content = response.content[0].type === "text" ? response.content[0].text : "";
    const cost = (response.usage.input_tokens * 0.00025 + response.usage.output_tokens * 0.00125) / 1000;

    return { result: content.trim(), cost };
  } catch {
    return { result: "true", cost: 0 };
  }
}

/**
 * Generate a mock response for testing
 */
function generateMockResponse(username: string, taskSubject: string, taskBody: string): AIResponse {
  console.log("[AI] Using mock response mode");
  
  const mockContent = `Hello ${username}! I received your request about "${taskSubject}".

I understand you're asking: "${taskBody.substring(0, 150)}${taskBody.length > 150 ? "..." : ""}"

I'm your AI assistant and I'm processing your request. Note: This is a test response because no AI API is currently available.

To enable real AI responses:
1. Add funds to your DeepSeek account, OR
2. Get a valid Anthropic API key, OR
3. Get a Google API key for Gemini

Then set AI_MOCK_MODE=false in your .env file.

[ACTION:remember("${username} sent a message about ${taskSubject.substring(0, 50)}")]`;

  return {
    content: mockContent,
    actions: parseActions(mockContent),
    tokensUsed: 100,
    cost: 0,
    model: 'mock'
  };
}

/**
 * Parse action tags from AI response
 */
export function parseActions(response: string): Action[] {
  const actions: Action[] = [];
  
  // Match [ACTION:functionName(params)]
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
 * Classify a task using AI (or heuristics as fallback)
 */
export async function classifyTask(userMessage: string): Promise<{
  taskType: string;
  goal: string;
  needsBrowser: boolean;
  domains: string[];
}> {
  // Use simple heuristic classification for cost efficiency
  // AI classification would cost ~$0.001 per request
  const text = userMessage.toLowerCase();
  
  let taskType = "general";
  let needsBrowser = false;
  const domains: string[] = [];
  
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
  }
  
  // Extract any URLs or domain names from the message
  const urlRegex = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+(?:\.[a-zA-Z]{2,})+)/g;
  let urlMatch;
  while ((urlMatch = urlRegex.exec(userMessage)) !== null) {
    domains.push(urlMatch[1]);
  }
  
  return {
    taskType,
    goal: userMessage,
    needsBrowser,
    domains
  };
}
