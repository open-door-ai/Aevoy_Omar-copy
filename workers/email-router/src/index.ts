interface Env {
  AGENT_URL: string;
  AGENT_WEBHOOK_SECRET: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

interface EmailMessage {
  from: string;
  to: string;
  headers: Headers;
  raw: ReadableStream;
  rawSize: number;
  setReject(reason: string): void;
  forward(to: string): Promise<void>;
}

interface Profile {
  id: string;
  username: string;
  email: string;
  messages_used: number;
  messages_limit: number;
}

type EmailType = 'confirmation_reply' | 'verification_reply' | 'new_task';

async function getUser(
  username: string,
  supabaseUrl: string,
  supabaseKey: string
): Promise<Profile | null> {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/profiles?username=eq.${username}&select=*`,
    {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    }
  );

  if (!response.ok) {
    console.error("Failed to fetch user:", response.status);
    return null;
  }

  const users = (await response.json()) as Profile[];
  return users.length > 0 ? users[0] : null;
}

async function parseEmail(
  raw: ReadableStream
): Promise<{ subject: string; body: string; bodyHtml?: string }> {
  const reader = raw.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const fullEmail = new TextDecoder().decode(
    chunks.reduce((acc, chunk) => {
      const tmp = new Uint8Array(acc.length + chunk.length);
      tmp.set(acc, 0);
      tmp.set(chunk, acc.length);
      return tmp;
    }, new Uint8Array())
  );

  // Simple email parsing - for production, use a proper email parser
  const headerEnd = fullEmail.indexOf("\r\n\r\n");
  const headers = fullEmail.substring(0, headerEnd);
  const body = fullEmail.substring(headerEnd + 4);

  // Extract subject
  const subjectMatch = headers.match(/^Subject: (.+)$/im);
  const subject = subjectMatch ? subjectMatch[1].trim() : "No subject";

  // For simplicity, treat the rest as plain text body
  // In production, handle MIME multipart properly
  const plainBody = body.replace(/<[^>]*>/g, "").trim();

  return {
    subject,
    body: plainBody,
    bodyHtml: body.includes("<") ? body : undefined,
  };
}

/**
 * Detect if this email is a reply to a confirmation request or verification request
 */
function detectEmailType(subject: string, body: string): { type: EmailType; taskId: string | null } {
  // Check for confirmation reply (subject contains "Confirm:" or "Re: Confirm:")
  if (subject.toLowerCase().includes("confirm:")) {
    // Try to extract task ID from body
    const taskIdMatch = body.match(/Task ID:\s*([a-f0-9-]+)/i);
    return {
      type: 'confirmation_reply',
      taskId: taskIdMatch ? taskIdMatch[1] : null
    };
  }

  // Check for verification code reply (subject contains "verification code")
  if (subject.toLowerCase().includes("verification code")) {
    const taskIdMatch = body.match(/Task ID:\s*([a-f0-9-]+)/i);
    return {
      type: 'verification_reply',
      taskId: taskIdMatch ? taskIdMatch[1] : null
    };
  }

  // Also check if the body contains Task ID (might be a quote from previous email)
  const taskIdMatch = body.match(/Task ID:\s*([a-f0-9-]+)/i);
  if (taskIdMatch) {
    // Check first line of reply to determine type
    const firstLine = body.split('\n')[0].toLowerCase().trim();
    if (/^\d{4,8}$/.test(firstLine)) {
      // First line is just digits - likely a verification code
      return {
        type: 'verification_reply',
        taskId: taskIdMatch[1]
      };
    }
    // Otherwise assume confirmation reply
    return {
      type: 'confirmation_reply',
      taskId: taskIdMatch[1]
    };
  }

  return {
    type: 'new_task',
    taskId: null
  };
}

/**
 * Extract the actual reply text from an email (remove quoted content)
 */
function extractReplyText(body: string): string {
  // Common patterns for quoted text
  const lines = body.split('\n');
  const replyLines: string[] = [];
  
  for (const line of lines) {
    // Stop at common quote indicators
    if (line.startsWith('>') || 
        line.startsWith('On ') && line.includes(' wrote:') ||
        line.includes('-----Original Message-----') ||
        line.includes('_______________') ||
        line.match(/^From:\s+/i) ||
        line.includes('Task ID:')) {
      break;
    }
    replyLines.push(line);
  }
  
  return replyLines.join('\n').trim();
}

export default {
  async email(message: EmailMessage, env: Env): Promise<void> {
    try {
      console.log(`Email received from ${message.from} to ${message.to}`);

      // Extract username from to address
      const toAddress = message.to.toLowerCase();
      const username = toAddress.split("@")[0];

      if (!username) {
        message.setReject("Invalid recipient address");
        return;
      }

      // Look up user in Supabase
      const user = await getUser(username, env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

      if (!user) {
        console.log(`User not found: ${username}`);
        message.setReject("User not found");
        return;
      }

      // Check quota
      if (user.messages_used >= user.messages_limit) {
        console.log(`User over quota: ${username}`);
        // Don't reject - forward to agent to send over-quota email
      }

      // Parse email content
      const { subject, body, bodyHtml } = await parseEmail(message.raw);

      // Detect email type (confirmation reply, verification reply, or new task)
      const { type: emailType, taskId } = detectEmailType(subject, body);
      console.log(`Email type: ${emailType}, Task ID: ${taskId}`);

      let endpoint: string;
      let payload: Record<string, unknown>;

      switch (emailType) {
        case 'confirmation_reply': {
          if (!taskId) {
            // No task ID found, treat as new task
            endpoint = '/task/incoming';
            payload = {
              userId: user.id,
              username: user.username,
              from: message.from,
              subject,
              body,
              bodyHtml,
            };
            break;
          }
          
          endpoint = '/task/confirm';
          const replyText = extractReplyText(body);
          payload = {
            userId: user.id,
            username: user.username,
            from: message.from,
            taskId,
            replyText,
          };
          break;
        }

        case 'verification_reply': {
          if (!taskId) {
            // No task ID found, treat as new task
            endpoint = '/task/incoming';
            payload = {
              userId: user.id,
              username: user.username,
              from: message.from,
              subject,
              body,
              bodyHtml,
            };
            break;
          }
          
          endpoint = '/task/verification';
          // Extract the verification code from the reply
          const replyText = extractReplyText(body);
          const codeMatch = replyText.match(/\b(\d{4,8})\b/);
          payload = {
            userId: user.id,
            username: user.username,
            from: message.from,
            taskId,
            code: codeMatch ? codeMatch[1] : replyText.trim(),
          };
          break;
        }

        case 'new_task':
        default:
          endpoint = '/task/incoming';
          payload = {
            userId: user.id,
            username: user.username,
            from: message.from,
            subject,
            body,
            bodyHtml,
          };
          break;
      }

      // Forward to agent server
      const response = await fetch(`${env.AGENT_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": env.AGENT_WEBHOOK_SECRET,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error(`Failed to forward to agent (${endpoint}):`, response.status);
        // Don't reject - email was received, just processing failed
      }

      console.log(`${emailType} forwarded for user ${username} to ${endpoint}`);
    } catch (error) {
      console.error("Email processing error:", error);
      // Don't reject for processing errors - we received the email
    }
  },
};
