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
const FALLBACK_PROMPT = `You are an AI AGENT that DOES things. Not a chatbot. You complete real tasks.

ACTIONS AVAILABLE (include in your response in this EXACT format):

BROWSER:
[ACTION:browse("url")] - Navigate to a webpage
[ACTION:search("query")] - Search the web
[ACTION:screenshot("url")] - Screenshot a webpage
[ACTION:fill_form("url", {"field": "value"})] - Fill a form
[ACTION:click("selector")] - Click an element
[ACTION:fill("selector", "value")] - Type into a field

COMMUNICATION:
[ACTION:send_email("to@email.com", "Subject", "Body")] - Send an email
[ACTION:send_sms("+1234567890", "Message")] - Send a text message (use user's phone from their profile)
[ACTION:send_whatsapp("+1234567890", "Message")] - Send a WhatsApp message
[ACTION:send_telegram("chat_id", "Message")] - Send a Telegram message
[ACTION:call_user("Optional message")] - Call the user's registered phone

OTHER:
[ACTION:read_email()] - Check inbox for new emails
[ACTION:remember("fact")] - Save to long-term memory
[ACTION:schedule("task", "in 5 minutes")] - Schedule a task
[ACTION:generate_image("prompt", "1024x1024")] - Generate an AI image

CRITICAL RULES:
- "text me" or "send me a text" → [ACTION:send_sms("+their_number", "message")]
- "call me" → [ACTION:call_user("message")]
- "email me" → [ACTION:send_email("to", "subject", "body")]
- NEVER explain how email/SMS works. NEVER say "text messaging is available on platforms like..."
- JUST USE THE ACTION TAG. Writing "I'll text you" without [ACTION:send_sms(...)] does NOTHING.
- Be concise. Act, don't advise.`;

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
  userContext: { username: string; senderName?: string; timezone?: string; preferences?: string; recentActivity?: string; userEmail?: string },
  agiBasePrompt?: string
): string {
  // username = agent's Aevoy username (e.g. "sage"), senderName = human's name (e.g. "Omar")
  const agentName = userContext.username.charAt(0).toUpperCase() + userContext.username.slice(1);
  const humanName = userContext.senderName || "the user";

  // ALWAYS start with the AGI system prompt — this contains all instructions,
  // action types, search strategies, response quality rules, and AGI behavior.
  // Without this, the AI is just a generic chatbot.
  let agiPrompt = agiBasePrompt || FALLBACK_PROMPT;

  // Inject the actual username's email address into the prompt
  agiPrompt = agiPrompt.replace(
    /your own email address/gi,
    `your own email address (${userContext.username}@aevoy.com)`
  );

  const parts: string[] = [agiPrompt];

  // Add personality overlay if available
  if (files.soul) {
    parts.push(files.soul);
  }

  if (files.identity) {
    parts.push(files.identity);
  }

  // User context
  parts.push(`Your name is ${agentName}. Your agent email is ${userContext.username}@aevoy.com.${userContext.userEmail ? ` The user's email is ${userContext.userEmail}.` : ''} You are helping ${humanName}. Address them as ${humanName}.`);

  if (files.userTemplate) {
    let userSection = files.userTemplate
      .replace("{{username}}", userContext.username)
      .replace("{{agentName}}", agentName)
      .replace("{{senderName}}", humanName)
      .replace("{{timezone}}", userContext.timezone || "not set")
      .replace("{{preferences}}", userContext.preferences || "none recorded")
      .replace("{{recentActivity}}", userContext.recentActivity || "no recent activity");
    parts.push(userSection);
  }

  return parts.join("\n\n");
}

/**
 * Main entry point: get a compiled system prompt for a user.
 */
export async function getCompiledPrompt(
  userId: string,
  username: string,
  memory?: { facts?: string; recentLogs?: string },
  senderName?: string,
  agiBasePrompt?: string,
  userEmail?: string
): Promise<string> {
  const files = await loadPersonalityFiles();

  return compileSystemPrompt(files, {
    username,
    senderName,
    preferences: memory?.facts?.substring(0, 200),
    recentActivity: memory?.recentLogs?.substring(0, 200),
    userEmail,
  }, agiBasePrompt);
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
