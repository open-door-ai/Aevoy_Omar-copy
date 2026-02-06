import PostalMime from "postal-mime";

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
  email_pin?: string | null;
  email_pin_attempts?: number;
  email_pin_locked_until?: string | null;
}

type EmailType = 'confirmation_reply' | 'verification_reply' | 'magic_link' | 'new_task';

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
): Promise<{ subject: string; body: string; bodyHtml?: string; attachments?: { filename: string; mimeType: string; size: number }[] }> {
  const reader = raw.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const rawBytes = chunks.reduce((acc, chunk) => {
    const tmp = new Uint8Array(acc.length + chunk.length);
    tmp.set(acc, 0);
    tmp.set(chunk, acc.length);
    return tmp;
  }, new Uint8Array());

  try {
    // Use postal-mime for proper MIME multipart parsing
    const parser = new PostalMime();
    const email = await parser.parse(rawBytes);

    const subject = email.subject || "No subject";
    const body = email.text || email.html?.replace(/<[^>]*>/g, "").trim() || "";
    const bodyHtml = email.html || undefined;
    const attachments = (email.attachments || []).map((att) => ({
      filename: att.filename || "unnamed",
      mimeType: att.mimeType || "application/octet-stream",
      size: att.content instanceof ArrayBuffer ? att.content.byteLength : (att.content?.length || 0),
    }));

    return { subject, body, bodyHtml, attachments: attachments.length > 0 ? attachments : undefined };
  } catch (parseError) {
    // Fallback to simple parsing if postal-mime fails
    console.error("postal-mime parse failed, using fallback:", parseError);
    const fullEmail = new TextDecoder().decode(rawBytes);
    const headerEnd = fullEmail.indexOf("\r\n\r\n");
    const headers = headerEnd > 0 ? fullEmail.substring(0, headerEnd) : "";
    const bodyRaw = headerEnd > 0 ? fullEmail.substring(headerEnd + 4) : fullEmail;

    const subjectMatch = headers.match(/^Subject: (.+)$/im);
    const subject = subjectMatch ? subjectMatch[1].trim() : "No subject";
    const plainBody = bodyRaw.replace(/<[^>]*>/g, "").trim();

    return {
      subject,
      body: plainBody,
      bodyHtml: bodyRaw.includes("<") ? bodyRaw : undefined,
    };
  }
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

  // Check for magic link emails (login/verification links from other services)
  const magicLinkPatterns = [
    /(?:sign.?in|log.?in|verify|confirm|magic).?link/i,
    /click\s+(?:here|this\s+link)\s+to\s+(?:sign|log)\s*in/i,
    /one-time\s+(?:link|login)/i,
  ];

  const isMagicLink = magicLinkPatterns.some(p => p.test(subject) || p.test(body));
  if (isMagicLink) {
    // Extract any URL that looks like a login/verification link
    const urlMatch = body.match(/https?:\/\/[^\s<>"]+(?:token|verify|login|auth|magic|confirm)[^\s<>"]*/i);
    if (urlMatch) {
      return {
        type: 'magic_link' as EmailType,
        taskId: null
      };
    }
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

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok || response.status < 500) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
    if (attempt < maxRetries - 1) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  throw lastError || new Error("fetchWithRetry failed");
}

/**
 * Send email via Resend (using agent's email service)
 */
async function sendEmailViaAgent(params: {
  to: string;
  from: string;
  subject: string;
  html: string;
  agentUrl: string;
  webhookSecret: string;
}): Promise<void> {
  try {
    await fetch(`${params.agentUrl}/email/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": params.webhookSecret,
      },
      body: JSON.stringify({
        to: params.to,
        from: params.from,
        subject: params.subject,
        body: params.html,
        bodyHtml: params.html,
      }),
    });
  } catch (error) {
    console.error("[EMAIL] Failed to send email via agent:", error);
  }
}

/**
 * Create Supabase client for worker
 */
function getSupabaseClient(url: string, key: string) {
  return {
    from: (table: string) => ({
      select: (fields: string) => ({
        eq: (column: string, value: unknown) => ({
          single: async () => {
            const response = await fetch(
              `${url}/rest/v1/${table}?${column}=eq.${value}&select=${fields}`,
              {
                headers: {
                  apikey: key,
                  Authorization: `Bearer ${key}`,
                },
              }
            );
            const data = await response.json();
            return { data: Array.isArray(data) && data.length > 0 ? data[0] : null, error: null };
          },
          gt: (column2: string, value2: unknown) => ({
            order: (column3: string, opts: { desc: boolean }) => ({
              limit: (n: number) => ({
                single: async () => {
                  let query = `${url}/rest/v1/${table}?${column}=eq.${value}&${column2}=gt.${value2}&select=${fields}&limit=${n}`;
                  if (opts.desc) query += `&order=${column3}.desc`;
                  const response = await fetch(query, {
                    headers: {
                      apikey: key,
                      Authorization: `Bearer ${key}`,
                    },
                  });
                  const data = await response.json();
                  return { data: Array.isArray(data) && data.length > 0 ? data[0] : null, error: data.length === 0 ? { message: 'Not found' } : null };
                },
              }),
            }),
          }),
        }),
      }),
      insert: (values: unknown) => ({
        select: () => ({
          single: async () => {
            const response = await fetch(`${url}/rest/v1/${table}`, {
              method: "POST",
              headers: {
                apikey: key,
                Authorization: `Bearer ${key}`,
                "Content-Type": "application/json",
                Prefer: "return=representation",
              },
              body: JSON.stringify(values),
            });
            const data = await response.json();
            return { data: Array.isArray(data) && data.length > 0 ? data[0] : data, error: response.ok ? null : data };
          },
        }),
      }),
      update: (values: unknown) => ({
        eq: (column: string, value: unknown) => ({
          execute: async () => {
            const response = await fetch(
              `${url}/rest/v1/${table}?${column}=eq.${value}`,
              {
                method: "PATCH",
                headers: {
                  apikey: key,
                  Authorization: `Bearer ${key}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(values),
              }
            );
            return { error: response.ok ? null : await response.json() };
          },
        }),
      }),
    }),
    rpc: (fn: string, params: unknown) => ({
      execute: async () => {
        const response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
          method: "POST",
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(params),
        });
        return { error: response.ok ? null : await response.json() };
      },
    }),
  };
}

export default {
  async email(message: EmailMessage, env: Env): Promise<void> {
    try {
      console.log(`[EMAIL] Received, size: ${message.rawSize}`);

      // Extract username from to address
      const toAddress = message.to.toLowerCase();
      const username = toAddress.split("@")[0];

      if (!username || !/^[a-zA-Z0-9_-]+$/.test(username)) {
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

      // Validate sender matches registered user email
      const senderEmail = message.from.toLowerCase().trim();
      const registeredEmail = user.email?.toLowerCase().trim() || "";

      // EMAIL PIN VERIFICATION FLOW
      if (registeredEmail && senderEmail !== registeredEmail) {
        console.log(`[EMAIL] Unregistered sender ${senderEmail} for user ${username}`);

        const supabase = getSupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

        // Check if user has email PIN configured
        if (!user.email_pin) {
          // No PIN - send setup instructions to registered email
          await sendEmailViaAgent({
            to: registeredEmail,
            from: "security@aevoy.com",
            subject: "🔒 Security Alert: Email from Unregistered Sender",
            html: `
              <p>Someone tried to email your AI from <strong>${senderEmail}</strong>.</p>
              <p>To allow emails from other addresses, set up an <strong>Email PIN</strong> in Settings → Security.</p>
              <p>Subject: ${(await parseEmail(message.raw)).subject}</p>
            `,
            agentUrl: env.AGENT_URL,
            webhookSecret: env.AGENT_WEBHOOK_SECRET,
          });

          message.setReject("Email PIN not configured for this account");
          return;
        }

        // Check if PIN locked (3 failed attempts)
        if (user.email_pin_locked_until && new Date(user.email_pin_locked_until) > new Date()) {
          console.log(`[EMAIL] User ${user.id} email PIN locked until ${user.email_pin_locked_until}`);

          await sendEmailViaAgent({
            to: registeredEmail,
            from: "security@aevoy.com",
            subject: "🔒 Email PIN Locked",
            html: `
              <p>Too many failed PIN attempts from <strong>${senderEmail}</strong>.</p>
              <p>Email verification is locked for 15 minutes.</p>
            `,
            agentUrl: env.AGENT_URL,
            webhookSecret: env.AGENT_WEBHOOK_SECRET,
          });

          message.setReject("Email PIN temporarily locked");
          return;
        }

        // Parse email early for PIN check
        const { subject, body, bodyHtml, attachments } = await parseEmail(message.raw);

        // Check if this is a PIN verification reply
        const pinMatch = body?.match(/\b\d{6}\b/); // Extract 6-digit PIN
        const isReplyToPinRequest = subject?.toLowerCase().includes("email pin required");

        if (pinMatch && isReplyToPinRequest) {
          const enteredPin = pinMatch[0];
          console.log(`[EMAIL] PIN verification attempt: ${enteredPin.slice(0, 2)}****`);

          // Find matching session
          const { data: session, error: sessionError } = await supabase
            .from("email_pin_sessions")
            .select("*")
            .eq("user_id", user.id)
            .eq("pin_code", enteredPin)
            .gt("expires_at", new Date().toISOString())
            .order("created_at", { desc: true })
            .limit(1)
            .single();

          if (!sessionError && session) {
            // PIN VERIFIED! Process original email
            console.log(`[EMAIL] PIN verified for ${session.sender_email}`);

            // Mark session as verified
            await supabase
              .from("email_pin_sessions")
              .update({ verified: true })
              .eq("id", session.id)
              .execute();

            // Reset PIN attempts
            await supabase.rpc("reset_email_pin_attempts", { p_user_id: user.id }).execute();

            // Forward original task to agent
            await fetchWithRetry(`${env.AGENT_URL}/task/incoming`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Webhook-Secret": env.AGENT_WEBHOOK_SECRET,
              },
              body: JSON.stringify({
                userId: user.id,
                username: user.username,
                from: session.sender_email,
                subject: session.email_subject,
                body: session.email_body,
                bodyHtml: session.email_body_html,
                attachments: session.attachments,
                inputChannel: "email",
              }),
            });

            // Confirm to user
            await sendEmailViaAgent({
              to: registeredEmail,
              from: "security@aevoy.com",
              subject: "✅ Email Verified",
              html: `
                <p>PIN verified successfully!</p>
                <p>Your AI is now processing the task from <strong>${session.sender_email}</strong>.</p>
                <p><em>Original subject: ${session.email_subject}</em></p>
              `,
              agentUrl: env.AGENT_URL,
              webhookSecret: env.AGENT_WEBHOOK_SECRET,
            });

            message.setReject("PIN verified - task forwarded to agent");
            return;
          } else {
            // Invalid or expired PIN
            console.log(`[EMAIL] Invalid PIN attempt from ${senderEmail}`);

            // Increment attempts
            await supabase.rpc("increment_email_pin_attempts", { p_user_id: user.id }).execute();

            // Check if should lock
            const { data: profile } = await supabase
              .from("profiles")
              .select("email_pin_attempts")
              .eq("id", user.id)
              .single();

            if (profile && profile.email_pin_attempts >= 3) {
              // Lock for 15 minutes
              const lockUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
              await supabase
                .from("profiles")
                .update({ email_pin_locked_until: lockUntil })
                .eq("id", user.id)
                .execute();

              await sendEmailViaAgent({
                to: registeredEmail,
                from: "security@aevoy.com",
                subject: "🔒 Email PIN Locked",
                html: `
                  <p>Too many failed PIN attempts.</p>
                  <p>Email verification locked for 15 minutes.</p>
                `,
                agentUrl: env.AGENT_URL,
                webhookSecret: env.AGENT_WEBHOOK_SECRET,
              });
            } else {
              const remaining = 3 - (profile?.email_pin_attempts || 0);
              await sendEmailViaAgent({
                to: registeredEmail,
                from: "security@aevoy.com",
                subject: "❌ Invalid PIN",
                html: `
                  <p>The PIN you entered was invalid or expired.</p>
                  <p>Attempts remaining: <strong>${remaining}</strong></p>
                `,
                agentUrl: env.AGENT_URL,
                webhookSecret: env.AGENT_WEBHOOK_SECRET,
              });
            }

            message.setReject("Invalid PIN");
            return;
          }
        }

        // Generate new PIN and create session
        const pinCode = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit PIN

        const { data: newSession, error: sessionInsertError } = await supabase
          .from("email_pin_sessions")
          .insert({
            user_id: user.id,
            sender_email: senderEmail,
            pin_code: pinCode,
            email_subject: subject,
            email_body: body,
            email_body_html: bodyHtml,
            attachments: attachments ? JSON.stringify(attachments) : null,
            expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min
          })
          .select()
          .single();

        if (sessionInsertError) {
          console.error("[EMAIL] Failed to create PIN session:", sessionInsertError);
          message.setReject("Internal error creating PIN session");
          return;
        }

        // Send PIN to registered email
        await sendEmailViaAgent({
          to: registeredEmail,
          from: "security@aevoy.com",
          subject: `🔐 Email PIN Required: ${senderEmail}`,
          html: `
            <h3>Someone from ${senderEmail} sent you a task:</h3>
            <p><strong>Subject:</strong> ${subject}</p>
            <p><strong>Preview:</strong> ${body?.substring(0, 200)}...</p>
            <hr>
            <h2 style="color: #0066ff; font-size: 32px; letter-spacing: 4px;">${pinCode}</h2>
            <p>To process this task, <strong>reply to this email with the PIN above</strong>.</p>
            <p><em>This PIN expires in 10 minutes.</em></p>
            <p><small>If you didn't expect this, ignore this email. The task will not be processed.</small></p>
          `,
          agentUrl: env.AGENT_URL,
          webhookSecret: env.AGENT_WEBHOOK_SECRET,
        });

        // Send auto-reply to sender
        await sendEmailViaAgent({
          to: senderEmail,
          from: `${username}@aevoy.com`,
          subject: `Re: ${subject}`,
          html: `
            <p>Your message has been received and is awaiting verification.</p>
            <p>A PIN has been sent to the account owner for approval.</p>
            <p>You'll be notified once your request is processed.</p>
          `,
          agentUrl: env.AGENT_URL,
          webhookSecret: env.AGENT_WEBHOOK_SECRET,
        });

        message.setReject("Awaiting PIN verification");
        return;
      }
      // END EMAIL PIN VERIFICATION FLOW

      // Check quota
      if (user.messages_used >= user.messages_limit) {
        console.log(`User over quota: ${username}`);
        // Don't reject - forward to agent to send over-quota email
      }

      // Parse email content
      const { subject, body, bodyHtml, attachments } = await parseEmail(message.raw);

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
              attachments,
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
              attachments,
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

        case 'magic_link': {
          // Extract the magic link URL and forward to agent via /task/incoming
          const urlMatch = body.match(/https?:\/\/[^\s<>"]+(?:token|verify|login|auth|magic|confirm)[^\s<>"]*/i);
          endpoint = '/task/incoming';
          payload = {
            userId: user.id,
            username: user.username,
            from: message.from,
            type: 'magic_link',
            magicLinkUrl: urlMatch ? urlMatch[0] : null,
            subject,
            body,
            attachments,
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
            attachments,
          };
          break;
      }

      // Forward to agent server with retry
      try {
        const response = await fetchWithRetry(`${env.AGENT_URL}${endpoint}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Secret": env.AGENT_WEBHOOK_SECRET,
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          console.error(`Agent returned ${response.status} for ${endpoint}`);
        }
      } catch (retryError) {
        console.error(`All retries failed for ${endpoint}:`, retryError);
      }

      console.log(`[EMAIL] ${emailType} forwarded for user ${username}`);
    } catch (error) {
      console.error("Email processing error:", error);
      // Don't reject for processing errors - we received the email
    }
  },
};
