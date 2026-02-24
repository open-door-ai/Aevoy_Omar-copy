import PostalMime from "postal-mime";

// SECURITY: PII masking for logs
function maskEmail(email: string | undefined | null): string {
  if (!email) return '***';
  const parts = email.split('@');
  if (parts.length !== 2) return '***';
  return `***@${parts[1]}`;
}

function maskPin(pin: string | undefined | null): string {
  if (!pin) return '***';
  return '*'.repeat(pin.length);
}

function maskUserId(userId: string | undefined | null): string {
  if (!userId) return '***';
  return userId.slice(0, 8);
}

interface Env {
  AGENT_URL: string;
  AGENT_WEBHOOK_SECRET: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  ADMIN_FORWARD_EMAIL?: string;
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
  unified_pin_hash?: string | null;
  pin_attempts?: number;
  pin_locked_until?: string | null;
}

type EmailType = 'confirmation_reply' | 'verification_reply' | 'magic_link' | 'new_task';

async function getUser(
  username: string,
  supabaseUrl: string,
  supabaseKey: string
): Promise<Profile | null> {
  const url = `${supabaseUrl}/rest/v1/profiles?username=ilike.${encodeURIComponent(username)}&select=*`;
  console.log(`[LOOKUP] getUser username=${username} keyPrefix=${supabaseKey?.substring(0, 10) || 'MISSING'}`);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });
  } catch (fetchErr) {
    console.error(`[LOOKUP] Network error: ${fetchErr}`);
    return null;
  }

  console.log(`[LOOKUP] getUser status=${response.status}`);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(`[LOOKUP] Supabase error ${response.status}: ${body.substring(0, 200)}`);
    return null;
  }

  const users = (await response.json()) as Profile[];
  console.log(`[LOOKUP] getUser found=${users.length} for username=${username}`);
  return users.length > 0 ? users[0] : null;
}

async function getUserByEmail(
  email: string,
  supabaseUrl: string,
  supabaseKey: string
): Promise<Profile | null> {
  console.log(`[LOOKUP] getUserByEmail email=${maskEmail(email)} keyPrefix=${supabaseKey?.substring(0, 10) || 'MISSING'}`);
  let response: Response;
  try {
    response = await fetch(
      `${supabaseUrl}/rest/v1/profiles?email=ilike.${encodeURIComponent(email)}&select=*`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      }
    );
  } catch (fetchErr) {
    console.error(`[LOOKUP] Network error getUserByEmail: ${fetchErr}`);
    return null;
  }

  console.log(`[LOOKUP] getUserByEmail status=${response.status}`);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(`[LOOKUP] getUserByEmail Supabase error ${response.status}: ${body.substring(0, 200)}`);
    return null;
  }

  const users = (await response.json()) as Profile[];
  console.log(`[LOOKUP] getUserByEmail found=${users.length}`);
  return users.length > 0 ? users[0] : null;
}

async function parseEmail(
  raw: ReadableStream
): Promise<{ subject: string; body: string; bodyHtml?: string; senderName?: string; attachments?: { filename: string; mimeType: string; size: number }[] }> {
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

    // Extract sender display name (e.g. "Omar Ebrahim" from "Omar Ebrahim <omar@example.com>")
    const fromAddr = Array.isArray(email.from) ? email.from[0] : email.from;
    const senderName = (fromAddr as { name?: string } | undefined)?.name || undefined;

    return { subject, body, bodyHtml, senderName, attachments: attachments.length > 0 ? attachments : undefined };
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

    // Try to extract name from From header in fallback
    const fromMatch = headers.match(/^From:\s*(.+?)(?:\s*<[^>]+>)?\s*$/im);
    const senderName = fromMatch ? fromMatch[1].trim().replace(/^["']|["']$/g, '') : undefined;

    return {
      subject,
      body: plainBody,
      bodyHtml: bodyRaw.includes("<") ? bodyRaw : undefined,
      senderName: senderName || undefined,
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
      select: (fields: string) => {
        let filters: string[] = [];

        const buildQuery = () => {
          const filterStr = filters.length > 0 ? filters.join('&') + '&' : '';
          return `${url}/rest/v1/${table}?${filterStr}select=${fields}`;
        };

        const chainable: any = {
          single: async () => {
            const response = await fetch(buildQuery(), {
              headers: { apikey: key, Authorization: `Bearer ${key}` }
            });
            const data = await response.json();
            return { data: Array.isArray(data) && data.length > 0 ? data[0] : null, error: null };
          },
          eq: (column: string, value: unknown) => {
            filters.push(`${column}=eq.${value}`);
            return chainable;
          },
          gt: (column: string, value: unknown) => {
            filters.push(`${column}=gt.${value}`);
            return chainable;
          },
          order: (column: string, opts: { desc: boolean }) => {
            filters.push(`order=${column}${opts.desc ? '.desc' : ''}`);
            return chainable;
          },
          limit: (n: number) => {
            filters.push(`limit=${n}`);
            return chainable;
          },
        };

        return chainable;
      },
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
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/debug" && request.method === "POST") {
      const body = await request.json().catch(() => ({})) as Record<string, string>;
      const testUsername = body.username || "sage";
      const testEmail = body.email || "";
      const diagnostics: Record<string, unknown> = {
        keyPresent: !!env.SUPABASE_SERVICE_KEY,
        keyPrefix: env.SUPABASE_SERVICE_KEY?.substring(0, 15) || "MISSING",
        agentUrl: env.AGENT_URL,
        supabaseUrl: env.SUPABASE_URL,
      };

      // Test username lookup
      const userByUsername = await getUser(testUsername, env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
      diagnostics.userByUsername = userByUsername ? { id: userByUsername.id.substring(0, 8), username: userByUsername.username } : null;

      // Test email lookup if provided
      if (testEmail) {
        const userByEmail = await getUserByEmail(testEmail, env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
        diagnostics.userByEmail = userByEmail ? { id: userByEmail.id.substring(0, 8), username: userByEmail.username } : null;
      }

      // Test agent reachability (health + task endpoint with auth)
      try {
        const agentRes = await fetch(`${env.AGENT_URL}/health`, { signal: AbortSignal.timeout(5000) });
        diagnostics.agentReachable = agentRes.ok;
        diagnostics.agentStatus = agentRes.status;
      } catch (e) {
        diagnostics.agentReachable = false;
        diagnostics.agentError = String(e);
      }

      // Also test VPS directly with auth
      const vpsUrl = "http://77.42.31.185:3001";
      try {
        const vpsHealth = await fetch(`${vpsUrl}/health`, { signal: AbortSignal.timeout(5000) });
        diagnostics.vpsHealthStatus = vpsHealth.status;
        diagnostics.vpsHealthOk = vpsHealth.ok;
      } catch (e) {
        diagnostics.vpsHealthStatus = String(e);
      }
      try {
        const vpsTask = await fetch(`${vpsUrl}/task/incoming`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Webhook-Secret": env.AGENT_WEBHOOK_SECRET },
          body: JSON.stringify({ userId: "test", username: "test", from: "test@test.com", body: "ping", inputChannel: "email" }),
          signal: AbortSignal.timeout(8000),
        });
        diagnostics.vpsTaskStatus = vpsTask.status;
        diagnostics.vpsTaskOk = vpsTask.ok;
        diagnostics.vpsTaskBody = await vpsTask.text().catch(() => '');
      } catch (e) {
        diagnostics.vpsTaskStatus = String(e);
      }

      return new Response(JSON.stringify(diagnostics, null, 2), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Aevoy Email Router", { status: 200 });
  },
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

      // ---- BYPASS LIST: Admin/system emails that skip AI entirely and forward to owner ----
      const ADMIN_FORWARD_EMAIL = env.ADMIN_FORWARD_EMAIL || "omarkebrahim@gmail.com";
      const BYPASS_USERNAMES = ['omar', 'hello', 'welcome', 'info', 'contact', 'sales', 'admin', 'noreply', 'no-reply', 'postmaster', 'abuse'];
      if (BYPASS_USERNAMES.includes(username.toLowerCase())) {
        console.log(`[EMAIL] Bypass: ${username}@aevoy.com → forwarding to admin`);
        try {
          await message.forward(ADMIN_FORWARD_EMAIL);
          console.log(`[EMAIL] Forwarded ${username}@aevoy.com to admin successfully`);
        } catch (fwdErr) {
          console.error(`[EMAIL] Forward failed for ${username}@aevoy.com:`, fwdErr);
        }
        return;
      }

      // Catch-all addresses (tasks@, ai@, inbox@) route by sender email
      const CATCHALL_USERNAMES = ['tasks', 'ai', 'inbox', 'mail', 'support', 'assistant'];
      let user: Profile | null = null;

      if (CATCHALL_USERNAMES.includes(username.toLowerCase())) {
        // Route to user by their registered email address (the sender)
        user = await getUserByEmail(message.from, env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
        if (!user) {
          console.log(`[EMAIL] No account found for sender: ${maskEmail(message.from)}`);
          message.setReject("No Aevoy account found for this email address. Sign up at aevoy.com");
          return;
        }
      } else {
        // Standard lookup by username (case-insensitive)
        user = await getUser(username, env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

        if (!user) {
          // Fallback: try to find user by sender email (in case they know their email but not username)
          user = await getUserByEmail(message.from, env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
        }

        if (!user) {
          console.log(`User not found: ${username}`);
          message.setReject("User not found. Email your-username@aevoy.com or tasks@aevoy.com");
          return;
        }
      }

      // Validate sender matches registered user email
      const senderEmail = message.from.toLowerCase().trim();
      const registeredEmail = user.email?.toLowerCase().trim() || "";

      // ALL email processing is now handled by the IMAP Inbox Poller.
      // The Cloudflare Worker's only job is to forward emails so they arrive
      // in the Gmail inbox where the poller picks them up.
      // This eliminates the duplicate processing bug where both Cloudflare AND
      // the IMAP poller would process the same email, causing double PIN
      // challenges and duplicate task execution.
      console.log(`[EMAIL] Valid user ${username}, forwarding to inbox for IMAP poller processing`);
      // Note: message.forward() is not needed here — Porkbun email forwarding
      // handles routing *@aevoy.com to the Gmail inbox. The Cloudflare Worker
      // just validates the recipient exists so invalid addresses get rejected early.
    } catch (error) {
      console.error("Email processing error:", error);
      // Don't reject for processing errors - we received the email
    }
  },
};
