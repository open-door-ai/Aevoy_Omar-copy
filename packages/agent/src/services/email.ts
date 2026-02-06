import { Resend } from "resend";

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
  const { to, from, subject, body, attachments } = options;

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

    const { error } = await getResendClient().emails.send(emailData);

    if (error) {
      console.error("Failed to send email:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Email service error:", error);
    return false;
  }
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
                  <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #1c1917; letter-spacing: -0.02em;">Aevoy</h1>
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
                    Sent by your AI assistant at Aevoy
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
  errorMessage: string
): Promise<boolean> {
  const body = `I apologize, but I encountered an error while processing your request.

**Error:** ${errorMessage}

Please try again, or if the issue persists, reach out to support.

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
  progressMessage: string
): Promise<boolean> {
  const body = `**Task Update**

${progressMessage}

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
  const body = `${confirmationMessage}

---
(Task ID: ${taskId})`;

  try {
    const htmlBody = formatResponseEmail(body);
    
    const { error } = await getResendClient().emails.send({
      from,
      to,
      subject: `Confirm: ${goal.slice(0, 40)}${goal.length > 40 ? '...' : ''}`,
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
  context: string
): Promise<boolean> {
  const body = `🔐 **Need verification code to continue**

I'm trying to ${context} but need a verification code.

A code was just sent to your phone/email.

**Reply with the code and I'll continue.**

(This request expires in 10 minutes)

---
(Task ID: ${taskId})`;

  try {
    const htmlBody = formatResponseEmail(body);
    
    const { error } = await getResendClient().emails.send({
      from,
      to,
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
  goal: string
): Promise<boolean> {
  const body = `Got it! Working on: "${goal}"

I'll email you when it's done.`;

  try {
    const htmlBody = formatResponseEmail(body);
    
    const { error } = await getResendClient().emails.send({
      from,
      to,
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
