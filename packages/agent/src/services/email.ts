import { Resend } from "resend";
import { fakeEmailServer, isTestMode } from "../test-utils/fake-email-server.js";
import { trackError } from "../utils/error-tracker.js";
import { getSupabaseClient } from "../utils/supabase.js";

// ---------------------------------------------------------------------------
// Blocked-email gate — checked before ANY outbound email
// ---------------------------------------------------------------------------

const blockedEmailCache = new Map<string, boolean>();
const BLOCKED_CACHE_TTL_MS = 60_000; // 1 minute
let blockedCacheLoadedAt = 0;

async function loadBlockedEmails(): Promise<void> {
  try {
    const { data } = await getSupabaseClient()
      .from("blocked_emails")
      .select("email");
    blockedEmailCache.clear();
    if (data) {
      for (const row of data) {
        blockedEmailCache.set(row.email.toLowerCase(), true);
      }
    }
    blockedCacheLoadedAt = Date.now();
  } catch (err) {
    console.error("[EMAIL-BLOCK] Failed to load blocked emails:", err);
  }
}

export async function isEmailBlocked(email: string): Promise<boolean> {
  if (Date.now() - blockedCacheLoadedAt > BLOCKED_CACHE_TTL_MS) {
    await loadBlockedEmails();
  }
  return blockedEmailCache.has(email.toLowerCase());
}

/**
 * SECURITY: Sanitize email header values to prevent header injection.
 * Strips carriage returns, newlines, and null bytes that could inject
 * additional headers (e.g. BCC, additional recipients).
 */
function sanitizeEmailHeader(value: string): string {
  return value.replace(/[\r\n\0]/g, '').trim();
}

let resend: Resend | null = null;

function getResendClient(): Resend {
  if (!resend) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

interface EmailOptions {
  to: string;
  from: string;
  subject: string;
  body: string;
  attachments?: EmailAttachment[];
}

interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

export async function sendResponse(options: EmailOptions): Promise<boolean> {
  // SECURITY: Sanitize all header fields to prevent email header injection
  const to = sanitizeEmailHeader(options.to);
  const from = sanitizeEmailHeader(options.from);
  const subject = sanitizeEmailHeader(options.subject);
  const { body, attachments } = options;

  // BLOCK: Check if recipient is on the blocked list
  if (await isEmailBlocked(to)) {
    console.log(`[EMAIL-BLOCK] Blocked outbound email to ${to} — user opted out`);
    return false;
  }

  console.log(`[EMAIL-SEND] sendResponse called: to=${to}, from=${from}, subject="${subject?.substring(0, 50)}", bodyLen=${body?.length || 0}`);

  // Test mode: use fake email server
  if (isTestMode()) {
    console.log(`[EMAIL-SEND] TEST MODE — routing to fake email server`);
    fakeEmailServer.sendEmail(from, to, `Re: ${subject}`, body, formatResponseEmail(body));
    return true;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) console.warn('[EMAIL-SEND] RESEND_API_KEY not configured');

  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const htmlBody = formatResponseEmail(body);

      const emailData: {
        from: string;
        to: string;
        subject: string;
        html: string;
        text: string;
        attachments?: { filename: string; content: Buffer }[];
      } = {
        from,
        to,
        subject: `Re: ${subject}`,
        html: htmlBody,
        text: body,
      };

      if (attachments && attachments.length > 0) {
        emailData.attachments = attachments.map((a) => ({
          filename: a.filename,
          content: typeof a.content === "string"
            ? Buffer.from(a.content, "base64")
            : a.content,
        }));
      }

      console.log(`[EMAIL-SEND] Calling Resend API (attempt ${attempt + 1}/${maxRetries + 1})...`);
      const result = await getResendClient().emails.send(emailData);
      console.log(`[EMAIL-SEND] Resend API response:`, JSON.stringify(result));

      if (result.error) {
        console.error(`[EMAIL-SEND] Resend error (attempt ${attempt + 1}/${maxRetries + 1}):`, result.error);
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 3000));
          continue;
        }
        return false;
      }

      console.log(`[EMAIL-SEND] SUCCESS — email sent to ${to}, id=${result.data?.id || 'unknown'}`);
      return true;
    } catch (error) {
      trackError('email');
      console.error(`[EMAIL-SEND] Exception (attempt ${attempt + 1}/${maxRetries + 1}):`, error);
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        continue;
      }
      // Never throw — just return false on final failure
      return false;
    }
  }

  return false;
}

// HTML-escape to prevent XSS in email output
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatResponseEmail(body: string): string {
  // Convert markdown-ish text to HTML (with XSS protection)
  const paragraphs = body.split("\n\n");

  const htmlParagraphs = paragraphs.map((p) => {
    const safe = escapeHtml(p);

    // Convert headers
    if (p.startsWith("# ")) {
      return `<h1 style="margin: 24px 0 12px 0; font-size: 24px; font-weight: 700; color: #1c1917; line-height: 1.3;">${escapeHtml(p.slice(2))}</h1>`;
    }
    if (p.startsWith("## ")) {
      return `<h2 style="margin: 20px 0 10px 0; font-size: 20px; font-weight: 600; color: #1c1917; line-height: 1.3;">${escapeHtml(p.slice(3))}</h2>`;
    }
    if (p.startsWith("### ")) {
      return `<h3 style="margin: 16px 0 8px 0; font-size: 17px; font-weight: 600; color: #292524; line-height: 1.4;">${escapeHtml(p.slice(4))}</h3>`;
    }

    // Convert bullet lists
    if (p.includes("\n- ")) {
      const lines = p.split("\n");
      const listItems = lines
        .filter((line) => line.startsWith("- "))
        .map((line) => `<li style="margin: 6px 0; line-height: 1.65;">${escapeHtml(line.slice(2))}</li>`)
        .join("");
      return `<ul style="margin: 12px 0; padding-left: 24px; color: #57534e;">${listItems}</ul>`;
    }

    // Convert line breaks within paragraph
    const withBreaks = safe.replace(/\n/g, "<br>");
    return `<p style="margin: 12px 0; line-height: 1.65; color: #57534e;">${withBreaks}</p>`;
  });

  // Premium Linear/Stripe-inspired table-based layout (email-safe)
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Helvetica Neue', sans-serif; background-color: #f5f5f4;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f5f5f4;">
        <tr>
          <td align="center" style="padding: 40px 16px;">
            <!-- Logo -->
            <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="max-width: 560px; width: 100%;">
              <tr>
                <td align="center" style="padding-bottom: 32px;">
                  <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #1c1917; letter-spacing: -0.02em;">Anticipy</h1>
                </td>
              </tr>
            </table>

            <!-- Content Card -->
            <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="max-width: 560px; width: 100%; background-color: #ffffff; border-radius: 16px; border: 1px solid #e7e5e4; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);">
              <tr>
                <td style="padding: 40px;">
                  <!-- Body Content -->
                  ${htmlParagraphs.join("\n")}
                </td>
              </tr>
            </table>

            <!-- Footer -->
            <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="max-width: 560px; width: 100%;">
              <tr>
                <td align="center" style="padding-top: 32px;">
                  <p style="margin: 0 0 12px 0; font-size: 12px; line-height: 1.5; color: #a8a29e;">
                    Sent by your AI assistant at Anticipy
                  </p>
                  <p style="margin: 0; font-size: 12px; line-height: 1.5;">
                    <a href="https://aevoy.com/dashboard" style="color: #78716c; text-decoration: underline; margin: 0 8px;">Dashboard</a>
                    <span style="color: #d6d3d1;">•</span>
                    <a href="https://aevoy.com/dashboard/settings" style="color: #78716c; text-decoration: underline; margin: 0 8px;">Settings</a>
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

export async function sendErrorEmail(
  to: string,
  from: string,
  originalSubject: string,
  _errorMessage: string
): Promise<boolean> {
  // Never expose raw error details to users — log internally only
  console.error(`[EMAIL] Error for user ${to}: ${_errorMessage}`);

  const body = `I ran into a snag while processing your request. I'm going to try a different approach.

If this keeps happening, feel free to reach out to support or try rephrasing your request.

I'm here to help when you're ready!`;

  return sendResponse({
    to,
    from,
    subject: originalSubject,
    body,
  });
}

export async function sendOverQuotaEmail(
  to: string,
  from: string,
  originalSubject: string
): Promise<boolean> {
  const body = `I'd love to help, but you've reached your message limit for this month.

**To continue using your AI assistant:**
- Upgrade your plan for more messages
- Or wait until your quota resets next month

Visit your dashboard to upgrade: https://aevoy.com/dashboard/settings

See you soon!`;

  return sendResponse({
    to,
    from,
    subject: originalSubject,
    body,
  });
}

export async function sendProgressEmail(
  to: string,
  from: string,
  originalSubject: string,
  progressMessage: string,
  taskId?: string
): Promise<boolean> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.aevoy.com';
  const taskLink = taskId ? `\n\n📊 **Track your task:** ${appUrl}/dashboard/tasks/${taskId}` : '';
  const body = `**Task Update**

${progressMessage}${taskLink}

I'm still working on your request and will email you when complete.`;

  return sendResponse({
    to,
    from,
    subject: `⏳ ${originalSubject}`,
    body,
  });
}

export async function sendConfirmationEmail(
  to: string,
  from: string,
  taskId: string,
  goal: string,
  confirmationMessage: string
): Promise<boolean> {
  // SECURITY: Sanitize header fields
  const safeTo = sanitizeEmailHeader(to);
  const safeFrom = sanitizeEmailHeader(from);
  const safeGoal = sanitizeEmailHeader(goal);

  // BLOCK: Check if recipient is on the blocked list
  if (await isEmailBlocked(safeTo)) {
    console.log(`[EMAIL-BLOCK] Blocked confirmation email to ${safeTo} — user opted out`);
    return false;
  }

  const body = `${confirmationMessage}

---
(Task ID: ${taskId})`;

  try {
    const htmlBody = formatResponseEmail(body);

    const { error } = await getResendClient().emails.send({
      from: safeFrom,
      to: safeTo,
      subject: `Confirm: ${safeGoal.slice(0, 40)}${safeGoal.length > 40 ? '...' : ''}`,
      html: htmlBody,
      text: body,
    });

    if (error) {
      console.error("Failed to send confirmation email:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Confirmation email error:", error);
    return false;
  }
}

export async function sendVerificationCodeRequest(
  to: string,
  from: string,
  taskId: string,
  context: string,
  liveViewUrl?: string
): Promise<boolean> {
  // SECURITY: Sanitize header fields
  const safeTo = sanitizeEmailHeader(to);
  const safeFrom = sanitizeEmailHeader(from);

  // BLOCK: Check if recipient is on the blocked list
  if (await isEmailBlocked(safeTo)) {
    console.log(`[EMAIL-BLOCK] Blocked verification email to ${safeTo} — user opted out`);
    return false;
  }

  const liveViewSection = liveViewUrl
    ? `\n\n**Or enter it yourself:** ${liveViewUrl}\nOpen this link on any device to see and control the browser directly.\n`
    : '';

  const body = `🔐 **Need verification code to continue**

I'm trying to ${context} but need a verification code.

A code was just sent to your phone/email.

**Reply with the code and I'll continue.**${liveViewSection}

(This request expires in 10 minutes)

---
(Task ID: ${taskId})`;

  try {
    const htmlBody = formatResponseEmail(body);

    const { error } = await getResendClient().emails.send({
      from: safeFrom,
      to: safeTo,
      subject: `🔐 Need verification code to continue`,
      html: htmlBody,
      text: body,
    });

    if (error) {
      console.error("Failed to send verification request:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Verification request email error:", error);
    return false;
  }
}

export async function sendTaskAccepted(
  to: string,
  from: string,
  goal: string,
  taskId?: string
): Promise<boolean> {
  // SECURITY: Sanitize header fields
  const safeTo = sanitizeEmailHeader(to);
  const safeFrom = sanitizeEmailHeader(from);

  // BLOCK: Check if recipient is on the blocked list
  if (await isEmailBlocked(safeTo)) {
    console.log(`[EMAIL-BLOCK] Blocked task-accepted email to ${safeTo} — user opted out`);
    return false;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.aevoy.com';
  const taskLink = taskId ? `\n\n📊 **Track progress:** ${appUrl}/dashboard/tasks/${taskId}` : '';
  const body = `Got it! Working on: "${goal}"

I'll email you when it's done.${taskLink}`;

  try {
    const htmlBody = formatResponseEmail(body);

    const { error } = await getResendClient().emails.send({
      from: safeFrom,
      to: safeTo,
      subject: `Working on it...`,
      html: htmlBody,
      text: body,
    });

    if (error) {
      console.error("Failed to send task accepted email:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Task accepted email error:", error);
    return false;
  }
}

export async function sendTaskCancelled(
  to: string,
  from: string,
  originalSubject: string
): Promise<boolean> {
  const body = `Cancelled. Let me know if you need anything else!`;

  return sendResponse({
    to,
    from,
    subject: originalSubject,
    body,
  });
}
