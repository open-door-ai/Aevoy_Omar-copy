/**
 * Daily Check-in Call Service
 * Handles proactive morning/evening calls to opted-in users
 */

import { getSupabaseClient } from "../utils/supabase.js";

const supabase = getSupabaseClient();

/**
 * Initiate a check-in call to a user
 */
export async function makeCheckinCall(
  userId: string,
  phoneNumber: string,
  callType: "morning" | "evening"
): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
  const twilioNumber = process.env.TWILIO_PHONE_NUMBER || "+17789008951";
  const agentUrl = process.env.AGENT_URL || "http://localhost:3001";

  if (!accountSid || !authToken || !twilioNumber) {
    console.error("[CHECKIN] Missing Twilio credentials");
    return;
  }

  try {
    // Get user's name and context
    const { data: profile } = await supabase
      .from("profiles")
      .select("username, full_name, bot_name, timezone")
      .eq("id", userId)
      .single();

    const userName = profile?.full_name || profile?.username || "there";
    const botName = profile?.bot_name || "your AI assistant";

    console.log(`[CHECKIN] Initiating ${callType} call for ${userName} (${userId.slice(0, 8)})`);

    // Make Twilio call
    const callUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`;

    // Prefer API Key auth (more secure, independently revocable)
    const authUser = apiKeySid && apiKeySecret ? apiKeySid : accountSid;
    const authPass = apiKeySid && apiKeySecret ? apiKeySecret : authToken;
    const auth = "Basic " + Buffer.from(`${authUser}:${authPass}`).toString("base64");

    const res = await fetch(callUrl, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        From: twilioNumber,
        To: phoneNumber,
        Url: `${agentUrl}/webhook/checkin/${userId}?type=${callType}`,
        Method: "POST",
      }),
    });

    if (!res.ok) {
      console.error("[CHECKIN] Twilio call failed:", await res.text());
      throw new Error("Failed to initiate check-in call");
    }

    const data = await res.json();
    console.log(`[CHECKIN] Call initiated: ${data.sid}`);

    // Log call
    await supabase.from("call_history").insert({
      user_id: userId,
      call_sid: data.sid,
      direction: "outbound",
      from_number: twilioNumber,
      to_number: phoneNumber,
      call_type: `checkin_${callType}`,
    });
  } catch (error) {
    console.error(`[CHECKIN] Error initiating ${callType} call:`, error);
    throw error;
  }
}

/**
 * Generate a dynamic, personalized check-in greeting using AI
 */
export async function generateCheckinGreeting(
  userName: string,
  botName: string,
  callType: "morning" | "evening"
): Promise<string> {
  // Use dynamic random greetings
  // TODO: Integrate AI-generated greetings properly with full Memory context
  const greetingOptions = {
    morning: [
      `Hey ${userName}! It's ${botName}. How's your morning going so far?`,
      `Good morning ${userName}! Ready to crush today? What's on your mind?`,
      `Morning ${userName}! How are you feeling? Anything I can help with today?`,
      `Hey there ${userName}, it's ${botName} checking in. What's on your agenda?`,
      `${userName}, morning! Hope you slept well. What's the plan for today?`,
    ],
    evening: [
      `Hey ${userName}! Hope you had a great day. Anything exciting happen?`,
      `Evening ${userName}! How did your day go?`,
      `Hi ${userName}, it's ${botName}. How was your day today?`,
      `Good evening ${userName}! Ready to wind down? Anything on your mind?`,
      `${userName}, evening check-in! How'd everything go today?`,
    ],
  };

  const greetings = greetingOptions[callType];
  return greetings[Math.floor(Math.random() * greetings.length)];
}
