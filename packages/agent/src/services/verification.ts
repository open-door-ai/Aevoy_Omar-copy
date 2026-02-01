/**
 * Verification Detection System
 * 
 * Detects when browser encounters 2FA/verification screens
 * and handles the flow of requesting codes from users.
 */

import type { Page } from "playwright";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { sendVerificationCodeRequest } from "./email.js";

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

// Common indicators of verification/2FA screens
const VERIFICATION_INDICATORS = [
  'verification code',
  'enter code',
  'sent to your phone',
  'sent to your email',
  'two-factor',
  '2fa',
  '2-factor',
  'confirm your identity',
  'security code',
  'one-time password',
  'otp',
  'authentication code',
  'verify your account',
  'enter the code',
  'we sent you a code',
  'check your phone',
  'check your email',
  'text message',
  'sms code',
  'authenticator app'
];

// Common input field selectors for verification codes
const CODE_INPUT_SELECTORS = [
  'input[name*="code"]',
  'input[name*="otp"]',
  'input[name*="verification"]',
  'input[name*="token"]',
  'input[aria-label*="code"]',
  'input[aria-label*="verification"]',
  'input[placeholder*="code"]',
  'input[placeholder*="digit"]',
  'input[type="tel"]',
  // Multi-digit inputs (common pattern)
  'input[maxlength="1"]',
  'input[maxlength="6"]',
  'input[maxlength="4"]'
];

export interface VerificationDetectionResult {
  detected: boolean;
  type: 'phone' | 'email' | 'authenticator' | 'unknown';
  phoneHint?: string; // Last digits of phone number if visible
  emailHint?: string; // Partial email if visible
  inputSelector?: string;
}

/**
 * Detect if the current page is showing a verification/2FA prompt
 */
export async function detectVerificationNeeded(page: Page): Promise<VerificationDetectionResult> {
  try {
    // Get page text content
    const pageText = await page.textContent('body');
    if (!pageText) {
      return { detected: false, type: 'unknown' };
    }
    
    const lowerText = pageText.toLowerCase();
    
    // Check for verification indicators
    const hasIndicator = VERIFICATION_INDICATORS.some(indicator => 
      lowerText.includes(indicator)
    );
    
    if (!hasIndicator) {
      return { detected: false, type: 'unknown' };
    }
    
    // Determine verification type
    let type: 'phone' | 'email' | 'authenticator' | 'unknown' = 'unknown';
    
    if (lowerText.includes('phone') || lowerText.includes('sms') || lowerText.includes('text message')) {
      type = 'phone';
    } else if (lowerText.includes('email') || lowerText.includes('inbox')) {
      type = 'email';
    } else if (lowerText.includes('authenticator') || lowerText.includes('totp')) {
      type = 'authenticator';
    }
    
    // Try to find phone number hint (e.g., "***-***-1234")
    let phoneHint: string | undefined;
    const phoneMatch = pageText.match(/\*{2,}\d{2,4}|\d{2,4}\*{2,}|ending in \d{2,4}/i);
    if (phoneMatch) {
      phoneHint = phoneMatch[0];
    }
    
    // Try to find email hint (e.g., "a***@gmail.com")
    let emailHint: string | undefined;
    const emailMatch = pageText.match(/[a-z]\*{2,}@[\w.]+/i);
    if (emailMatch) {
      emailHint = emailMatch[0];
    }
    
    // Find the input selector for the code
    let inputSelector: string | undefined;
    for (const selector of CODE_INPUT_SELECTORS) {
      try {
        const element = await page.$(selector);
        if (element) {
          inputSelector = selector;
          break;
        }
      } catch {
        // Selector not found, try next
      }
    }
    
    return {
      detected: true,
      type,
      phoneHint,
      emailHint,
      inputSelector
    };
  } catch (error) {
    console.error("[VERIFICATION] Detection error:", error);
    return { detected: false, type: 'unknown' };
  }
}

/**
 * Pause task and request verification code from user
 */
export async function requestVerificationCode(
  taskId: string,
  userId: string,
  userEmail: string,
  agentEmail: string,
  context: string,
  detection: VerificationDetectionResult
): Promise<void> {
  // Build context message
  let contextMessage = context;
  
  if (detection.type === 'phone' && detection.phoneHint) {
    contextMessage += ` A code was sent to your phone ${detection.phoneHint}.`;
  } else if (detection.type === 'email' && detection.emailHint) {
    contextMessage += ` A code was sent to ${detection.emailHint}.`;
  } else if (detection.type === 'authenticator') {
    contextMessage += ` Please provide the code from your authenticator app.`;
  }
  
  // Update task status to awaiting input
  await getSupabaseClient()
    .from("tasks")
    .update({
      status: "awaiting_user_input",
      stuck_reason: "verification_code"
    })
    .eq("id", taskId);
  
  // Send email requesting code
  await sendVerificationCodeRequest(
    userEmail,
    agentEmail,
    taskId,
    contextMessage
  );
  
  console.log(`[VERIFICATION] Code requested for task ${taskId}`);
}

/**
 * Enter verification code into the page
 */
export async function enterVerificationCode(
  page: Page,
  code: string,
  detection: VerificationDetectionResult
): Promise<boolean> {
  try {
    // Clean the code (remove spaces, dashes)
    const cleanCode = code.replace(/[\s-]/g, '');
    
    // Try to find and fill the input
    if (detection.inputSelector) {
      // Check if it's multiple single-digit inputs
      const inputs = await page.$$(detection.inputSelector);
      
      if (inputs.length > 1 && inputs.length === cleanCode.length) {
        // Fill each digit separately
        for (let i = 0; i < inputs.length; i++) {
          await inputs[i].fill(cleanCode[i]);
        }
        return true;
      } else if (inputs.length > 0) {
        // Single input field
        await inputs[0].fill(cleanCode);
        return true;
      }
    }
    
    // Fallback: try common selectors
    for (const selector of CODE_INPUT_SELECTORS) {
      try {
        const input = await page.$(selector);
        if (input) {
          await input.fill(cleanCode);
          return true;
        }
      } catch {
        // Continue to next selector
      }
    }
    
    console.error("[VERIFICATION] Could not find code input field");
    return false;
  } catch (error) {
    console.error("[VERIFICATION] Error entering code:", error);
    return false;
  }
}

/**
 * Check if a task is waiting for user input
 */
export async function isTaskAwaitingInput(taskId: string): Promise<{
  awaiting: boolean;
  reason?: string;
}> {
  const { data: task } = await getSupabaseClient()
    .from("tasks")
    .select("status, stuck_reason")
    .eq("id", taskId)
    .single();
  
  if (!task) {
    return { awaiting: false };
  }
  
  return {
    awaiting: task.status === "awaiting_user_input",
    reason: task.stuck_reason
  };
}

/**
 * Resume a task that was waiting for input
 */
export async function resumeTask(taskId: string): Promise<void> {
  await getSupabaseClient()
    .from("tasks")
    .update({
      status: "processing",
      stuck_reason: null
    })
    .eq("id", taskId);
}
