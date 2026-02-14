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

// ---- Outbound Voice Calls ----

/**
 * AI calls the user (for updates, questions, alerts).
 */
export async function callUser(request: VoiceCallRequest): Promise<{
  success: boolean;
  callSid?: string;
  error?: string;
}> {
  const config = getTwilioConfig();
  if (!config) return { success: false, error: "Twilio not configured" };

  try {
    const params = new URLSearchParams({
      To: request.to,
      From: config.phoneNumber,
      Twiml: generateSpeechTwiml(request.message, request.voice),
    });

    const response = await twilioRequest("/Calls.json", "POST", params);

    if (!response.ok) {
      const errorData = await response.text();
      return { success: false, error: `Twilio API error: ${response.status} ${errorData}` };
    }

    const data = await response.json() as { sid: string };

    // Track usage
    await trackVoiceUsage(request.userId, 1);

    console.log(`[TWILIO] Call initiated: ${data.sid}`);
    return { success: true, callSid: data.sid };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[TWILIO] Call error:", msg);
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
  gatherAfter: boolean = true
): Promise<{ success: boolean; callSid?: string; error?: string }> {
  const config = getTwilioConfig();
  if (!config) return { success: false, error: "Twilio not configured" };
  const voice = await getUserVoice(userId);

  try {
    // Build TwiML that speaks then optionally gathers response
    let twiml = `<Response>
  <Say voice="${voice}">${escapeXml(message)}</Say>`;

    if (gatherAfter) {
      twiml += `
  <Gather input="speech" timeout="10" speechTimeout="auto"
          action="${config.webhookBaseUrl}/webhook/voice/process/${userId}" method="POST">
    <Say voice="${voice}">I'm listening for your response.</Say>
  </Gather>`;
    }

    twiml += `\n</Response>`;

    const params = new URLSearchParams({
      To: to,
      From: config.phoneNumber,
      Twiml: twiml,
    });

    const response = await twilioRequest("/Calls.json", "POST", params);

    if (!response.ok) {
      return { success: false, error: `Twilio error: ${response.status}` };
    }

    const data = await response.json() as { sid: string };
    await trackVoiceUsage(userId, 1);

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
 */
function generateSpeechTwiml(text: string, voice?: string): string {
  return `<Response>
  <Say voice="${voice || DEFAULT_VOICE}">${escapeXml(text)}</Say>
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
    const from = config?.phoneNumber || '+17789008951';
    const messageId = fakeEmailServer.sendSMS(from, request.to, request.body);
    console.log(`[TWILIO-TEST] SMS sent: ${messageId}`);
    return { success: true, messageSid: messageId };
  }

  const config = getTwilioConfig();
  if (!config) return { success: false, error: "Twilio not configured" };

  try {
    const params = new URLSearchParams({
      To: request.to,
      From: config.phoneNumber,
      Body: request.body,
    });

    const response = await twilioRequest("/Messages.json", "POST", params);

    if (!response.ok) {
      const errorData = await response.text();
      return { success: false, error: `SMS error: ${response.status} ${errorData}` };
    }

    const data = await response.json() as { sid: string };

    // Track usage
    await trackSmsUsage(request.userId, 1);

    console.log(`[TWILIO] SMS sent: ${data.sid}`);
    return { success: true, messageSid: data.sid };
  } catch (error) {
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
}> {
  try {
    // Find user by their Twilio number
    const { data: profile } = await getSupabaseClient()
      .from("profiles")
      .select("id, username, email")
      .eq("twilio_number", data.to)
      .single();

    if (!profile) {
      console.log(`[TWILIO] No user found for number ${data.to}`);
      return { processed: false };
    }

    const userId = profile.id;

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

      console.log(`[TWILIO] Verification code received for task ${pendingTask.id}`);
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
      console.log(`[TWILIO] SMS task created: ${taskRecord.id}`);
      return { processed: true, taskId: taskRecord.id };
    }

    return { processed: false };
  } catch (error) {
    console.error("[TWILIO] Error handling SMS:", error);
    return { processed: false };
  }
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
      return await generateResponseTwiml("Sorry, this number is not associated with an Aevoy account.");
    }

    // Check if the caller IS the user (direct call to their AI)
    const callerIsUser =
      profile.phone && data.from &&
      (data.from === profile.phone || data.from.replace(/\D/g, "").endsWith(profile.phone.replace(/\D/g, "").slice(-10)));

    if (callerIsUser) {
      // User calling their own AI — normal assistant mode
      return await generateIncomingCallTwiml(profile.id, profile.username);
    }

    // Someone else is calling the user's Aevoy number (forwarded call)
    // Act as a receptionist / assistant
    console.log(`[TWILIO] Forwarded call for ${profile.username} from ${data.from}`);
    return await generateReceptionistTwiml(profile.id, profile.username, data.from);
  } catch (error) {
    console.error("[TWILIO] Error handling voice:", error);
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
      console.log(`[TWILIO] Voice task created: ${taskRecord.id}`);

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
    console.error("[TWILIO] Voice processing error:", error);
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
    // Search for available numbers
    const searchResponse = await twilioRequest(
      `/AvailablePhoneNumbers/US/Local.json?AreaCode=${areaCode}&SmsEnabled=true&VoiceEnabled=true`,
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
      FriendlyName: `aevoy-${userId.slice(0, 8)}`,
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

    console.log(`[TWILIO] Provisioned number for user ${userId.slice(0, 8)}...`);
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
    console.error("[TWILIO] Release error:", error);
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
  const openingMessage = `Hi ${profile.username}! This is your Aevoy assistant. I received an email from ${senderName} about "${email.subject}". This needs your input. Let me read it to you.`;

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

    console.log(`[TWILIO] Email conversation initiated: ${data.sid}`);
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
    console.error("[TWILIO] Email voice decision error:", error);
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

// ---- Helpers ----

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
