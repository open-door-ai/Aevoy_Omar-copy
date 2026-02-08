import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

// ---- Environment Validation ----

function validateEnv(): void {
  const required: { key: string; label: string }[] = [
    { key: "ENCRYPTION_KEY", label: "Encryption key (32 byte hex string)" },
    { key: "AGENT_WEBHOOK_SECRET", label: "Agent webhook secret" },
    { key: "NEXT_PUBLIC_SUPABASE_URL", label: "Supabase URL" },
    { key: "SUPABASE_SERVICE_ROLE_KEY", label: "Supabase service role key" },
  ];

  const missing = required.filter(({ key }) => !process.env[key]);
  if (missing.length > 0) {
    console.error("[STARTUP] Missing required environment variables:");
    for (const { key, label } of missing) {
      console.error(`  - ${key}: ${label}`);
    }
    process.exit(1);
  }

  // At least one AI provider must be configured
  const aiKeys = [
    "DEEPSEEK_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
    "KIMI_API_KEY",
    "GROQ_API_KEY",
  ];
  const hasAiKey = aiKeys.some((key) => !!process.env[key]);
  if (!hasAiKey && process.env.AI_MOCK_MODE !== "true") {
    console.error("[STARTUP] No AI API key configured. Set at least one of:", aiKeys.join(", "));
    console.error("  Or set AI_MOCK_MODE=true for testing without AI.");
    process.exit(1);
  }

  // Validate ENCRYPTION_KEY format (must be 32 bytes = 64 hex chars)
  const encKey = process.env.ENCRYPTION_KEY!;
  if (!/^[0-9a-f]{64}$/i.test(encKey)) {
    console.error("[STARTUP] ENCRYPTION_KEY must be a 64-character hex string (32 bytes).");
    process.exit(1);
  }

  // Warn for optional but important env vars
  const optional = [
    "RESEND_API_KEY",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "BROWSERBASE_API_KEY",
    "BROWSERBASE_PROJECT_ID",
  ];
  const missingOptional = optional.filter((key) => !process.env[key]);
  if (missingOptional.length > 0) {
    console.warn("[STARTUP] Optional env vars not set (features will be limited):", missingOptional.join(", "));
  }
}

validateEnv();

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { processTask, processIncomingTask, handleConfirmationReply, handleVerificationCodeReply } from "./services/processor.js";
import { startScheduler } from "./services/scheduler.js";
import { startInboxPoller } from "./services/inbox-poller.js";
import { handleIncomingSms, handleIncomingVoice, processVoiceCommand, getTwilioConfig, twilioRequest } from "./services/twilio.js";
import { resolveUser } from "./services/identity/resolver.js";
import { getSupabaseClient } from "./utils/supabase.js";
import type { TaskRequest } from "./types/index.js";
import skillRoutes from "./routes/skills.js";

import crypto from "crypto";

const app = express();
const PORT = process.env.AGENT_PORT || 3001;
const WEBHOOK_SECRET = process.env.AGENT_WEBHOOK_SECRET;

// ---- Rate Limiting ----

const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limited", message: "Too many requests, slow down" },
});

const taskLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => {
    const forwarded = req.headers["x-forwarded-for"];
    const clientIp = typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : req.ip;
    return req.body?.userId || clientIp || "unknown";
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limited", message: "Too many tasks, please wait" },
  validate: false,
});

const twilioLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => {
    const forwarded = req.headers["x-forwarded-for"];
    const clientIp = typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : req.ip;
    return req.body?.From || clientIp || "unknown";
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: "Rate limited",
  validate: false,
});

// ---- Daily Call Limit Tracker (50 calls/day per user) ----

const dailyCallLimits = new Map<string, { count: number; resetAt: number }>();

function checkDailyCallLimit(userId: string): boolean {
  const now = Date.now();
  const userLimit = dailyCallLimits.get(userId);

  if (!userLimit || now > userLimit.resetAt) {
    // Reset counter (new day)
    dailyCallLimits.set(userId, {
      count: 1,
      resetAt: now + 24 * 60 * 60 * 1000, // 24 hours
    });
    return true;
  }

  if (userLimit.count >= 50) {
    console.log(`[SECURITY] User ${userId.slice(0, 8)} exceeded daily call limit (50)`);
    return false;
  }

  userLimit.count++;
  return true;
}

// ---- Middleware ----

// Restrict CORS to known origins
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "https://aevoy.com,https://www.aevoy.com,http://localhost:3000").split(",");
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(globalLimiter);

// Timing-safe webhook secret comparison
function verifyWebhookSecret(provided: string | null | undefined): boolean {
  if (!provided || !WEBHOOK_SECRET) return false;
  if (provided.length !== WEBHOOK_SECRET.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(WEBHOOK_SECRET));
}

// Twilio signature validation middleware (async for dynamic import)
async function validateTwilioSignature(req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> {
  if (process.env.TEST_MODE === "true") {
    next();
    return;
  }

  const twilioSignature = req.headers["x-twilio-signature"] as string;
  if (!twilioSignature || !process.env.TWILIO_AUTH_TOKEN) {
    res.status(401).json({ error: "Missing Twilio signature" });
    return;
  }

  try {
    const twilioModule = await import("twilio");
    const validateRequest = twilioModule.default?.validateRequest ?? (twilioModule as Record<string, unknown>).validateRequest as (
      authToken: string, signature: string, url: string, params: Record<string, string>
    ) => boolean;
    if (!validateRequest) {
      throw new Error("validateRequest not found in twilio module");
    }
    const url = `${process.env.AGENT_URL || "http://localhost:3001"}${req.originalUrl}`;
    const isValid = validateRequest(
      process.env.TWILIO_AUTH_TOKEN,
      twilioSignature,
      url,
      req.body
    );

    if (!isValid) {
      res.status(403).json({ error: "Invalid Twilio signature" });
      return;
    }
  } catch {
    if (process.env.NODE_ENV === "production") {
      res.status(500).json({ error: "Twilio validation unavailable" });
      return;
    }
  }

  next();
}

// ---- Track active tasks for health reporting ----

let activeTasks = 0;

// ---- Health Check (Enhanced) ----

app.get("/health", async (_req, res) => {
  const checks: Record<string, string> = {};

  // Supabase check
  try {
    const sb = getSupabaseClient();
    const { error } = await sb.from("profiles").select("id").limit(1);
    checks.supabase = error ? "error" : "ok";
  } catch {
    checks.supabase = "unavailable";
  }

  // API key availability
  checks.deepseek = process.env.DEEPSEEK_API_KEY ? "configured" : "missing";
  checks.anthropic = process.env.ANTHROPIC_API_KEY ? "configured" : "missing";
  checks.google = process.env.GOOGLE_API_KEY ? "configured" : "missing";
  checks.resend = process.env.RESEND_API_KEY ? "configured" : "missing";
  checks.twilio = process.env.TWILIO_ACCOUNT_SID ? "configured" : "missing";
  checks.browserbase = process.env.BROWSERBASE_API_KEY ? "configured" : "missing";

  const allOk = checks.supabase === "ok";

  res.status(allOk ? 200 : 503).json({
    status: allOk ? "healthy" : "degraded",
    version: "2.0.0",
    timestamp: new Date().toISOString(),
    activeTasks,
    subsystems: checks,
  });
});

// ---- Dev-only smoke test ----

if (process.env.NODE_ENV !== "production") {
  app.post("/test/smoke", async (_req, res) => {
    try {
      const mockTask: TaskRequest = {
        userId: "00000000-0000-4000-a000-000000000000",
        username: "smoketest",
        from: "smoke@test.local",
        subject: "Smoke test",
        body: "This is a smoke test task",
        inputChannel: "web",
      };

      // Set mock mode for this test
      const origMock = process.env.AI_MOCK_MODE;
      process.env.AI_MOCK_MODE = "true";

      const result = await processTask(mockTask);

      process.env.AI_MOCK_MODE = origMock;

      res.json({
        success: result.success,
        taskId: result.taskId,
        actionsCount: result.actions.length,
        responseLength: result.response.length,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown";
      res.status(500).json({ success: false, error: msg });
    }
  });
}

// ---- Task Endpoints ----

app.post("/task", taskLimiter, async (req, res) => {
  const secret = req.headers["x-webhook-secret"];
  if (!verifyWebhookSecret(secret as string)) {
    return res.status(401).json({ error: "unauthorized", message: "Invalid webhook secret" });
  }

  const task: TaskRequest = req.body;

  if (!task.userId || !task.username || !task.from || !task.subject) {
    return res.status(400).json({ error: "bad_request", message: "Missing required fields" });
  }

  console.log(`[TASK] Received`, {
    userId: task.userId?.slice(0, 8),
    timestamp: new Date().toISOString(),
  });

  res.json({ status: "queued", message: "Task received and processing" });

  activeTasks++;
  processTask(task)
    .then((result) => {
      console.log(`Task completed: ${result.taskId}`, { success: result.success, actionsExecuted: result.actions.length });
    })
    .catch((error) => console.error("Task processing failed:", error))
    .finally(() => { activeTasks--; });
});

app.post("/task/incoming", taskLimiter, async (req, res) => {
  const secret = req.headers["x-webhook-secret"];
  if (!verifyWebhookSecret(secret as string)) {
    return res.status(401).json({ error: "unauthorized", message: "Invalid webhook secret" });
  }

  const task: TaskRequest = req.body;
  if (!task.userId || !task.username || !task.from) {
    return res.status(400).json({ error: "bad_request", message: "Missing required fields" });
  }

  console.log(`[TASK] Incoming`, {
    userId: task.userId?.slice(0, 8),
    channel: task.inputChannel || "email",
    timestamp: new Date().toISOString(),
  });

  res.json({ status: "queued", message: "Task received and processing" });

  activeTasks++;
  processIncomingTask(task)
    .then((result) => {
      console.log(`Incoming task processed: ${result.taskId}`, { success: result.success });
    })
    .catch((error) => console.error("Incoming task processing failed:", error))
    .finally(() => { activeTasks--; });
});

app.post("/task/confirm", taskLimiter, async (req, res) => {
  const secret = req.headers["x-webhook-secret"];
  if (!verifyWebhookSecret(secret as string)) {
    return res.status(401).json({ error: "unauthorized", message: "Invalid webhook secret" });
  }

  const { userId, username, from, taskId, replyText } = req.body;
  if (!userId || !username || !from || !taskId || !replyText) {
    return res.status(400).json({ error: "bad_request", message: "Missing required fields" });
  }

  res.json({ status: "queued", message: "Confirmation received" });

  activeTasks++;
  handleConfirmationReply(userId, username, from, replyText, taskId)
    .then((result) => console.log(`Confirmation processed: ${taskId}`, { success: result.success }))
    .catch((error) => console.error("Confirmation processing failed:", error))
    .finally(() => { activeTasks--; });
});

app.post("/task/verification", taskLimiter, async (req, res) => {
  const secret = req.headers["x-webhook-secret"];
  if (!verifyWebhookSecret(secret as string)) {
    return res.status(401).json({ error: "unauthorized", message: "Invalid webhook secret" });
  }

  const { userId, username, from, taskId, code } = req.body;
  if (!userId || !username || !from || !taskId || !code) {
    return res.status(400).json({ error: "bad_request", message: "Missing required fields" });
  }

  res.json({ status: "queued", message: "Verification code received" });

  activeTasks++;
  handleVerificationCodeReply(userId, username, from, code, taskId)
    .then((result) => console.log(`Verification processed: ${taskId}`, { success: result.success }))
    .catch((error) => console.error("Verification processing failed:", error))
    .finally(() => { activeTasks--; });
});

// POST /task/email-pin - Direct PIN verification (web dashboard submission)
app.post("/task/email-pin", taskLimiter, async (req, res) => {
  const { userId, pinCode } = req.body;

  if (!userId || !pinCode) {
    return res.status(400).json({ error: "userId and pinCode required" });
  }

  try {
    const supabase = getSupabaseClient();

    // Find matching non-verified session
    const { data: sessions, error } = await supabase
      .from("email_pin_sessions")
      .select("*")
      .eq("user_id", userId)
      .eq("pin_code", pinCode)
      .eq("verified", false)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1);

    const session = sessions && sessions.length > 0 ? sessions[0] : null;

    if (error || !session) {
      console.log(`[EMAIL-PIN] Invalid PIN: ${pinCode.slice(0, 2)}****`);

      // Increment attempts
      await supabase.rpc("increment_email_pin_attempts", { p_user_id: userId });

      return res.status(401).json({
        error: "Invalid or expired PIN",
        message: "The PIN you entered is invalid or has expired. Please check your email.",
      });
    }

    // Mark verified
    await supabase
      .from("email_pin_sessions")
      .update({ verified: true })
      .eq("id", session.id);

    // Reset attempts
    await supabase.rpc("reset_email_pin_attempts", { p_user_id: userId });

    // Get user profile for username
    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", userId)
      .single();

    // Process original task
    const taskToProcess: TaskRequest = {
      userId: session.user_id,
      username: profile?.username || "user",
      from: session.sender_email,
      subject: session.email_subject || "",
      body: session.email_body || "",
      bodyHtml: session.email_body_html,
      attachments: session.attachments ? JSON.parse(session.attachments as string) : undefined,
      inputChannel: "email",
    };

    // Process task asynchronously
    activeTasks++;
    processIncomingTask(taskToProcess)
      .then((result) => console.log(`Email PIN verified task processed: ${result.taskId}`))
      .catch((error) => console.error("Email PIN task processing failed:", error))
      .finally(() => { activeTasks--; });

    res.json({
      success: true,
      message: "PIN verified successfully. Task is being processed.",
    });
  } catch (error) {
    console.error("[EMAIL-PIN] Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---- Email Connection Test ----

app.post("/email/test", taskLimiter, async (req, res) => {
  const secret = req.headers["x-webhook-secret"];
  if (!verifyWebhookSecret(secret as string)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const { testImapConnection, detectProvider } = await import("./services/inbox.js");
    const provider = detectProvider(email);
    if (!provider) {
      return res.json({ success: false, error: "Unsupported email provider" });
    }

    const result = await testImapConnection(email, password, provider.imap_host, provider.imap_port);
    return res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Test failed";
    return res.json({ success: false, error: msg });
  }
});

// ---- Email Send (for email worker PIN notifications) ----

app.post("/email/send", taskLimiter, async (req, res) => {
  const secret = req.headers["x-webhook-secret"];
  if (!verifyWebhookSecret(secret as string)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const { to, from, subject, body, bodyHtml } = req.body;
  if (!to || !from || !subject || (!body && !bodyHtml)) {
    return res.status(400).json({ error: "Missing required email fields" });
  }

  try {
    // Import Resend directly for raw HTML emails (PIN notifications, etc.)
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);

    const { error } = await resend.emails.send({
      from,
      to,
      subject,
      html: bodyHtml || body,
      text: body || bodyHtml?.replace(/<[^>]*>/g, ""),
    });

    if (error) {
      console.error("[EMAIL] Resend error:", error);
      return res.status(500).json({ error: "Failed to send email" });
    }

    res.json({ success: true, message: "Email sent" });
  } catch (error) {
    console.error("[EMAIL] Failed to send email:", error);
    res.status(500).json({ error: "Failed to send email" });
  }
});

// ---- Twilio Voice Webhooks ----

app.post("/webhook/voice/:userId", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const userId = req.params.userId;
  const from = req.body.From || "";
  const to = req.body.To || "";
  const callSid = req.body.CallSid || "";

  console.log(`[TWILIO] Incoming voice call for user ${userId?.slice(0, 8)}`);

  try {
    const twiml = await handleIncomingVoice({ from, to, callSid });
    res.type("text/xml");
    res.send(twiml);
  } catch (error) {
    console.error("[TWILIO] Voice webhook error:", error);
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Neural2-F">Sorry, an error occurred. Please try again later.</Say>
</Response>`);
  }
});

app.post("/webhook/voice/process/:userId", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const userId = req.params.userId;
  const speechResult = req.body.SpeechResult || "";

  console.log(`[TWILIO] Voice command received for user ${userId?.slice(0, 8)}`);

  try {
    const twiml = await processVoiceCommand(userId, speechResult);
    res.type("text/xml");
    res.send(twiml);

    if (speechResult.trim()) {
      // Use identity resolver for consistent user lookup
      const resolved = await resolveUser(userId);
      const profile = resolved || await (async () => {
        const { data } = await getSupabaseClient()
          .from("profiles").select("id, username, email").eq("id", userId).single();
        return data ? { userId: data.id, username: data.username, email: data.email, phone: null } : null;
      })();

      if (profile) {
        activeTasks++;
        processIncomingTask({
          userId: profile.userId,
          username: profile.username,
          from: profile.email,
          subject: "Voice Task",
          body: speechResult,
          inputChannel: "voice",
        })
          .catch(console.error)
          .finally(() => { activeTasks--; });
      }
    }
  } catch (error) {
    console.error("[TWILIO] Voice process error:", error);
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Neural2-F">Sorry, I had trouble processing that. Please try again.</Say>
</Response>`);
  }
});

// ---- Twilio Message-Taking Webhook (Receptionist) ----

app.post("/webhook/voice/message/:userId", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const userId = req.params.userId;
  const speechResult = req.body.SpeechResult || "";
  const callerNumber = req.query.caller as string || req.body.From || "unknown";

  console.log(`[TWILIO] Message received for user ${userId?.slice(0, 8)} from ${callerNumber}`);

  try {
    // Respond to the caller
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Neural2-F">Thank you! I've recorded your message and will make sure it's delivered right away. Goodbye!</Say>
</Response>`);

    // Send message to user via email and SMS
    if (speechResult.trim()) {
      const { data: profile } = await getSupabaseClient()
        .from("profiles").select("username, email, twilio_number, phone_number").eq("id", userId).single();

      if (profile) {
        const { sendResponse: sendEmail } = await import("./services/email.js");
        const { sendSms } = await import("./services/twilio.js");

        const messageBody = `You received a call from ${callerNumber}.\n\nTheir message: "${speechResult}"\n\nReply to this email or text to follow up.`;

        // Email the user
        await sendEmail({
          to: profile.email,
          from: `${profile.username}@aevoy.com`,
          subject: `Call from ${callerNumber}`,
          body: messageBody,
        });

        // SMS the user if they have a personal phone number
        if (profile.phone_number) {
          await sendSms({
            userId,
            to: profile.phone_number,
            body: `[Aevoy] Missed call from ${callerNumber}: "${speechResult.substring(0, 140)}"`,
          });
        }

        console.log(`[TWILIO] Message delivered to ${profile.username} from ${callerNumber}`);
      }
    }
  } catch (error) {
    console.error("[TWILIO] Message recording error:", error);
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Neural2-F">Sorry, there was an error. Please try calling back later.</Say>
</Response>`);
  }
});

// ---- Twilio SMS Webhook ----

app.post("/webhook/sms/:userId", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const from = req.body.From || "";
  const to = req.body.To || "";
  const body = req.body.Body || "";

  console.log(`[TWILIO] Incoming SMS received`);

  try {
    const result = await handleIncomingSms({ from, to, body });

    res.type("text/xml");
    if (result.processed) {
      if (result.isVerificationCode) {
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Got it! Continuing with your task.</Message>
</Response>`);
      } else {
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Task received! I'll work on it and send you the results.</Message>
</Response>`);
      }

      if (!result.isVerificationCode && result.taskId) {
        // Use identity resolver for consistent phone-based lookup
        const resolved = await resolveUser(to);
        const profile = resolved || await (async () => {
          const { data } = await getSupabaseClient()
            .from("profiles")
            .select("id, username, email")
            .eq("twilio_number", to)
            .single();
          return data ? { userId: data.id, username: data.username, email: data.email, phone: null } : null;
        })();

        if (profile) {
          activeTasks++;
          processIncomingTask({
            userId: profile.userId,
            username: profile.username,
            from: profile.email,
            subject: "SMS Task",
            body,
            taskId: result.taskId,
            inputChannel: "sms",
          })
            .catch(console.error)
            .finally(() => { activeTasks--; });
        }
      }
    } else {
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Sorry, I couldn't process that message. Please try again or email your AI.</Message>
</Response>`);
    }
  } catch (error) {
    console.error("[TWILIO] SMS webhook error:", error);
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Sorry, an error occurred. Please try again.</Message>
</Response>`);
  }
});

// ==== INCOMING PHONE SYSTEM WEBHOOKS ====

// ---- Incoming Voice Calls (Caller Identification) ----

app.post("/webhook/voice/incoming", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const callerNumber = req.body.From || "";
  const twilioNumber = req.body.To || "";
  const callSid = req.body.CallSid || "";

  console.log(`[VOICE] Incoming call from ${callerNumber} to ${twilioNumber}`);

  try {
    const supabase = getSupabaseClient();
    const { normalizePhone } = await import("./utils/phone.js");
    const normalized = normalizePhone(callerNumber);

    // Lookup user by phone number
    const { data: profile, error: lookupError } = await supabase
      .from("profiles")
      .select("id, username, voice_pin, voice_pin_attempts, voice_pin_locked_until, timezone")
      .eq("phone_number", normalized)
      .single();

    if (lookupError || !profile) {
      // Unknown caller - block
      console.log(`[VOICE] Unknown caller: ${callerNumber}`);

      await supabase.from("call_history").insert({
        call_sid: callSid,
        direction: "inbound",
        from_number: callerNumber,
        to_number: twilioNumber,
        call_type: "unknown",
        pin_required: true,
        pin_success: false
      });

      res.type("text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Neural2-F">Sorry, I don't recognize this phone number. Please sign up at aevoy dot com first, or call from your registered number.</Say>
  <Hangup/>
</Response>`);
    }

    const userId = profile.id;

    // Check daily call limit (50/day per user)
    if (!checkDailyCallLimit(userId)) {
      console.log(`[VOICE] User ${userId.slice(0, 8)} exceeded daily call limit`);

      await supabase.from("call_history").insert({
        user_id: userId,
        call_sid: callSid,
        direction: "inbound",
        from_number: callerNumber,
        to_number: twilioNumber,
        call_type: "rate_limited",
        pin_required: false,
        pin_success: null
      });

      res.type("text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Neural2-F">You've reached your daily call limit of 50 calls. Please try again tomorrow or contact us at aevoy dot com.</Say>
  <Hangup/>
</Response>`);
    }

    // Check if PIN-locked (3 failed attempts = 15min lockout)
    if (profile.voice_pin_locked_until && new Date(profile.voice_pin_locked_until) > new Date()) {
      console.log(`[VOICE] User ${userId.slice(0, 8)} is PIN-locked until ${profile.voice_pin_locked_until}`);

      await supabase.from("call_history").insert({
        user_id: userId,
        call_sid: callSid,
        direction: "inbound",
        from_number: callerNumber,
        to_number: twilioNumber,
        call_type: "blocked",
        pin_required: true,
        pin_success: false
      });

      res.type("text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Neural2-F">Your account is temporarily locked due to too many failed PIN attempts. Please try again in 15 minutes, or contact support.</Say>
  <Hangup/>
</Response>`);
    }

    // Verified caller - route to task handler
    console.log(`[VOICE] Recognized user: ${profile.username} (${userId.slice(0, 8)})`);

    await supabase.from("call_history").insert({
      user_id: userId,
      call_sid: callSid,
      direction: "inbound",
      from_number: callerNumber,
      to_number: twilioNumber,
      call_type: "task",
      pin_required: false,
      pin_success: null
    });

    // Generate TwiML for task request
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Neural2-F">Hey! What can I help you with?</Say>
  <Gather input="speech" timeout="8" speechTimeout="auto" speechModel="phone_call" enhanced="true"
    action="${process.env.AGENT_URL}/webhook/voice/process/${userId}" method="POST">
    <Say voice="Google.en-US-Neural2-F">Go ahead, I'm listening.</Say>
  </Gather>
  <Say voice="Google.en-US-Neural2-F">I didn't catch that. Please call back and try again.</Say>
</Response>`);
  } catch (error) {
    console.error("[VOICE] Incoming call error:", error);
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Neural2-F">Sorry, something went wrong. Please try again or contact support at aevoy dot com.</Say>
  <Hangup/>
</Response>`);
  }
});

// ---- Incoming SMS (Caller Identification) ----

app.post("/webhook/sms/incoming", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const senderNumber = req.body.From || "";
  const message = req.body.Body || "";
  const twilioNumber = req.body.To || "";
  const messageSid = req.body.MessageSid || "";

  console.log(`[SMS] Incoming from ${senderNumber}: "${message.slice(0, 50)}..."`);

  try {
    const supabase = getSupabaseClient();
    const { normalizePhone } = await import("./utils/phone.js");
    const normalized = normalizePhone(senderNumber);

    // Lookup user
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, username")
      .eq("phone_number", normalized)
      .single();

    if (!profile) {
      // Unknown sender
      console.log(`[SMS] Unknown sender: ${senderNumber}`);
      res.type("text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Sorry, I don't recognize this number. Sign up at aevoy.com first 👋</Message>
</Response>`);
    }

    const userId = profile.id;
    console.log(`[SMS] Recognized user: ${profile.username} (${userId.slice(0, 8)})`);

    // Process SMS as task
    const { processTask } = await import("./services/processor.js");
    await processTask({
      userId,
      username: profile.username,
      from: senderNumber,
      subject: "[SMS]",
      body: message,
      inputChannel: "sms"
    });

    // Send empty TwiML (task response will be sent separately via Twilio API)
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
  } catch (error) {
    console.error("[SMS] Incoming SMS error:", error);
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Oops, something went wrong. Please try again or email support@aevoy.com</Message>
</Response>`);
  }
});

// ---- PIN Verification for Unknown Callers ----

app.post("/webhook/voice/pin-verify", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const enteredPin = req.body.Digits || "";
  const callerNumber = req.body.From || "";
  const callSid = req.body.CallSid || "";

  console.log(`[PIN] Verification attempt from ${callerNumber}, entered: ${enteredPin.slice(0, 2)}**`);

  try {
    const supabase = getSupabaseClient();
    const { normalizePhone } = await import("./utils/phone.js");
    const normalized = normalizePhone(callerNumber);

    // Look up user by caller phone number (not all profiles)
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, username, voice_pin, voice_pin_attempts, voice_pin_locked_until, phone_number")
      .eq("phone_number", normalized)
      .single();

    if (!profile || !profile.voice_pin) {
      res.type("text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Neural2-F">No account found for this phone number. Please sign up at aevoy dot com.</Say>
  <Hangup/>
</Response>`);
    }

    // PIN verification with backward-compatible hashing
    const storedPin = profile.voice_pin;
    const isHashed = storedPin.length === 64 && /^[0-9a-f]{64}$/.test(storedPin);

    let pinMatch: boolean;
    if (isHashed) {
      // Compare against SHA-256 hash
      const enteredHash = crypto.createHash('sha256').update(`${profile.id}:${enteredPin}`).digest('hex');
      const hashBuffer = Buffer.from(enteredHash);
      const storedHashBuffer = Buffer.from(storedPin);
      pinMatch = hashBuffer.length === storedHashBuffer.length &&
        crypto.timingSafeEqual(hashBuffer, storedHashBuffer);
    } else {
      // Legacy plain text comparison — auto-upgrade after successful match
      const pinBuffer = Buffer.from(enteredPin);
      const storedPinBuffer = Buffer.from(storedPin);
      pinMatch = pinBuffer.length === storedPinBuffer.length &&
        crypto.timingSafeEqual(pinBuffer, storedPinBuffer);

      if (pinMatch) {
        // Auto-upgrade to hashed PIN
        const hashedPin = crypto.createHash('sha256').update(`${profile.id}:${enteredPin}`).digest('hex');
        await supabase.from("profiles").update({ voice_pin: hashedPin }).eq("id", profile.id);
        console.log(`[PIN] Auto-upgraded PIN to hashed for user ${profile.id.slice(0, 8)}`);
      }
    }

    if (!pinMatch) {
      // Failed PIN attempt — increment attempts
      const attempts = (profile.voice_pin_attempts || 0) + 1;
      const updateData: Record<string, unknown> = { voice_pin_attempts: attempts };
      if (attempts >= 3) {
        updateData.voice_pin_locked_until = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      }
      await supabase.from("profiles").update(updateData).eq("id", profile.id);

      const remaining = Math.max(0, 3 - attempts);
      console.log(`[PIN] Invalid PIN from ${callerNumber}, ${remaining} attempts remaining`);

      res.type("text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Neural2-F">Incorrect PIN. You have ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.</Say>
  <Gather action="${process.env.AGENT_URL}/webhook/voice/pin-verify" numDigits="4" timeout="10">
    <Say voice="Google.en-US-Neural2-F">Please enter your 4 to 6 digit PIN.</Say>
  </Gather>
  <Hangup/>
</Response>`);
    }

    const userId = profile.id;
    console.log(`[PIN] Successful verification for ${profile.username} (${userId.slice(0, 8)})`);

    // Reset PIN attempts
    await supabase
      .from("profiles")
      .update({ voice_pin_attempts: 0, voice_pin_locked_until: null })
      .eq("id", userId);

    // Log successful PIN auth
    await supabase.from("call_history").insert({
      user_id: userId,
      call_sid: callSid,
      direction: "inbound",
      from_number: callerNumber,
      to_number: process.env.TWILIO_PHONE_NUMBER || "",
      call_type: "task",
      pin_required: true,
      pin_success: true
    });

    // Route to task handler
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Neural2-F">PIN verified. What can I help you with?</Say>
  <Gather input="speech" timeout="8" speechTimeout="auto" speechModel="phone_call" enhanced="true"
    action="${process.env.AGENT_URL}/webhook/voice/process/${userId}" method="POST">
    <Say voice="Google.en-US-Neural2-F">Go ahead, I'm listening.</Say>
  </Gather>
  <Say voice="Google.en-US-Neural2-F">I didn't catch that. Please call back and try again.</Say>
</Response>`);
  } catch (error) {
    console.error("[PIN] Verification error:", error);
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Neural2-F">Sorry, something went wrong. Please try again.</Say>
  <Hangup/>
</Response>`);
  }
});

// ---- Premium Number Voice (Direct User Routing) ----

app.post("/webhook/voice/premium/:userId", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const userId = req.params.userId;
  const from = req.body.From || "";
  const to = req.body.To || "";
  const callSid = req.body.CallSid || "";

  console.log(`[VOICE-PREMIUM] Call to user ${userId.slice(0, 8)} from ${from}`);

  try {
    const supabase = getSupabaseClient();

    // Check daily call limit (50/day per user)
    if (!checkDailyCallLimit(userId)) {
      console.log(`[VOICE-PREMIUM] User ${userId.slice(0, 8)} exceeded daily call limit`);

      await supabase.from("call_history").insert({
        user_id: userId,
        call_sid: callSid,
        direction: "inbound",
        from_number: from,
        to_number: to,
        call_type: "rate_limited"
      });

      res.type("text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Neural2-F">You've reached your daily call limit of 50 calls. Please try again tomorrow.</Say>
  <Hangup/>
</Response>`);
    }

    // Log call
    await supabase.from("call_history").insert({
      user_id: userId,
      call_sid: callSid,
      direction: "inbound",
      from_number: from,
      to_number: to,
      call_type: "task"
    });

    // Route directly to task handler (no caller ID needed)
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Neural2-F">Hey! What can I help you with?</Say>
  <Gather input="speech" timeout="8" speechTimeout="auto" speechModel="phone_call" enhanced="true"
    action="${process.env.AGENT_URL}/webhook/voice/process/${userId}" method="POST">
    <Say voice="Google.en-US-Neural2-F">Go ahead, I'm listening.</Say>
  </Gather>
  <Say voice="Google.en-US-Neural2-F">I didn't catch that. Please call back and try again.</Say>
</Response>`);
  } catch (error) {
    console.error("[VOICE-PREMIUM] Error:", error);
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Neural2-F">Sorry, something went wrong. Please try again.</Say>
  <Hangup/>
</Response>`);
  }
});

// ---- Premium Number SMS ----

app.post("/webhook/sms/premium/:userId", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const userId = req.params.userId;
  const from = req.body.From || "";
  const message = req.body.Body || "";
  const messageSid = req.body.MessageSid || "";

  console.log(`[SMS-PREMIUM] Message to user ${userId.slice(0, 8)} from ${from}: "${message.slice(0, 50)}..."`);

  try {
    // Process as task
    const supabase = getSupabaseClient();
    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", userId)
      .single();

    const { processTask } = await import("./services/processor.js");
    await processTask({
      userId,
      username: profile?.username || "user",
      from,
      subject: "[SMS Premium]",
      body: message,
      inputChannel: "sms"
    });

    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
  } catch (error) {
    console.error("[SMS-PREMIUM] Error:", error);
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Oops, something went wrong. Please try again.</Message>
</Response>`);
  }
});

// ---- Daily Check-in Call Webhook ----

app.post("/webhook/checkin/:userId", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const userId = req.params.userId;
  const callType = req.query.type as string || "morning";
  const from = req.body.From || "";
  const to = req.body.To || "";
  const callSid = req.body.CallSid || "";

  console.log(`[CHECKIN] ${callType} call webhook for user ${userId.slice(0, 8)}`);

  try {
    const supabase = getSupabaseClient();

    // Get user context
    const { data: profile } = await supabase
      .from("profiles")
      .select("username, display_name, bot_name")
      .eq("id", userId)
      .single();

    const userName = profile?.display_name || profile?.username || "there";
    const botName = profile?.bot_name || "your AI assistant";

    // Generate dynamic greeting using AI
    const { generateCheckinGreeting } = await import("./services/checkin.js");
    const greeting = await generateCheckinGreeting(userName, botName, callType as "morning" | "evening");

    // TwiML: Say greeting, listen for response, process as task
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Neural2-F">${greeting}</Say>
  <Gather input="speech" timeout="8" speechTimeout="auto" speechModel="phone_call" enhanced="true"
    action="${process.env.AGENT_URL}/webhook/checkin/response/${userId}?type=${callType}" method="POST">
    <Say voice="Google.en-US-Neural2-F">Go ahead, I'm listening.</Say>
  </Gather>
  <Say voice="Google.en-US-Neural2-F">I didn't catch that. Thanks for chatting! Have a great day.</Say>
</Response>`);
  } catch (error) {
    console.error("[CHECKIN] Webhook error:", error);
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Neural2-F">Sorry, something went wrong with your check-in. Have a great day!</Say>
  <Hangup/>
</Response>`);
  }
});

// ---- Check-in Response Handler ----

app.post("/webhook/checkin/response/:userId", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const userId = req.params.userId;
  const transcription = req.body.SpeechResult || req.body.TranscriptionText || "";
  const callType = req.query.type as string || "morning";

  console.log(`[CHECKIN] Response from ${userId.slice(0, 8)}: "${transcription.slice(0, 50)}..."`);

  try {
    const supabase = getSupabaseClient();

    if (!transcription || transcription.trim().length < 5) {
      // No meaningful response
      res.type("text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
    }

    // Save to episodic memory
    const { encryptWithServerKey } = await import("./security/encryption.js");
    const memoryContent = {
      type: `daily_checkin_${callType}`,
      response: transcription,
      timestamp: new Date().toISOString()
    };

    const encrypted = await encryptWithServerKey(JSON.stringify(memoryContent));

    await supabase.from("user_memory").insert({
      user_id: userId,
      memory_type: "episodic",
      encrypted_data: encrypted,
      importance: 0.7
    });

    // If user mentioned a task, process it
    const looksLikeTask = /book|schedule|remind|buy|order|research|find|email|call/i.test(transcription);

    if (looksLikeTask) {
      const { data: userProfile } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", userId)
        .single();

      const { processTask } = await import("./services/processor.js");
      await processTask({
        userId,
        username: userProfile?.username || "user",
        from: req.body.From || "",
        subject: `[Check-in ${callType}]`,
        body: transcription,
        inputChannel: "voice"
      });
    }

    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
  } catch (error) {
    console.error("[CHECKIN] Response handler error:", error);
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
  }
});

// ---- Onboarding Interview Webhooks ----

app.post("/webhook/interview-call/:userId", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const userId = req.params.userId;
  const from = req.body.From || "";
  const to = req.body.To || "";
  const callSid = req.body.CallSid || "";

  console.log(`[ONBOARDING] Interview call initiated for user ${userId?.slice(0, 8)}`);

  try {
    const { handleInterviewCall } = await import("./services/onboarding-interview.js");
    const twiml = await handleInterviewCall({ userId, from, to, callSid });
    res.type("text/xml");
    res.send(twiml);
  } catch (error) {
    console.error("[ONBOARDING] Interview call error:", error);
    const { generateErrorTwiml } = await import("./services/onboarding-interview.js");
    res.type("text/xml");
    res.send(generateErrorTwiml("Sorry, we couldn't start your interview. Please try again from the dashboard."));
  }
});

app.post("/webhook/interview-call/response/:userId", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const userId = req.params.userId;
  const transcription = req.body.SpeechResult || req.body.TranscriptionText || "";
  const questionIndex = parseInt(req.query.question as string || "0");

  console.log(`[ONBOARDING] Interview response from ${userId?.slice(0, 8)}, Q${questionIndex}: "${transcription.slice(0, 50)}..."`);

  try {
    const { processInterviewResponse } = await import("./services/onboarding-interview.js");
    const twiml = await processInterviewResponse(userId, questionIndex, transcription);
    res.type("text/xml");
    res.send(twiml);
  } catch (error) {
    console.error("[ONBOARDING] Interview response error:", error);
    const { generateErrorTwiml } = await import("./services/onboarding-interview.js");
    res.type("text/xml");
    res.send(generateErrorTwiml("Sorry, something went wrong. Let's continue via email instead."));
  }
});

// ---- Phone Verification Webhooks ----

/**
 * POST /webhook/voice/onboarding-verify
 * Initiates a phone verification call to the user
 * Body: { userId, phone }
 */
app.post("/webhook/voice/onboarding-verify", async (req, res) => {
  const secret = req.headers["x-webhook-secret"];
  if (!verifyWebhookSecret(secret as string)) {
    return res.status(401).json({ error: "unauthorized", message: "Invalid webhook secret" });
  }

  const { userId, phone } = req.body;
  if (!userId || !phone) {
    return res.status(400).json({ error: "userId and phone are required" });
  }

  console.log(`[PHONE-VERIFY] Initiating verification call to ${phone} for user ${userId?.slice(0, 8)}`);

  try {
    const config = getTwilioConfig();
    if (!config) {
      return res.status(503).json({ error: "Twilio not configured" });
    }

    // Initiate call with TwiML URL pointing to gather endpoint
    const params = new URLSearchParams({
      To: phone,
      From: config.phoneNumber,
      Url: `${config.webhookBaseUrl}/webhook/voice/onboarding-gather/${userId}`,
      Method: "POST",
    });

    const response = await twilioRequest("/Calls.json", "POST", params);

    if (!response.ok) {
      const errorData = await response.text();
      console.error(`[PHONE-VERIFY] Twilio error: ${errorData}`);
      return res.status(502).json({ error: "Failed to initiate call", details: errorData });
    }

    const callData = await response.json() as { sid: string };
    console.log(`[PHONE-VERIFY] Call initiated: ${callData.sid}`);

    res.json({ success: true, callSid: callData.sid });
  } catch (error) {
    console.error("[PHONE-VERIFY] Error:", error);
    res.status(500).json({ error: "Failed to initiate verification call" });
  }
});

/**
 * POST /webhook/voice/onboarding-gather/:userId
 * Returns TwiML for the verification call - asks user to press 1 to verify
 */
app.post("/webhook/voice/onboarding-gather/:userId", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const userId = req.params.userId;

  console.log(`[PHONE-VERIFY] Playing gather prompt for user ${userId?.slice(0, 8)}`);

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Neural2-F">
    Hi! This is Aevoy verifying your phone number. 
    Press 1 to confirm this is your number, or press 2 if this is not your number.
  </Say>
  <Gather numDigits="1" action="${process.env.AGENT_URL || "http://localhost:3001"}/webhook/voice/onboarding-confirm/${userId}" method="POST">
    <Pause length="5" />
  </Gather>
</Response>`;

  res.type("text/xml");
  res.send(twiml);
});

/**
 * POST /webhook/voice/onboarding-confirm/:userId
 * Handles the user's key press (1 = verified, 2 = cancelled)
 */
app.post("/webhook/voice/onboarding-confirm/:userId", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const userId = req.params.userId;
  const digit = req.body.Digits || "";
  const from = req.body.From || "";

  console.log(`[PHONE-VERIFY] User ${userId?.slice(0, 8)} pressed: ${digit}`);

  try {
    const supabase = getSupabaseClient();

    if (digit === "1") {
      // User confirmed - mark phone as verified
      const { data: profile } = await supabase
        .from("profiles")
        .select("phone_number")
        .eq("id", userId)
        .single();

      // Update profile to mark phone as verified
      await supabase
        .from("profiles")
        .update({ phone_verified: true })
        .eq("id", userId);

      // Update verification attempt record
      await supabase
        .from("phone_verification_attempts")
        .update({ status: "completed", verified_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("phone_number", profile?.phone_number || from)
        .eq("status", "initiated");

      console.log(`[PHONE-VERIFY] Phone verified for user ${userId?.slice(0, 8)}`);

      res.type("text/xml");
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Neural2-F">Thank you! Your phone number is verified. Goodbye!</Say>
  <Hangup/>
</Response>`);
    } else if (digit === "2") {
      // User cancelled
      await supabase
        .from("phone_verification_attempts")
        .update({ status: "failed" })
        .eq("user_id", userId)
        .eq("status", "initiated");

      console.log(`[PHONE-VERIFY] Verification cancelled by user ${userId?.slice(0, 8)}`);

      res.type("text/xml");
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Neural2-F">Verification cancelled. Please try again. Goodbye!</Say>
  <Hangup/>
</Response>`);
    } else {
      // Timeout or invalid input
      await supabase
        .from("phone_verification_attempts")
        .update({ status: "timeout" })
        .eq("user_id", userId)
        .eq("status", "initiated");

      console.log(`[PHONE-VERIFY] Verification timeout for user ${userId?.slice(0, 8)}`);

      res.type("text/xml");
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Neural2-F">No response received. Please try again. Goodbye!</Say>
  <Hangup/>
</Response>`);
    }
  } catch (error) {
    console.error("[PHONE-VERIFY] Error handling confirmation:", error);
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Neural2-F">Sorry, something went wrong. Please try again later. Goodbye!</Say>
  <Hangup/>
</Response>`);
  }
});

// ---- Skill System Routes ----

app.use("/skills", skillRoutes);

// ---- Error Handler ----

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "internal_error", message: "An unexpected error occurred" });
});

// ---- Process Crash Handlers ----

process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", err);
  // Give time for logs to flush, then exit
  setTimeout(() => process.exit(1), 1000);
});

process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled rejection:", reason);
});

process.on("SIGTERM", () => {
  console.log("[SHUTDOWN] SIGTERM received, shutting down gracefully...");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("[SHUTDOWN] SIGINT received, shutting down...");
  process.exit(0);
});

// ---- Start Server ----

app.listen(PORT, async () => {
  console.log(`Agent server v2.0 running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);

  startScheduler();
  // startInboxPoller(); // Disabled: Using Cloudflare Email Routing instead

  // Seed default skills (idempotent)
  try {
    const { seedDefaultSkills } = await import("./services/skill-registry.js");
    await seedDefaultSkills();
  } catch {
    // Non-critical — skills will be seeded on next restart
  }
});
