/**
 * Voice Conversation Handler
 * Manages WebSocket connections for Twilio ConversationRelay
 * Real-time two-way voice conversations via ElevenLabs TTS + Deepgram STT
 *
 * Wired into the full memory pipeline — same context as email/task processing.
 */

import { WebSocket } from "ws";
import { IncomingMessage } from "http";
import { getSupabaseClient } from "../utils/supabase.js";
import { generatePersonalizedGreeting, generateVoiceResponse } from "./voice-prompts.js";
import { verifyVoicePin } from "./twilio.js";
import { trackServiceCost } from "./ai.js";
import { calculateVoiceCost } from "../utils/cost-calculator.js";
import { loadMemory, saveWorkingMemory, appendDailyLog } from "./memory.js";
import { sanitizeTaskInput } from "../security/validator.js";
import { getUnreadMessages, getRecentMessages, isEmailConnected } from "./inbox.js";

// ---- Types ----

interface VoiceSession {
  sessionId: string;
  callSid: string;
  userId: string | null;
  userName: string;
  userEmail: string;
  botName: string;
  greetingStyle: string;
  timezone: string;
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  state: "setup" | "awaiting_pin" | "ready" | "conversation" | "ended";
  pinAttempts: number;
  pinDigits: string;
  ws: WebSocket;
  startedAt: number;
  lastActivityAt: number;
  callType: string;
  // Memory context loaded at session start
  memoryContext: string;
  userProfile: string;
}

const activeSessions = new Map<string, VoiceSession>();
const MAX_SESSIONS = 50;
const SESSION_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes max call

// ---- Session Management ----

function cleanupSession(sessionId: string): void {
  const session = activeSessions.get(sessionId);
  if (session) {
    activeSessions.delete(sessionId);
    console.log(`[VOICE-WS] Session ${sessionId.slice(0, 8)} cleaned up (active: ${activeSessions.size})`);
  }
}

// Periodic cleanup of stale sessions
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of activeSessions) {
    if (now - session.startedAt > SESSION_TIMEOUT_MS) {
      console.log(`[VOICE-WS] Session ${id.slice(0, 8)} timed out after ${Math.round((now - session.startedAt) / 60000)}m`);
      try {
        session.ws.send(JSON.stringify({ type: "end" }));
        session.ws.close();
      } catch { /* ignore */ }
      activeSessions.delete(id);
    }
  }
}, 60_000);

// ---- WebSocket Handler ----

export async function handleVoiceWebSocket(ws: WebSocket, request: IncomingMessage): Promise<void> {
  let sessionId = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  if (activeSessions.size >= MAX_SESSIONS) {
    console.warn("[VOICE-WS] Max sessions reached, rejecting connection");
    ws.send(JSON.stringify({ type: "text", token: "I'm sorry, all lines are busy right now. Please try again in a few minutes.", last: true }));
    ws.send(JSON.stringify({ type: "end" }));
    ws.close();
    return;
  }

  ws.on("message", async (data) => {
    try {
      const message = JSON.parse(data.toString());
      const session = activeSessions.get(sessionId);

      switch (message.type) {
        case "setup":
          await handleSetup(ws, message, sessionId);
          break;

        case "prompt":
          if (session) await handlePrompt(session, message);
          break;

        case "dtmf":
          if (session) await handleDtmf(session, message);
          break;

        case "interrupt":
          if (session) {
            session.lastActivityAt = Date.now();
            console.log(`[VOICE-WS] ${sessionId.slice(0, 8)} interrupted at: "${message.utteranceUntilInterrupt?.slice(0, 50)}"`);
          }
          break;

        case "error":
          console.error(`[VOICE-WS] Session error: ${message.description}`);
          break;

        default:
          // ConversationRelay tolerates unknown messages
          break;
      }
    } catch (err) {
      console.error("[VOICE-WS] Message processing error:", err);
    }
  });

  // Keepalive ping every 25s — prevents proxies/load balancers from closing idle connections
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    } else {
      clearInterval(pingInterval);
    }
  }, 25_000);

  ws.on("close", () => {
    clearInterval(pingInterval);
    const session = activeSessions.get(sessionId);
    if (session) {
      const duration = Math.round((Date.now() - session.startedAt) / 1000);
      console.log(`[VOICE-WS] Session ${sessionId.slice(0, 8)} closed after ${duration}s (${session.conversationHistory.length} exchanges)`);
      logCallHistory(session, duration);
      // Save conversation to memory (async, non-blocking)
      saveConversationToMemory(session).catch(() => {});
    }
    cleanupSession(sessionId);
  });

  ws.on("error", (err) => {
    clearInterval(pingInterval);
    console.error(`[VOICE-WS] WebSocket error:`, err);
    cleanupSession(sessionId);
  });
}

// ---- Message Handlers ----

async function handleSetup(ws: WebSocket, message: any, sessionId: string): Promise<void> {
  const { callSid, from, to, customParameters = {} } = message;
  const userId = customParameters.userId || null;
  const callType = customParameters.callType || "task";

  const isDemo = callType === "demo";
  console.log(`[VOICE-WS] Setup: callSid=${callSid?.slice(0, 10)}, from=${from}, userId=${userId?.slice(0, 8)}, type=${callType}${isDemo ? " (DEMO)" : ""}`);

  // Load user profile
  let userName = isDemo ? "there" : "there";
  let userEmail = "";
  let botName = isDemo ? "Aevoy" : "Nova";
  let greetingStyle = "casual";
  let timezone = "America/Los_Angeles";
  let needsPin = false;
  let userProfile = "";
  let memoryContext = isDemo ? "This is a DEMO CALL from the website 'Call Me Now' button. The caller is a potential customer trying Aevoy for the first time. Be warm, impressive, and show off what Aevoy can do. Don't ask for personal info — just demonstrate capabilities." : "";

  if (userId) {
    // Load profile, settings, and memory in parallel — wrapped in try/catch so session is ALWAYS created
    try {
      const [profileResult, settingsResult, memoryResult] = await Promise.all([
        getSupabaseClient()
          .from("profiles")
          .select("display_name, username, bot_name, phone_number, timezone, voice_pin_hash, voice_pin, voice_pin_attempts, voice_pin_locked_until, email")
          .eq("id", userId)
          .single()
          .then(r => r, (e: any) => { console.error("[VOICE-WS] Profile load failed:", e); return { data: null }; }),
        getSupabaseClient()
          .from("user_settings")
          .select("greeting_style")
          .eq("user_id", userId)
          .single()
          .then(r => r, (e: any) => { console.error("[VOICE-WS] Settings load failed:", e); return { data: null }; }),
        loadMemory(userId).catch(() => ({ facts: "", recentLogs: "", workingMemories: [], episodicMemories: [] })),
      ]);

      const profile = profileResult.data;
      const settings = settingsResult.data;

      if (profile) {
        userName = profile.display_name || profile.username || "there";
        userEmail = profile.email || "";
        botName = profile.bot_name || "Dave";
        greetingStyle = (settings as any)?.greeting_style || "casual";
        timezone = profile.timezone || "America/Los_Angeles";

        // Build profile context string for the AI
        userProfile = [
          userName !== "there" ? `Name: ${userName}` : null,
          userEmail ? `Email: ${userEmail}` : null,
          profile.phone_number ? `Phone: ${profile.phone_number}` : null,
          `Bot name: ${botName}`,
          `Timezone: ${timezone}`,
        ].filter(Boolean).join("\n");

        // Check if caller needs PIN (unknown number)
        const callerPhone = from?.replace(/\D/g, "");
        const userPhone = profile.phone_number?.replace(/\D/g, "");
        const hasPinSet = profile.voice_pin_hash || profile.voice_pin;

        if (hasPinSet && callerPhone !== userPhone) {
          // Check lockout
          if (profile.voice_pin_locked_until && new Date(profile.voice_pin_locked_until) > new Date()) {
            ws.send(JSON.stringify({
              type: "text",
              token: "This number is temporarily locked due to too many incorrect PIN attempts. Please try again later.",
              last: true,
            }));
            ws.send(JSON.stringify({ type: "end" }));
            return;
          }
          needsPin = true;
        }
      } else {
        console.warn(`[VOICE-WS] No profile found for ${userId.slice(0, 8)} — proceeding with defaults`);
      }

      // Format memory context
      if (memoryResult.facts) {
        memoryContext = memoryResult.facts;
        if (memoryResult.recentLogs) {
          memoryContext += `\n\nRecent activity:\n${memoryResult.recentLogs}`;
        }
      }
    } catch (setupErr) {
      console.error(`[VOICE-WS] Setup DB error for ${userId.slice(0, 8)} — proceeding with defaults:`, setupErr);
      // Don't return — always create the session so the call doesn't hang
    }

    console.log(`[VOICE-WS] Loaded context for ${userId.slice(0, 8)}: profile=${userProfile.length}ch, memory=${memoryContext.length}ch`);
  }

  const session: VoiceSession = {
    sessionId,
    callSid: callSid || "",
    userId,
    userName,
    userEmail,
    botName,
    greetingStyle,
    timezone,
    conversationHistory: [],
    state: needsPin ? "awaiting_pin" : "ready",
    pinAttempts: 0,
    pinDigits: "",
    ws,
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    callType,
    memoryContext,
    userProfile,
  };

  activeSessions.set(sessionId, session);
  console.log(`[VOICE-WS] Session created: ${sessionId.slice(0, 8)} (state: ${session.state}, active: ${activeSessions.size})`);

  if (needsPin) {
    ws.send(JSON.stringify({
      type: "text",
      token: `Hello! I need to verify your identity. Please enter your ${session.botName} PIN using your keypad.`,
      last: true,
    }));
  }
  // If no PIN needed, the welcomeGreeting in TwiML handles the greeting
}

async function handlePrompt(session: VoiceSession, message: any): Promise<void> {
  const { voicePrompt, last } = message;
  if (!voicePrompt || !last) return; // Wait for complete utterance

  session.lastActivityAt = Date.now();

  // If awaiting PIN via voice (spoken digits)
  if (session.state === "awaiting_pin") {
    const spokenDigits = voicePrompt.replace(/\D/g, "");
    if (spokenDigits.length >= 4 && spokenDigits.length <= 6) {
      await verifyPinAndTransition(session, spokenDigits);
    } else {
      session.ws.send(JSON.stringify({
        type: "text",
        token: "Please enter your 4 to 6 digit PIN using your keypad, or say the numbers clearly.",
        last: true,
      }));
    }
    return;
  }

  // Sanitize voice input for prompt injection
  const sanitized = sanitizeTaskInput("", voicePrompt);
  if (sanitized.injectionDetected) {
    console.warn(`[VOICE-WS] ${session.sessionId.slice(0, 8)} injection attempt blocked`);
    session.ws.send(JSON.stringify({
      type: "text",
      token: "I didn't quite catch that. What can I help you with?",
      last: true,
    }));
    return;
  }

  // Normal conversation
  session.conversationHistory.push({ role: "user", content: voicePrompt });
  console.log(`[VOICE-WS] ${session.sessionId.slice(0, 8)} user: "${voicePrompt.slice(0, 80)}"`);

  try {
    // FAST PATH: Email queries — fetch and respond inline (< 5s) instead of creating background task
    const emailFastPath = await handleEmailVoiceQuery(session, voicePrompt);
    if (emailFastPath) {
      session.conversationHistory.push({ role: "assistant", content: emailFastPath });
      session.ws.send(JSON.stringify({ type: "text", token: emailFastPath, last: true }));
      console.log(`[VOICE-WS] ${session.sessionId.slice(0, 8)} email fast path: "${emailFastPath.slice(0, 80)}"`);
      return;
    }

    const rawResponse = await generateVoiceResponse(session.userId || "demo", voicePrompt, session.conversationHistory, {
      userName: session.userName,
      userEmail: session.userEmail,
      botName: session.botName,
      timezone: session.timezone,
      callType: session.callType,
      userProfile: session.userProfile,
      memoryContext: session.memoryContext,
    });

    // Extract [REMEMBER:...] tags before sending to TTS
    const { response, memories } = extractMemoryTags(rawResponse);

    session.conversationHistory.push({ role: "assistant", content: response });

    // Send response (ConversationRelay handles TTS)
    session.ws.send(JSON.stringify({
      type: "text",
      token: response,
      last: true,
    }));

    console.log(`[VOICE-WS] ${session.sessionId.slice(0, 8)} assistant: "${response.slice(0, 80)}"`);

    // Save any memories the AI decided to remember (async, non-blocking)
    if (memories.length > 0 && session.userId) {
      for (const mem of memories) {
        saveWorkingMemory(session.userId, mem).catch(() => {});
      }
      console.log(`[VOICE-WS] ${session.sessionId.slice(0, 8)} saved ${memories.length} memories`);
    }

    // Check if the AI wants to create a task from this conversation
    await maybeCreateTask(session, voicePrompt, response);
  } catch (err) {
    console.error(`[VOICE-WS] Response generation error:`, err);
    session.ws.send(JSON.stringify({
      type: "text",
      token: "I had a brief hiccup. Could you repeat that?",
      last: true,
    }));
  }
}

async function handleDtmf(session: VoiceSession, message: any): Promise<void> {
  const { digit } = message;
  session.lastActivityAt = Date.now();

  if (session.state === "awaiting_pin") {
    session.pinDigits += digit;
    console.log(`[VOICE-WS] PIN digit received: ${session.pinDigits.length} digits so far`);

    // Verify when we have 4-6 digits (check after each digit >= 4)
    if (session.pinDigits.length >= 4) {
      await verifyPinAndTransition(session, session.pinDigits);
      session.pinDigits = ""; // Reset for next attempt
    }
  }
}

async function verifyPinAndTransition(session: VoiceSession, pin: string): Promise<void> {
  if (!session.userId) {
    session.ws.send(JSON.stringify({ type: "text", token: "I couldn't verify your identity. Goodbye.", last: true }));
    session.ws.send(JSON.stringify({ type: "end" }));
    return;
  }

  const isValid = await verifyVoicePin(session.userId, pin);

  if (isValid) {
    session.state = "ready";
    session.pinAttempts = 0;
    const greeting = await generatePersonalizedGreeting({
      userId: session.userId,
      userName: session.userName,
      botName: session.botName,
      callType: session.callType as any,
      greetingStyle: session.greetingStyle,
      timezone: session.timezone,
    });
    session.ws.send(JSON.stringify({ type: "text", token: greeting, last: true }));
    console.log(`[VOICE-WS] ${session.sessionId.slice(0, 8)} PIN verified, entering conversation`);
  } else {
    session.pinAttempts++;
    if (session.pinAttempts >= 3) {
      // Lock the account
      await getSupabaseClient()
        .from("profiles")
        .update({
          voice_pin_locked_until: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          voice_pin_attempts: session.pinAttempts,
        })
        .eq("id", session.userId);

      session.ws.send(JSON.stringify({
        type: "text",
        token: "Too many incorrect attempts. Your account has been locked for 15 minutes. Goodbye.",
        last: true,
      }));
      session.ws.send(JSON.stringify({ type: "end" }));
    } else {
      session.ws.send(JSON.stringify({
        type: "text",
        token: `Incorrect PIN. You have ${3 - session.pinAttempts} attempts remaining. Please try again.`,
        last: true,
      }));
    }
  }
}

// ---- Memory Integration ----

function extractMemoryTags(text: string): { response: string; memories: string[] } {
  const memories: string[] = [];
  const cleaned = text.replace(/\[REMEMBER:(.*?)\]/g, (_match, content) => {
    memories.push(content.trim());
    return "";
  });
  return { response: cleaned.trim(), memories };
}

async function saveConversationToMemory(session: VoiceSession): Promise<void> {
  if (!session.userId || session.conversationHistory.length === 0) return;

  try {
    const duration = Math.round((Date.now() - session.startedAt) / 1000);
    const exchangeCount = Math.floor(session.conversationHistory.length / 2);

    // Summarize the conversation for daily log
    const topics = session.conversationHistory
      .filter(m => m.role === "user")
      .map(m => m.content.slice(0, 60))
      .join("; ");

    const logEntry = `Voice call (${session.callType}, ${duration}s, ${exchangeCount} exchanges): ${topics}`;
    await appendDailyLog(session.userId, logEntry);

    // If substantive conversation (3+ exchanges), save to working memory
    if (exchangeCount >= 3) {
      const summary = `Voice conversation on ${new Date().toLocaleDateString()}: discussed ${topics.slice(0, 200)}`;
      await saveWorkingMemory(session.userId, summary);
    }

    console.log(`[VOICE-WS] Saved conversation to memory for ${session.userId.slice(0, 8)}`);
  } catch (err) {
    console.error("[VOICE-WS] Failed to save conversation to memory:", err);
  }
}

// ---- Email Fast Path for Voice ----

const EMAIL_VOICE_KEYWORDS = [
  'check email', 'check my email', 'read email', 'read my email',
  'my inbox', 'any email', 'any new email', 'last email', 'unread email',
  'what email', 'email i received', 'recent email', 'new email',
  'check inbox', 'read inbox', 'show email', 'show inbox',
  'my gmail', 'my outlook', 'last message', 'recent message',
  'received email', 'got email', 'got any email', 'email from',
  'message from', 'in my gmail', 'in my email', 'in my inbox',
];

async function handleEmailVoiceQuery(session: VoiceSession, voicePrompt: string): Promise<string | null> {
  if (!session.userId) return null;

  const lowerPrompt = voicePrompt.toLowerCase();
  const isEmailQuery = EMAIL_VOICE_KEYWORDS.some(kw => lowerPrompt.includes(kw));
  if (!isEmailQuery) return null;

  console.log(`[VOICE-WS] ${session.sessionId.slice(0, 8)} email fast path triggered`);

  try {
    const connected = await isEmailConnected(session.userId);
    if (!connected) {
      return "You haven't connected your email yet. You can set it up in the Settings page under Connected Apps.";
    }

    // Determine if it's a specific query or just "check inbox"
    const isSpecificQuery = /regarding|about|from\s+\w|subject|mention|related to|contain|saying/i.test(voicePrompt);

    let emails;
    if (isSpecificQuery) {
      emails = await getRecentMessages(session.userId, 15, 7);
    } else {
      emails = await getUnreadMessages(session.userId, 10);
    }

    // Filter out system emails
    const realEmails = emails.filter((e: any) =>
      !e.from.includes('@aevoy.com') && !e.from.includes('aevoy.com>')
    );

    if (realEmails.length === 0) {
      return isSpecificQuery
        ? `I checked your inbox but didn't find any emails matching that. You might want to check on your phone or computer.`
        : "Your inbox is clear — no new unread emails right now.";
    }

    // For specific queries, use Groq to filter and answer
    if (isSpecificQuery) {
      const groqKey = process.env.GROQ_API_KEY;
      if (groqKey) {
        const rawEmails = realEmails.slice(0, 10).map((e: any, i: number) =>
          `[${i + 1}] From: ${e.from} | Subject: ${e.subject} | Date: ${e.date}`
        ).join("\n");

        const filterRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${groqKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "llama-3.1-8b-instant",
            messages: [{
              role: "user",
              content: `The user asked over the phone: "${voicePrompt}"\n\nHere are their emails:\n${rawEmails}\n\nAnswer their question in 1-2 short sentences suitable for a phone conversation. Be concise. If no match, say so briefly.`,
            }],
            temperature: 0,
            max_tokens: 200,
          }),
        });

        if (filterRes.ok) {
          const filterData = await filterRes.json();
          const answer = filterData.choices?.[0]?.message?.content;
          if (answer) return answer;
        }
      }
    }

    // Simple inbox summary for voice (keep it short for speech)
    const count = realEmails.length;
    const top3 = realEmails.slice(0, 3).map((e: any) => {
      const fromName = e.from.split('<')[0].trim() || e.from;
      return `${fromName} about ${e.subject}`;
    }).join(". ");

    return `You have ${count} ${isSpecificQuery ? '' : 'unread '}email${count !== 1 ? 's' : ''}. The latest: ${top3}.`;
  } catch (err) {
    console.error(`[VOICE-WS] Email fast path error:`, err);
    return "I tried checking your email but ran into an issue. Try asking me again in a moment.";
  }
}

// ---- Task Creation from Voice ----

async function maybeCreateTask(session: VoiceSession, userSpeech: string, aiResponse: string): Promise<void> {
  if (!session.userId) return;

  // Detect task-like commands in user speech
  const taskKeywords = /\b(book|schedule|remind|send|email|search|find|order|buy|create|set up|look up|research|remember)\b/i;
  if (!taskKeywords.test(userSpeech)) return;

  try {
    // Create a background task from the voice command
    const { processIncomingTask } = await import("./processor.js");
    await processIncomingTask({
      userId: session.userId,
      username: session.userName,
      from: `${session.userName}@voice`,
      subject: "Voice Task",
      body: userSpeech,
      inputChannel: "voice",
    });
    console.log(`[VOICE-WS] Task created from voice: "${userSpeech.slice(0, 60)}"`);
  } catch (err) {
    console.error("[VOICE-WS] Failed to create task from voice:", err);
  }
}

// ---- Call History Logging ----

async function logCallHistory(session: VoiceSession, durationSeconds: number): Promise<void> {
  if (!session.userId) return;

  try {
    // Log call history
    getSupabaseClient()
      .from("call_history")
      .insert({
        user_id: session.userId,
        call_sid: session.callSid,
        direction: "inbound",
        call_type: session.callType,
        duration_seconds: durationSeconds,
        pin_required: session.state === "awaiting_pin",
        pin_success: session.state !== "awaiting_pin",
      })
      .then(() => {}, (e: any) => console.error("[VOICE-WS] Call history insert failed:", e));

    // Track voice call cost (Twilio + ElevenLabs TTS + Deepgram STT bundled)
    if (durationSeconds > 0) {
      const voiceCost = calculateVoiceCost(durationSeconds, false);
      trackServiceCost(session.userId, "twilio", "voice_call", voiceCost, "voice_call").catch(() => {});
    }
  } catch { /* non-critical */ }
}

// ---- Exports ----

export function getActiveSessionCount(): number {
  return activeSessions.size;
}
