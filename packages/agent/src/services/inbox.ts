/**
 * Inbox Management Service
 *
 * Connects to user email via IMAP + App Password (preferred) or Gmail OAuth (fallback).
 * IMAP works with Gmail, Outlook, Yahoo, iCloud — no Google Cloud Console needed.
 *
 * User setup: enter email + app password → auto-detect provider → done.
 */

import { getSupabaseClient } from "../utils/supabase.js";

// ---- Provider Auto-Detection ----

interface EmailProvider {
  name: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  appPasswordUrl: string;
  steps: string;
}

const PROVIDERS: Record<string, EmailProvider> = {
  "gmail.com": {
    name: "Gmail",
    imap_host: "imap.gmail.com",
    imap_port: 993,
    smtp_host: "smtp.gmail.com",
    smtp_port: 465,
    smtp_secure: true,
    appPasswordUrl: "https://myaccount.google.com/apppasswords",
    steps: "Enable 2-Step Verification, then generate an App Password",
  },
  "googlemail.com": {
    name: "Gmail",
    imap_host: "imap.gmail.com",
    imap_port: 993,
    smtp_host: "smtp.gmail.com",
    smtp_port: 465,
    smtp_secure: true,
    appPasswordUrl: "https://myaccount.google.com/apppasswords",
    steps: "Enable 2-Step Verification, then generate an App Password",
  },
  "outlook.com": {
    name: "Outlook",
    imap_host: "outlook.office365.com",
    imap_port: 993,
    smtp_host: "smtp-mail.outlook.com",
    smtp_port: 587,
    smtp_secure: false,
    appPasswordUrl: "https://account.live.com/proofs/AppPassword",
    steps: "Go to Security settings, then create an App Password",
  },
  "hotmail.com": {
    name: "Outlook",
    imap_host: "outlook.office365.com",
    imap_port: 993,
    smtp_host: "smtp-mail.outlook.com",
    smtp_port: 587,
    smtp_secure: false,
    appPasswordUrl: "https://account.live.com/proofs/AppPassword",
    steps: "Go to Security settings, then create an App Password",
  },
  "live.com": {
    name: "Outlook",
    imap_host: "outlook.office365.com",
    imap_port: 993,
    smtp_host: "smtp-mail.outlook.com",
    smtp_port: 587,
    smtp_secure: false,
    appPasswordUrl: "https://account.live.com/proofs/AppPassword",
    steps: "Go to Security settings, then create an App Password",
  },
  "yahoo.com": {
    name: "Yahoo",
    imap_host: "imap.mail.yahoo.com",
    imap_port: 993,
    smtp_host: "smtp.mail.yahoo.com",
    smtp_port: 465,
    smtp_secure: true,
    appPasswordUrl:
      "https://login.yahoo.com/account/security/app-passwords",
    steps: "Go to Account Security, then generate an App Password",
  },
  "icloud.com": {
    name: "iCloud",
    imap_host: "imap.mail.me.com",
    imap_port: 993,
    smtp_host: "smtp.mail.me.com",
    smtp_port: 587,
    smtp_secure: false,
    appPasswordUrl:
      "https://appleid.apple.com/account/manage/section/security",
    steps: "Go to Sign-In and Security, then create an App-Specific Password",
  },
  "me.com": {
    name: "iCloud",
    imap_host: "imap.mail.me.com",
    imap_port: 993,
    smtp_host: "smtp.mail.me.com",
    smtp_port: 587,
    smtp_secure: false,
    appPasswordUrl:
      "https://appleid.apple.com/account/manage/section/security",
    steps: "Go to Sign-In and Security, then create an App-Specific Password",
  },
};

export function detectProvider(email: string): EmailProvider | null {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;
  return PROVIDERS[domain] || null;
}

// ---- Credential Types ----

interface ImapCredentials {
  email: string;
  password: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  provider: string;
}

interface GmailOAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  gmail_address: string;
}

interface NylasCredentials {
  grantId: string;
  email: string;
  provider: string;
}

type EmailCredentials =
  | { type: "imap"; creds: ImapCredentials }
  | { type: "gmail_oauth"; creds: GmailOAuthTokens }
  | { type: "nylas"; creds: NylasCredentials };

// ---- Message Type ----

interface EmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  date: string;
  isUnread: boolean;
}

// ---- Credential Retrieval ----

export async function getEmailCredentials(
  userId: string
): Promise<EmailCredentials | null> {
  const supabase = getSupabaseClient();
  const uid = userId.slice(0, 8);

  // Try Nylas first (one-click OAuth, no app passwords needed)
  const { data: nylasConn } = await supabase
    .from("oauth_connections")
    .select("access_token_encrypted, account_email, provider_subtype")
    .eq("user_id", userId)
    .eq("provider", "nylas")
    .eq("status", "active")
    .single();

  if (nylasConn?.access_token_encrypted) {
    console.log(`[INBOX] ${uid} — found Nylas credentials (${nylasConn.account_email})`);
    return {
      type: "nylas",
      creds: {
        grantId: nylasConn.access_token_encrypted,
        email: nylasConn.account_email,
        provider: nylasConn.provider_subtype || "email",
      },
    } as unknown as EmailCredentials;
  }

  // Fallback: IMAP + App Password
  const { data: imapCred } = await supabase
    .from("user_credentials")
    .select("encrypted_data")
    .eq("user_id", userId)
    .eq("site_domain", "email_imap")
    .single();

  if (imapCred) {
    try {
      const parsed = JSON.parse(imapCred.encrypted_data);
      if (parsed.email && parsed.password) {
        console.log(`[INBOX] ${uid} — found IMAP credentials (${parsed.email}, host: ${parsed.imap_host})`);
        return { type: "imap", creds: parsed as ImapCredentials };
      }
      console.log(`[INBOX] ${uid} — IMAP credential found but missing email/password fields`);
    } catch (e) {
      console.error(`[INBOX] ${uid} — failed to parse IMAP encrypted_data:`, e);
    }
  }

  // Legacy: Gmail OAuth (for users who connected before)
  const { data: oauthCred } = await supabase
    .from("user_credentials")
    .select("encrypted_data")
    .eq("user_id", userId)
    .eq("site_domain", "gmail.googleapis.com")
    .single();

  if (oauthCred) {
    try {
      const parsed = JSON.parse(oauthCred.encrypted_data);
      if (parsed.access_token) {
        console.log(`[INBOX] ${uid} — found Gmail OAuth credentials (${parsed.gmail_address})`);
        return { type: "gmail_oauth", creds: parsed as GmailOAuthTokens };
      }
    } catch (e) {
      console.error(`[INBOX] ${uid} — failed to parse Gmail OAuth encrypted_data:`, e);
    }
  }

  console.log(`[INBOX] ${uid} — no email credentials found (checked Nylas, IMAP, Gmail OAuth)`);
  return null;
}

// ---- IMAP Operations ----

async function getUnreadViaImap(
  creds: ImapCredentials,
  maxResults: number
): Promise<EmailMessage[]> {
  const { ImapFlow } = await import("imapflow");

  const client = new ImapFlow({
    host: creds.imap_host,
    port: creds.imap_port,
    secure: true,
    auth: { user: creds.email, pass: creds.password },
    logger: false,
    connectionTimeout: 10_000,
    greetingTimeout: 5_000,
  });

  const messages: EmailMessage[] = [];

  // Wrap IMAP operations in a timeout to prevent hanging
  const timeoutMs = 15_000;
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`IMAP operation timed out after ${timeoutMs / 1000}s`)), timeoutMs)
  );

  try {
    await Promise.race([client.connect(), timeoutPromise]);
    const lock = await client.getMailboxLock("INBOX");

    try {
      const searchResult = await client.search({ seen: false });
      if (!searchResult || searchResult.length === 0) {
        lock.release();
        await client.logout();
        return [];
      }

      const seqNums = searchResult.slice(-maxResults);

      for await (const msg of client.fetch(seqNums, {
        envelope: true,
        uid: true,
        bodyStructure: true,
        source: { maxLength: 4096 }, // Fetch first 4KB of raw message for snippet extraction
      })) {
        const env = msg.envelope;
        if (!env) continue;

        // Extract text snippet from raw message source
        let snippet = "";
        if (msg.source) {
          try {
            const rawText = msg.source.toString("utf-8");
            // Find the plain text body after headers (double newline separates headers from body)
            const bodyStart = rawText.indexOf("\r\n\r\n");
            if (bodyStart > -1) {
              let bodyText = rawText.substring(bodyStart + 4);
              // Strip HTML tags if present
              bodyText = bodyText.replace(/<[^>]*>/g, " ");
              // Decode common MIME encoding artifacts
              bodyText = bodyText.replace(/=\r?\n/g, ""); // quoted-printable soft line breaks
              bodyText = bodyText.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
                String.fromCharCode(parseInt(hex, 16))
              );
              // Clean up whitespace
              snippet = bodyText.replace(/\s+/g, " ").trim().substring(0, 500);
            }
          } catch {
            // Non-critical — snippet stays empty
          }
        }

        messages.push({
          id: String(msg.uid),
          threadId: env.messageId || String(msg.uid),
          from: env.from?.[0]
            ? `${env.from[0].name || ""} <${env.from[0].address || ""}>`
            : "Unknown",
          to: env.to?.[0]
            ? `${env.to[0].name || ""} <${env.to[0].address || ""}>`
            : "",
          subject: env.subject || "(no subject)",
          snippet,
          date: env.date?.toISOString() || new Date().toISOString(),
          isUnread: true,
        });
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err) {
    console.error(`[INBOX] IMAP fetch error (host: ${creds.imap_host}, user: ${creds.email}):`, err);
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
    // Re-throw so callers get a proper error instead of empty results
    throw err;
  }

  return messages;
}

/**
 * Fetch ALL recent emails (read + unread) via IMAP.
 * Used for search/filter queries where the target email might already be read.
 */
async function getRecentViaImap(
  creds: ImapCredentials,
  maxResults: number,
  sinceDays: number = 7
): Promise<EmailMessage[]> {
  const { ImapFlow } = await import("imapflow");

  const client = new ImapFlow({
    host: creds.imap_host,
    port: creds.imap_port,
    secure: true,
    auth: { user: creds.email, pass: creds.password },
    logger: false,
    connectionTimeout: 10_000,
    greetingTimeout: 5_000,
  });

  const messages: EmailMessage[] = [];
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - sinceDays);

  const timeoutMs = 15_000;
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`IMAP operation timed out after ${timeoutMs / 1000}s`)), timeoutMs)
  );

  try {
    await Promise.race([client.connect(), timeoutPromise]);
    const lock = await client.getMailboxLock("INBOX");

    try {
      // Search ALL emails since date (not just unseen)
      const searchResult = await client.search({ since: sinceDate });
      if (!searchResult || searchResult.length === 0) {
        lock.release();
        await client.logout();
        return [];
      }

      // Take the most recent N
      const seqNums = searchResult.slice(-maxResults);

      for await (const msg of client.fetch(seqNums, {
        envelope: true,
        uid: true,
        flags: true,
        source: { maxLength: 4096 },
      })) {
        const env = msg.envelope;
        if (!env) continue;

        let snippet = "";
        if (msg.source) {
          try {
            const rawText = msg.source.toString("utf-8");
            const bodyStart = rawText.indexOf("\r\n\r\n");
            if (bodyStart > -1) {
              let bodyText = rawText.substring(bodyStart + 4);
              bodyText = bodyText.replace(/<[^>]*>/g, " ");
              bodyText = bodyText.replace(/=\r?\n/g, "");
              bodyText = bodyText.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
                String.fromCharCode(parseInt(hex, 16))
              );
              snippet = bodyText.replace(/\s+/g, " ").trim().substring(0, 500);
            }
          } catch { /* Non-critical */ }
        }

        const flags = msg.flags ? Array.from(msg.flags) : [];
        messages.push({
          id: String(msg.uid),
          threadId: env.messageId || String(msg.uid),
          from: env.from?.[0]
            ? `${env.from[0].name || ""} <${env.from[0].address || ""}>`
            : "Unknown",
          to: env.to?.[0]
            ? `${env.to[0].name || ""} <${env.to[0].address || ""}>`
            : "",
          subject: env.subject || "(no subject)",
          snippet,
          date: env.date?.toISOString() || new Date().toISOString(),
          isUnread: !flags.includes("\\Seen"),
        });
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err) {
    console.error(`[INBOX] IMAP recent-fetch error:`, err);
    try { await client.logout(); } catch { /* ignore */ }
    throw err;
  }

  return messages;
}

async function markAsReadViaImap(
  creds: ImapCredentials,
  messageUid: string
): Promise<boolean> {
  const { ImapFlow } = await import("imapflow");

  const client = new ImapFlow({
    host: creds.imap_host,
    port: creds.imap_port,
    secure: true,
    auth: { user: creds.email, pass: creds.password },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      await client.messageFlagsAdd(messageUid, ["\\Seen"], { uid: true });
    } finally {
      lock.release();
    }

    await client.logout();
    return true;
  } catch (err) {
    console.error("[INBOX] IMAP mark-read error:", err);
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
    return false;
  }
}

async function deleteViaImap(
  creds: ImapCredentials,
  messageUid: string
): Promise<boolean> {
  const { ImapFlow } = await import("imapflow");

  const client = new ImapFlow({
    host: creds.imap_host,
    port: creds.imap_port,
    secure: true,
    auth: { user: creds.email, pass: creds.password },
    logger: false,
    connectionTimeout: 10_000,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      // Flag as Deleted, then expunge — standard IMAP delete
      await client.messageFlagsAdd(messageUid, ["\\Deleted"], { uid: true });
      await client.messageDelete(messageUid, { uid: true });
    } finally {
      lock.release();
    }

    await client.logout();
    return true;
  } catch (err) {
    console.error("[INBOX] IMAP delete error:", err);
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
    return false;
  }
}

async function sendViaSmtp(
  creds: ImapCredentials,
  to: string,
  subject: string,
  body: string
): Promise<boolean> {
  const nodemailer = await import("nodemailer");

  const transporter = nodemailer.default.createTransport({
    host: creds.smtp_host,
    port: creds.smtp_port,
    secure: creds.smtp_secure,
    auth: { user: creds.email, pass: creds.password },
  });

  try {
    await transporter.sendMail({ from: creds.email, to, subject, text: body });
    return true;
  } catch (err) {
    console.error("[INBOX] SMTP send error:", err);
    return false;
  }
}

// ---- Gmail OAuth Operations (fallback for existing users) ----

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

async function refreshGmailToken(
  refreshToken: string
): Promise<{ access_token: string; expires_in: number } | null> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return null;

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function ensureValidGmailToken(
  creds: GmailOAuthTokens,
  userId: string
): Promise<string | null> {
  if (Date.now() < creds.expires_at - 300_000) {
    return creds.access_token;
  }

  const refreshed = await refreshGmailToken(creds.refresh_token);
  if (!refreshed) return null;

  creds.access_token = refreshed.access_token;
  creds.expires_at = Date.now() + refreshed.expires_in * 1000;

  await getSupabaseClient()
    .from("user_credentials")
    .update({
      encrypted_data: JSON.stringify(creds),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("site_domain", "gmail.googleapis.com");

  return creds.access_token;
}

async function getUnreadViaGmailApi(
  creds: GmailOAuthTokens,
  userId: string,
  maxResults: number
): Promise<EmailMessage[]> {
  const token = await ensureValidGmailToken(creds, userId);
  if (!token) return [];

  try {
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread&maxResults=${maxResults}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!listRes.ok) return [];

    const listData = await listRes.json();
    const messageIds: Array<{ id: string }> = listData.messages || [];
    if (messageIds.length === 0) return [];

    const messages: EmailMessage[] = [];
    for (const { id } of messageIds.slice(0, maxResults)) {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!msgRes.ok) continue;

      const msg = await msgRes.json();
      const headers = msg.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find(
          (h: { name: string; value: string }) =>
            h.name.toLowerCase() === name.toLowerCase()
        )?.value || "";

      messages.push({
        id: msg.id,
        threadId: msg.threadId,
        from: getHeader("From"),
        to: getHeader("To"),
        subject: getHeader("Subject"),
        snippet: msg.snippet || "",
        date: getHeader("Date"),
        isUnread: msg.labelIds?.includes("UNREAD") ?? true,
      });
    }

    return messages;
  } catch (err) {
    console.error("[INBOX] Gmail API error:", err);
    return [];
  }
}

// ---- Public API ----

export async function getUnreadMessages(
  userId: string,
  maxResults: number = 10
): Promise<EmailMessage[]> {
  const creds = await getEmailCredentials(userId);
  if (!creds) return [];

  if (creds.type === "nylas") {
    // Use Nylas service (dynamically import to avoid circular deps)
    const { getUnreadMessages: getNylasUnread } = await import("./nylas-email.js");
    return getNylasUnread(userId, maxResults) as unknown as EmailMessage[];
  }

  if (creds.type === "imap") {
    return getUnreadViaImap(creds.creds, maxResults);
  }
  return getUnreadViaGmailApi(creds.creds, userId, maxResults);
}

/**
 * Get ALL recent emails (read + unread) for search/filter queries.
 * Use this when the user asks about a specific email that might already be read.
 */
export async function getRecentMessages(
  userId: string,
  maxResults: number = 20,
  sinceDays: number = 7
): Promise<EmailMessage[]> {
  const creds = await getEmailCredentials(userId);
  if (!creds) return [];

  if (creds.type === "imap") {
    return getRecentViaImap(creds.creds, maxResults, sinceDays);
  }

  // For Nylas/Gmail OAuth, fall back to unread (TODO: add recent-all support)
  if (creds.type === "nylas") {
    const { getUnreadMessages: getNylasUnread } = await import("./nylas-email.js");
    return getNylasUnread(userId, maxResults) as unknown as EmailMessage[];
  }
  return getUnreadViaGmailApi(creds.creds, userId, maxResults);
}

export async function getInboxSummary(
  userId: string
): Promise<{
  connected: boolean;
  email: string;
  method: "imap" | "oauth" | "nylas";
  provider: string;
  unreadCount: number;
  topSenders: string[];
  recentSubjects: string[];
} | null> {
  const creds = await getEmailCredentials(userId);
  if (!creds) return null;

  const messages = await getUnreadMessages(userId, 20);

  const senderCounts = new Map<string, number>();
  for (const msg of messages) {
    const sender = msg.from.replace(/<.*>/, "").trim();
    senderCounts.set(sender, (senderCounts.get(sender) || 0) + 1);
  }

  const topSenders = [...senderCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([sender]) => sender);

  // Determine email and provider based on connection type
  let email: string;
  let provider: string;
  let method: "imap" | "oauth" | "nylas";

  if (creds.type === "nylas") {
    email = creds.creds.email;
    provider = creds.creds.provider;
    method = "nylas";
  } else if (creds.type === "imap") {
    email = creds.creds.email;
    provider = creds.creds.provider;
    method = "imap";
  } else {
    email = creds.creds.gmail_address;
    provider = "Gmail";
    method = "oauth";
  }

  return {
    connected: true,
    email,
    method,
    provider,
    unreadCount: messages.length,
    topSenders,
    recentSubjects: messages.slice(0, 5).map((m) => m.subject),
  };
}

export async function sendViaUserEmail(
  userId: string,
  to: string,
  subject: string,
  body: string
): Promise<boolean> {
  const creds = await getEmailCredentials(userId);
  if (!creds) return false;

  if (creds.type === "nylas") {
    const { sendEmail: sendNylasEmail } = await import("./nylas-email.js");
    return sendNylasEmail(userId, to, subject, body);
  }

  if (creds.type === "imap") {
    return sendViaSmtp(creds.creds, to, subject, body);
  }

  const token = await ensureValidGmailToken(creds.creds, userId);
  if (!token) return false;

  const email = [
    `From: ${creds.creds.gmail_address}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=utf-8`,
    "",
    body,
  ].join("\r\n");

  const encodedEmail = Buffer.from(email)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  try {
    const res = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw: encodedEmail }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function markAsRead(
  userId: string,
  messageId: string
): Promise<boolean> {
  const creds = await getEmailCredentials(userId);
  if (!creds) return false;

  if (creds.type === "nylas") {
    const { markAsRead: markNylasRead } = await import("./nylas-email.js");
    return markNylasRead(userId, messageId);
  }

  if (creds.type === "imap") {
    return markAsReadViaImap(creds.creds, messageId);
  }

  const token = await ensureValidGmailToken(creds.creds, userId);
  if (!token) return false;

  try {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteMessage(
  userId: string,
  messageId: string
): Promise<boolean> {
  const creds = await getEmailCredentials(userId);
  if (!creds) return false;

  if (creds.type === "nylas") {
    // Nylas delete not yet implemented — skip silently
    console.log(`[INBOX] Nylas delete not implemented — skipping ${messageId}`);
    return false;
  }

  if (creds.type === "imap") {
    return deleteViaImap(creds.creds, messageId);
  }

  // Gmail OAuth — move to trash
  const token = await ensureValidGmailToken(creds.creds, userId);
  if (!token) return false;

  try {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/trash`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function isEmailConnected(userId: string): Promise<boolean> {
  const creds = await getEmailCredentials(userId);
  return !!creds;
}

/**
 * Test IMAP connection with provided credentials.
 */
export async function testImapConnection(
  email: string,
  password: string,
  host: string,
  port: number
): Promise<{ success: boolean; error?: string }> {
  const { ImapFlow } = await import("imapflow");

  const client = new ImapFlow({
    host,
    port,
    secure: true,
    auth: { user: email, pass: password },
    logger: false,
    connectionTimeout: 10_000,
    greetingTimeout: 5_000,
  });

  try {
    await client.connect();
    await client.logout();
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Connection failed";
    return { success: false, error: message };
  }
}

// Backward-compatible exports
export const sendViaGmail = sendViaUserEmail;
export const isGmailConnected = isEmailConnected;
