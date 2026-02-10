/**
 * Nylas Email Service
 *
 * Provides one-click email integration using Nylas hosted OAuth.
 * No Google Cloud Console approval needed - Nylas has pre-approved apps!
 *
 * Free tier: 5 connected accounts (perfect for beta launch)
 * Paid: ~$99/mo for up to 100 accounts
 *
 * Supported providers: Google (Gmail), Microsoft (Outlook), Yahoo, IMAP
 */

import { getSupabaseClient } from "../utils/supabase.js";

const NYLAS_API_KEY = process.env.NYLAS_API_KEY;
const NYLAS_API_URL = "https://api.us.nylas.com/v3";

interface NylasNylasEmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string[];
  subject: string;
  body: string;
  snippet: string;
  date: string;
  isUnread: boolean;
  attachments: Array<{
    id: string;
    filename: string;
    contentType: string;
    size: number;
  }>;
}

/**
 * Get Nylas grant ID for a user
 */
async function getNylasGrantId(userId: string): Promise<string | null> {
  const { data: conn } = await getSupabaseClient()
    .from("oauth_connections")
    .select("access_token_encrypted") // Stores the grant ID
    .eq("user_id", userId)
    .eq("provider", "nylas")
    .eq("status", "active")
    .single();

  return conn?.access_token_encrypted || null;
}

/**
 * Check if user has Nylas email connected
 */
export async function isNylasConnected(userId: string): Promise<boolean> {
  const grantId = await getNylasGrantId(userId);
  return !!grantId;
}

/**
 * Get unread messages via Nylas
 */
export async function getUnreadMessages(
  userId: string,
  maxResults: number = 10
): Promise<NylasEmailMessage[]> {
  const grantId = await getNylasGrantId(userId);
  if (!grantId || !NYLAS_API_KEY) return [];

  try {
    // Query for unread messages
    const query = encodeURIComponent("is:unread");
    const res = await fetch(
      `${NYLAS_API_URL}/grants/${grantId}/messages?limit=${maxResults}&q=${query}`,
      {
        headers: {
          "Authorization": `Bearer ${NYLAS_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!res.ok) {
      const error = await res.text();
      console.error("[NYLAS] Failed to fetch messages:", error);
      return [];
    }

    const data = await res.json();
    const messages: Array<{
      id: string;
      thread_id: string;
      from?: Array<{ email: string; name?: string }>;
      to?: Array<{ email: string; name?: string }>;
      subject?: string;
      body?: string;
      snippet?: string;
      date?: number;
      unread?: boolean;
      attachments?: Array<{ id: string; filename: string; content_type: string; size: number }>;
    }> = data.data || [];

    return messages.map((msg) => ({
      id: msg.id,
      threadId: msg.thread_id,
      from: msg.from?.[0]
        ? `${msg.from[0].name || ""} <${msg.from[0].email}>`.trim()
        : "Unknown",
      to: msg.to?.map((t) => t.email) || [],
      subject: msg.subject || "(no subject)",
      body: msg.body || "",
      snippet: msg.snippet || "",
      date: msg.date ? new Date(msg.date * 1000).toISOString() : new Date().toISOString(),
      isUnread: msg.unread ?? true,
      attachments: msg.attachments?.map((a) => ({
        id: a.id,
        filename: a.filename,
        contentType: a.content_type,
        size: a.size,
      })) || [],
    }));
  } catch (err) {
    console.error("[NYLAS] Error fetching messages:", err);
    return [];
  }
}

/**
 * Get inbox summary for a user
 */
export async function getInboxSummary(
  userId: string
): Promise<{
  connected: boolean;
  email: string | null;
  provider: string;
  unreadCount: number;
  topSenders: string[];
  recentSubjects: string[];
} | null> {
  // Check connection
  const { data: conn } = await getSupabaseClient()
    .from("oauth_connections")
    .select("account_email, provider_subtype")
    .eq("user_id", userId)
    .eq("provider", "nylas")
    .eq("status", "active")
    .single();

  if (!conn) return null;

  const messages = await getUnreadMessages(userId, 20);

  // Count senders
  const senderCounts = new Map<string, number>();
  for (const msg of messages) {
    const sender = msg.from.replace(/<.*>/, "").trim();
    senderCounts.set(sender, (senderCounts.get(sender) || 0) + 1);
  }

  const topSenders = [...senderCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([sender]) => sender);

  return {
    connected: true,
    email: conn.account_email,
    provider: conn.provider_subtype || "email",
    unreadCount: messages.length,
    topSenders,
    recentSubjects: messages.slice(0, 5).map((m) => m.subject),
  };
}

/**
 * Send email via Nylas
 */
export async function sendEmail(
  userId: string,
  to: string | string[],
  subject: string,
  body: string,
  options?: {
    replyToMessageId?: string;
    attachments?: Array<{
      filename: string;
      content: Buffer | string;
      contentType?: string;
    }>;
  }
): Promise<boolean> {
  const grantId = await getNylasGrantId(userId);
  if (!grantId || !NYLAS_API_KEY) return false;

  const toAddresses = Array.isArray(to) ? to : [to];

  try {
    const emailData: {
      to: Array<{ email: string }>;
      subject: string;
      body: string;
      reply_to_message_id?: string;
    } = {
      to: toAddresses.map((email) => ({ email })),
      subject,
      body,
    };

    if (options?.replyToMessageId) {
      emailData.reply_to_message_id = options.replyToMessageId;
    }

    const res = await fetch(
      `${NYLAS_API_URL}/grants/${grantId}/messages/send`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${NYLAS_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(emailData),
      }
    );

    if (!res.ok) {
      const error = await res.text();
      console.error("[NYLAS] Failed to send email:", error);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[NYLAS] Error sending email:", err);
    return false;
  }
}

/**
 * Mark message as read
 */
export async function markAsRead(userId: string, messageId: string): Promise<boolean> {
  const grantId = await getNylasGrantId(userId);
  if (!grantId || !NYLAS_API_KEY) return false;

  try {
    const res = await fetch(
      `${NYLAS_API_URL}/grants/${grantId}/messages/${messageId}`,
      {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${NYLAS_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ unread: false }),
      }
    );

    return res.ok;
  } catch (err) {
    console.error("[NYLAS] Error marking as read:", err);
    return false;
  }
}

/**
 * Get full message with body
 */
export async function getMessage(
  userId: string,
  messageId: string
): Promise<NylasEmailMessage | null> {
  const grantId = await getNylasGrantId(userId);
  if (!grantId || !NYLAS_API_KEY) return null;

  try {
    const res = await fetch(
      `${NYLAS_API_URL}/grants/${grantId}/messages/${messageId}`,
      {
        headers: {
          "Authorization": `Bearer ${NYLAS_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!res.ok) return null;

    const msg = await res.json();

    return {
      id: msg.data.id,
      threadId: msg.data.thread_id,
      from: msg.data.from?.[0]
        ? `${msg.data.from[0].name || ""} <${msg.data.from[0].email}>`.trim()
        : "Unknown",
      to: msg.data.to?.map((t: { email: string }) => t.email) || [],
      subject: msg.data.subject || "(no subject)",
      body: msg.data.body || "",
      snippet: msg.data.snippet || "",
      date: msg.data.date
        ? new Date(msg.data.date * 1000).toISOString()
        : new Date().toISOString(),
      isUnread: msg.data.unread ?? true,
      attachments: msg.data.attachments?.map((a: { id: string; filename: string; content_type: string; size: number }) => ({
        id: a.id,
        filename: a.filename,
        contentType: a.content_type,
        size: a.size,
      })) || [],
    };
  } catch (err) {
    console.error("[NYLAS] Error fetching message:", err);
    return null;
  }
}

/**
 * Get calendar events (bonus feature with Nylas)
 */
export async function getCalendarEvents(
  userId: string,
  startDate: Date,
  endDate: Date,
  maxResults: number = 10
): Promise<Array<{
  id: string;
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  location?: string;
  attendees: string[];
}>> {
  const grantId = await getNylasGrantId(userId);
  if (!grantId || !NYLAS_API_KEY) return [];

  try {
    const startTimestamp = Math.floor(startDate.getTime() / 1000);
    const endTimestamp = Math.floor(endDate.getTime() / 1000);

    const res = await fetch(
      `${NYLAS_API_URL}/grants/${grantId}/events?limit=${maxResults}&start=${startTimestamp}&end=${endTimestamp}`,
      {
        headers: {
          "Authorization": `Bearer ${NYLAS_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!res.ok) {
      console.error("[NYLAS] Failed to fetch events:", await res.text());
      return [];
    }

    const data = await res.json();
    const events: Array<{
      id: string;
      title?: string;
      description?: string;
      when?: { start_time?: number; end_time?: number };
      location?: string;
      participants?: Array<{ email: string }>;
    }> = data.data || [];

    return events.map((e) => ({
      id: e.id,
      title: e.title || "(no title)",
      description: e.description,
      startTime: e.when?.start_time
        ? new Date(e.when.start_time * 1000).toISOString()
        : "",
      endTime: e.when?.end_time
        ? new Date(e.when.end_time * 1000).toISOString()
        : "",
      location: e.location,
      attendees: e.participants?.map((p) => p.email) || [],
    }));
  } catch (err) {
    console.error("[NYLAS] Error fetching events:", err);
    return [];
  }
}

// Backward-compatible exports
export const sendViaNylas = sendEmail;
