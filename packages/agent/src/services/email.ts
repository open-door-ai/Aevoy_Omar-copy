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

export function formatResponseEmail(body: string): string {
  // Convert markdown-ish text to HTML
  const paragraphs = body.split("\n\n");
  
  const htmlParagraphs = paragraphs.map((p) => {
    // Convert headers
    if (p.startsWith("# ")) {
      return `<h1 style="margin-top: 20px; font-size: 24px;">${p.slice(2)}</h1>`;
    }
    if (p.startsWith("## ")) {
      return `<h2 style="margin-top: 16px; font-size: 20px;">${p.slice(3)}</h2>`;
    }
    if (p.startsWith("### ")) {
      return `<h3 style="margin-top: 12px; font-size: 16px;">${p.slice(4)}</h3>`;
    }

    // Convert bullet lists
    if (p.includes("\n- ")) {
      const lines = p.split("\n");
      const listItems = lines
        .filter((line) => line.startsWith("- "))
        .map((line) => `<li>${line.slice(2)}</li>`)
        .join("");
      return `<ul style="margin: 10px 0; padding-left: 20px;">${listItems}</ul>`;
    }

    // Convert line breaks within paragraph
    const withBreaks = p.replace(/\n/g, "<br>");
    return `<p style="margin: 10px 0;">${withBreaks}</p>`;
  });

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        a {
          color: #0066cc;
        }
        code {
          background: #f4f4f4;
          padding: 2px 6px;
          border-radius: 3px;
          font-family: monospace;
        }
      </style>
    </head>
    <body>
      ${htmlParagraphs.join("\n")}
      <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;">
      <p style="font-size: 12px; color: #666;">
        This email was sent by your AI assistant at Aevoy.
      </p>
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

Visit your dashboard to upgrade: https://aevoy.ai/dashboard/settings

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
