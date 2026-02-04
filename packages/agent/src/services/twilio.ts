/**
 * Twilio Service — Full Voice + SMS Integration
 *
 * Capabilities:
 * - Outbound calls: AI calls user (updates, questions), AI calls others (appointments)
 * - Inbound calls: User calls AI (voice tasks), AI receives calls (receptionist)
 * - TwiML generation: Voice flow responses with speech synthesis (Polly.Amy)
 * - Speech-to-text: Transcribe voice commands
 * - SMS two-way: Send tasks via text, receive updates
 * - 2FA codes: Receive verification codes via SMS
 */

import { getSupabaseClient } from "../utils/supabase.js";
import type { VoiceCallRequest, SmsRequest, IncomingVoiceData, IncomingSmsData } from "../types/index.js";

// ---- Configuration ----

interface TwilioConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
  webhookBaseUrl: string;
}

function getTwilioConfig(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const phoneNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken) {
    return null;
  }

  return {
    accountSid,
    authToken,
    phoneNumber: phoneNumber || "",
    webhookBaseUrl: process.env.AGENT_WEBHOOK_BASE_URL || "https://agent.aevoy.com",
  };
}

export function isTwilioConfigured(): boolean {
  return getTwilioConfig() !== null;
}

// ---- Twilio REST API helpers ----

async function twilioRequest(
  path: string,
  method: "GET" | "POST" | "DELETE" = "POST",
  body?: URLSearchParams
): Promise<Response> {
  const config = getTwilioConfig();
  if (!config) throw new Error("Twilio not configured");

  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}${path}`;
  const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");

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

  try {
    // Build TwiML that speaks then optionally gathers response
    let twiml = `<Response>
  <Say voice="Polly.Amy">${escapeXml(message)}</Say>`;

    if (gatherAfter) {
      twiml += `
  <Gather input="speech" timeout="10" speechTimeout="auto"
          action="${config.webhookBaseUrl}/webhook/voice/process/${userId}" method="POST">
    <Say voice="Polly.Amy">I'm listening for your response.</Say>
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
 * Greets user and starts speech gathering.
 */
export function generateIncomingCallTwiml(userId: string, userName: string): string {
  const config = getTwilioConfig();
  const processUrl = config
    ? `${config.webhookBaseUrl}/webhook/voice/process/${userId}`
    : "/webhook/voice/process/" + userId;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Amy">Hello ${escapeXml(userName)}! This is your Aevoy assistant. How can I help you today?</Say>
  <Gather input="speech" timeout="10" speechTimeout="auto"
          action="${processUrl}" method="POST">
    <Say voice="Polly.Amy">Go ahead, I'm listening.</Say>
  </Gather>
  <Say voice="Polly.Amy">I didn't catch that. Please call back and try again.</Say>
</Response>`;
}

/**
 * Generate TwiML response after processing a voice command.
 */
export function generateResponseTwiml(message: string, voice?: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice || "Polly.Amy"}">${escapeXml(message)}</Say>
</Response>`;
}

/**
 * Generate TwiML for speech synthesis.
 */
function generateSpeechTwiml(text: string, voice?: string): string {
  return `<Response>
  <Say voice="${voice || "Polly.Amy"}">${escapeXml(text)}</Say>
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

      console.log(`[TWILIO] Verification code received for task ${pendingTask.id}`);
      return { processed: true, taskId: pendingTask.id, isVerificationCode: true };
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
      return generateResponseTwiml("Sorry, this number is not associated with an Aevoy account.");
    }

    // Check if the caller IS the user (direct call to their AI)
    const callerIsUser =
      profile.phone && data.from &&
      (data.from === profile.phone || data.from.replace(/\D/g, "").endsWith(profile.phone.replace(/\D/g, "").slice(-10)));

    if (callerIsUser) {
      // User calling their own AI — normal assistant mode
      return generateIncomingCallTwiml(profile.id, profile.username);
    }

    // Someone else is calling the user's Aevoy number (forwarded call)
    // Act as a receptionist / assistant
    console.log(`[TWILIO] Forwarded call for ${profile.username} from ${data.from}`);
    return generateReceptionistTwiml(profile.id, profile.username, data.from);
  } catch (error) {
    console.error("[TWILIO] Error handling voice:", error);
    return generateResponseTwiml("Sorry, an error occurred. Please try again later.");
  }
}

/**
 * Generate TwiML for receptionist mode (answering forwarded calls).
 * Greets caller, takes a message, and sends it to the user.
 */
function generateReceptionistTwiml(userId: string, userName: string, callerNumber: string): string {
  const config = getTwilioConfig();
  const processUrl = config
    ? `${config.webhookBaseUrl}/webhook/voice/message/${userId}?caller=${encodeURIComponent(callerNumber)}`
    : `/webhook/voice/message/${userId}?caller=${encodeURIComponent(callerNumber)}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Amy">Hello! You've reached ${escapeXml(userName)}'s assistant. ${escapeXml(userName)} is not available right now, but I can take a message and make sure they get it right away.</Say>
  <Gather input="speech" timeout="15" speechTimeout="auto"
          action="${processUrl}" method="POST">
    <Say voice="Polly.Amy">Please leave your message after this prompt. What would you like me to tell ${escapeXml(userName)}?</Say>
  </Gather>
  <Say voice="Polly.Amy">I didn't hear a message. I'll let ${escapeXml(userName)} know you called. Goodbye!</Say>
</Response>`;
}

/**
 * Process transcribed voice command — returns TwiML response.
 */
export async function processVoiceCommand(
  userId: string,
  speechResult: string
): Promise<string> {
  if (!speechResult || speechResult.trim().length === 0) {
    return generateResponseTwiml("I didn't catch that. Could you repeat your request?");
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
      return generateResponseTwiml(
        `Got it! I'll work on that for you: "${speechResult.substring(0, 100)}". I'll send you the results by email or text.`
      );
    }

    return generateResponseTwiml("Sorry, I had trouble creating your task. Please try again.");
  } catch (error) {
    console.error("[TWILIO] Voice processing error:", error);
    return generateResponseTwiml("Sorry, something went wrong. Please try again later.");
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

// ---- Helpers ----

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
