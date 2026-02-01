/**
 * Twilio Integration
 * 
 * Handles virtual phone numbers for auto-receiving verification codes.
 * Optional feature - users can choose to pay $1/month for a dedicated number.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getUserSettings } from "./clarifier.js";

let supabase: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      process.env.SUPABASE_SERVICE_ROLE_KEY || ""
    );
  }
  return supabase;
}

interface TwilioConfig {
  accountSid: string;
  authToken: string;
  webhookUrl: string;
}

function getTwilioConfig(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const webhookUrl = process.env.TWILIO_PHONE_WEBHOOK_URL;
  
  if (!accountSid || !authToken) {
    console.warn("[TWILIO] Not configured - missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN");
    return null;
  }
  
  return {
    accountSid,
    authToken,
    webhookUrl: webhookUrl || "https://api.aevoy.ai/webhook/sms"
  };
}

/**
 * Provision a new phone number for a user
 */
export async function provisionPhoneNumber(
  userId: string,
  areaCode: string = "604" // Default to Vancouver
): Promise<{ success: boolean; phoneNumber?: string; error?: string }> {
  const config = getTwilioConfig();
  if (!config) {
    return { success: false, error: "Twilio not configured" };
  }
  
  try {
    // Search for available numbers
    const searchUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/AvailablePhoneNumbers/US/Local.json?AreaCode=${areaCode}&SmsEnabled=true`;
    
    const searchResponse = await fetch(searchUrl, {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')
      }
    });
    
    if (!searchResponse.ok) {
      throw new Error(`Failed to search numbers: ${searchResponse.status}`);
    }
    
    const searchData = await searchResponse.json() as { available_phone_numbers: Array<{ phone_number: string; friendly_name: string }> };
    
    if (!searchData.available_phone_numbers || searchData.available_phone_numbers.length === 0) {
      return { success: false, error: "No available numbers in that area code" };
    }
    
    const phoneNumber = searchData.available_phone_numbers[0].phone_number;
    
    // Purchase the number
    const purchaseUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/IncomingPhoneNumbers.json`;
    
    const purchaseResponse = await fetch(purchaseUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        PhoneNumber: phoneNumber,
        SmsUrl: config.webhookUrl,
        FriendlyName: `handlit-${userId.slice(0, 8)}`
      })
    });
    
    if (!purchaseResponse.ok) {
      throw new Error(`Failed to purchase number: ${purchaseResponse.status}`);
    }
    
    // Save to user settings
    const { error: dbError } = await getSupabaseClient()
      .from("user_settings")
      .upsert({
        user_id: userId,
        virtual_phone: phoneNumber,
        verification_method: 'virtual_number',
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
    
    if (dbError) {
      console.error("[TWILIO] Failed to save phone number to DB:", dbError);
    }
    
    console.log(`[TWILIO] Provisioned ${phoneNumber} for user ${userId}`);
    
    return { success: true, phoneNumber };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[TWILIO] Error provisioning number:", message);
    return { success: false, error: message };
  }
}

/**
 * Release a user's phone number
 */
export async function releasePhoneNumber(userId: string): Promise<boolean> {
  const config = getTwilioConfig();
  if (!config) {
    return false;
  }
  
  try {
    // Get user's phone number
    const settings = await getUserSettings(userId);
    if (!settings.virtualPhone) {
      return true; // No number to release
    }
    
    // Find the Twilio resource SID for this number
    const listUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(settings.virtualPhone)}`;
    
    const listResponse = await fetch(listUrl, {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')
      }
    });
    
    if (!listResponse.ok) {
      throw new Error(`Failed to find number: ${listResponse.status}`);
    }
    
    const listData = await listResponse.json() as { incoming_phone_numbers: Array<{ sid: string }> };
    
    if (listData.incoming_phone_numbers && listData.incoming_phone_numbers.length > 0) {
      const phoneSid = listData.incoming_phone_numbers[0].sid;
      
      // Delete the number
      const deleteUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/IncomingPhoneNumbers/${phoneSid}.json`;
      
      await fetch(deleteUrl, {
        method: 'DELETE',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')
        }
      });
    }
    
    // Update user settings
    await getSupabaseClient()
      .from("user_settings")
      .update({
        virtual_phone: null,
        verification_method: 'forward',
        updated_at: new Date().toISOString()
      })
      .eq("user_id", userId);
    
    console.log(`[TWILIO] Released number for user ${userId}`);
    
    return true;
  } catch (error) {
    console.error("[TWILIO] Error releasing number:", error);
    return false;
  }
}

/**
 * Handle incoming SMS webhook from Twilio
 * This should be called from an Express route
 */
export async function handleIncomingSms(
  from: string,
  to: string,
  body: string
): Promise<{ processed: boolean; taskId?: string }> {
  try {
    // Find user by their virtual phone number
    const { data: settings } = await getSupabaseClient()
      .from("user_settings")
      .select("user_id")
      .eq("virtual_phone", to)
      .single();
    
    if (!settings) {
      console.log(`[TWILIO] No user found for number ${to}`);
      return { processed: false };
    }
    
    const userId = settings.user_id;
    
    // Find a task awaiting verification input
    const { data: task } = await getSupabaseClient()
      .from("tasks")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "awaiting_user_input")
      .eq("stuck_reason", "verification_code")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    
    if (!task) {
      console.log(`[TWILIO] No pending task for user ${userId}`);
      return { processed: false };
    }
    
    // Extract verification code from SMS
    const codeMatch = body.match(/\b(\d{4,8})\b/);
    const code = codeMatch ? codeMatch[1] : body.trim();
    
    // Update task with the code
    await getSupabaseClient()
      .from("tasks")
      .update({
        status: "processing",
        stuck_reason: null,
        structured_intent: {
          verification_code: code
        }
      })
      .eq("id", task.id);
    
    console.log(`[TWILIO] Received code for task ${task.id}`);
    
    return { processed: true, taskId: task.id };
  } catch (error) {
    console.error("[TWILIO] Error handling SMS:", error);
    return { processed: false };
  }
}

/**
 * Get user's virtual phone number if they have one
 */
export async function getUserPhoneNumber(userId: string): Promise<string | null> {
  const settings = await getUserSettings(userId);
  return settings.virtualPhone;
}

/**
 * Check if Twilio is configured
 */
export function isTwilioConfigured(): boolean {
  return getTwilioConfig() !== null;
}
