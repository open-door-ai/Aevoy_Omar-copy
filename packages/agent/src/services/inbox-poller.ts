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

import { getSupabaseClient } from "../utils/supabase.js";
import {
  processIncomingTask,
  handleConfirmationReply,
  handleVerificationCodeReply,
} from "./processor.js";

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
    console.log(
      "[INBOX-POLLER] Skipping — AGENT_INBOX_EMAIL / AGENT_INBOX_PASSWORD not configured"
    );
    return;
  }

  if (pollerInterval) {
    console.log("[INBOX-POLLER] Already running");
    return;
  }

  console.log(
    `[INBOX-POLLER] Starting — polling ${INBOX_EMAIL} every ${POLL_INTERVAL / 1000}s`
  );

  // Run immediately, then on interval
  pollInbox().catch((err) =>
    console.error("[INBOX-POLLER] Initial poll error:", err)
  );

  pollerInterval = setInterval(() => {
    pollInbox().catch((err) =>
      console.error("[INBOX-POLLER] Poll error:", err)
    );
  }, POLL_INTERVAL);
}

export function stopInboxPoller(): void {
  if (pollerInterval) {
    clearInterval(pollerInterval);
    pollerInterval = null;
  }
  console.log("[INBOX-POLLER] Stopped");
}

// ---------------------------------------------------------------------------
// Core polling loop
// ---------------------------------------------------------------------------

async function pollInbox(): Promise<void> {
  if (isPolling) return; // prevent overlapping polls
  isPolling = true;

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

      console.log(`[INBOX-POLLER] Found ${uids.length} unread email(s)`);

      // Process up to 10 per cycle to avoid blocking
      const batch = uids.slice(-10);

      for (const uid of batch) {
        try {
          // Fetch envelope + full text source
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const msg: any = await client.fetchOne(uid, {
            envelope: true,
            source: true,
          }, { uid: true });

          if (!msg || !msg.envelope) continue;

          const env = msg.envelope;
          const fromAddr: string =
            env.from?.[0]?.address?.toLowerCase() || "";
          const toAddr: string =
            env.to?.[0]?.address?.toLowerCase() || "";
          const subject: string = env.subject || "(no subject)";

          // Parse body from raw source
          let body = "";
          if (msg.source) {
            body = await parseBodyFromSource(msg.source as Buffer);
          }

          const parsed: ParsedInboxEmail = {
            uid: String(uid),
            from: fromAddr,
            to: toAddr,
            subject,
            body,
            date: env.date?.toISOString() || new Date().toISOString(),
          };

          await routeEmail(parsed);

          // Mark as read after successful processing
          await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
        } catch (msgErr) {
          console.error(
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
    console.error("[INBOX-POLLER] Connection error:", err);
  } finally {
    isPolling = false;
  }
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
      line.includes("Task ID:")
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
// Route email to the correct processor
// ---------------------------------------------------------------------------

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
    console.log(
      `[INBOX-POLLER] Could not extract username from To: ${email.to}, skipping`
    );
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
    console.log(`[INBOX-POLLER] User not found: ${username}`);
    return;
  }

  // Validate sender matches registered email
  const senderEmail = email.from.toLowerCase().trim();
  if (user.email && senderEmail !== user.email.toLowerCase().trim()) {
    console.log(
      `[INBOX-POLLER] Sender mismatch for ${username}: ${senderEmail} vs ${user.email}`
    );
    return;
  }

  // Detect email type and route
  const { type: emailType, taskId } = detectEmailType(
    email.subject,
    email.body
  );
  console.log(
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
    default:
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
}
