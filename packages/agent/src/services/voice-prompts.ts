/**
 * Voice Prompts Service
 * AI-generated personalized greetings and voice conversation responses
 */

import { getSupabaseClient } from "../utils/supabase.js";

// ---- Types ----

interface GreetingParams {
  userId: string;
  userName: string;
  botName: string;
  callType: "incoming" | "checkin_morning" | "checkin_evening" | "outbound" | "receptionist" | "task";
  greetingStyle: string;
  timezone: string;
}

interface VoiceContext {
  userName: string;
  botName: string;
  timezone: string;
  callType: string;
}

// ---- AI-Generated Greetings ----

export async function generatePersonalizedGreeting(params: GreetingParams): Promise<string> {
  try {
    // Load user context in parallel
    const [recentTasks, pendingCount] = await Promise.all([
      getRecentTasks(params.userId, 3),
      getPendingTaskCount(params.userId),
    ]);

    const timeOfDay = getTimeOfDay(params.timezone);
    const prompt = buildGreetingPrompt(params, timeOfDay, recentTasks, pendingCount);

    const response = await callFastModel(prompt, 80);
    if (response) return response;
  } catch (err) {
    console.error("[VOICE-PROMPT] Greeting generation failed, using fallback:", err);
  }

  return getFallbackGreeting(params);
}

function buildGreetingPrompt(
  params: GreetingParams,
  timeOfDay: string,
  recentTasks: string[],
  pendingCount: number
): string {
  return `Generate a natural, warm phone greeting. Keep it under 25 words. Be conversational, not robotic.

Name: ${params.userName}
Bot name: ${params.botName}
Time: ${timeOfDay}
Style: ${params.greetingStyle}
Call type: ${params.callType}
${recentTasks.length ? `Recent activity: ${recentTasks.join(", ")}` : ""}
${pendingCount > 0 ? `Pending tasks: ${pendingCount}` : ""}

Rules:
- Sound like a real person, not a robot or customer service agent
- Reference something specific if possible (time of day, recent activity)
- End with an open question like "what's up?" or "what can I do for you?"
- Do NOT use emojis or markdown
- Do NOT use phrases like "How may I assist you today" — too formal`;
}

// ---- Voice Response Generation ----

export async function generateVoiceResponse(
  userId: string,
  userSpeech: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
  context: VoiceContext
): Promise<string> {
  const systemPrompt = buildVoiceSystemPrompt(context);

  // Build message array: system + last 10 exchanges
  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: systemPrompt },
  ];

  // Include recent conversation history (last 10 exchanges for context)
  const recentHistory = conversationHistory.slice(-10);
  for (const msg of recentHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }

  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${groqKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages,
          temperature: 0.7,
          max_tokens: 200,
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        if (text) return cleanVoiceResponse(text);
      }
    } catch (err) {
      console.error("[VOICE-PROMPT] Groq response failed:", err);
    }
  }

  // Fallback to DeepSeek
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (deepseekKey) {
    try {
      const res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${deepseekKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages,
          temperature: 0.7,
          max_tokens: 200,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        if (text) return cleanVoiceResponse(text);
      }
    } catch (err) {
      console.error("[VOICE-PROMPT] DeepSeek response failed:", err);
    }
  }

  return "I'm having trouble processing that right now. Could you try rephrasing?";
}

function buildVoiceSystemPrompt(context: VoiceContext): string {
  return `You are ${context.botName}, a helpful AI assistant speaking on a phone call with ${context.userName}.

CRITICAL RULES FOR VOICE:
- Keep responses SHORT (1-3 sentences max). This is a phone call, not an essay.
- Sound natural and conversational. Use contractions (I'm, you're, that's).
- Never use markdown, bullet points, numbered lists, or formatting.
- Never use emojis or special characters.
- Never say "as an AI" or "I'm an artificial intelligence."
- If the user asks you to do something (book, search, email, etc.), confirm you'll handle it and give a brief summary.
- If you don't understand, ask a short clarifying question.
- Match the user's energy — casual if they're casual, focused if they're focused.
- End task confirmations with "anything else?" or similar.
- Current time: ${getTimeOfDay(context.timezone)} (${context.timezone})`;
}

// ---- Helpers ----

function cleanVoiceResponse(text: string): string {
  // Strip any markdown, action tags, or formatting that slipped through
  return text
    .replace(/\[ACTION:[^\]]*\]/g, "")
    .replace(/\[TASK_COMPLETE\]/g, "")
    .replace(/[*_`#]/g, "")
    .replace(/\n+/g, " ")
    .trim();
}

async function callFastModel(prompt: string, maxTokens: number): Promise<string | null> {
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${groqKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.8,
          max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        if (text) return cleanVoiceResponse(text);
      }
    } catch { /* fallback */ }
  }
  return null;
}

async function getRecentTasks(userId: string, limit: number): Promise<string[]> {
  try {
    const { data } = await getSupabaseClient()
      .from("tasks")
      .select("input_text")
      .eq("user_id", userId)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(limit);

    return (data || [])
      .map((t: any) => t.input_text?.slice(0, 50))
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function getPendingTaskCount(userId: string): Promise<number> {
  try {
    const { count } = await getSupabaseClient()
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", ["queued", "processing"]);

    return count || 0;
  } catch {
    return 0;
  }
}

function getTimeOfDay(timezone: string): string {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "numeric",
      hour12: true,
    });
    const timeStr = formatter.format(now);

    const hourFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });
    const hour = parseInt(hourFormatter.format(now));

    if (hour < 12) return `${timeStr} (morning)`;
    if (hour < 17) return `${timeStr} (afternoon)`;
    if (hour < 21) return `${timeStr} (evening)`;
    return `${timeStr} (night)`;
  } catch {
    return "unknown time";
  }
}

// ---- Fallback Greetings (used when AI fails) ----

function getFallbackGreeting(params: GreetingParams): string {
  const { userName, botName, callType, greetingStyle } = params;

  if (callType === "checkin_morning") {
    const greetings = [
      `Good morning, ${userName}! It's ${botName}. How's your day looking?`,
      `Hey ${userName}! Morning check-in. Anything on your mind?`,
      `Rise and shine, ${userName}! ${botName} here. What's the plan today?`,
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  }

  if (callType === "checkin_evening") {
    const greetings = [
      `Hey ${userName}, it's ${botName}. How did today go?`,
      `Evening, ${userName}! ${botName} checking in. Anything you need before calling it a day?`,
      `Hey ${userName}! Just your evening check-in. How are things?`,
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  }

  if (callType === "receptionist") {
    return `Hello! You've reached ${userName}'s assistant. How can I help you?`;
  }

  // Default incoming call greeting
  switch (greetingStyle) {
    case "jarvis":
      return `Good to hear from you, ${userName}. How may I assist?`;
    case "ironman":
      return `${userName}! What've you got for me?`;
    case "professional":
      return `Hello ${userName}, this is ${botName}. What can I help with?`;
    default:
      const casual = [
        `Hey ${userName}! What's up?`,
        `Hey! ${botName} here. What can I do for you?`,
        `${userName}! Good to hear from you. What do you need?`,
      ];
      return casual[Math.floor(Math.random() * casual.length)];
  }
}
