/**
 * Inbox Poller Service
 *
 * Replaces Cloudflare Email Routing by polling a central agent inbox via IMAP.
 * Emails forwarded from *@aevoy.com (via Porkbun email forwarding) arrive here.
 *
 * Flow:
 *  1. Porkbun forwards *@aevoy.com → AGENT_INBOX_EMAIL (Gmail)
 *  2. This poller checks that inbox every 30s via IMAP
 *  3. Parses each unread email: extracts username from To, detects type
 *  4. Routes directly to processor functions (no HTTP round-trip)
 *  5. Marks email as read
 *
 * Env vars:
 *  - AGENT_INBOX_EMAIL     — e.g. aevoy.tasks@gmail.com
 *  - AGENT_INBOX_PASSWORD  — Gmail App Password (16 chars, no spaces)
 *  - AGENT_INBOX_POLL_MS   — poll interval in ms (default 30000)
 */

import { getSupabaseClient, acquireDistributedLock, releaseDistributedLock } from "../utils/supabase.js";
import {
  processIncomingTask,
  handleConfirmationReply,
  handleVerificationCodeReply,
} from "./task-router.js";
import { maskEmail } from "../utils/logging.js";
import { logger } from '../utils/logger.js';
import { isEmailBlocked } from "./email.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EmailType =
  | "confirmation_reply"
  | "verification_reply"
  | "magic_link"
  | "new_task";

interface ParsedInboxEmail {
  uid: string;
  messageId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  date: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const INBOX_EMAIL = process.env.AGENT_INBOX_EMAIL || "";
const INBOX_PASSWORD = process.env.AGENT_INBOX_PASSWORD || "";
const INBOX_HOST = process.env.AGENT_INBOX_IMAP_HOST || "imap.gmail.com";
const INBOX_PORT = parseInt(process.env.AGENT_INBOX_IMAP_PORT || "993", 10);
const POLL_INTERVAL = parseInt(process.env.AGENT_INBOX_POLL_MS || "30000", 10);

let pollerInterval: ReturnType<typeof setInterval> | null = null;
let isPolling = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startInboxPoller(): void {
  if (!INBOX_EMAIL || !INBOX_PASSWORD) {
    logger.info(
      "[INBOX-POLLER] Skipping — AGENT_INBOX_EMAIL / AGENT_INBOX_PASSWORD not configured"
    );
    return;
  }

  if (pollerInterval) {
    logger.info("[INBOX-POLLER] Already running");
    return;
  }

  logger.info(
    `[INBOX-POLLER] Starting — polling ${maskEmail(INBOX_EMAIL)} every ${POLL_INTERVAL / 1000}s`
  );

  // Run immediately, then on interval
  pollInbox().catch((err) =>
    logger.error("[INBOX-POLLER] Initial poll error:", err)
  );

  pollerInterval = setInterval(() => {
    pollInbox().catch((err) =>
      logger.error("[INBOX-POLLER] Poll error:", err)
    );
  }, POLL_INTERVAL);
}

export function stopInboxPoller(): void {
  if (pollerInterval) {
    clearInterval(pollerInterval);
    pollerInterval = null;
  }
  logger.info("[INBOX-POLLER] Stopped");
}

// ---------------------------------------------------------------------------
// Core polling loop
// ---------------------------------------------------------------------------

async function pollInbox(): Promise<void> {
  if (isPolling) return; // prevent overlapping polls
  isPolling = true;

  // Distributed lock — only one instance polls at a time
  // Was: POLL_INTERVAL + 10_000 (40s total — too short for slow IMAP)
  // Now: POLL_INTERVAL + 120_000 (150s total — handles slow connections)
  const lockAcquired = await acquireDistributedLock("inbox_poller", POLL_INTERVAL + 120_000);
  if (!lockAcquired) {
    isPolling = false;
    return; // Another instance is polling
  }

  try {
    const { ImapFlow } = await import("imapflow");

    const client = new ImapFlow({
      host: INBOX_HOST,
      port: INBOX_PORT,
      secure: true,
      auth: { user: INBOX_EMAIL, pass: INBOX_PASSWORD },
      logger: false,
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
    });

    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      // Find unread messages
      const uids = await client.search({ seen: false });
      if (!uids || uids.length === 0) {
        lock.release();
        await client.logout();
        return;
      }

      logger.info(`[INBOX-POLLER] Found ${uids.length} unread email(s)`);

      // Process up to 20 per cycle to avoid blocking
      const MAX_EMAILS_PER_POLL = 20;
      const batch = uids.slice(-MAX_EMAILS_PER_POLL);
      let emailsProcessed = 0;

      for (const uid of batch) {
        if (emailsProcessed >= MAX_EMAILS_PER_POLL) {
          logger.info(`[INBOX-POLLER] Reached ${MAX_EMAILS_PER_POLL} emails this cycle — will continue next poll`);
          break;
        }
        emailsProcessed++;
        try {
          // Fetch envelope + full text source
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const msg: any = await client.fetchOne(uid, {
            envelope: true,
            source: true,
          }, { uid: true });

          if (!msg || !msg.envelope) continue;

          const env = msg.envelope;
          const messageId: string = env.messageId || `uid-${uid}-${Date.now()}`;
          const fromAddr: string =
            env.from?.[0]?.address?.toLowerCase() || "";
          const toAddr: string =
            env.to?.[0]?.address?.toLowerCase() || "";
          const subject: string = env.subject || "(no subject)";

          // BLOCK: Skip emails from blocked/opted-out users
          if (await isEmailBlocked(fromAddr)) {
            logger.info(`[INBOX-POLLER] Blocked email from ${maskEmail(fromAddr)} — user opted out, marking as read`);
            await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
            continue;
          }

          // Idempotency check — skip if already processed
          const alreadyProcessed = await isEmailProcessed(messageId);
          if (alreadyProcessed) {
            await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
            continue;
          }

          // Parse body from raw source
          let body = "";
          if (msg.source) {
            body = await parseBodyFromSource(msg.source as Buffer);
          }

          const parsed: ParsedInboxEmail = {
            uid: String(uid),
            messageId,
            from: fromAddr,
            to: toAddr,
            subject,
            body,
            date: env.date?.toISOString() || new Date().toISOString(),
          };

          await routeEmail(parsed);

          // Record as processed for idempotency
          await markEmailProcessed(messageId, fromAddr, toAddr, subject);

          // Mark as read after successful processing
          try {
            await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
          } catch (flagErr) {
            logger.warn(`[INBOX-POLLER] Failed to mark uid=${uid} as read (already processed):`, flagErr);
          }
        } catch (msgErr) {
          logger.error(
            `[INBOX-POLLER] Error processing uid=${uid}:`,
            msgErr
          );
          // Don't mark as read — will retry next cycle
        }
      }
    } finally {
      lock.release();
      await client.logout();
    }
  } catch (err) {
    logger.error("[INBOX-POLLER] Connection error:", err);
  } finally {
    await releaseDistributedLock("inbox_poller");
    isPolling = false;
  }
}

/**
 * Check if an email has already been processed (idempotency).
 */
async function isEmailProcessed(messageId: string): Promise<boolean> {
  const { data } = await getSupabaseClient()
    .from("processed_emails")
    .select("message_id")
    .eq("message_id", messageId)
    .limit(1);
  return !!(data && data.length > 0);
}

/**
 * Record an email as processed.
 */
async function markEmailProcessed(
  messageId: string,
  from: string,
  to: string,
  subject: string
): Promise<void> {
  await getSupabaseClient()
    .from("processed_emails")
    .upsert({
      message_id: messageId,
      from_addr: from,
      to_addr: to,
      subject: subject.substring(0, 255),
      processed_at: new Date().toISOString(),
    });
}

// ---------------------------------------------------------------------------
// Body parsing — extract plain text from raw MIME source
// ---------------------------------------------------------------------------

async function parseBodyFromSource(source: Buffer): Promise<string> {
  // Try postal-mime first (proper MIME parser)
  try {
    const PostalMime = (await import("postal-mime")).default;
    const parser = new PostalMime();
    const email = await parser.parse(source);
    return (
      email.text ||
      email.html?.replace(/<[^>]*>/g, " ").trim() ||
      ""
    );
  } catch {
    // Fallback: naive header/body split
    const raw = source.toString("utf-8");
    const headerEnd = raw.indexOf("\r\n\r\n");
    if (headerEnd > 0) {
      return raw
        .substring(headerEnd + 4)
        .replace(/<[^>]*>/g, " ")
        .trim();
    }
    return raw;
  }
}

// ---------------------------------------------------------------------------
// Email type detection (ported from Cloudflare worker)
// ---------------------------------------------------------------------------

function detectEmailType(
  subject: string,
  body: string
): { type: EmailType; taskId: string | null } {
  // Plan approval reply (must check BEFORE confirmation)
  if (subject.toLowerCase().includes("plan approval:")) {
    const taskIdMatch = body.match(/Task ID:\s*([a-f0-9-]+)/i);
    return { type: "confirmation_reply", taskId: taskIdMatch?.[1] ?? null };
  }

  // Confirmation reply
  if (subject.toLowerCase().includes("confirm:")) {
    const taskIdMatch = body.match(/Task ID:\s*([a-f0-9-]+)/i);
    return { type: "confirmation_reply", taskId: taskIdMatch?.[1] ?? null };
  }

  // Verification code reply
  if (subject.toLowerCase().includes("verification code")) {
    const taskIdMatch = body.match(/Task ID:\s*([a-f0-9-]+)/i);
    return { type: "verification_reply", taskId: taskIdMatch?.[1] ?? null };
  }

  // Body contains Task ID — could be reply quote
  const taskIdMatch = body.match(/Task ID:\s*([a-f0-9-]+)/i);
  if (taskIdMatch) {
    const firstLine = body.split("\n")[0].toLowerCase().trim();
    if (/^\d{4,8}$/.test(firstLine)) {
      return { type: "verification_reply", taskId: taskIdMatch[1] };
    }
    return { type: "confirmation_reply", taskId: taskIdMatch[1] };
  }

  // Magic link patterns
  const magicPatterns = [
    /(?:sign.?in|log.?in|verify|confirm|magic).?link/i,
    /click\s+(?:here|this\s+link)\s+to\s+(?:sign|log)\s*in/i,
    /one-time\s+(?:link|login)/i,
  ];
  if (magicPatterns.some((p) => p.test(subject) || p.test(body))) {
    const urlMatch = body.match(
      /https?:\/\/[^\s<>"]+(?:token|verify|login|auth|magic|confirm)[^\s<>"]*/i
    );
    if (urlMatch) {
      return { type: "magic_link", taskId: null };
    }
  }

  return { type: "new_task", taskId: null };
}

// ---------------------------------------------------------------------------
// Extract reply text (remove quoted content)
// ---------------------------------------------------------------------------

function extractReplyText(body: string): string {
  const lines = body.split("\n");
  const replyLines: string[] = [];

  for (const line of lines) {
    if (
      line.startsWith(">") ||
      (line.startsWith("On ") && line.includes(" wrote:")) ||
      line.includes("-----Original Message-----") ||
      line.includes("_______________") ||
      /^From:\s+/i.test(line) ||
      line.includes("Task ID:") ||
      /^--\s*$/.test(line)  // Email signature delimiter (RFC 3676)
    ) {
      break;
    }
    replyLines.push(line);
  }

  return replyLines.join("\n").trim();
}

// ---------------------------------------------------------------------------
// Extract username from forwarded email To address
// ---------------------------------------------------------------------------

function extractUsername(toAddr: string): string | null {
  // Forwarded emails from Porkbun preserve the original To: header
  // e.g. "omar@aevoy.com" → username = "omar"
  if (!toAddr.includes("@aevoy.com")) {
    // If Porkbun rewrites To to the forwarding address, fall back to
    // checking X-Original-To or Delivered-To (handled in parseBodyFromSource
    // in a future enhancement). For now, skip non-aevoy addresses.
    return null;
  }
  const username = toAddr.split("@")[0];
  if (!username || !/^[a-zA-Z0-9_-]+$/.test(username)) return null;
  return username;
}

// ---------------------------------------------------------------------------
// PIN reply helpers (Resend email)
// ---------------------------------------------------------------------------

async function sendPinReply(toEmail: string, username: string, originalSubject: string, message: string): Promise<void> {
  // Sanitize email address — prevent CRLF header injection
  const sanitizedTo = toEmail.replace(/[\r\n\t]/g, '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sanitizedTo)) {
    logger.warn(`[INBOX-POLLER] Invalid reply-to address: ${maskEmail(toEmail)}`);
    return;
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    logger.info(`[INBOX-POLLER] No RESEND_API_KEY — cannot send PIN reply for ${username}`);
    return;
  }

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${username}@aevoy.com`,
        to: sanitizedTo,
        subject: `Re: ${originalSubject}`,
        text: `${message}\n\n— ${username}'s AI assistant`,
      }),
    });
  } catch (err) {
    logger.error("[INBOX-POLLER] Failed to send PIN reply:", err);
  }
}

// ---------------------------------------------------------------------------
// Full Send Mode — email priority categorization
// ---------------------------------------------------------------------------

export type EmailPriority = 'spam' | 'newsletter' | 'notification' | 'low' | 'medium' | 'high' | 'urgent';

/**
 * Use Groq (fast, cheap) to classify an incoming email by priority.
 * Returns one of: spam | newsletter | notification | low | medium | high | urgent
 */
async function categorizePriority(
  from: string,
  subject: string,
  body: string
): Promise<EmailPriority> {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    // No Groq key — default to medium so nothing is silently dropped
    return 'medium';
  }

  try {
    const OpenAI = (await import("openai")).default;
    const groq = new OpenAI({
      apiKey: groqKey,
      baseURL: "https://api.groq.com/openai/v1",
    });

    const snippet = body.substring(0, 600);
    const prompt = `Classify this email by priority. Reply with EXACTLY one word from: spam, newsletter, notification, low, medium, high, urgent

From: ${from}
Subject: ${subject}
Body (first 600 chars): ${snippet}

Rules:
- spam: unsolicited ads, phishing, junk mail
- newsletter: subscribed newsletters, marketing blasts, digest emails
- notification: automated system notifications (GitHub, Stripe, bank alerts, order confirmations)
- low: casual FYI emails, mailing list, social notifications
- medium: regular personal emails, general business correspondence, replies that don't require immediate action
- high: emails from known contacts requesting action, meetings, deadlines
- urgent: time-sensitive (today/ASAP), emergency, flagged urgent by sender, critical alerts requiring immediate response

Reply with one word only:`;

    const response = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant', // Fast, cheap 8B model
      messages: [
        { role: 'system', content: 'You are an email classifier. Reply with exactly one word.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 10,
      temperature: 0,
    });

    const raw = response.choices[0]?.message?.content?.trim().toLowerCase() || 'medium';
    const valid: EmailPriority[] = ['spam', 'newsletter', 'notification', 'low', 'medium', 'high', 'urgent'];
    const priority = valid.find(p => raw.startsWith(p)) || 'medium';
    logger.info(`[FULL-SEND] categorizePriority from="${from}" subject="${subject.substring(0, 60)}" → ${priority}`);
    return priority;
  } catch (err) {
    logger.error('[FULL-SEND] categorizePriority error:', err);
    return 'medium'; // Safe default — don't silently drop
  }
}

/**
 * Send an auto-reply from the user's @aevoy.com address (Full Send Mode).
 * Keeps the tone natural and brief — not robotic.
 */
async function sendAutoReply(
  toEmail: string,
  fromUsername: string,
  originalSubject: string,
  replyBody: string
): Promise<void> {
  // Sanitize email address — prevent CRLF header injection
  const sanitizedTo = toEmail.replace(/[\r\n\t]/g, '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sanitizedTo)) {
    logger.warn(`[INBOX-POLLER] Invalid reply-to address: ${maskEmail(toEmail)}`);
    return;
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${fromUsername}@aevoy.com`,
        to: sanitizedTo,
        subject: originalSubject.startsWith("Re:") ? originalSubject : `Re: ${originalSubject}`,
        text: `${replyBody}\n\n— ${fromUsername}'s AI assistant`,
      }),
    });
    logger.info(`[FULL-SEND] Auto-reply sent to ${maskEmail(toEmail)}`);
  } catch (err) {
    logger.error("[FULL-SEND] Auto-reply failed:", err);
  }
}

/**
 * Generate a natural-sounding auto-reply using Groq given email context.
 * Falls back to a generic acknowledgement if AI is unavailable.
 */
async function generateAutoReplyText(
  subject: string,
  body: string,
  priority: EmailPriority,
  senderName: string
): Promise<string> {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return "Got it — thanks for reaching out. I'll pass this along.";
  }

  try {
    const OpenAI = (await import("openai")).default;
    const groq = new OpenAI({
      apiKey: groqKey,
      baseURL: "https://api.groq.com/openai/v1",
    });

    const toneGuide =
      priority === 'notification' || priority === 'low'
        ? 'Write a brief, casual 1-sentence acknowledgement (e.g. "Got it, thanks!" or "Noted, cheers!").'
        : 'Write a friendly 2-3 sentence reply that acknowledges the email and addresses its main point concisely.';

    const response = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'system',
          content: `You are an AI email assistant writing on behalf of a user. ${toneGuide} Be natural, not robotic. No sign-off needed (it is added separately). Reply only with the email body text.`,
        },
        {
          role: 'user',
          content: `Email subject: ${subject}\nEmail body:\n${body.substring(0, 800)}\nSender: ${senderName}`,
        },
      ],
      max_tokens: 150,
      temperature: 0.7,
    });

    return response.choices[0]?.message?.content?.trim() || "Got it — thanks!";
  } catch {
    return "Got it — thanks for reaching out.";
  }
}

// ---------------------------------------------------------------------------
// Route email to the correct processor
// ---------------------------------------------------------------------------

// ---- BYPASS LIST: Admin/system emails that skip AI entirely and forward to owner ----
const ADMIN_FORWARD_EMAIL = process.env.ADMIN_FORWARD_EMAIL || "omarkebrahim@gmail.com";
const BYPASS_USERNAMES = ['omar', 'hello', 'welcome', 'info', 'contact', 'sales', 'admin', 'noreply', 'no-reply', 'postmaster', 'abuse'];

async function forwardToAdmin(email: ParsedInboxEmail, username: string): Promise<void> {
  // Sanitize email address — prevent CRLF header injection
  const sanitizedFrom = email.from.replace(/[\r\n\t]/g, '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sanitizedFrom)) {
    logger.warn(`[INBOX-POLLER] Invalid forward-from address: ${maskEmail(email.from)}`);
    return;
  }

  // Forward via Resend (already configured in the agent)
  try {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      logger.info(`[INBOX-POLLER] No RESEND_API_KEY — cannot forward bypass email for ${username}@aevoy.com`);
      return;
    }
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${username}@aevoy.com`,
        to: ADMIN_FORWARD_EMAIL,
        subject: `[FWD: ${username}@] ${email.subject}`,
        text: `Forwarded from: ${email.from}\nTo: ${email.to}\nDate: ${email.date}\n\n${email.body}`,
      }),
    });
    logger.info(`[INBOX-POLLER] Forwarded ${username}@aevoy.com email to admin`);
  } catch (err) {
    logger.error(`[INBOX-POLLER] Forward to admin failed:`, err);
  }
}

async function routeEmail(email: ParsedInboxEmail): Promise<void> {
  // Extract username from To address
  let username = extractUsername(email.to);

  // If To is the agent inbox itself (forwarding rewrote it),
  // try to find the original recipient in the body/headers
  if (!username) {
    // Try to find "username@aevoy.com" anywhere in the body or subject
    const aevoyMatch = email.body.match(/([a-zA-Z0-9_-]+)@aevoy\.com/);
    if (aevoyMatch) {
      username = aevoyMatch[1];
    } else {
      // Also check subject (some forwarders put original To there)
      const subjMatch = email.subject.match(
        /([a-zA-Z0-9_-]+)@aevoy\.com/
      );
      if (subjMatch) {
        username = subjMatch[1];
      }
    }
  }

  if (!username) {
    logger.info(
      `[INBOX-POLLER] Could not extract username from To: ${email.to}, skipping`
    );
    return;
  }

  // Bypass admin/system emails — forward directly, skip AI processing
  if (BYPASS_USERNAMES.includes(username.toLowerCase())) {
    logger.info(`[INBOX-POLLER] Bypass: ${username}@aevoy.com → forwarding to admin`);
    await forwardToAdmin(email, username);
    return;
  }

  // Look up user
  const { data: users } = await getSupabaseClient()
    .from("profiles")
    .select("id, username, email, messages_used, messages_limit")
    .eq("username", username)
    .limit(1);

  const user = users?.[0];
  if (!user) {
    logger.info(`[INBOX-POLLER] User not found: ${username}`);
    return;
  }

  // Check if sender is a recognized email
  const senderEmail = email.from.toLowerCase().trim();
  const isKnownSender = user.email && senderEmail === user.email.toLowerCase().trim();

  // SELF-EMAIL FILTER: Skip emails sent FROM *@aevoy.com — these are our OWN responses
  // getting picked up by the IMAP poller. Processing them creates infinite loops and
  // triggers false PIN challenges.
  if (senderEmail.endsWith('@aevoy.com')) {
    logger.info(`[INBOX-POLLER] Skipping self-email from ${maskEmail(senderEmail)} (Anticipy system email)`);
    return;
  }

  // SERVICE EMAIL BYPASS: Allow automated/noreply emails from known services through
  // without PIN. These are verification codes, receipts, newsletters, etc.
  // The agent reads them but never follows instructions blindly (content is sanitized).
  const senderDomain = senderEmail.split('@')[1] || '';
  const TRUSTED_SERVICE_DOMAINS = [
    // Big tech & email services
    'google.com', 'gmail.com', 'accounts.google.com', 'youtube.com',
    'apple.com', 'id.apple.com', 'icloud.com',
    'microsoft.com', 'outlook.com', 'live.com', 'hotmail.com',
    'amazon.com', 'amazon.ca', 'amazon.co.uk',
    // Social & messaging
    'twitter.com', 'x.com', 'facebook.com', 'facebookmail.com', 'instagram.com',
    'linkedin.com', 'reddit.com', 'discord.com', 'slack.com', 'telegram.org',
    // Streaming & entertainment
    'netflix.com', 'hulu.com', 'spotify.com', 'disneyplus.com', 'hbomax.com',
    'peacocktv.com', 'paramountplus.com', 'crunchyroll.com',
    // Shopping & delivery
    'ebay.com', 'walmart.com', 'target.com', 'bestbuy.com', 'costco.com',
    'ubereats.com', 'doordash.com', 'grubhub.com', 'instacart.com',
    'uber.com', 'lyft.com', 'airbnb.com',
    // Banking & finance
    'paypal.com', 'venmo.com', 'stripe.com', 'squareup.com', 'cash.app',
    'chase.com', 'bankofamerica.com', 'wellsfargo.com', 'citibank.com',
    // SaaS & developer tools
    'github.com', 'gitlab.com', 'atlassian.com', 'notion.so', 'figma.com',
    'vercel.com', 'railway.app', 'heroku.com', 'netlify.com', 'cloudflare.com',
    'twilio.com', 'sendgrid.net', 'mailgun.org', 'postmarkapp.com',
    // Health & fitness
    'fitbit.com', 'myfitnesspal.com', 'peloton.com', 'strava.com',
    // Travel & booking
    'booking.com', 'expedia.com', 'tripadvisor.com', 'kayak.com',
    'aircanada.com', 'united.com', 'delta.com', 'southwest.com',
    // Canadian services
    'rogers.com', 'bell.ca', 'telus.com', 'td.com', 'rbc.com', 'bmo.com',
    'scotiabank.com', 'cibc.com', 'canadapost-postescanada.ca',
    // Utilities & government
    'intuit.com', 'turbotax.ca', 'gov.bc.ca', 'canada.ca', 'cra-arc.gc.ca',
  ];
  // Match exact domain or subdomains (e.g., noreply@mail.netflix.com → netflix.com)
  const isServiceEmail = TRUSTED_SERVICE_DOMAINS.some(d =>
    senderDomain === d || senderDomain.endsWith('.' + d)
  );
  // Also detect noreply/automated sender patterns
  const isNoReplyEmail = /^(no-?reply|noreply|notifications?|alerts?|info|support|verify|confirm|donotreply|mailer-daemon|postmaster)\b/i.test(senderEmail.split('@')[0]);

  if (!isKnownSender && (isServiceEmail || isNoReplyEmail)) {
    // Service/automated email — allow through but log it. Content will be sanitized
    // by the AI system prompt's injection protection before processing.
    logger.info(`[INBOX-POLLER] Service email from ${maskEmail(senderEmail)} → ${username} (domain: ${senderDomain}, noreply: ${isNoReplyEmail}) — bypassing PIN`);
    // Fall through to normal processing (no PIN required)
  } else if (!isKnownSender) {
    // Unknown HUMAN sender — require PIN authentication
    const { verifyUnifiedPin, hasPin: userHasPin, getRemainingAttempts } = await import("../utils/pin-auth.js");
    const hasPinSet = await userHasPin(user.id);

    if (!hasPinSet) {
      // No PIN set — tell sender to contact the user
      await sendPinReply(email.from, username, email.subject,
        `This email address only accepts emails from ${username}'s registered email. To allow emails from other addresses, ask ${username} to set up a Security PIN in their Anticipy settings.`);
      logger.info(`[INBOX-POLLER] Unknown sender ${maskEmail(senderEmail)} for ${username}, no PIN set — sent setup instructions`);
      return;
    }

    // Look for 4-6 digit PIN in subject or body
    const pinMatch = email.subject.match(/\b(\d{4,6})\b/) || email.body.match(/\b(\d{4,6})\b/);

    if (!pinMatch) {
      // No PIN found — reply asking for PIN
      await sendPinReply(email.from, username, email.subject,
        `Hi! This is ${username}'s AI assistant at Anticipy.\n\nI received your email, but I don't recognize your email address. To verify your identity, please reply with your 4-6 digit security PIN in the subject line or body of your email.\n\nIf you don't have a PIN, please ask ${username} to share it with you.`);
      logger.info(`[INBOX-POLLER] Sent PIN request to ${maskEmail(senderEmail)} for ${username}`);
      return;
    }

    const pinResult = await verifyUnifiedPin(user.id, pinMatch[1]);

    if (pinResult === "locked") {
      await sendPinReply(email.from, username, email.subject,
        "Too many incorrect PIN attempts. Your account has been temporarily locked. Please try again in about an hour.");
      return;
    }

    if (pinResult !== "valid") {
      const remaining = await getRemainingAttempts(user.id);
      await sendPinReply(email.from, username, email.subject,
        `Incorrect PIN. You have ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining. Please reply with the correct 4-6 digit security PIN in the subject or body.`);
      return;
    }

    // PIN valid — strip PIN from subject/body before processing
    email.subject = email.subject.replace(new RegExp(`\\b${pinMatch[1]}\\b`), "").trim() || email.subject;
    email.body = email.body.replace(new RegExp(`\\b${pinMatch[1]}\\b`), "").trim() || email.body;
    logger.info(`[INBOX-POLLER] PIN verified for ${maskEmail(senderEmail)} → ${username}`);
  }

  // ---------------------------------------------------------------------------
  // FULL SEND MODE: Autonomously handle incoming email by priority
  // Only applies to new incoming emails — NOT confirmation/verification replies
  // ---------------------------------------------------------------------------
  const { data: fsUserSettings } = await getSupabaseClient()
    .from("user_settings")
    .select("full_send_mode, full_send_auto_reply, full_send_draft_threshold")
    .eq("user_id", user.id)
    .single();

  const fullSendEnabled = fsUserSettings?.full_send_mode === true;

  if (fullSendEnabled) {
    // Only apply full send mode to genuine new emails (not replies/confirmations)
    const isLikelyReply =
      email.subject.toLowerCase().includes("confirm:") ||
      email.subject.toLowerCase().includes("verification code") ||
      email.subject.toLowerCase().includes("plan approval:") ||
      /Task ID:\s*[a-f0-9-]+/i.test(email.body);

    if (!isLikelyReply) {
      const priority = await categorizePriority(email.from, email.subject, email.body);
      const autoReplyEnabled = fsUserSettings?.full_send_auto_reply !== false;
      const threshold = (fsUserSettings?.full_send_draft_threshold as 'all' | 'medium' | 'high') || 'medium';

      const senderDisplayName = email.from.split('@')[0] || 'there';

      // spam / newsletter: silently skip — no task, no reply
      if (priority === 'spam' || priority === 'newsletter') {
        logger.info(`[FULL-SEND] Dropping ${priority} email from ${maskEmail(email.from)} — subject: "${email.subject.substring(0, 60)}"`);
        return; // skip processing entirely
      }

      // notification / low: auto-reply with brief acknowledgement + mark handled
      if (priority === 'notification' || priority === 'low') {
        if (autoReplyEnabled) {
          const replyText = await generateAutoReplyText(email.subject, email.body, priority, senderDisplayName);
          await sendAutoReply(email.from, username, email.subject, replyText);
        }
        // Log as a handled task in DB so user can see it in activity
        await getSupabaseClient().from("tasks").insert({
          user_id: user.id,
          subject: `[Auto-handled] ${email.subject.substring(0, 200)}`,
          body: `From: ${email.from}\n\nPriority: ${priority}\n\n${email.body.substring(0, 500)}`,
          input_channel: "email",
          status: "completed",
          response_text: `Auto-handled: ${priority} priority email from ${email.from}. ${autoReplyEnabled ? "Brief acknowledgement sent." : "No reply sent (auto-reply disabled)."}`,
          completed_at: new Date().toISOString(),
          action_count: autoReplyEnabled ? 1 : 0,
        });
        logger.info(`[FULL-SEND] ${priority} email auto-handled (reply=${autoReplyEnabled}) from ${maskEmail(email.from)}`);
        return;
      }

      // medium: draft + send reply autonomously (if threshold allows)
      const shouldAutoReplyMedium = threshold === 'all' || threshold === 'medium';
      if (priority === 'medium' && shouldAutoReplyMedium) {
        if (autoReplyEnabled) {
          const replyText = await generateAutoReplyText(email.subject, email.body, priority, senderDisplayName);
          await sendAutoReply(email.from, username, email.subject, replyText);
          // Log task
          await getSupabaseClient().from("tasks").insert({
            user_id: user.id,
            subject: `[Full Send] ${email.subject.substring(0, 200)}`,
            body: `From: ${email.from}\n\nPriority: medium\n\n${email.body.substring(0, 500)}`,
            input_channel: "email",
            status: "completed",
            response_text: `Full Send Mode: medium-priority email from ${email.from} — reply drafted and sent automatically.`,
            completed_at: new Date().toISOString(),
            action_count: 1,
          });
          logger.info(`[FULL-SEND] medium email auto-replied to ${maskEmail(email.from)}`);
          return;
        }
        // auto-reply off but medium threshold — fall through to normal processing
      }

      // high / urgent: reply AND notify user via SMS
      if (priority === 'high' || priority === 'urgent') {
        const shouldAutoReplyHigh = threshold === 'all' || threshold === 'medium' || threshold === 'high';
        if (autoReplyEnabled && shouldAutoReplyHigh) {
          const replyText = await generateAutoReplyText(email.subject, email.body, priority, senderDisplayName);
          await sendAutoReply(email.from, username, email.subject, replyText);
        }

        // Notify user via SMS if they have a phone number
        try {
          const { data: userProfile } = await getSupabaseClient()
            .from("profiles")
            .select("phone_number")
            .eq("id", user.id)
            .single();

          if (userProfile?.phone_number) {
            const { sendSms } = await import("./twilio.js");
            const urgentLabel = priority === 'urgent' ? 'URGENT' : 'High-priority';
            await sendSms({
              userId: user.id,
              to: userProfile.phone_number,
              body: `[Anticipy] ${urgentLabel} email from ${email.from}: "${email.subject.substring(0, 80)}" — replied on your behalf. Check your inbox.`,
            });
            logger.info(`[FULL-SEND] SMS alert sent for ${priority} email`);
          }
        } catch (smsErr) {
          logger.error("[FULL-SEND] SMS notification failed:", smsErr);
        }

        // Also create a task so the user can see it in activity
        await getSupabaseClient().from("tasks").insert({
          user_id: user.id,
          subject: `[Full Send - ${priority.toUpperCase()}] ${email.subject.substring(0, 200)}`,
          body: `From: ${email.from}\n\nPriority: ${priority}\n\n${email.body.substring(0, 500)}`,
          input_channel: "email",
          status: "needs_review",
          response_text: `Full Send Mode: ${priority} priority email from ${email.from}. ${autoReplyEnabled && shouldAutoReplyHigh ? "Reply sent automatically. " : ""}User notified via SMS.`,
          completed_at: new Date().toISOString(),
          action_count: (autoReplyEnabled && shouldAutoReplyHigh ? 1 : 0) + 1,
        });
        logger.info(`[FULL-SEND] ${priority} email handled — reply sent + user notified`);
        return;
      }

      // If we get here, threshold excluded this priority level → fall through to normal processing
      logger.info(`[FULL-SEND] priority=${priority} below threshold="${threshold}" — routing to normal processor`);
    }
  }

  // Detect email type and route
  const { type: emailType, taskId } = detectEmailType(
    email.subject,
    email.body
  );
  logger.info(
    `[INBOX-POLLER] Routing: user=${username} type=${emailType} taskId=${taskId || "none"}`
  );

  switch (emailType) {
    case "confirmation_reply": {
      if (!taskId) {
        // No task ID — treat as new task
        await processIncomingTask({
          userId: user.id,
          username: user.username,
          from: user.email,
          subject: email.subject,
          body: email.body,
          inputChannel: "email",
        });
        return;
      }
      const replyText = extractReplyText(email.body);
      await handleConfirmationReply(
        user.id,
        user.username,
        user.email,
        replyText,
        taskId
      );
      return;
    }

    case "verification_reply": {
      if (!taskId) {
        await processIncomingTask({
          userId: user.id,
          username: user.username,
          from: user.email,
          subject: email.subject,
          body: email.body,
          inputChannel: "email",
        });
        return;
      }
      const replyText = extractReplyText(email.body);
      const codeMatch = replyText.match(/\b(\d{4,8})\b/);
      const code = codeMatch ? codeMatch[1] : replyText.trim();
      await handleVerificationCodeReply(
        user.id,
        user.username,
        user.email,
        code,
        taskId
      );
      return;
    }

    case "magic_link": {
      const urlMatch = email.body.match(
        /https?:\/\/[^\s<>"]+(?:token|verify|login|auth|magic|confirm)[^\s<>"]*/i
      );
      await processIncomingTask({
        userId: user.id,
        username: user.username,
        from: user.email,
        subject: email.subject,
        body: email.body,
        inputChannel: "email",
      });
      return;
    }

    case "new_task":
    default: {
      // ── Auto-proceed reply detection (Email) ──
      // Check if user has a task waiting for their reply before creating a new task
      try {
        const { data: awaitingTask } = await getSupabaseClient()
          .from('tasks')
          .select('id, input_text, email_subject, status, auto_proceed_at')
          .eq('user_id', user.id)
          .in('status', ['needs_review', 'pending_approval', 'awaiting_confirmation'])
          .not('auto_proceed_at', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (awaitingTask) {
          const emailText = `${email.subject} ${extractReplyText(email.body)}`.trim();
          const emailLower = emailText.toLowerCase();
          const isCancelRequest = /\b(cancel|stop|forget it|nevermind|never mind|ignore|scratch that|abort|don't|dont)\b/i.test(emailLower);

          // Distinguish replies from new tasks
          const _emailLooksLikeNewTask = emailText.length > 80
            || /\b(create|make|build|find|search|sign\s?up|book\s+(?:me\s+)?a|write|send|get\s+me|order\s+me|help\s+me|tell\s+me|show\s+me|set\s+up|look\s+up|check\s+(?:my|if|on)|how\s+(?:to|do|can)|what\s+is|who\s+is)\b/i.test(emailLower);

          if (_emailLooksLikeNewTask && !isCancelRequest) {
            logger.info(`[INBOX-POLLER] Email looks like new task, not reply to ${awaitingTask.id.slice(0, 8)}: "${emailText.slice(0, 60)}"`);
            // Fall through to create new task
          } else if (isCancelRequest) {
            await getSupabaseClient().from('tasks').update({
              status: 'completed',
              response_text: 'Task cancelled.',
              auto_proceed_at: null,
              auto_proceed_context: null,
              completed_at: new Date().toISOString(),
            }).eq('id', awaitingTask.id);

            logger.info(`[INBOX-POLLER] User cancelled awaiting task ${awaitingTask.id.slice(0, 8)} via email`);
            return;
          } else {
            // User provided an answer — clear timer and re-process with their reply
            logger.info(`[INBOX-POLLER] User replied to awaiting task ${awaitingTask.id.slice(0, 8)} via email`);

            await getSupabaseClient().from('tasks').update({
              status: 'processing',
              auto_proceed_at: null,
              auto_proceed_context: null,
            }).eq('id', awaitingTask.id);

            const { processTaskV3 } = await import('../v3/processor-v3.js');
            await processTaskV3({
              userId: user.id,
              username: user.username,
              from: user.email,
              subject: awaitingTask.email_subject || awaitingTask.input_text?.substring(0, 200) || email.subject,
              body: `${awaitingTask.input_text || ''}\n\nUser reply: ${extractReplyText(email.body)}`,
              taskId: awaitingTask.id,
              inputChannel: "email",
              responsePrefix: `You replied with additional info. Here's what I did:`,
            });
            return;
          }
        }
      } catch {
        // Non-critical — fall through to normal processing
      }

      await processIncomingTask({
        userId: user.id,
        username: user.username,
        from: user.email,
        subject: email.subject,
        body: extractReplyText(email.body),
        inputChannel: "email",
      });
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// On-demand email fetch — used by read_email action during task execution
// ---------------------------------------------------------------------------

export interface FetchedEmail {
  from: string;
  to: string;
  subject: string;
  body: string;
  date: string;
}

/**
 * Fetch recent emails from the agent inbox for a specific @aevoy.com address.
 * Used by the read_email action to let the AI check for verification codes, replies, etc.
 *
 * @param forAddress - The @aevoy.com address to filter for (e.g. "sage@aevoy.com")
 * @param limit - Max emails to return (default 5)
 * @param minutesBack - How far back to look (default 30 minutes)
 */
export async function fetchRecentEmails(
  forAddress: string,
  limit = 5,
  minutesBack = 30
): Promise<FetchedEmail[]> {
  if (!INBOX_EMAIL || !INBOX_PASSWORD) {
    logger.info("[READ-EMAIL] IMAP not configured, falling back to DB");
    return fetchFromDatabase(forAddress, limit);
  }

  try {
    const { ImapFlow } = await import("imapflow");

    const client = new ImapFlow({
      host: INBOX_HOST,
      port: INBOX_PORT,
      secure: true,
      auth: { user: INBOX_EMAIL, pass: INBOX_PASSWORD },
      logger: false,
      connectionTimeout: 10_000,
      greetingTimeout: 8_000,
    });

    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    const results: FetchedEmail[] = [];

    try {
      const since = new Date(Date.now() - minutesBack * 60 * 1000);
      // Search for recent emails addressed to the user's @aevoy.com address
      const uids = await client.search({
        since,
        to: forAddress,
      });

      if (!uids || uids.length === 0) {
        lock.release();
        await client.logout();
        return results;
      }

      // Take the most recent N
      const batch = uids.slice(-limit);

      for (const uid of batch) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const msg: any = await client.fetchOne(uid, {
            envelope: true,
            source: true,
          }, { uid: true });

          if (!msg?.envelope) continue;

          const env = msg.envelope;
          let body = "";
          if (msg.source) {
            body = await parseBodyFromSource(msg.source as Buffer);
          }

          results.push({
            from: env.from?.[0]?.address?.toLowerCase() || "",
            to: env.to?.[0]?.address?.toLowerCase() || forAddress,
            subject: env.subject || "(no subject)",
            body: body.substring(0, 2000), // Cap body length
            date: env.date?.toISOString() || new Date().toISOString(),
          });
        } catch (msgErr) {
          logger.warn(`[READ-EMAIL] Error fetching uid=${uid}:`, msgErr);
        }
      }
    } finally {
      lock.release();
      await client.logout();
    }

    logger.info(`[READ-EMAIL] Fetched ${results.length} emails for ${forAddress}`);
    return results;
  } catch (err) {
    logger.error("[READ-EMAIL] IMAP fetch failed, falling back to DB:", err);
    return fetchFromDatabase(forAddress, limit);
  }
}

/**
 * Fallback: fetch from processed_emails + tasks tables when IMAP unavailable.
 */
async function fetchFromDatabase(forAddress: string, limit: number): Promise<FetchedEmail[]> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from("processed_emails")
    .select("from_addr, to_addr, subject, processed_at")
    .eq("to_addr", forAddress)
    .order("processed_at", { ascending: false })
    .limit(limit);

  if (!data || data.length === 0) return [];

  return data.map(row => ({
    from: row.from_addr || "",
    to: row.to_addr || forAddress,
    subject: row.subject || "(no subject)",
    body: "(body not available — fetched from metadata only)",
    date: row.processed_at || new Date().toISOString(),
  }));
}
