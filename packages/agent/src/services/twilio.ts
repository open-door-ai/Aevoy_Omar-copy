/**
 * Twilio Service — Full Voice + SMS Integration
 *
 * Capabilities:
 * - Outbound calls: AI calls user (updates, questions), AI calls others (appointments)
 * - Inbound calls: User calls AI (voice tasks), AI receives calls (receptionist)
 * - TwiML generation: Voice flow responses with speech synthesis (Google.en-US-Neural2-F)
 * - Speech-to-text: Transcribe voice commands
 * - SMS two-way: Send tasks via text, receive updates
 * - 2FA codes: Receive verification codes via SMS
 */

import { getSupabaseClient } from "../utils/supabase.js";
import type { VoiceCallRequest, SmsRequest, IncomingVoiceData, IncomingSmsData } from "../types/index.js";
import { fakeEmailServer, isTestMode } from "../test-utils/fake-email-server.js";
import { trackServiceCost } from "./ai.js";
import { calculateSMSCost, SMS_MARKUP, VOICE_MARKUP, TWILIO_RATES } from "../utils/cost-calculator.js";
import { trackError } from "../utils/error-tracker.js";
import { logger } from "../utils/logger.js";

// ---- Security: Input Sanitization ----

/**
 * SECURITY: Strip control characters from SMS body to prevent SMS injection.
 * Preserves normal whitespace (spaces, newlines for readability) but removes
 * characters that could manipulate SMS protocol or confuse rendering.
 */
function sanitizeSmsBody(text: string): string {
  // Remove control characters (C0 and C1) EXCEPT \n (0x0A) and \r (0x0D) and space (0x20)
  // Also remove null bytes, backspace, escape, delete, and other non-printable chars
  return text.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '').trim();
}

/**
 * SECURITY: Sanitize phone number to prevent injection via Twilio API params.
 * Only allows digits, +, -, (, ), and spaces.
 */
function sanitizePhoneNumber(phone: string): string {
  return phone.replace(/[^\d+\-() ]/g, '').trim();
}

// ---- Configuration ----

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  apiKeySid?: string;
  apiKeySecret?: string;
  phoneNumber: string;
  webhookBaseUrl: string;
}

export function getTwilioConfig(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const phoneNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken) {
    return null;
  }

  return {
    accountSid,
    authToken,
    apiKeySid: process.env.TWILIO_API_KEY_SID || undefined,
    apiKeySecret: process.env.TWILIO_API_KEY_SECRET || undefined,
    phoneNumber: phoneNumber || "",
    webhookBaseUrl: process.env.AGENT_WEBHOOK_BASE_URL || "https://agent.aevoy.com",
  };
}

export function isTwilioConfigured(): boolean {
  return getTwilioConfig() !== null;
}

// ---- Voice Configuration ----

// Available voices (Twilio Generative + Neural + Standard)
// GENERATIVE = most natural (Google Chirp3-HD, Polly Generative)
// NEURAL = good quality (Google Neural2, Polly Neural)
export const AVAILABLE_VOICES = {
  // Generative (most natural, human-like)
  'Google.en-US-Chirp3-HD': 'Google Chirp3 HD (Female, most natural)',
  'Polly.Ruth-Generative': 'AWS Polly Generative (Female, conversational)',
  'Polly.Matthew-Generative': 'AWS Polly Generative (Male, conversational)',

  // Neural (high quality)
  'Google.en-US-Neural2-H': 'Google Neural (Female, warm)',
  'Google.en-US-Neural2-F': 'Google Neural (Female, professional)',
  'Google.en-US-Neural2-J': 'Google Neural (Male, deep)',
  'Polly.Joanna-Neural': 'AWS Polly Neural (Female)',
  'Polly.Matthew-Neural': 'AWS Polly Neural (Male)',
} as const;

export const DEFAULT_VOICE = 'Google.en-US-Chirp3-HD'; // Generative voice - most natural

// Cache voice preferences in memory (refreshed per call)
const voiceCache = new Map<string, { voice: string; cachedAt: number }>();
const VOICE_CACHE_TTL = 300000; // 5 minutes

export async function getUserVoice(userId: string): Promise<string> {
  const cached = voiceCache.get(userId);
  if (cached && Date.now() - cached.cachedAt < VOICE_CACHE_TTL) {
    return cached.voice;
  }

  try {
    const { data } = await getSupabaseClient()
      .from('user_settings')
      .select('voice_preference')
      .eq('user_id', userId)
      .single();
    const voice = data?.voice_preference || DEFAULT_VOICE;
    voiceCache.set(userId, { voice, cachedAt: Date.now() });
    return voice;
  } catch {
    return DEFAULT_VOICE;
  }
}

// ---- Twilio REST API helpers ----

export async function twilioRequest(
  path: string,
  method: "GET" | "POST" | "DELETE" = "POST",
  body?: URLSearchParams
): Promise<Response> {
  const config = getTwilioConfig();
  if (!config) throw new Error("Twilio not configured");

  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}${path}`;
  // Prefer API Key auth (more secure, independently revocable) over Auth Token
  const authUser = config.apiKeySid && config.apiKeySecret ? config.apiKeySid : config.accountSid;
  const authPass = config.apiKeySid && config.apiKeySecret ? config.apiKeySecret : config.authToken;
  const auth = Buffer.from(`${authUser}:${authPass}`).toString("base64");

  const options: RequestInit = {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(body ? { body: body.toString() } : {}),
  };

  return fetch(url, options);
}

// ---- User Number Lookup ----

/**
 * Get the user's dedicated Twilio number (if they purchased one).
 * Returns empty string if the user has no dedicated number.
 * The demo/shared number is NEVER used as fallback — it's only for website "Call Me Now".
 */
async function getUserFromNumber(userId: string): Promise<string> {
  try {
    const { data } = await getSupabaseClient()
      .from('user_twilio_numbers')
      .select('phone_number')
      .eq('user_id', userId)
      .eq('is_active', true)
      .limit(1)
      .single();
    if (data?.phone_number) return data.phone_number;
  } catch { /* no dedicated number */ }

  return '';
}

// ---- Outbound Voice Calls ----

/**
 * AI calls the user (for updates, questions, alerts).
 * Uses the user's dedicated number as caller ID if they have one.
 */
export async function callUser(request: VoiceCallRequest): Promise<{
  success: boolean;
  callSid?: string;
  error?: string;
}> {
  const config = getTwilioConfig();
  if (!config) return { success: false, error: "Twilio not configured" };

  try {
    // User MUST have a dedicated number — demo number is never used for user tasks
    const fromNumber = await getUserFromNumber(request.userId);
    if (!fromNumber) {
      logger.warn({ userId: request.userId.slice(0, 8) }, '[TWILIO] callUser blocked: no dedicated number');
      return { success: false, error: "You need a dedicated phone number to make calls. Visit your dashboard to get one." };
    }

    // Block ALL non-North-American numbers — international calls cost 10-30x more
    // INCIDENT 2026-03-16: Israel calls at $0.31/min burned $55+ via demo button
    const cleanedNumber = (request.to || '').replace(/[^\d+]/g, '');
    const isNorthAmerican = /^\+?1[2-9]\d{9}$/.test(cleanedNumber);
    if (!isNorthAmerican) {
      logger.warn({ numberPrefix: cleanedNumber.slice(0, 5) }, '[TWILIO] BLOCKED international number (only +1 NA allowed)');
      return { success: false, error: 'International calls are not supported yet. Only US/Canada numbers (+1) are allowed.' };
    }
    // Block premium/toll numbers
    if (/^\+?1(900|976|950|540)/.test(cleanedNumber)) {
      logger.warn({ numberPrefix: cleanedNumber.slice(0, 7) }, '[TWILIO] BLOCKED premium number');
      return { success: false, error: 'Premium/toll numbers are not supported for safety.' };
    }

    // Daily call safety cap
    const DEFAULT_DAILY_CALL_LIMIT = 20;
    try {
      const { data: todayCalls } = await getSupabaseClient()
        .from('call_history')
        .select('id')
        .eq('user_id', request.userId)
        .gte('created_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
        .limit(DEFAULT_DAILY_CALL_LIMIT + 1);
      if (todayCalls && todayCalls.length >= DEFAULT_DAILY_CALL_LIMIT) {
        logger.warn({ userId: request.userId.slice(0, 8), limit: DEFAULT_DAILY_CALL_LIMIT }, '[TWILIO] Daily call limit reached');
        return { success: false, error: `Daily call limit reached (${DEFAULT_DAILY_CALL_LIMIT}). This resets at midnight.` };
      }
    } catch { /* Don't block calls on DB errors */ }

    const agentUrl = process.env.AGENT_URL || '';

    // Use a URL-based approach: Twilio fetches TwiML from our server
    // This supports ConversationRelay properly (inline Twiml param doesn't)
    const callbackUrl = `${agentUrl}/webhook/voice/outbound-twiml?userId=${encodeURIComponent(request.userId)}&message=${encodeURIComponent(request.message || '')}`;

    const callbackBase = process.env.TWILIO_CALLBACK_URL || process.env.AGENT_URL || 'https://agent-production-1339.up.railway.app';
    const params = new URLSearchParams({
      To: request.to,
      From: fromNumber,
      Url: callbackUrl,
      Method: 'POST',
      StatusCallback: `${callbackBase}/webhook/voice/call-end`,
      StatusCallbackMethod: 'POST',
      StatusCallbackEvent: 'completed',
      MachineDetection: 'DetectMessageEnd',
      AsyncAmdStatusCallback: `${callbackBase}/webhook/voice/amd-status`,
      AsyncAmdStatusCallbackMethod: 'POST',
      TimeLimit: '420', // 7 minutes max — prevents runaway billing (C002)
    });

    const response = await twilioRequest("/Calls.json", "POST", params);

    if (!response.ok) {
      const errorData = await response.text();
      logger.error({ status: response.status, errorData }, '[TWILIO] callUser API error');
      return { success: false, error: `Twilio API error: ${response.status}` };
    }

    const data = await response.json() as { sid: string };

    // Track usage count only — actual cost is logged by /webhook/voice/call-end StatusCallback.
    // DO NOT log estimate here — it was never deducted when actual arrived, causing double-billing.
    await trackVoiceUsage(request.userId, 1);

    logger.info({ callSid: data.sid }, '[TWILIO] Callback initiated via URL');
    return { success: true, callSid: data.sid };
  } catch (error) {
    trackError('voice');
    const msg = error instanceof Error ? error.message : "Unknown error";
    logger.error({ err: msg }, '[TWILIO] Call error');
    return { success: false, error: msg };
  }
}

/**
 * AI calls another number (book appointments, make inquiries).
 */
export async function callExternal(
  userId: string,
  to: string,
  message: string,
  gatherAfter: boolean = true,
  businessName?: string
): Promise<{ success: boolean; callSid?: string; error?: string }> {
  const config = getTwilioConfig();
  if (!config) return { success: false, error: "Twilio not configured" };
  const fromNumber = await getUserFromNumber(userId);
  if (!fromNumber) {
    logger.warn({ userId: userId.slice(0, 8) }, '[TWILIO] callExternal blocked: no dedicated number');
    return { success: false, error: "You need a dedicated phone number to make calls. Visit your dashboard to get one." };
  }

  // Block ALL non-North-American numbers — international calls cost 10-30x more
  const cleanedNumber = (to || '').replace(/[^\d+]/g, '');
  const isNorthAmerican = /^\+?1[2-9]\d{9}$/.test(cleanedNumber);
  if (!isNorthAmerican) {
    logger.warn({ numberPrefix: cleanedNumber.slice(0, 5) }, '[TWILIO] BLOCKED international number (callExternal)');
    return { success: false, error: 'International calls are not supported yet. Only US/Canada numbers (+1) are allowed.' };
  }
  if (/^\+?1(900|976|950|540)/.test(cleanedNumber)) {
    logger.warn({ numberPrefix: cleanedNumber.slice(0, 7) }, '[TWILIO] BLOCKED premium number (callExternal)');
    return { success: false, error: 'Premium/toll numbers are not supported for safety.' };
  }

  // Daily call safety cap
  const DEFAULT_DAILY_CALL_LIMIT = 20;
  try {
    const { data: todayCalls } = await getSupabaseClient()
      .from('call_history')
      .select('id')
      .eq('user_id', userId)
      .gte('created_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
      .limit(DEFAULT_DAILY_CALL_LIMIT + 1);
    if (todayCalls && todayCalls.length >= DEFAULT_DAILY_CALL_LIMIT) {
      logger.warn({ userId: userId.slice(0, 8), limit: DEFAULT_DAILY_CALL_LIMIT }, '[TWILIO] Daily call limit reached (callExternal)');
      return { success: false, error: `Daily call limit reached (${DEFAULT_DAILY_CALL_LIMIT}). This resets at midnight.` };
    }
  } catch { /* Don't block calls on DB errors */ }

  try {
    // Generate a unique context key for this call
    const contextKey = `ext_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Store context for the ConversationRelay WebSocket to pick up
    const { setExternalCallContext } = await import("./voice-conversation.js");
    setExternalCallContext(contextKey, {
      script: message,
      businessName: businessName || 'the business',
      userName: '', // Will be loaded from profile in handleSetup
      createdAt: Date.now(),
    });

    // Use ConversationRelay via TwiML URL — natural ElevenLabs voice + real two-way conversation
    const baseUrl = config.webhookBaseUrl || process.env.AGENT_URL || 'https://agent-production-1339.up.railway.app';
    const twimlUrl = `${baseUrl}/webhook/voice/external-call-twiml?userId=${encodeURIComponent(userId)}&contextKey=${encodeURIComponent(contextKey)}&businessName=${encodeURIComponent(businessName || 'the business')}&script=${encodeURIComponent(message.substring(0, 200))}`;

    const callbackBase = process.env.TWILIO_CALLBACK_URL || process.env.AGENT_URL || 'https://agent-production-1339.up.railway.app';
    const params = new URLSearchParams({
      To: to,
      From: fromNumber,
      Url: twimlUrl,
      Method: 'POST',
      StatusCallback: `${callbackBase}/webhook/voice/call-end`,
      StatusCallbackMethod: 'POST',
      StatusCallbackEvent: 'completed',
      MachineDetection: 'DetectMessageEnd',
      AsyncAmdStatusCallback: `${callbackBase}/webhook/voice/amd-status`,
      AsyncAmdStatusCallbackMethod: 'POST',
      TimeLimit: '420', // 7 minutes max — prevents runaway billing (C002)
    });

    const response = await twilioRequest("/Calls.json", "POST", params);

    if (!response.ok) {
      return { success: false, error: `Twilio error: ${response.status}` };
    }

    const data = await response.json() as { sid: string };
    // Track usage count only — actual cost is logged by /webhook/voice/call-end StatusCallback.
    await trackVoiceUsage(userId, 1);

    logger.info({ to, from: fromNumber || config.phoneNumber, callSid: data.sid, business: businessName || 'unknown' }, '[CALL-EXTERNAL] ConversationRelay call placed');
    return { success: true, callSid: data.sid };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: msg };
  }
}

// ---- Inbound Voice Handling ----

/**
 * Generate TwiML for incoming voice call.
 * Greets user with dynamic, personalized message.
 */
export async function generateIncomingCallTwiml(userId: string, userName: string): Promise<string> {
  const config = getTwilioConfig();
  const voice = await getUserVoice(userId);
  const processUrl = config
    ? `${config.webhookBaseUrl}/webhook/voice/process/${userId}`
    : "/webhook/voice/process/" + userId;

  // Get user's greeting style preference (default: casual)
  const { data: settings } = await getSupabaseClient()
    .from('user_settings')
    .select('greeting_style')
    .eq('user_id', userId)
    .single()
    .then(result => result, () => ({ data: null }));

  const greetingStyle = settings?.greeting_style || 'casual';

  // Generate greeting based on style
  let greeting = '';
  switch (greetingStyle) {
    case 'jarvis':
      greeting = `Good ${getTimeOfDay()}, ${escapeXml(userName)}. How may I assist you today?`;
      break;
    case 'ironman':
      greeting = `${escapeXml(userName)}! Your AI assistant here. What've you got for me?`;
      break;
    case 'australian':
      greeting = `G'day ${escapeXml(userName)}! What can I do for ya, mate?`;
      break;
    case 'professional':
      greeting = `Hello ${escapeXml(userName)}, this is Nova. How can I help you today?`;
      break;
    case 'casual':
    default:
      const casualGreetings = [
        `Hey ${escapeXml(userName)}! What's up?`,
        `Hi ${escapeXml(userName)}! What can I do for you?`,
        `${escapeXml(userName)}! Good to hear from you.`,
        `Hey ${escapeXml(userName)}! What's on your mind?`,
        `${escapeXml(userName)}! What can I help with?`,
      ];
      greeting = casualGreetings[Math.floor(Math.random() * casualGreetings.length)];
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">${greeting}</Say>
  <Gather input="speech" timeout="8" speechTimeout="auto" speechModel="phone_call" enhanced="true"
          action="${processUrl}" method="POST" />
  <Say voice="${voice}">I didn't catch that. Call me back anytime!</Say>
</Response>`;

}

function getTimeOfDay(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

/**
 * Generate TwiML response after processing a voice command.
 */
export async function generateResponseTwiml(message: string, voiceOverride?: string, userId?: string): Promise<string> {
  const voice = voiceOverride || (userId ? await getUserVoice(userId) : DEFAULT_VOICE);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">${escapeXml(message)}</Say>
</Response>`;
}

/**
 * Generate TwiML for speech synthesis.
 * Uses Polly.Joanna-Neural as safe default — always works on Twilio.
 */
function generateSpeechTwiml(text: string, voice?: string): string {
  const safeVoice = voice || 'Polly.Joanna-Neural';
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${safeVoice}">${escapeXml(text)}</Say>
</Response>`;
}

// ---- SMS ----

/**
 * Send an SMS message.
 */
export async function sendSms(request: SmsRequest): Promise<{
  success: boolean;
  messageSid?: string;
  error?: string;
}> {
  // Test mode: use fake SMS server
  if (isTestMode()) {
    const config = getTwilioConfig();
    const from = config?.phoneNumber || '+16043321466';
    const messageId = fakeEmailServer.sendSMS(from, request.to, request.body);
    logger.info({ messageId }, '[TWILIO-TEST] SMS sent');
    return { success: true, messageSid: messageId };
  }

  const config = getTwilioConfig();
  if (!config) return { success: false, error: "Twilio not configured" };

  // COST GUARD: Daily SMS cap per user (proactive/monitoring runaway protection)
  const MAX_PROACTIVE_SMS_PER_DAY = 15;
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  if (request.userId) {
    try {
      const supabase = getSupabaseClient();

      // Count SMS sent today for this user
      const { count } = await supabase
        .from('ai_cost_log')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', request.userId)
        .eq('provider', 'twilio')
        .in('purpose', ['sms', 'sms_inbound'])
        .gte('created_at', `${today}T00:00:00.000Z`);

      const dailySmsCount = count || 0;

      // Get user's custom cap from settings (default 15)
      const { data: settings } = await supabase
        .from('user_settings')
        .select('daily_sms_limit')
        .eq('user_id', request.userId)
        .single();

      const dailyCap = (settings as any)?.daily_sms_limit ?? MAX_PROACTIVE_SMS_PER_DAY;

      if (dailySmsCount >= dailyCap) {
        logger.warn({ userId: request.userId.slice(0, 8), count: dailySmsCount, cap: dailyCap }, '[SMS-CAP] User hit daily SMS cap');
        return { success: false, error: `Daily SMS cap reached (${dailyCap}/day). Resets at midnight.` };
      }
    } catch (capErr) {
      logger.warn({ err: capErr }, '[SMS-CAP] Failed to check daily cap'); // Don't block SMS on cap check failure
    }
  }

  try {
    // SECURITY: Sanitize SMS body and phone number before sending
    const sanitizedBody = sanitizeSmsBody(request.body);
    const sanitizedTo = sanitizePhoneNumber(request.to);

    // User MUST have a dedicated number — demo number is never used for user SMS
    const fromNumber = await getUserFromNumber(request.userId);
    if (!fromNumber) {
      logger.warn({ userId: request.userId.slice(0, 8) }, '[TWILIO] sendSms blocked: no dedicated number');
      return { success: false, error: "You need a dedicated phone number to send SMS. Visit your dashboard to get one." };
    }

    const params = new URLSearchParams({
      To: sanitizedTo,
      From: fromNumber,
      Body: sanitizedBody,
    });

    const response = await twilioRequest("/Messages.json", "POST", params);

    if (!response.ok) {
      const errorData = await response.text();
      return { success: false, error: `SMS error: ${response.status} ${errorData}` };
    }

    const data = await response.json() as { sid: string };

    // Track usage count + dollar cost (SMS_MARKUP = 2.0× on top of base 1.296× = 2.592× total)
    await trackSmsUsage(request.userId, 1);
    const smsCost = calculateSMSCost(request.to, request.body?.length || 160);
    trackServiceCost(request.userId, "twilio", "sms_outbound", smsCost, "sms_outbound", undefined, SMS_MARKUP).catch(() => {});

    logger.info({ messageSid: data.sid }, '[TWILIO] SMS sent');
    return { success: true, messageSid: data.sid };
  } catch (error) {
    trackError('sms');
    const msg = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: msg };
  }
}

/**
 * Handle incoming SMS — process as a task or verification code.
 */
export async function handleIncomingSms(data: IncomingSmsData): Promise<{
  processed: boolean;
  taskId?: string;
  isVerificationCode?: boolean;
  isReplyToAwaiting?: boolean;
}> {
  try {
    // Find user by their Twilio number
    const { data: profile } = await getSupabaseClient()
      .from("profiles")
      .select("id, username, email")
      .eq("twilio_number", data.to)
      .single();

    if (!profile) {
      logger.info({ to: data.to }, '[TWILIO] No user found for number');
      return { processed: false };
    }

    const userId = profile.id;

    // Track inbound SMS cost ($0.0083/message Twilio raw rate, 2.592× total markup)
    if (userId) {
      trackServiceCost(userId, "twilio", "sms_inbound", TWILIO_RATES.SMS_INBOUND_NA, "sms_inbound", undefined, SMS_MARKUP).catch(() => {});
    }

    // Check if there's a task waiting for verification code
    const { data: pendingTask } = await getSupabaseClient()
      .from("tasks")
      .select("id, structured_intent")
      .eq("user_id", userId)
      .eq("status", "awaiting_user_input")
      .eq("stuck_reason", "verification_code")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (pendingTask) {
      // Extract verification code from SMS
      const codeMatch = data.body.match(/\b(\d{4,8})\b/);
      const code = codeMatch ? codeMatch[1] : data.body.trim();

      await getSupabaseClient()
        .from("tasks")
        .update({
          status: "processing",
          stuck_reason: null,
          structured_intent: {
            ...(pendingTask.structured_intent as Record<string, unknown> || {}),
            verification_code: code,
          },
        })
        .eq("id", pendingTask.id);

      // Also store in tfa_codes table for the new TFA system
      try {
        const { storeTfaCode } = await import("./tfa.js");
        const siteDomain = (pendingTask.structured_intent as Record<string, unknown>)?.site_domain as string | undefined;
        await storeTfaCode(userId, pendingTask.id, code, "sms", siteDomain);
      } catch {
        // Non-critical
      }

      logger.info({ taskId: pendingTask.id }, '[TWILIO] Verification code received for task');
      return { processed: true, taskId: pendingTask.id, isVerificationCode: true };
    }

    // Check if the body looks like a 2FA code even without a pending task
    const standaloneCode = data.body.trim().match(/^\d{4,8}$/);
    if (standaloneCode) {
      try {
        const { storeTfaCode } = await import("./tfa.js");
        await storeTfaCode(userId, null, standaloneCode[0], "sms");
      } catch {
        // Non-critical
      }
    }

    // ── Auto-proceed reply detection ──
    // Check if user has a task waiting for their reply (needs_review/pending_approval/awaiting_confirmation
    // with auto_proceed_at set) before creating a new task
    try {
      const { data: awaitingTask } = await getSupabaseClient()
        .from('tasks')
        .select('id, input_text, email_subject, status, auto_proceed_at')
        .eq('user_id', userId)
        .in('status', ['needs_review', 'pending_approval', 'awaiting_confirmation'])
        .not('auto_proceed_at', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (awaitingTask) {
        const msgLower = data.body.toLowerCase().trim();
        const isCancelRequest = /\b(cancel|stop|forget it|nevermind|never mind|ignore|scratch that|abort|don't|dont)\b/i.test(msgLower);

        // Distinguish replies from new tasks (same heuristic as web endpoint)
        const _smsLooksLikeNewTask = data.body.trim().length > 80
          || /\b(create|make|build|find|search|sign\s?up|book\s+(?:me\s+)?a|write|send|get\s+me|order\s+me|help\s+me|tell\s+me|show\s+me|set\s+up|look\s+up|check\s+(?:my|if|on)|how\s+(?:to|do|can)|what\s+is|who\s+is)\b/i.test(msgLower);

        if (_smsLooksLikeNewTask && !isCancelRequest) {
          logger.info({ taskId: awaitingTask.id.slice(0, 8), body: data.body.slice(0, 60) }, '[TWILIO] SMS looks like new task, not reply');
          // Fall through to create new task
        } else if (isCancelRequest) {
          // User wants to cancel
          await getSupabaseClient().from('tasks').update({
            status: 'completed',
            response_text: 'Task cancelled.',
            auto_proceed_at: null,
            auto_proceed_context: null,
            completed_at: new Date().toISOString(),
          }).eq('id', awaitingTask.id);

          logger.info({ taskId: awaitingTask.id.slice(0, 8) }, '[TWILIO] User cancelled awaiting task via SMS');
          return { processed: true, taskId: awaitingTask.id };
        } else {
          // User provided an answer — clear auto-proceed timer and re-process
          logger.info({ taskId: awaitingTask.id.slice(0, 8) }, '[TWILIO] User replied to awaiting task via SMS');

          await getSupabaseClient().from('tasks').update({
            status: 'processing',
            auto_proceed_at: null,
            auto_proceed_context: null,
          }).eq('id', awaitingTask.id);

          // Re-process with user's answer (the caller in index.ts will route this)
          return { processed: true, taskId: awaitingTask.id, isReplyToAwaiting: true };
        }
      }
    } catch {
      // Non-critical — fall through to create new task
    }

    // Otherwise, treat as a new task via SMS
    const { data: taskRecord } = await getSupabaseClient()
      .from("tasks")
      .insert({
        user_id: userId,
        status: "pending",
        email_subject: "SMS Task",
        input_text: data.body,
        input_channel: "sms",
      })
      .select()
      .single();

    if (taskRecord) {
      logger.info({ taskId: taskRecord.id }, '[TWILIO] SMS task created');
      return { processed: true, taskId: taskRecord.id };
    }

    return { processed: false };
  } catch (error) {
    logger.error({ err: error }, '[TWILIO] Error handling SMS');
    return { processed: false };
  }
}

/**
 * Extract SMS verification code for a user.
 *
 * Two-pronged approach:
 *   1. Check `tfa_codes` table (codes stored by our SMS webhook).
 *   2. Fall back to Twilio REST API (lists recent inbound messages).
 *
 * Returns the first 4-8 digit code found, or null.
 */
export async function extractSMSVerificationCode(
  userId: string,
  phoneNumber: string,
  timeWindowMs: number = 120000 // 2 minutes
): Promise<string | null> {
  // ── 1. Check tfa_codes table (fastest — already parsed by webhook) ──
  try {
    const since = new Date(Date.now() - timeWindowMs).toISOString();
    const { data: codes } = await getSupabaseClient()
      .from("tfa_codes")
      .select("code, created_at")
      .eq("user_id", userId)
      .eq("source", "sms")
      .eq("used", false)
      .gt("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1);

    if (codes && codes.length > 0) {
      const code = codes[0].code;
      // Mark as used to prevent reuse
      await getSupabaseClient()
        .from("tfa_codes")
        .update({ used: true })
        .eq("user_id", userId)
        .eq("code", code)
        .eq("source", "sms")
        .eq("used", false);
      logger.info({ userId: userId.slice(0, 8) }, '[TWILIO] Found SMS verification code from tfa_codes');
      return code;
    }
  } catch (e) {
    logger.warn({ err: e }, '[TWILIO] tfa_codes lookup failed');
  }

  // ── 2. Fall back to Twilio REST API ──
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken || !phoneNumber) return null;

  try {
    const since = new Date(Date.now() - timeWindowMs);
    const params = new URLSearchParams({
      To: phoneNumber,
      DateSent: `>${since.toISOString().split("T")[0]}`,
      PageSize: "5",
    });
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json?${params}`;
    const resp = await fetch(url, {
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
      },
    });
    if (!resp.ok) return null;

    const data = (await resp.json()) as {
      messages?: {
        from: string;
        body: string;
        date_sent: string;
        direction: string;
      }[];
    };

    const inbound = (data.messages || []).filter(
      (m) =>
        m.direction === "inbound" &&
        new Date(m.date_sent).getTime() > since.getTime()
    );

    // Extract 4-8 digit verification code from the most recent inbound message
    for (const msg of inbound) {
      const codeMatch = msg.body.match(
        /(?:verification|confirm|verify|auth|code|pin|otp|token)\s*(?:is|:)?\s*[:\-–—]?\s*(\d{4,8})\b/i
      ) ||
        msg.body.match(/\b(\d{4,8})\s*(?:is your|is the)\s*(?:verification|confirm|auth|code|pin|otp)/i) ||
        msg.body.match(/(?:enter|use|type)\s+(?:this\s+)?(?:code|pin|otp)[:\s]+(\d{4,8})\b/i) ||
        msg.body.match(/\bcode[:\s]+(\d{4,8})\b/i) ||
        msg.body.match(/\b(\d{6})\b/); // Fallback: standalone 6-digit number

      if (codeMatch?.[1]) {
        logger.info({ from: msg.from }, '[TWILIO] Found SMS verification code via REST API');
        // Store it in tfa_codes so subsequent lookups are faster
        try {
          const { storeTfaCode } = await import("./tfa.js");
          await storeTfaCode(userId, null, codeMatch[1], "sms");
        } catch { /* non-critical */ }
        return codeMatch[1];
      }
    }
  } catch (e) {
    logger.warn({ err: e }, '[TWILIO] Twilio REST API SMS lookup failed');
  }

  return null;
}

/**
 * Handle incoming voice call — returns TwiML.
 * Detects whether the caller is the user (direct call) or someone else
 * (forwarded call / third party) and responds accordingly.
 */
export async function handleIncomingVoice(
  data: IncomingVoiceData
): Promise<string> {
  try {
    // Find user by their Twilio number
    const { data: profile } = await getSupabaseClient()
      .from("profiles")
      .select("id, username, phone, email")
      .eq("twilio_number", data.to)
      .single();

    if (!profile) {
      return await generateResponseTwiml("Sorry, this number is not associated with an Anticipy account.");
    }

    // Check if the caller IS the user (direct call to their AI)
    const callerIsUser =
      profile.phone && data.from &&
      (data.from === profile.phone || data.from.replace(/\D/g, "").endsWith(profile.phone.replace(/\D/g, "").slice(-10)));

    if (callerIsUser) {
      // User calling their own AI — normal assistant mode
      return await generateIncomingCallTwiml(profile.id, profile.username);
    }

    // Someone else is calling the user's Anticipy number (forwarded call)
    // Act as a receptionist / assistant
    logger.info({ username: profile.username, from: data.from }, '[TWILIO] Forwarded call');
    return await generateReceptionistTwiml(profile.id, profile.username, data.from);
  } catch (error) {
    logger.error({ err: error }, '[TWILIO] Error handling voice');
    return await generateResponseTwiml("Sorry, an error occurred. Please try again later.");
  }
}

/**
 * Generate TwiML for receptionist mode (answering forwarded calls).
 * Greets caller, takes a message, and sends it to the user.
 */
async function generateReceptionistTwiml(userId: string, userName: string, callerNumber: string): Promise<string> {
  const config = getTwilioConfig();
  const voice = await getUserVoice(userId);
  const processUrl = config
    ? `${config.webhookBaseUrl}/webhook/voice/message/${userId}?caller=${encodeURIComponent(callerNumber)}`
    : `/webhook/voice/message/${userId}?caller=${encodeURIComponent(callerNumber)}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Hello! You've reached ${escapeXml(userName)}'s assistant. ${escapeXml(userName)} is not available right now, but I can take a message and make sure they get it right away.</Say>
  <Gather input="speech" timeout="15" speechTimeout="auto"
          action="${processUrl}" method="POST">
    <Say voice="${voice}">Please leave your message after this prompt. What would you like me to tell ${escapeXml(userName)}?</Say>
  </Gather>
  <Say voice="${voice}">I didn't hear a message. I'll let ${escapeXml(userName)} know you called. Goodbye!</Say>
</Response>`;
}

/**
 * Process transcribed voice command — returns TwiML response with smooth ending.
 */
export async function processVoiceCommand(
  userId: string,
  speechResult: string
): Promise<string> {
  if (!speechResult || speechResult.trim().length === 0) {
    return generateResponseTwiml("I didn't catch that. Call me back anytime!");
  }

  try {
    // Get user profile
    const { data: profile } = await getSupabaseClient()
      .from("profiles")
      .select("id, username, email")
      .eq("id", userId)
      .single();

    if (!profile) {
      return generateResponseTwiml("Sorry, I could not find your account.");
    }

    // Create task from voice command
    const { data: taskRecord } = await getSupabaseClient()
      .from("tasks")
      .insert({
        user_id: userId,
        status: "pending",
        email_subject: "Voice Task",
        input_text: speechResult,
        input_channel: "voice",
      })
      .select()
      .single();

    if (taskRecord) {
      logger.info({ taskId: taskRecord.id }, '[TWILIO] Voice task created');

      // Generate dynamic confirmation + smooth ending
      const confirmations = [
        `Perfect! I'm on it. I'll shoot you the results as soon as I'm done. Talk soon!`,
        `Got it! Working on this now. You'll get an update via email or text. Catch you later!`,
        `Awesome! Consider it done. I'll ping you when it's ready. Take care!`,
        `On it! I'll handle this and get back to you shortly. Have a good one!`,
        `Understood! I'll take care of that right away and update you soon. Later!`,
      ];
      const confirmation = confirmations[Math.floor(Math.random() * confirmations.length)];

      return generateResponseTwiml(confirmation);
    }

    return generateResponseTwiml("Sorry, I had trouble creating your task. Give me another call!");
  } catch (error) {
    logger.error({ err: error }, '[TWILIO] Voice processing error');
    return generateResponseTwiml("Sorry, something went wrong. Call me back and we'll try again!");
  }
}

// ---- Phone Number Provisioning ----

/**
 * Provision a new phone number for a user.
 */
export async function provisionPhoneNumber(
  userId: string,
  areaCode: string = "604"
): Promise<{ success: boolean; phoneNumber?: string; error?: string }> {
  const config = getTwilioConfig();
  if (!config) return { success: false, error: "Twilio not configured" };

  try {
    // Detect country from area code (Canada vs US)
    const CANADIAN_AREA_CODES = new Set([
      '204','226','236','249','250','289','306','343','365','367','382',
      '403','416','418','431','437','438','450','506','514','519','548',
      '579','581','587','604','613','639','647','672','683','705','709',
      '742','778','780','782','807','819','825','867','873','902','905'
    ]);
    const country = CANADIAN_AREA_CODES.has(areaCode) ? 'CA' : 'US';

    // Search for available numbers
    const searchResponse = await twilioRequest(
      `/AvailablePhoneNumbers/${country}/Local.json?AreaCode=${areaCode}&SmsEnabled=true&VoiceEnabled=true`,
      "GET"
    );

    if (!searchResponse.ok) {
      return { success: false, error: `Search failed: ${searchResponse.status}` };
    }

    const searchData = await searchResponse.json() as {
      available_phone_numbers: Array<{ phone_number: string }>;
    };

    if (!searchData.available_phone_numbers?.length) {
      return { success: false, error: "No available numbers in that area code" };
    }

    const phoneNumber = searchData.available_phone_numbers[0].phone_number;

    // Purchase the number
    const params = new URLSearchParams({
      PhoneNumber: phoneNumber,
      SmsUrl: `${config.webhookBaseUrl}/webhook/sms/${userId}`,
      VoiceUrl: `${config.webhookBaseUrl}/webhook/voice/${userId}`,
      FriendlyName: `aurora-${userId.slice(0, 8)}`,
    });

    const purchaseResponse = await twilioRequest("/IncomingPhoneNumbers.json", "POST", params);

    if (!purchaseResponse.ok) {
      return { success: false, error: `Purchase failed: ${purchaseResponse.status}` };
    }

    // Save to user profile
    await getSupabaseClient()
      .from("profiles")
      .update({ twilio_number: phoneNumber })
      .eq("id", userId);

    // Also sync to user_twilio_numbers table
    try {
      const purchaseData = await purchaseResponse.json() as { sid?: string };
      await getSupabaseClient().from("user_twilio_numbers").upsert(
        {
          user_id: userId,
          phone_number: phoneNumber,
          twilio_sid: purchaseData.sid || null,
          purpose: "primary",
          is_active: true,
          area_code: areaCode,
        },
        { onConflict: "user_id,purpose" }
      );
    } catch {
      // Non-critical
    }

    // Log initial monthly fee and schedule recurring billing
    // Raw cost passed to trackServiceCost; PHONE_NUMBER_MARKUP (1.5×) applied on top of base 1.296× = 1.944× total
    try {
      const { MONTHLY_LOCAL_NUMBER_COST, PHONE_NUMBER_MARKUP, calculatePhoneNumberMonthlyCost } = await import('../utils/cost-calculator.js');
      const { trackServiceCost: trackPhoneCost } = await import('./ai.js');
      // Pass RAW cost — trackServiceCost applies all markup layers
      trackPhoneCost(userId, 'twilio', 'phone_number_monthly', MONTHLY_LOCAL_NUMBER_COST, 'phone_number', undefined, PHONE_NUMBER_MARKUP).catch(() => {});
      const billedMonthlyFee = calculatePhoneNumberMonthlyCost('local');
      // Schedule recurring monthly fee on the 1st of every month at 9am
      const nextFirstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1, 9, 0, 0);
      await getSupabaseClient().from('scheduled_tasks').insert({
        user_id: userId,
        description: `Monthly phone number fee for ${phoneNumber}`,
        task_template: `phone_number_fee:${phoneNumber}:${billedMonthlyFee.toFixed(4)}`,
        cron_expression: '0 9 1 * *',
        next_run_at: nextFirstOfMonth.toISOString(),
        is_active: true,
      });
    } catch {
      // Non-critical — don't fail provisioning if billing setup fails
    }

    logger.info({ userId: userId.slice(0, 8), phoneNumber }, '[TWILIO] Provisioned number');
    return { success: true, phoneNumber };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: msg };
  }
}

/**
 * Release a user's phone number.
 */
export async function releasePhoneNumber(userId: string): Promise<boolean> {
  const config = getTwilioConfig();
  if (!config) return false;

  try {
    const { data: profile } = await getSupabaseClient()
      .from("profiles")
      .select("twilio_number")
      .eq("id", userId)
      .single();

    if (!profile?.twilio_number) return true;

    // Find and delete the number
    const listResponse = await twilioRequest(
      `/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(profile.twilio_number)}`,
      "GET"
    );

    if (listResponse.ok) {
      const listData = await listResponse.json() as {
        incoming_phone_numbers: Array<{ sid: string }>;
      };

      if (listData.incoming_phone_numbers?.length > 0) {
        await twilioRequest(
          `/IncomingPhoneNumbers/${listData.incoming_phone_numbers[0].sid}.json`,
          "DELETE"
        );
      }
    }

    // Clear from profile
    await getSupabaseClient()
      .from("profiles")
      .update({ twilio_number: null })
      .eq("id", userId);

    return true;
  } catch (error) {
    logger.error({ err: error }, '[TWILIO] Release error');
    return false;
  }
}

/**
 * Get user's phone number.
 */
export async function getUserPhoneNumber(userId: string): Promise<string | null> {
  const { data } = await getSupabaseClient()
    .from("profiles")
    .select("twilio_number")
    .eq("id", userId)
    .single();

  return data?.twilio_number || null;
}

// ---- Usage Tracking ----

async function trackVoiceUsage(userId: string, minutes: number): Promise<void> {
  try {
    await getSupabaseClient().rpc("track_voice_sms_usage", {
      p_user_id: userId,
      p_sms_count: 0,
      p_voice_minutes: minutes,
    });
  } catch {
    // Non-critical
  }
}

async function trackSmsUsage(userId: string, count: number): Promise<void> {
  try {
    await getSupabaseClient().rpc("track_voice_sms_usage", {
      p_user_id: userId,
      p_sms_count: count,
      p_voice_minutes: 0,
    });
  } catch {
    // Non-critical
  }
}

// ---- Natural Voice Conversations for Email Decisions ----

/**
 * Initiate a natural voice conversation about a complex email.
 * This creates an interactive call where the AI explains the situation
 * and the user can respond naturally (yes/no/ask questions).
 */
export async function initiateEmailConversation(
  userId: string,
  email: {
    from: string;
    subject: string;
    body: string;
    queueId: string;
  }
): Promise<{ success: boolean; callSid?: string; error?: string }> {
  const config = getTwilioConfig();
  if (!config) return { success: false, error: "Twilio not configured" };

  const voice = await getUserVoice(userId);
  const { data: profile } = await getSupabaseClient()
    .from("profiles")
    .select("phone_number, username")
    .eq("id", userId)
    .single();

  if (!profile?.phone_number) {
    return { success: false, error: "User has no phone number on file" };
  }

  // Generate natural opening message
  const senderName = email.from.split("<")[0].trim();
  const openingMessage = `Hi ${profile.username}! This is your Anticipy assistant. I received an email from ${senderName} about "${email.subject}". This needs your input. Let me read it to you.`;

  // Build TwiML with conversation flow
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">${escapeXml(openingMessage)}</Say>
  <Pause length="1"/>
  <Say voice="${voice}">${escapeXml(email.body.substring(0, 500))}</Say>
  <Pause length="1"/>
  <Say voice="${voice}">Here's what I think: This looks like it needs your personal input. Would you like me to draft a response for you to review, or would you prefer to handle this one yourself?</Say>
  <Gather input="speech" timeout="15" speechTimeout="auto"
          action="${config.webhookBaseUrl}/webhook/voice/email-decision/${userId}/${email.queueId}" 
          method="POST">
    <Say voice="${voice}">You can say: draft a response, handle it myself, or give me more details.</Say>
  </Gather>
  <Say voice="${voice}">I didn't hear a response. I'll queue this in your dashboard for you to review later. Goodbye!</Say>
</Response>`;

  try {
    const params = new URLSearchParams({
      To: profile.phone_number,
      From: config.phoneNumber,
      Twiml: twiml,
    });

    const response = await twilioRequest("/Calls.json", "POST", params);

    if (!response.ok) {
      const errorData = await response.text();
      return { success: false, error: `Twilio error: ${response.status} ${errorData}` };
    }

    const data = await response.json() as { sid: string };
    await trackVoiceUsage(userId, 1);

    logger.info({ callSid: data.sid }, '[TWILIO] Email conversation initiated');
    return { success: true, callSid: data.sid };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: msg };
  }
}

/**
 * Process user's voice response about an email decision.
 * Uses AI to understand natural language responses (not just button presses).
 */
export async function processEmailVoiceDecision(
  userId: string,
  queueId: string,
  speechResult: string
): Promise<string> {
  if (!speechResult || speechResult.trim().length === 0) {
    return generateResponseTwiml("I didn't catch that. Let me queue this for you to review in your dashboard.");
  }

  const voice = await getUserVoice(userId);
  const config = getTwilioConfig();

  try {
    // Use AI to understand the user's intent from natural speech
    const prompt = `The user received a call about an email that needs their input. They said: "${speechResult}"

Classify their response into exactly one of these categories:
- "draft": User wants the AI to draft a response
- "handle_self": User wants to handle it themselves
- "more_info": User wants more details about the email
- "approve": User approves the suggested action
- "reject": User rejects/rejects the suggested action
- "unclear": Could not determine intent

Respond with JSON only: {"intent": "category", "confidence": 0.0-1.0}`;

    // Use cheap model for classification
    const groqKey = process.env.GROQ_API_KEY;
    let intent = "unclear";
    
    if (groqKey) {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${groqKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
          max_tokens: 100,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content || "";
        const json = text.match(/\{[\s\S]*\}/)?.[0];
        if (json) {
          const parsed = JSON.parse(json);
          intent = parsed.intent || "unclear";
        }
      }
    }

    // Handle based on intent
    switch (intent) {
      case "draft":
        // Generate draft response
        await getSupabaseClient()
          .from("inbox_queue")
          .update({ 
            status: "pending",
            user_decision: "User requested draft via voice call"
          })
          .eq("id", queueId);
        
        return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Perfect! I'll draft a response and queue it in your dashboard for review. You'll get a notification when it's ready.</Say>
  <Pause length="1"/>
  <Say voice="${voice}">Is there anything else you need help with?</Say>
  <Gather input="speech" timeout="10" speechTimeout="auto" action="${config?.webhookBaseUrl}/webhook/voice/process/${userId}" method="POST">
    <Say voice="${voice}">I'm listening.</Say>
  </Gather>
</Response>`;

      case "handle_self":
        // User wants to handle it
        await getSupabaseClient()
          .from("inbox_queue")
          .update({ 
            status: "rejected",
            user_decision: "User chose to handle via voice call"
          })
          .eq("id", queueId);
        
        return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">No problem! I'll leave this one for you. It's marked in your dashboard so you know I didn't take action.</Say>
  <Pause length="1"/>
  <Say voice="${voice}">Anything else I can help you with today?</Say>
  <Gather input="speech" timeout="10" speechTimeout="auto" action="${config?.webhookBaseUrl}/webhook/voice/process/${userId}" method="POST">
    <Say voice="${voice}">I'm listening.</Say>
  </Gather>
</Response>`;

      case "more_info":
        // Read more of the email
        return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Of course. Let me read you the full email content...</Say>
  <Pause length="1"/>
  <Say voice="${voice}">Would you like me to draft a response now, or handle this yourself?</Say>
  <Gather input="speech" timeout="15" speechTimeout="auto" action="${config?.webhookBaseUrl}/webhook/voice/email-decision/${userId}/${queueId}" method="POST">
    <Say voice="${voice}">Say: draft a response, or I'll handle it.</Say>
  </Gather>
</Response>`;

      case "approve":
        await getSupabaseClient()
          .from("inbox_queue")
          .update({ 
            status: "approved",
            executed_at: new Date().toISOString(),
          })
          .eq("id", queueId);
        
        return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Great! I'll take care of this right away. Done!</Say>
  <Pause length="1"/>
  <Say voice="${voice}">Is there anything else you need?</Say>
  <Gather input="speech" timeout="10" speechTimeout="auto" action="${config?.webhookBaseUrl}/webhook/voice/process/${userId}" method="POST">
    <Say voice="${voice}">I'm listening.</Say>
  </Gather>
</Response>`;

      case "reject":
        await getSupabaseClient()
          .from("inbox_queue")
          .update({ status: "rejected" })
          .eq("id", queueId);
        
        return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Understood. I'll leave this one alone and it's marked as handled.</Say>
  <Pause length="1"/>
  <Say voice="${voice}">Anything else I can help with?</Say>
  <Gather input="speech" timeout="10" speechTimeout="auto" action="${config?.webhookBaseUrl}/webhook/voice/process/${userId}" method="POST">
    <Say voice="${voice}">I'm listening.</Say>
  </Gather>
</Response>`;

      default:
        // Unclear - ask again
        return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">I'm not sure I understood. Let me give you the options again:</Say>
  <Pause length="1"/>
  <Say voice="${voice}">Would you like me to draft a response for you to review, or would you prefer to handle this email yourself?</Say>
  <Gather input="speech" timeout="15" speechTimeout="auto" action="${config?.webhookBaseUrl}/webhook/voice/email-decision/${userId}/${queueId}" method="POST">
    <Say voice="${voice}">Say: draft a response, or I'll handle it.</Say>
  </Gather>
  <Say voice="${voice}">I'll queue this in your dashboard for you to review later. Goodbye!</Say>
</Response>`;
    }
  } catch (error) {
    logger.error({ err: error }, '[TWILIO] Email voice decision error');
    return generateResponseTwiml("Sorry, I had trouble processing your response. I'll queue this in your dashboard for you to review.");
  }
}

/**
 * Simple wrapper to call user about an email
 */
export async function processVoiceCall(
  userId: string,
  message: string
): Promise<void> {
  const config = getTwilioConfig();
  if (!config) return;

  const { data: profile } = await getSupabaseClient()
    .from("profiles")
    .select("phone_number")
    .eq("id", userId)
    .single();

  if (!profile?.phone_number) return;

  await callUser({
    userId,
    to: profile.phone_number,
    message,
  });
}

// ---- PIN Verification ----

/**
 * Verify a voice PIN against the stored hash/plaintext for a user.
 * Supports bcrypt (preferred), SHA-256 (legacy), and plaintext (legacy).
 * Auto-migrates to bcrypt on successful verification.
 */
export async function verifyVoicePin(userId: string, pin: string): Promise<boolean> {
  // Delegate to unified PIN system — handles all hash formats + auto-migration
  const { verifyUnifiedPin } = await import("../utils/pin-auth.js");
  const result = await verifyUnifiedPin(userId, pin);
  return result === "valid";
}

// ---- Helpers ----

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
