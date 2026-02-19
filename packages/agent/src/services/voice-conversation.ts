/**
 * Voice Conversation Handler
 * Manages WebSocket connections for Twilio ConversationRelay
 * Real-time two-way voice conversations via ElevenLabs TTS + Deepgram STT
 */

import { WebSocket } from "ws";
import { IncomingMessage } from "http";
import { getSupabaseClient } from "../utils/supabase.js";
import { generatePersonalizedGreeting, generateVoiceResponse } from "./voice-prompts.js";
import { verifyVoicePin } from "./twilio.js";

// ---- Types ----

interface VoiceSession {
  sessionId: string;
  callSid: string;
  userId: string | null;
  userName: string;
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

  ws.on("close", () => {
    const session = activeSessions.get(sessionId);
    if (session) {
      const duration = Math.round((Date.now() - session.startedAt) / 1000);
      console.log(`[VOICE-WS] Session ${sessionId.slice(0, 8)} closed after ${duration}s (${session.conversationHistory.length} exchanges)`);
      logCallHistory(session, duration);
    }
    cleanupSession(sessionId);
  });

  ws.on("error", (err) => {
    console.error(`[VOICE-WS] WebSocket error:`, err);
    cleanupSession(sessionId);
  });
}

// ---- Message Handlers ----

async function handleSetup(ws: WebSocket, message: any, sessionId: string): Promise<void> {
  const { callSid, from, to, customParameters = {} } = message;
  const userId = customParameters.userId || null;
  const callType = customParameters.callType || "task";

  console.log(`[VOICE-WS] Setup: callSid=${callSid?.slice(0, 10)}, from=${from}, userId=${userId?.slice(0, 8)}, type=${callType}`);

  // Load user profile
  let userName = "there";
  let botName = "Nova";
  let greetingStyle = "casual";
  let timezone = "America/Los_Angeles";
  let needsPin = false;

  if (userId) {
    const { data: profile } = await getSupabaseClient()
      .from("profiles")
      .select("display_name, username, bot_name, phone_number, greeting_style, timezone, voice_pin_hash, voice_pin, voice_pin_attempts, voice_pin_locked_until")
      .eq("id", userId)
      .single();

    if (profile) {
      userName = profile.display_name || profile.username || "there";
      botName = profile.bot_name || "Nova";
      greetingStyle = profile.greeting_style || "casual";
      timezone = profile.timezone || "America/Los_Angeles";

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
    }
  }

  const session: VoiceSession = {
    sessionId,
    callSid: callSid || "",
    userId,
    userName,
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

  // Normal conversation
  session.conversationHistory.push({ role: "user", content: voicePrompt });
  console.log(`[VOICE-WS] ${session.sessionId.slice(0, 8)} user: "${voicePrompt.slice(0, 80)}"`);

  try {
    const response = await generateVoiceResponse(session.userId!, voicePrompt, session.conversationHistory, {
      userName: session.userName,
      botName: session.botName,
      timezone: session.timezone,
      callType: session.callType,
    });

    session.conversationHistory.push({ role: "assistant", content: response });

    // Send response (ConversationRelay handles TTS)
    session.ws.send(JSON.stringify({
      type: "text",
      token: response,
      last: true,
    }));

    console.log(`[VOICE-WS] ${session.sessionId.slice(0, 8)} assistant: "${response.slice(0, 80)}"`);

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
    await getSupabaseClient()
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
  } catch { /* non-critical */ }
}

// ---- Exports ----

export function getActiveSessionCount(): number {
  return activeSessions.size;
}
