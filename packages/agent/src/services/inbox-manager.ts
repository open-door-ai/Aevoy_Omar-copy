/**
 * AI Inbox Manager Service
 *
 * Polls user inboxes every 5 minutes, classifies emails using cheap AI models,
 * takes autonomous actions or queues for approval based on user settings.
 *
 * Escalates to expensive models only when necessary.
 */

import { getSupabaseClient } from "../utils/supabase.js";
import { getUnreadMessages, sendViaUserEmail, isEmailConnected, deleteMessage } from "./inbox.js";
import { isNylasConnected, getUnreadMessages as getNylasUnread, sendEmail as sendNylasEmail } from "./nylas-email.js";
import { sendResponse } from "./email.js";
import { processVoiceCall } from "./twilio.js";
import { schedulerHeartbeat } from "../utils/scheduler-heartbeat.js";

// Configuration
// Global tick every 15 minutes; per-user interval respected via lastChecked map
const POLL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes (tick)
const DEFAULT_USER_INTERVAL_MINUTES = 30; // Default per-user check frequency
let managerInterval: ReturnType<typeof setInterval> | null = null;

// Track last check time per user (in-memory; resets on restart = first check always runs)
const userLastChecked = new Map<string, Date>();

// User cache to avoid re-querying settings
interface UserInboxConfig {
  userId: string;
  autonomyLevel: number;
  enabled: boolean;
  checkIntervalMinutes: number;
  settings: {
    monitorInbox: boolean;
    deleteSpam: boolean;
    respondToSimple: boolean;
    scheduleMeetings: boolean;
    callForComplex: boolean;
    aiSignatureEnabled: boolean;
    aiSignatureText: string;
    userRules: string[];
    maxEmailsPerDay: number;
    notifyUrgentImmediately: boolean;
  };
  emailProvider: "nylas" | "imap" | "gmail_oauth" | null;
  lastChecked: Date;
}

const userConfigCache = new Map<string, UserInboxConfig>();

/**
 * Start the inbox manager polling service
 */
export function startInboxManager(): void {
  if (managerInterval) {
    console.log("[INBOX-MANAGER] Already running");
    return;
  }

  console.log("[INBOX-MANAGER] Starting - global tick every 15 min, per-user intervals respected");

  // Run immediately, then on interval
  processAllInboxes().catch((err) =>
    console.error("[INBOX-MANAGER] Initial run error:", err)
  );

  managerInterval = setInterval(() => {
    processAllInboxes()
      .then(() => schedulerHeartbeat.record('inbox_manager'))
      .catch((err) => console.error("[INBOX-MANAGER] Poll error:", err));
  }, POLL_INTERVAL_MS);
}

/**
 * Stop the inbox manager
 */
export function stopInboxManager(): void {
  if (managerInterval) {
    clearInterval(managerInterval);
    managerInterval = null;
  }
  console.log("[INBOX-MANAGER] Stopped");
}

/**
 * Process all enabled user inboxes
 */
async function processAllInboxes(): Promise<void> {
  console.log("[INBOX-MANAGER] Starting inbox check cycle");

  try {
    // Get all users with inbox management enabled
    const { data: enabledUsers } = await getSupabaseClient()
      .from("inbox_settings")
      .select("user_id, autonomy_level, enabled, check_interval_minutes, monitor_inbox, delete_spam, respond_to_simple, schedule_meetings, call_for_complex, ai_signature_enabled, ai_signature_text, user_rules, max_emails_per_day, notify_urgent_immediately")
      .eq("enabled", true);

    if (!enabledUsers || enabledUsers.length === 0) {
      console.log("[INBOX-MANAGER] No users with inbox management enabled");
      return;
    }

    console.log(`[INBOX-MANAGER] Processing ${enabledUsers.length} users`);
    const now = new Date();

    for (const user of enabledUsers) {
      try {
        // Respect per-user check interval
        const intervalMinutes = user.check_interval_minutes ?? DEFAULT_USER_INTERVAL_MINUTES;
        const lastCheck = userLastChecked.get(user.user_id);
        if (lastCheck) {
          const minutesSinceLastCheck = (now.getTime() - lastCheck.getTime()) / 60000;
          if (minutesSinceLastCheck < intervalMinutes) {
            console.log(`[INBOX-MANAGER] Skipping user ${user.user_id} — checked ${Math.round(minutesSinceLastCheck)}m ago (interval: ${intervalMinutes}m)`);
            continue;
          }
        }
        userLastChecked.set(user.user_id, now);

        await processUserInbox(user.user_id, {
          autonomyLevel: user.autonomy_level,
          enabled: user.enabled,
          checkIntervalMinutes: intervalMinutes,
          settings: {
            monitorInbox: user.monitor_inbox,
            deleteSpam: user.delete_spam,
            respondToSimple: user.respond_to_simple,
            scheduleMeetings: user.schedule_meetings,
            callForComplex: user.call_for_complex,
            aiSignatureEnabled: user.ai_signature_enabled,
            aiSignatureText: user.ai_signature_text,
            userRules: user.user_rules || [],
            maxEmailsPerDay: user.max_emails_per_day,
            notifyUrgentImmediately: user.notify_urgent_immediately,
          },
          emailProvider: await detectEmailProvider(user.user_id),
          lastChecked: now,
        });
      } catch (err) {
        console.error(`[INBOX-MANAGER] Error processing user ${user.user_id}:`, err);
        // Continue with next user
      }
    }

    console.log("[INBOX-MANAGER] Completed inbox check cycle");
  } catch (err) {
    console.error("[INBOX-MANAGER] Fatal error in processAllInboxes:", err);
  }
}

/**
 * Detect which email provider a user has connected
 */
async function detectEmailProvider(userId: string): Promise<"nylas" | "imap" | "gmail_oauth" | null> {
  // Check Nylas first (preferred)
  if (await isNylasConnected(userId)) return "nylas";
  
  // Check legacy IMAP
  if (await isEmailConnected(userId)) return "imap";
  
  return null;
}

/**
 * Process a single user's inbox
 */
async function processUserInbox(userId: string, config: Omit<UserInboxConfig, "userId">): Promise<void> {
  if (!config.enabled || !config.settings.monitorInbox) return;

  // Check daily email limit
  const emailsProcessedToday = await getEmailsProcessedToday(userId);
  if (emailsProcessedToday >= config.settings.maxEmailsPerDay) {
    console.log(`[INBOX-MANAGER] User ${userId} hit daily email limit`);
    return;
  }

  // Fetch unread emails
  let messages: Array<{
    id: string;
    threadId: string;
    from: string;
    to: string | string[];
    subject: string;
    body?: string;
    snippet: string;
    date: string;
    isUnread: boolean;
  }> = [];

  if (config.emailProvider === "nylas") {
    const { getUnreadMessages: getNylasMessages } = await import("./nylas-email.js");
    messages = await getNylasMessages(userId, 20) as typeof messages;
  } else if (config.emailProvider === "imap") {
    messages = await getUnreadMessages(userId, 20) as typeof messages;
  } else {
    console.log(`[INBOX-MANAGER] User ${userId} has no email provider connected`);
    return;
  }

  if (messages.length === 0) return;

  console.log(`[INBOX-MANAGER] User ${userId}: ${messages.length} unread emails`);

  // Process each email
  for (const message of messages) {
    try {
      // Check if already processed
      const alreadyProcessed = await isEmailAlreadyProcessed(userId, message.id);
      if (alreadyProcessed) continue;

      await processEmail(userId, {...message, body: message.body || ""}, config);
    } catch (err) {
      console.error(`[INBOX-MANAGER] Error processing email ${message.id}:`, err);
    }
  }
}

/**
 * Process a single email with AI classification
 */
async function processEmail(
  userId: string,
  message: {
    id: string;
    from: string;
    subject: string;
    body: string;
    snippet: string;
  },
  config: Omit<UserInboxConfig, "userId">
): Promise<void> {
  console.log(`[INBOX-MANAGER] Processing email from ${message.from}: ${message.subject}`);

  // Step 1: Cheap classification (Gemini Flash or Groq)
  const classification = await classifyEmailCheap(message);
  console.log(`[INBOX-MANAGER] Classified as: ${classification.type} (confidence: ${classification.confidence})`);

  // Step 2: Decide action based on classification and autonomy level
  const action = determineAction(classification, config);
  console.log(`[INBOX-MANAGER] Suggested action: ${action.type}`);

  // Step 3: Execute or queue
  if (action.type === "delete" && config.settings.deleteSpam && config.autonomyLevel >= 25) {
    // Auto-delete spam
    await executeDelete(userId, message.id, config.emailProvider);
    await logProcessing(userId, "auto_deleted", { messageId: message.id, subject: message.subject });
  } else if (action.type === "respond" && config.settings.respondToSimple && config.autonomyLevel >= 50) {
    // Need to generate response - escalate to better model
    const response = await generateResponse(message, config);
    
    if (config.autonomyLevel >= 75) {
      // High autonomy - send immediately
      await executeSend(userId, message, response, config);
      await logProcessing(userId, "auto_responded", { messageId: message.id, subject: message.subject });
    } else {
      // Medium autonomy - queue for approval
      await queueForApproval(userId, message, action.type, response, classification, config);
      await logProcessing(userId, "queued_for_approval", { messageId: message.id, subject: message.subject });
    }
  } else if (action.type === "schedule" && config.settings.scheduleMeetings && config.autonomyLevel >= 50) {
    // Handle meeting scheduling
    await handleMeetingRequest(userId, message, config);
    await logProcessing(userId, "meeting_detected", { messageId: message.id, subject: message.subject });
  } else if (action.type === "complex" && config.settings.callForComplex && config.autonomyLevel >= 75) {
    // Complex email - call user
    await initiateVoiceCall(userId, message, config);
    await logProcessing(userId, "called_user", { messageId: message.id, subject: message.subject });
  } else if (classification.type === "urgent" && config.settings.notifyUrgentImmediately) {
    // Urgent email - notify immediately
    await notifyUrgent(userId, message, config);
    await logProcessing(userId, "urgent_notified", { messageId: message.id, subject: message.subject });
  } else {
    // Default: queue for approval
    await queueForApproval(userId, message, action.type, null, classification, config);
    await logProcessing(userId, "queued_default", { messageId: message.id, subject: message.subject });
  }

  // Mark as processed
  await markEmailAsProcessed(userId, message.id);
}

/**
 * Cheap email classification using Gemini Flash
 */
async function classifyEmailCheap(message: {
  from: string;
  subject: string;
  body: string;
  snippet: string;
}): Promise<{
  type: "spam" | "promotional" | "simple" | "complex" | "urgent" | "meeting" | "personal";
  confidence: number;
  reasoning: string;
}> {
  // Use Gemini Flash (free/cheapest model)
  const prompt = `Classify this email into exactly one category:
- spam: Obvious spam, phishing, unsolicited
- promotional: Newsletters, marketing, notifications
- simple: Easy to respond to (invites, thank yous, quick questions)
- meeting: Contains scheduling or calendar invites
- urgent: Time-sensitive, requires immediate attention
- complex: Requires thought, multiple questions, or decision
- personal: From friends/family

Email:
From: ${message.from}
Subject: ${message.subject}
Body: ${message.snippet || message.body.substring(0, 500)}

Respond with JSON only:
{"type": "category", "confidence": 0.0-1.0, "reasoning": "brief explanation"}`;

  try {
    // Try Gemini Flash first (free tier)
    const geminiKey = process.env.GOOGLE_API_KEY;
    if (geminiKey) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 200 },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const json = text.match(/\{[\s\S]*\}/)?.[0];
        if (json) {
          const parsed = JSON.parse(json);
          return {
            type: parsed.type || "complex",
            confidence: parsed.confidence || 0.5,
            reasoning: parsed.reasoning || "",
          };
        }
      }
    }

    // Fallback: Groq (fast, cheap)
    const groqKey = process.env.GROQ_API_KEY;
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
          max_tokens: 200,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content || "";
        const json = text.match(/\{[\s\S]*\}/)?.[0];
        if (json) {
          const parsed = JSON.parse(json);
          return {
            type: parsed.type || "complex",
            confidence: parsed.confidence || 0.5,
            reasoning: parsed.reasoning || "",
          };
        }
      }
    }
  } catch (err) {
    console.error("[INBOX-MANAGER] Classification error:", err);
  }

  // Fallback: assume complex
  return { type: "complex", confidence: 0.5, reasoning: "Classification failed" };
}

/**
 * Determine action based on classification and autonomy
 */
function determineAction(
  classification: { type: string; confidence: number },
  config: Omit<UserInboxConfig, "userId">
): { type: string; confidence: number } {
  const { autonomyLevel } = config;

  // Low confidence = always queue for approval
  if (classification.confidence < 0.7) {
    return { type: "queue", confidence: classification.confidence };
  }

  switch (classification.type) {
    case "spam":
      return autonomyLevel >= 25 
        ? { type: "delete", confidence: classification.confidence }
        : { type: "queue", confidence: classification.confidence };
    
    case "simple":
      return autonomyLevel >= 50
        ? { type: "respond", confidence: classification.confidence }
        : { type: "queue", confidence: classification.confidence };
    
    case "meeting":
      return autonomyLevel >= 50
        ? { type: "schedule", confidence: classification.confidence }
        : { type: "queue", confidence: classification.confidence };
    
    case "urgent":
      return autonomyLevel >= 75
        ? { type: "handle_urgent", confidence: classification.confidence }
        : { type: "queue", confidence: classification.confidence };
    
    case "complex":
      return autonomyLevel >= 75
        ? { type: "complex", confidence: classification.confidence }
        : { type: "queue", confidence: classification.confidence };
    
    default:
      return { type: "queue", confidence: classification.confidence };
  }
}

/**
 * Generate email response using better model (escalation)
 */
async function generateResponse(
  message: { from: string; subject: string; body: string },
  config: Omit<UserInboxConfig, "userId">
): Promise<string> {
  const prompt = `Write a professional email response to:

From: ${message.from}
Subject: ${message.subject}
Body: ${message.body}

${config.settings.userRules.length > 0 ? `Follow these rules:\n${config.settings.userRules.join("\n")}` : ""}

${config.settings.aiSignatureEnabled ? `Sign off as: ${config.settings.aiSignatureText}` : ""}

Respond naturally and concisely.`;

  // Use better model for response generation
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (deepseekKey) {
    try {
      const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${deepseekKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7,
          max_tokens: 500,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        return data.choices?.[0]?.message?.content || "I'll get back to you soon.";
      }
    } catch (err) {
      console.error("[INBOX-MANAGER] Response generation error:", err);
    }
  }

  return "Thank you for your email. I'll review this and get back to you shortly.";
}

/**
 * Execute email deletion
 */
async function executeDelete(
  userId: string,
  messageId: string,
  _provider: string | null
): Promise<void> {
  console.log(`[INBOX-MANAGER] Deleting email ${messageId} for user ${userId}`);
  const success = await deleteMessage(userId, messageId);
  if (success) {
    console.log(`[INBOX-MANAGER] Deleted email ${messageId} successfully`);
  } else {
    console.error(`[INBOX-MANAGER] Failed to delete email ${messageId} — will retry next cycle`);
  }
}

/**
 * Execute sending a response
 */
async function executeSend(
  userId: string,
  message: { from: string; subject: string },
  response: string,
  config: Omit<UserInboxConfig, "userId">
): Promise<void> {
  const to = message.from.match(/<([^>]+)>/)?.[1] || message.from;
  
  if (config.emailProvider === "nylas") {
    await sendNylasEmail(userId, to, `Re: ${message.subject}`, response);
  } else {
    await sendViaUserEmail(userId, to, `Re: ${message.subject}`, response);
  }
  
  console.log(`[INBOX-MANAGER] Sent response to ${to}`);
}

/**
 * Queue email for user approval
 */
async function queueForApproval(
  userId: string,
  message: { id: string; from: string; subject: string; body: string },
  action: string,
  suggestedResponse: string | null,
  classification: { type: string; confidence: number; reasoning: string },
  config: Omit<UserInboxConfig, "userId">
): Promise<void> {
  await getSupabaseClient().from("inbox_queue").upsert({
    user_id: userId,
    external_email_id: message.id,
    from_address: message.from,
    subject: message.subject,
    body_text: message.body.substring(0, 10000), // Truncate if too long
    received_at: new Date().toISOString(),
    classification: classification.type,
    confidence: classification.confidence,
    suggested_action: action,
    suggested_response: suggestedResponse,
    reasoning: classification.reasoning,
    status: "pending",
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hour expiry
  }, { onConflict: "user_id, external_email_id" });

  console.log(`[INBOX-MANAGER] Queued email for approval: ${message.subject}`);
}

/**
 * Handle meeting request
 */
async function handleMeetingRequest(
  userId: string,
  message: { id: string; from: string; subject: string; body: string },
  config: Omit<UserInboxConfig, "userId">
): Promise<void> {
  console.log(`[INBOX-MANAGER] Meeting request detected: ${message.subject}`);

  // Use cheap AI to extract meeting details
  let meetingDetails = "";
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
          messages: [
            {
              role: "user",
              content: `Extract meeting details from this email. Return ONLY: date, time, location/link, attendees, and purpose. If any detail is missing, say "not specified".\n\nFrom: ${message.from}\nSubject: ${message.subject}\nBody: ${message.body.substring(0, 2000)}`,
            },
          ],
          temperature: 0,
          max_tokens: 300,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        meetingDetails = data.choices?.[0]?.message?.content || "";
      }
    } catch {
      // Non-critical
    }
  }

  // Generate a suggested response
  const suggestedResponse = `Thank you for the meeting invitation regarding "${message.subject}". I'll check my calendar and confirm shortly.`;

  // Queue for user approval with extracted details
  await queueForApproval(
    userId,
    message,
    "schedule",
    suggestedResponse,
    {
      type: "meeting_request",
      confidence: 0.8,
      reasoning: meetingDetails || `Meeting request from ${message.from}: ${message.subject}`,
    },
    config
  );
}

/**
 * Initiate voice call for complex decisions
 */
async function initiateVoiceCall(
  userId: string,
  message: { id: string; from: string; subject: string; body: string },
  config: Omit<UserInboxConfig, "userId">
): Promise<void> {
  console.log(`[INBOX-MANAGER] Initiating voice call for user ${userId}`);
  
  // Get queue ID for this email
  const { data: queueItem } = await getSupabaseClient()
    .from("inbox_queue")
    .select("id")
    .eq("user_id", userId)
    .eq("external_email_id", message.id)
    .single();

  // Use natural voice conversation
  const { initiateEmailConversation } = await import("./twilio.js");
  await initiateEmailConversation(userId, {
    from: message.from,
    subject: message.subject,
    body: message.body,
    queueId: queueItem?.id || "",
  });
}

/**
 * Notify user of urgent email
 */
async function notifyUrgent(
  userId: string,
  message: { from: string; subject: string },
  config: Omit<UserInboxConfig, "userId">
): Promise<void> {
  // Send SMS or email notification
  const { data: profile } = await getSupabaseClient()
    .from("profiles")
    .select("email, phone_number")
    .eq("id", userId)
    .single();

  if (profile?.email) {
    await sendResponse({
      to: profile.email,
      from: "urgent@aevoy.com",
      subject: `🚨 Urgent: ${message.subject}`,
      body: `You received an urgent email from ${message.from} that requires immediate attention.\n\nSubject: ${message.subject}\n\nCheck your inbox queue to review.`,
    });
  }
}

// Helper functions
async function getEmailsProcessedToday(userId: string): Promise<number> {
  const { data } = await getSupabaseClient()
    .from("inbox_processing_log")
    .select("id", { count: "exact" })
    .eq("user_id", userId)
    .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  
  return data?.length || 0;
}

async function isEmailAlreadyProcessed(userId: string, messageId: string): Promise<boolean> {
  const { data } = await getSupabaseClient()
    .from("inbox_queue")
    .select("id")
    .eq("user_id", userId)
    .eq("external_email_id", messageId)
    .limit(1);
  
  return !!(data && data.length > 0);
}

async function markEmailAsProcessed(userId: string, messageId: string): Promise<void> {
  // Already tracked in inbox_queue
}

async function logProcessing(
  userId: string,
  action: string,
  details: Record<string, unknown>
): Promise<void> {
  await getSupabaseClient().from("inbox_processing_log").insert({
    user_id: userId,
    action,
    details,
  });
}
