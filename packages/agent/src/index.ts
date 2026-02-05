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
import { handleIncomingSms, handleIncomingVoice, processVoiceCommand } from "./services/twilio.js";
import { resolveUser } from "./services/identity/resolver.js";
import { getSupabaseClient } from "./utils/supabase.js";
import type { TaskRequest } from "./types/index.js";

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
  <Say voice="Polly.Amy">Sorry, an error occurred. Please try again later.</Say>
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
  <Say voice="Polly.Amy">Sorry, I had trouble processing that. Please try again.</Say>
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
  <Say voice="Polly.Amy">Thank you! I've recorded your message and will make sure it's delivered right away. Goodbye!</Say>
</Response>`);

    // Send message to user via email and SMS
    if (speechResult.trim()) {
      const { data: profile } = await getSupabaseClient()
        .from("profiles").select("username, email, twilio_number").eq("id", userId).single();

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

        // SMS the user if they have a phone
        if (profile.twilio_number) {
          await sendSms({
            userId,
            to: profile.email, // This would need to be their personal phone
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
  <Say voice="Polly.Amy">Sorry, there was an error. Please try calling back later.</Say>
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
  startInboxPoller();

  // Seed default skills (idempotent)
  try {
    const { seedDefaultSkills } = await import("./services/skill-registry.js");
    await seedDefaultSkills();
  } catch {
    // Non-critical — skills will be seeded on next restart
  }
});
