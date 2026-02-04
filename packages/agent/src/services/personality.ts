/**
 * Personality Service
 *
 * Loads external personality config files and compiles them into a system prompt.
 * Hot-reloads when files change. Falls back to built-in prompt if files missing.
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import type { CompiledPersonality } from "../types/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.join(__dirname, "../../config/personality");

// Cached file contents
let cachedSoul: string | null = null;
let cachedIdentity: string | null = null;
let cachedUserTemplate: string | null = null;
let lastLoadTime = 0;

const CACHE_TTL_MS = 5000; // 5 seconds

// Built-in fallback (matches original SYSTEM_PROMPT)
const FALLBACK_PROMPT = `You are an AI assistant that can actually DO things for your user. You're not just a chatbot - you complete real tasks.

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

/**
 * Load a personality file with caching.
 */
async function loadFile(filename: string): Promise<string | null> {
  try {
    const filePath = path.join(CONFIG_DIR, filename);
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Load all personality files, using cache if fresh.
 */
async function loadPersonalityFiles(): Promise<{
  soul: string | null;
  identity: string | null;
  userTemplate: string | null;
}> {
  const now = Date.now();
  if (cachedSoul !== null && now - lastLoadTime < CACHE_TTL_MS) {
    return { soul: cachedSoul, identity: cachedIdentity, userTemplate: cachedUserTemplate };
  }

  const [soul, identity, userTemplate] = await Promise.all([
    loadFile("SOUL.md"),
    loadFile("IDENTITY.md"),
    loadFile("USER_TEMPLATE.md"),
  ]);

  cachedSoul = soul;
  cachedIdentity = identity;
  cachedUserTemplate = userTemplate;
  lastLoadTime = now;

  return { soul, identity, userTemplate };
}

/**
 * Compile a system prompt from personality files and user context.
 */
export function compileSystemPrompt(
  files: { soul: string | null; identity: string | null; userTemplate: string | null },
  userContext: { username: string; timezone?: string; preferences?: string; recentActivity?: string }
): string {
  // If no personality files found, use fallback
  if (!files.soul && !files.identity) {
    return `${FALLBACK_PROMPT}\n\nYou are ${userContext.username}'s personal AI assistant. Address them by name when appropriate.`;
  }

  const parts: string[] = [];

  if (files.soul) {
    parts.push(files.soul);
  }

  if (files.identity) {
    parts.push(files.identity);
  }

  // Action format (always included)
  parts.push(`## Actions Format
Include actions in your response using this format:
[ACTION:browse("url")] - Navigate to a webpage
[ACTION:search("query")] - Search the web
[ACTION:screenshot("url")] - Take a screenshot
[ACTION:fill_form("url", {"field": "value"})] - Fill a form
[ACTION:send_email("to", "subject", "body")] - Send an email
[ACTION:remember("fact")] - Save a fact to memory
[ACTION:schedule("task", "cron")] - Schedule a task`);

  // User context
  if (files.userTemplate) {
    let userSection = files.userTemplate
      .replace("{{username}}", userContext.username)
      .replace("{{timezone}}", userContext.timezone || "not set")
      .replace("{{preferences}}", userContext.preferences || "none recorded")
      .replace("{{recentActivity}}", userContext.recentActivity || "no recent activity");
    parts.push(userSection);
  } else {
    parts.push(`You are ${userContext.username}'s personal AI employee. Address them by name when appropriate.`);
  }

  return parts.join("\n\n");
}

/**
 * Main entry point: get a compiled system prompt for a user.
 */
export async function getCompiledPrompt(
  userId: string,
  username: string,
  memory?: { facts?: string; recentLogs?: string }
): Promise<string> {
  const files = await loadPersonalityFiles();

  return compileSystemPrompt(files, {
    username,
    preferences: memory?.facts?.substring(0, 200),
    recentActivity: memory?.recentLogs?.substring(0, 200),
  });
}

/**
 * Get the compiled personality metadata (for debugging/inspection).
 */
export async function getPersonalityInfo(): Promise<CompiledPersonality> {
  const files = await loadPersonalityFiles();
  return {
    hasSoul: !!files.soul,
    hasIdentity: !!files.identity,
    hasUserTemplate: !!files.userTemplate,
    usingFallback: !files.soul && !files.identity,
  };
}
