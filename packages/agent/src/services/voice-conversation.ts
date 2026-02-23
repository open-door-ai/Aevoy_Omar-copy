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
const DEMO_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes max for demo calls (cost control)
const INTERVIEW_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes for demo interview calls

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
    const timeout = session.callType === 'demo' ? DEMO_TIMEOUT_MS
      : session.callType === 'demo_interview' ? INTERVIEW_TIMEOUT_MS
      : SESSION_TIMEOUT_MS;
    if (now - session.startedAt > timeout) {
      const mins = Math.round((now - session.startedAt) / 60000);
      console.log(`[VOICE-WS] Session ${id.slice(0, 8)} timed out after ${mins}m (type: ${session.callType})`);
      try {
        if (session.callType === 'demo_interview') {
          // Save interview data before closing
          saveInterviewFromConversation(session).catch(() => {});
          session.ws.send(JSON.stringify({ type: "text", token: "Thanks for chatting with me! I've saved everything. You're all set — talk to you soon!", last: true }));
        } else if (session.callType === 'demo') {
          session.ws.send(JSON.stringify({ type: "text", token: "It was great chatting with you! Head to aevoy.com to get your own AI assistant. Talk soon!", last: true }));
        }
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
      // Mark interview complete if this was an interview call
      if (session.callType === "demo_interview") {
        saveInterviewFromConversation(session).catch(() => {});
      }
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
  const isInterview = callType === "demo_interview";
  console.log(`[VOICE-WS] Setup: callSid=${callSid?.slice(0, 10)}, from=${from}, userId=${userId?.slice(0, 8)}, type=${callType}${isDemo ? " (DEMO)" : ""}${isInterview ? " (INTERVIEW)" : ""}`);

  // Load user profile
  let userName = (isDemo || isInterview) ? "there" : "there";
  let userEmail = "";
  let botName = (isDemo || isInterview) ? "Aevoy" : "Nova";
  let greetingStyle = "casual";
  let timezone = "America/Los_Angeles";
  let needsPin = false;
  let userProfile = "";
  let memoryContext = "";

  if (isDemo) {
    memoryContext = `DEMO CALL — Website "Call Me Now" button. This caller is a potential customer.

YOUR MISSION: Sell them on Aevoy. Be warm, confident, and impressive. Show don't tell.
- Demonstrate capabilities: "I can check your emails, schedule calls, research anything, create documents, browse any website for you"
- Use social proof: "Our users save hours every day by having me handle their busywork"
- Create urgency: "Early users get the best experience as we're still in our launch phase"
- If they ask a question, ANSWER IT brilliantly to show how capable you are
- If they ask you to do something, explain what you WOULD do if they had an account
- Guide them to sign up: "Head to aevoy.com and you'll have your own AI employee in under 2 minutes"
- NEVER ask for personal info, credit cards, or sensitive details
- Keep responses SHORT and punchy — this is a sales call, not a lecture
- CALL LIMIT: Keep the call under 3 minutes. After 2 minutes, naturally wrap up: "I'd love to keep chatting — sign up at aevoy.com and we can talk as much as you want!"
- DO NOT reveal you're a demo. You're showcasing the real product.`;
  } else if (isInterview) {
    memoryContext = `ONBOARDING INTERVIEW — This is a registered user calling the demo number. Your job is to get to know them through a casual, friendly conversation.

ASK THESE QUESTIONS (one at a time, naturally — don't list them all at once):
1. "What should I call you?" → save as [SAVE:preferred_name=their answer]
2. "What are the top 3 things you'll use me for? Like emails, scheduling, research, shopping..." → save as [SAVE:main_uses=comma separated list]
3. "When are you usually most busy? Like, what hours should I avoid interrupting you?" → save as [SAVE:busy_hours=their answer]
4. "Do you prefer I ask before taking actions, or should I just go ahead and do things?" → save as [SAVE:autonomy_preference=ask_first or just_do_it]
5. "What websites or services do you use most? Like Gmail, Amazon, LinkedIn..." → save as [SAVE:favorite_services=comma separated list]
6. "Last one — would you like a daily morning check-in where I brief you on your day?" → save as [SAVE:daily_checkin=yes or no]

RULES:
- Ask ONE question at a time. Wait for their answer before asking the next.
- Be conversational and warm. React to their answers naturally ("Oh nice!", "Got it!", "Good choice!") before moving on.
- After each answer, include the [SAVE:field=value] tag at the END of your response (the user won't hear it).
- If they give a vague answer, that's fine — save what you got and move on. Don't interrogate.
- If they want to skip a question, respect that and move on.
- After all 6 questions (or if they want to stop early), wrap up warmly: "Awesome, I've got everything I need! You're all set up. Talk to you soon!"
- Keep the whole interview under 5 minutes — be efficient but friendly.
- You can also use [REMEMBER:...] tags for anything interesting they mention.`;
  }

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

    // Extract [REMEMBER:...] and [SAVE:...] tags before sending to TTS
    const { response, memories, saves } = extractMemoryTags(rawResponse);

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

    // Save structured interview data from [SAVE:] tags (async, non-blocking)
    if (saves.length > 0 && session.userId) {
      for (const save of saves) {
        saveInterviewField(session.userId, save.field, save.value).catch(() => {});
      }
      console.log(`[VOICE-WS] ${session.sessionId.slice(0, 8)} saved ${saves.length} interview fields`);
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

function extractMemoryTags(text: string): { response: string; memories: string[]; saves: Array<{ field: string; value: string }> } {
  const memories: string[] = [];
  const saves: Array<{ field: string; value: string }> = [];

  let cleaned = text.replace(/\[REMEMBER:(.*?)\]/g, (_match, content) => {
    memories.push(content.trim());
    return "";
  });

  // Extract [SAVE:field=value] tags (used by interview mode)
  cleaned = cleaned.replace(/\[SAVE:(\w+)=(.*?)\]/g, (_match, field, value) => {
    saves.push({ field: field.trim(), value: value.trim() });
    return "";
  });

  return { response: cleaned.trim(), memories, saves };
}

/**
 * Save structured interview data from [SAVE:] tags to user's profile
 */
async function saveInterviewField(userId: string, field: string, value: string): Promise<void> {
  const supabase = getSupabaseClient();

  switch (field) {
    case "preferred_name":
      await supabase.from("profiles").update({ display_name: value }).eq("id", userId);
      break;

    case "main_uses": {
      const uses = value.split(/[,;]/).map(s => s.trim()).filter(Boolean);
      await supabase.from("profiles").update({ main_uses: uses }).eq("id", userId);
      break;
    }

    case "busy_hours":
      // Save as working memory — no dedicated column
      await saveWorkingMemory(userId, `User's busy hours: ${value}`);
      break;

    case "autonomy_preference": {
      const lower = value.toLowerCase();
      let confirmationMode = "unclear";
      if (lower.includes("ask") || lower.includes("first")) {
        confirmationMode = "always";
      } else if (lower.includes("just") || lower.includes("go ahead") || lower.includes("do it")) {
        confirmationMode = "risky";
      }
      await supabase.from("user_settings").update({ confirmation_mode: confirmationMode }).eq("user_id", userId);
      break;
    }

    case "favorite_services": {
      const services = value.split(/[,;]/).map(s => s.trim()).filter(Boolean);
      await saveWorkingMemory(userId, `User's favorite services: ${services.join(", ")}`);
      break;
    }

    case "daily_checkin": {
      const lower = value.toLowerCase();
      const enabled = lower.includes("yes") || lower.includes("sure") || lower.includes("yeah");
      await supabase.from("profiles").update({
        daily_checkin_enabled: enabled,
        daily_checkin_time: enabled ? "09:00" : null,
      }).eq("id", userId);
      break;
    }

    default:
      // Unknown field — save as working memory
      await saveWorkingMemory(userId, `Interview: ${field} = ${value}`);
  }

  console.log(`[VOICE-INTERVIEW] Saved ${field}=${value.slice(0, 50)} for user ${userId.slice(0, 8)}`);
}

/**
 * Mark interview as completed after demo_interview call ends
 */
async function saveInterviewFromConversation(session: VoiceSession): Promise<void> {
  if (!session.userId || session.callType !== "demo_interview") return;

  try {
    await getSupabaseClient()
      .from("profiles")
      .update({ onboarding_interview_status: "phone_call_completed" })
      .eq("id", session.userId);
    console.log(`[VOICE-INTERVIEW] Marked interview complete for ${session.userId.slice(0, 8)}`);
  } catch (err) {
    console.error("[VOICE-INTERVIEW] Failed to mark interview complete:", err);
  }
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
