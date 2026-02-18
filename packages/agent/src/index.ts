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

  // SECURITY: Validate encryption key has sufficient entropy (not weak/predictable)
  const weakPatterns = [
    /^0+$/, // all zeros
    /^f+$/i, // all Fs
    /^(00)+$/, // repeating 00
    /^(ff)+$/i, // repeating FF
    /^(.)\1+$/, // single character repeated
    /^(..)\1+$/, // two characters repeated
    /^0123456789abcdef0123456789abcdef/i, // sequential hex
  ];

  if (weakPatterns.some(pattern => pattern.test(encKey))) {
    console.error("[STARTUP] ENCRYPTION_KEY is too weak (contains repeating or sequential pattern).");
    console.error("  Generate a strong key with: openssl rand -hex 32");
    process.exit(1);
  }

  // Check for minimum unique characters (should have at least 10 different hex chars)
  const uniqueChars = new Set(encKey.toLowerCase().split('')).size;
  if (uniqueChars < 10) {
    console.error(`[STARTUP] ENCRYPTION_KEY has insufficient entropy (only ${uniqueChars} unique characters).`);
    console.error("  A strong key should use most hex characters (0-9, a-f).");
    console.error("  Generate a strong key with: openssl rand -hex 32");
    process.exit(1);
  }

  // Warn for optional but important env vars
  const optional = [
    "RESEND_API_KEY",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "VPS_BROWSER_HOST", // Optional VPS browser for better performance
  ];
  const missingOptional = optional.filter((key) => !process.env[key]);
  if (missingOptional.length > 0) {
    console.warn("[STARTUP] Optional env vars not set (features will be limited):", missingOptional.join(", "));
  }
}

validateEnv();

import express from "express";
import cors from "cors";
import helmet from "helmet";
import { processTask, processIncomingTask, handleConfirmationReply, handleVerificationCodeReply } from "./services/processor.js";
import { processorV2 } from "./services/processor-v2.js";
import { startScheduler } from "./services/scheduler.js";
import { startInboxPoller } from "./services/inbox-poller.js";
import { startInboxManager } from "./services/inbox-manager.js";
import { handleIncomingSms, handleIncomingVoice, processVoiceCommand, getTwilioConfig, twilioRequest, getUserVoice, DEFAULT_VOICE } from "./services/twilio.js";
import { resolveUser } from "./services/identity/resolver.js";
import { getSupabaseClient } from "./utils/supabase.js";
import type { TaskRequest, TaskResult } from "./types/index.js";
import skillRoutes from "./routes/skills.js";
import { trackBackgroundJob } from "./utils/job-tracker.js";
import { maskPhone, maskEmail, maskUserId, maskPin } from "./utils/logging.js";
import { hashPin, verifyPinHash, isBcryptHash } from "./utils/hashing.js";
import { globalLimiter, taskLimiter, twilioLimiter } from "./middleware/rate-limit.js";

import crypto from "crypto";

const app = express();
const PORT = process.env.AGENT_PORT || 3001;
const WEBHOOK_SECRET = process.env.AGENT_WEBHOOK_SECRET;

// ---- Rate Limiting (imported from centralized middleware) ----
// All rate limiters are now imported from ./middleware/rate-limit.ts
// - globalLimiter: 100 requests/min per IP
// - taskLimiter: 10 requests/min per user
// - twilioLimiter: 30 requests/min per phone number

// ---- Daily Call Limit Tracker (50 calls/day per user) ----

/**
 * Check and track daily call limit using DB-backed counter.
 * Persists across restarts (unlike the old in-memory Map).
 */
async function checkDailyCallLimit(userId: string): Promise<boolean> {
  try {
    const { data } = await getSupabaseClient().rpc('track_voice_call', {
      p_user_id: userId,
      p_daily_limit: 50,
    });
    if (data && typeof data === 'object' && 'allowed' in data) {
      const result = data as { allowed: boolean; calls_today: number; daily_limit: number };
      if (!result.allowed) {
        console.log(`[SECURITY] User ${userId.slice(0, 8)} exceeded daily call limit (${result.calls_today}/${result.daily_limit})`);
      }
      return result.allowed;
    }
    return true; // Allow on RPC failure
  } catch (err) {
    console.error('[CALL-LIMIT] RPC error:', err);
    return true; // Allow on error (fail open)
  }
}

// ---- Middleware ----

// SECURITY FIX: Helmet security headers (CSP, XSS, HSTS, etc.)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // Needed for TwiML responses
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: [
        "'self'",
        "*.supabase.co",
        "*.railway.app",
        "*.browserbase.com",
        "api.groq.com",
        "api.deepseek.com",
        "api.anthropic.com",
        "generativelanguage.googleapis.com",
      ],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null,
    },
  },
  strictTransportSecurity: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  xFrameOptions: { action: "deny" },
  xContentTypeOptions: true,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  xPermittedCrossDomainPolicies: { permittedPolicies: "none" },
  crossOriginEmbedderPolicy: false, // Allow external resources
  crossOriginOpenerPolicy: { policy: "same-origin" },
  crossOriginResourcePolicy: { policy: "same-origin" },
  originAgentCluster: true,
  dnsPrefetchControl: { allow: false },
  xDownloadOptions: true as any,  // Prevents IE from downloading files in trusted zones
  xPoweredBy: false, // Hide X-Powered-By header
}));

// Additional security headers not covered by helmet
app.use((_req, res, next) => {
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

// SECURITY FIX: Strict CORS - Production-only origins (no wildcards)
const ALLOWED_ORIGINS = process.env.NODE_ENV === "production"
  ? (process.env.ALLOWED_ORIGINS || "https://aevoy.com,https://www.aevoy.com").split(",")
  : ["http://localhost:3000", "http://127.0.0.1:3000"]; // Development: localhost only

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests without origin (server-to-server, webhooks)
    // These are validated by webhook secret instead of CORS
    if (!origin) {
      callback(null, true);
      return;
    }

    // Strict whitelist check for browser requests
    if (ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`[SECURITY] CORS rejected: ${origin}`);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  maxAge: 600, // 10 minutes cache
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization", "x-webhook-secret", "x-webhook-timestamp"],
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

// ---- Task concurrency control ----

import { getActiveBrowserTasks, canAcceptBrowserTask } from "./utils/concurrency.js";

let activeTasks = 0;
const MAX_CONCURRENT_TASKS = 10;
const MAX_CONCURRENT_BROWSER_TASKS = 10; // Using VPS Browser or local Playwright
const taskQueue: Array<{ task: TaskRequest; resolve: (v: TaskResult) => void; reject: (e: Error) => void }> = [];

function canProcessTask(needsBrowser: boolean): boolean {
  if (activeTasks >= MAX_CONCURRENT_TASKS) return false;
  if (needsBrowser && !canAcceptBrowserTask()) return false;
  return true;
}

function processQueuedTasks(): void {
  while (taskQueue.length > 0 && canProcessTask(false)) {
    const queued = taskQueue.shift();
    if (queued) {
      activeTasks++;
      processTask(queued.task)
        .then(queued.resolve)
        .catch(queued.reject)
        .finally(() => {
          activeTasks--;
          processQueuedTasks(); // try next in queue
        });
    }
  }
}

// ---- Health Check (Enhanced) ----

app.get("/health", async (_req, res) => {
  // SECURITY: Only check critical subsystems, don't leak API key configuration
  let supabaseStatus = "ok";

  try {
    const sb = getSupabaseClient();
    const { error } = await sb.from("profiles").select("id").limit(1);
    supabaseStatus = error ? "error" : "ok";
  } catch {
    supabaseStatus = "unavailable";
  }

  const allOk = supabaseStatus === "ok";

  res.status(allOk ? 200 : 503).json({
    status: allOk ? "healthy" : "degraded",
    version: "2.0.0-qualityfix",
    timestamp: new Date().toISOString(),
    activeTasks,
    activeBrowserTasks: getActiveBrowserTasks(),
    queuedTasks: taskQueue.length,
    maxConcurrent: MAX_CONCURRENT_TASKS,
    maxBrowserConcurrent: MAX_CONCURRENT_BROWSER_TASKS,
    database: supabaseStatus,
  });
});

// ---- Email diagnostic endpoint (protected by webhook secret) ----
app.post("/debug/email-test", async (req, res) => {
  const secret = req.headers["x-webhook-secret"];
  if (!verifyWebhookSecret(secret as string)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const { to, from: fromAddr } = req.body;
  const diagnostics: Record<string, unknown> = {
    resendKeyPresent: !!process.env.RESEND_API_KEY,
    resendKeyPrefix: process.env.RESEND_API_KEY?.substring(0, 8) || "MISSING",
    testModeEmail: process.env.TEST_MODE === 'true',
    nodeEnv: process.env.NODE_ENV,
  };

  // Actually try to send a test email
  try {
    const { sendResponse: sr } = await import("./services/email.js");
    const sent = await sr({
      to: to || "ebrahimo@mulgrave.com",
      from: fromAddr || "sage@aevoy.com",
      subject: "Railway Email Diagnostic",
      body: "This test email was sent directly from Railway to diagnose email delivery.",
    });
    diagnostics.emailSent = sent;
  } catch (err) {
    diagnostics.emailError = String(err);
  }

  res.json(diagnostics);
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

// ---- Task Endpoints ----

/**
 * Task Processor V2 - With Planning Phase
 * Uses autonomous execution with plan confirmation for complex tasks
 */
app.post("/task/v2", taskLimiter, async (req, res) => {
  const secret = req.headers["x-webhook-secret"];
  if (!verifyWebhookSecret(secret as string)) {
    return res.status(401).json({ error: "unauthorized", message: "Invalid webhook secret" });
  }

  const { userId, username, from, subject, body, inputChannel } = req.body;

  if (!userId || !username || !from || !body) {
    return res.status(400).json({ error: "bad_request", message: "Missing required fields" });
  }

  console.log(`[TASK-V2] Received`, {
    userId: maskUserId(userId),
    channel: inputChannel || "email",
    timestamp: new Date().toISOString(),
  });

  activeTasks++;
  
  try {
    const result = await processorV2.processTask({
      userId,
      username,
      email: from,
      task: body,
      channel: inputChannel || "email",
    });

    // If plan requires confirmation, return plan details
    if (result.awaitingConfirmation && result.planId) {
      res.json({ 
        status: "awaiting_confirmation", 
        planId: result.planId,
        message: "Plan created, awaiting user confirmation",
        response: result.response,
      });
    } else {
      res.json({ 
        status: "completed", 
        success: result.success,
        response: result.response,
      });
    }
  } catch (error) {
    console.error("[TASK-V2] Processing failed:", error);
    res.status(500).json({ 
      status: "error", 
      message: error instanceof Error ? error.message : "Processing failed" 
    });
  } finally {
    activeTasks--;
  }
});

/**
 * Legacy Task Processor V1
 * Fallback for backward compatibility
 */
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
    userId: task.userId.substring(0, 8),
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

  console.log(`[TASK] Incoming (FULL PROCESSOR with 30x iterations)`, {
    userId: task.userId.substring(0, 8),
    channel: task.inputChannel || "email",
    timestamp: new Date().toISOString(),
  });

  res.json({ status: "queued", message: "Task received and processing" });

  // CRITICAL FIX: Use ORIGINAL processor (not V2) to get:
  // - MAX_ITERATIONS = 30 (not just 1 attempt)
  // - Strategy tracking (prevents dumb retries)
  // - Outcome verification (REAL goal checking)
  // - Memory loading (unified memory)
  activeTasks++;
  const taskPromise = processTask({
    userId: task.userId,
    username: task.username,
    from: task.from,
    subject: task.subject || '',
    body: task.body || '',
    inputChannel: (task.inputChannel as "email" | "sms" | "voice" | "web") || "email",
  });

  // Track with 20-minute timeout
  trackBackgroundJob(
    crypto.randomUUID(), // Generate taskId for tracking
    task.userId,
    taskPromise,
    () => {
      // Timeout handler - notify user
      if (task.from) {
        import("./services/email.js").then(({ sendErrorEmail }) => {
          sendErrorEmail(
            task.from,
            process.env.RESEND_FROM_EMAIL || 'noreply@aevoy.com',
            task.subject || 'Your Task',
            'Task exceeded 20-minute maximum execution time. Please try breaking it into smaller tasks.'
          ).catch((err) => console.error("Failed to send timeout email:", err));
        });
      }
    }
  );

  taskPromise
    .then((result) => {
      console.log(`Incoming task processed: ${result.taskId || 'unknown'}`, { success: result.success, actions: result.actions?.length || 0 });
      // Original processor handles responses internally via processTask
    })
    .catch((error) => {
      console.error("Incoming task processing failed:", error);

      // Send error email
      if (task.from) {
        import("./services/email.js").then(({ sendErrorEmail }) => {
          sendErrorEmail(
            task.from,
            process.env.RESEND_FROM_EMAIL || 'noreply@aevoy.com',
            task.subject || 'Your Task',
            error.message || 'An unexpected error occurred'
          ).catch((err) => console.error("Failed to send error email:", err));
        });
      }
    })
    .finally(() => { activeTasks--; });
});

/**
 * Plan Confirmation Endpoint (V2)
 * Handles YES/NO/MODIFY responses from user
 */
app.post("/task/confirm", taskLimiter, async (req, res) => {
  const secret = req.headers["x-webhook-secret"];
  if (!verifyWebhookSecret(secret as string)) {
    return res.status(401).json({ error: "unauthorized", message: "Invalid webhook secret" });
  }

  const { userId, username, from, taskId, replyText, action, planId } = req.body;
  
  // Support both V1 (taskId + replyText) and V2 (planId + action) formats
  if (planId && action) {
    // V2 format
    res.json({ status: "processing", message: "Confirmation received" });
    
    activeTasks++;
    processorV2.handleConfirmation(planId, userId, action as "yes" | "no" | "modify", replyText)
      .then((result) => console.log(`[V2] Confirmation processed: ${planId}`, { success: result.success }))
      .catch((error) => console.error("[V2] Confirmation processing failed:", error))
      .finally(() => { activeTasks--; });
    return;
  }
  
  // V1 format (legacy)
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

// ---- Incoming Voice Calls (Caller Identification) ----

app.post("/webhook/voice/incoming", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const callerNumber = req.body.From || "";
  const twilioNumber = req.body.To || "";
  const callSid = req.body.CallSid || "";
  let voice = DEFAULT_VOICE;
  const startTime = Date.now();

  console.log(`[VOICE] Incoming call from ${maskPhone(callerNumber)} to ${maskPhone(twilioNumber)}`);

  try {
    const supabase = getSupabaseClient();

    // OPTIMIZATION: Resolve user AND load profile in parallel (saves ~400ms)
    const [resolved, profileResult] = await Promise.all([
      resolveUser(callerNumber),
      (async () => {
        const tempResolved = await resolveUser(callerNumber);
        if (!tempResolved) return null;
        return supabase
          .from("profiles")
          .select("id, username, voice_pin, voice_pin_hash, voice_pin_attempts, voice_pin_locked_until, timezone")
          .eq("id", tempResolved.userId)
          .single();
      })()
    ]);

    if (!resolved) {
      console.log(`[VOICE] Unknown caller: ${maskPhone(callerNumber)} (${Date.now() - startTime}ms)`);

      // Fire-and-forget (don't await) - saves ~200ms
      supabase.from("call_history").insert({
        call_sid: callSid,
        direction: "inbound",
        from_number: callerNumber,
        to_number: twilioNumber,
        call_type: "unknown",
        pin_required: true,
        pin_success: false
      }).then(() => {}, (e: any) => console.error("[VOICE] Call history insert failed:", e));

      res.type("text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Sorry, I don't recognize this phone number. Please sign up at aevoy dot com first, or call from your registered number.</Say>
  <Hangup/>
</Response>`);
    }

    const userId = resolved.userId;
    const profile = profileResult?.data;

    if (!profile) {
      console.log(`[VOICE] Failed to load profile for user ${userId.slice(0, 8)} (${Date.now() - startTime}ms)`);
      res.type("text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Sorry, something went wrong. Please try again.</Say>
  <Hangup/>
</Response>`);
    }

    // OPTIMIZATION: Check call limit in parallel with PIN check (both are fast checks)
    const [withinLimit, isPinLocked] = await Promise.all([
      checkDailyCallLimit(userId),
      Promise.resolve(profile.voice_pin_locked_until && new Date(profile.voice_pin_locked_until) > new Date())
    ]);

    if (!withinLimit) {
      console.log(`[VOICE] User ${userId.slice(0, 8)} exceeded daily call limit (${Date.now() - startTime}ms)`);

      // Fire-and-forget
      supabase.from("call_history").insert({
        user_id: userId,
        call_sid: callSid,
        direction: "inbound",
        from_number: callerNumber,
        to_number: twilioNumber,
        call_type: "rate_limited",
        pin_required: false,
        pin_success: null
      }).then(() => {}, (e: any) => console.error("[VOICE] Call history insert failed:", e));

      res.type("text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">You've reached your daily call limit of 50 calls. Please try again tomorrow or contact us at aevoy dot com.</Say>
  <Hangup/>
</Response>`);
    }

    if (isPinLocked) {
      console.log(`[VOICE] User ${userId.slice(0, 8)} is PIN-locked until ${profile.voice_pin_locked_until} (${Date.now() - startTime}ms)`);

      // Fire-and-forget
      supabase.from("call_history").insert({
        user_id: userId,
        call_sid: callSid,
        direction: "inbound",
        from_number: callerNumber,
        to_number: twilioNumber,
        call_type: "blocked",
        pin_required: true,
        pin_success: false
      }).then(() => {}, (e: any) => console.error("[VOICE] Call history insert failed:", e));

      res.type("text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Your account is temporarily locked due to too many failed PIN attempts. Please try again in 15 minutes, or contact support.</Say>
  <Hangup/>
</Response>`);
    }

    // Verified caller - route to task handler
    voice = await getUserVoice(userId);
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

    // Get user's greeting style preference
    const { data: settings } = await supabase
      .from('user_settings')
      .select('greeting_style')
      .eq('user_id', userId)
      .single();

    const greetingStyle = settings?.greeting_style || 'casual';

    // Generate greeting based on style
    let greeting = '';
    const getTimeOfDay = () => {
      const hour = new Date().getHours();
      if (hour < 12) return 'morning';
      if (hour < 18) return 'afternoon';
      return 'evening';
    };

    switch (greetingStyle) {
      case 'jarvis':
        greeting = `Good ${getTimeOfDay()}, ${profile.username}. How may I assist you today?`;
        break;
      case 'ironman':
        greeting = `${profile.username}! Your AI assistant here. What've you got for me?`;
        break;
      case 'australian':
        greeting = `G'day ${profile.username}! What can I do for ya, mate?`;
        break;
      case 'professional':
        greeting = `Hello ${profile.username}, this is Nova. How can I help you today?`;
        break;
      case 'casual':
      default:
        const casualGreetings = [
          `Hey ${profile.username}! What's up?`,
          `Hi ${profile.username}! What can I do for you?`,
          `${profile.username}! Good to hear from you.`,
          `Hey ${profile.username}! What's on your mind?`,
          `${profile.username}! What can I help with?`,
        ];
        greeting = casualGreetings[Math.floor(Math.random() * casualGreetings.length)];
    }

    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">${greeting}</Say>
  <Gather input="speech" timeout="8" speechTimeout="auto" speechModel="phone_call" enhanced="true"
    action="${process.env.AGENT_URL}/webhook/voice/process/${userId}" method="POST" />
  <Say voice="${voice}">I didn't catch that. Call me back anytime!</Say>
</Response>`);
  } catch (error) {
    console.error("[VOICE] Incoming call error:", error);
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Sorry, something went wrong. Please try again or contact support at aevoy dot com.</Say>
  <Hangup/>
</Response>`);
  }
});
app.post("/webhook/voice/:userId", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const userId = req.params.userId;
  const voice = await getUserVoice(userId);
  const from = req.body.From || "";
  const to = req.body.To || "";
  const callSid = req.body.CallSid || "";

  console.log(`[TWILIO] Incoming voice call for user ${maskUserId(userId)}`);

  try {
    const twiml = await handleIncomingVoice({ from, to, callSid });
    res.type("text/xml");
    res.send(twiml);
  } catch (error) {
    console.error("[TWILIO] Voice webhook error:", error);
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Sorry, an error occurred. Please try again later.</Say>
</Response>`);
  }
});

app.post("/webhook/voice/process/:userId", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const userId = req.params.userId;
  const voice = await getUserVoice(userId);
  const speechResult = req.body.SpeechResult || "";

  console.log(`[TWILIO] Voice command received for user ${maskUserId(userId)}`);

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
  <Say voice="${voice}">Sorry, I had trouble processing that. Please try again.</Say>
</Response>`);
  }
});

// ---- Email Voice Decision Webhook ----

app.post("/webhook/voice/email-decision/:userId/:queueId", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const userId = req.params.userId;
  const queueId = req.params.queueId;
  const speechResult = req.body.SpeechResult || "";

  console.log(`[TWILIO] Email decision received for user ${maskUserId(userId)}, queue ${queueId?.slice(0, 8)}`);

  try {
    const { processEmailVoiceDecision } = await import("./services/twilio.js");
    const twiml = await processEmailVoiceDecision(userId, queueId, speechResult);
    
    res.type("text/xml");
    res.send(twiml);
  } catch (error) {
    console.error("[TWILIO] Email decision error:", error);
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${DEFAULT_VOICE}">Sorry, I had trouble processing your response. I'll queue this in your dashboard for you to review later.</Say>
</Response>`);
  }
});

// ---- Twilio Message-Taking Webhook (Receptionist) ----

app.post("/webhook/voice/message/:userId", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const userId = req.params.userId;
  const voice = await getUserVoice(userId);
  const speechResult = req.body.SpeechResult || "";
  const callerNumber = req.query.caller as string || req.body.From || "unknown";

  console.log(`[TWILIO] Message received for user ${maskUserId(userId)} from ${maskPhone(callerNumber)}`);

  try {
    // Respond to the caller
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Thank you! I've recorded your message and will make sure it's delivered right away. Goodbye!</Say>
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

        console.log(`[TWILIO] Message delivered to ${profile.username} from ${maskPhone(callerNumber)}`);
      }
    }
  } catch (error) {
    console.error("[TWILIO] Message recording error:", error);
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Sorry, there was an error. Please try calling back later.</Say>
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


// ---- Incoming SMS (Caller Identification) ----

app.post("/webhook/sms/incoming", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const senderNumber = req.body.From || "";
  const message = req.body.Body || "";
  const twilioNumber = req.body.To || "";
  const messageSid = req.body.MessageSid || "";

  console.log(`[SMS] Incoming from ${maskPhone(senderNumber)}: "${message.slice(0, 50)}..."`);

  try {
    const supabase = getSupabaseClient();

    // Use identity resolver to handle both twilio_number and phone_number
    const resolved = await resolveUser(senderNumber);

    if (!resolved) {
      // Unknown sender
      console.log(`[SMS] Unknown sender: ${senderNumber}`);
      res.type("text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Sorry, I don't recognize this number. Sign up at aevoy.com first 👋</Message>
</Response>`);
    }

    const userId = resolved.userId;
    const username = resolved.username;
    console.log(`[SMS] Recognized user: ${username} (${userId.slice(0, 8)})`);

    // Process SMS as task
    const { processTask } = await import("./services/processor.js");
    await processTask({
      userId,
      username,
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
  let voice = DEFAULT_VOICE;
  const callSid = req.body.CallSid || "";

  console.log(`[PIN] Verification attempt from ${maskPhone(callerNumber)}, entered: ${maskPin(enteredPin)}`);

  try {
    const supabase = getSupabaseClient();

    // Resolve user identity (checks both twilio_number and phone_number)
    const resolved = await resolveUser(callerNumber);

    if (!resolved) {
      res.type("text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">No account found for this phone number. Please sign up at aevoy dot com.</Say>
  <Hangup/>
</Response>`);
    }

    const userId = resolved.userId;
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, username, voice_pin, voice_pin_hash, voice_pin_attempts, voice_pin_locked_until")
      .eq("id", userId)
      .single();

    if (!profile || (!profile.voice_pin && !profile.voice_pin_hash)) {
      res.type("text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">No PIN set. Please set your voice PIN at aevoy dot com slash dashboard slash settings.</Say>
  <Hangup/>
</Response>`);
    }

    voice = await getUserVoice(profile.id);

    // SECURITY: PIN verification with bcrypt (new) + backward compat (legacy SHA-256/plaintext)
    let pinMatch = false;

    // Priority 1: Check new bcrypt hash (most secure)
    if (profile.voice_pin_hash && isBcryptHash(profile.voice_pin_hash)) {
      pinMatch = await verifyPinHash(enteredPin, profile.voice_pin_hash);
    }
    // Priority 2: Check legacy SHA-256 hash + auto-migrate
    else if (profile.voice_pin) {
      const storedPin = profile.voice_pin;
      const isHashed = storedPin.length === 64 && /^[0-9a-f]{64}$/.test(storedPin);

      if (isHashed) {
        // Legacy SHA-256 hash
        const enteredHash = crypto.createHash('sha256').update(`${profile.id}:${enteredPin}`).digest('hex');
        const hashBuffer = Buffer.from(enteredHash);
        const storedHashBuffer = Buffer.from(storedPin);
        pinMatch = hashBuffer.length === storedHashBuffer.length &&
          crypto.timingSafeEqual(hashBuffer, storedHashBuffer);
      } else {
        // Legacy plaintext
        const pinBuffer = Buffer.from(enteredPin);
        const storedPinBuffer = Buffer.from(storedPin);
        pinMatch = pinBuffer.length === storedPinBuffer.length &&
          crypto.timingSafeEqual(pinBuffer, storedPinBuffer);
      }

      // Auto-migrate to bcrypt on successful login
      if (pinMatch) {
        const bcryptHash = await hashPin(enteredPin);
        await supabase.from("profiles").update({
          voice_pin_hash: bcryptHash,
          voice_pin: null // Clear legacy PIN
        }).eq("id", profile.id);
        console.log(`[PIN] Auto-migrated PIN to bcrypt for user ${maskUserId(profile.id)}`);
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
      console.log(`[PIN] Invalid PIN from ${maskPhone(callerNumber)}, ${remaining} attempts remaining`);

      res.type("text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Incorrect PIN. You have ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.</Say>
  <Gather action="${process.env.AGENT_URL}/webhook/voice/pin-verify" numDigits="4" timeout="10">
    <Say voice="${voice}">Please enter your 4 to 6 digit PIN.</Say>
  </Gather>
  <Hangup/>
</Response>`);
    }

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
  <Say voice="${voice}">PIN verified. What can I help you with?</Say>
  <Gather input="speech" timeout="8" speechTimeout="auto" speechModel="phone_call" enhanced="true"
    action="${process.env.AGENT_URL}/webhook/voice/process/${userId}" method="POST">
    <Say voice="${voice}">Go ahead, I'm listening.</Say>
  </Gather>
  <Say voice="${voice}">I didn't catch that. Please call back and try again.</Say>
</Response>`);
  } catch (error) {
    console.error("[PIN] Verification error:", error);
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Sorry, something went wrong. Please try again.</Say>
  <Hangup/>
</Response>`);
  }
});

// ---- Premium Number Voice (Direct User Routing) ----

app.post("/webhook/voice/premium/:userId", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const userId = req.params.userId;
  const voice = await getUserVoice(userId);
  const from = req.body.From || "";
  const to = req.body.To || "";
  const callSid = req.body.CallSid || "";

  console.log(`[VOICE-PREMIUM] Call to user ${userId.slice(0, 8)} from ${from}`);

  try {
    const supabase = getSupabaseClient();

    // Check daily call limit (50/day per user)
    if (!(await checkDailyCallLimit(userId))) {
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
  <Say voice="${voice}">You've reached your daily call limit of 50 calls. Please try again tomorrow.</Say>
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
  <Say voice="${voice}">Hey! What can I help you with?</Say>
  <Gather input="speech" timeout="8" speechTimeout="auto" speechModel="phone_call" enhanced="true"
    action="${process.env.AGENT_URL}/webhook/voice/process/${userId}" method="POST">
    <Say voice="${voice}">Go ahead, I'm listening.</Say>
  </Gather>
  <Say voice="${voice}">I didn't catch that. Please call back and try again.</Say>
</Response>`);
  } catch (error) {
    console.error("[VOICE-PREMIUM] Error:", error);
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Sorry, something went wrong. Please try again.</Say>
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
  const voice = await getUserVoice(userId);
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
  <Say voice="${voice}">${greeting}</Say>
  <Gather input="speech" timeout="8" speechTimeout="auto" speechModel="phone_call" enhanced="true"
    action="${process.env.AGENT_URL}/webhook/checkin/response/${userId}?type=${callType}" method="POST">
    <Say voice="${voice}">Go ahead, I'm listening.</Say>
  </Gather>
  <Say voice="${voice}">I didn't catch that. Thanks for chatting! Have a great day.</Say>
</Response>`);
  } catch (error) {
    console.error("[CHECKIN] Webhook error:", error);
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Sorry, something went wrong with your check-in. Have a great day!</Say>
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

  console.log(`[ONBOARDING] Interview call initiated for user ${maskUserId(userId)}`);

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

  console.log(`[ONBOARDING] Interview response from ${maskUserId(userId)}, Q${questionIndex}: "${transcription.slice(0, 50)}..."`);

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
  const voice = userId ? await getUserVoice(userId) : DEFAULT_VOICE;
  if (!userId || !phone) {
    return res.status(400).json({ error: "userId and phone are required" });
  }

  console.log(`[PHONE-VERIFY] Initiating verification call to ${maskPhone(phone)} for user ${maskUserId(userId)}`);

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
  const voice = await getUserVoice(userId);

  console.log(`[PHONE-VERIFY] Playing gather prompt for user ${maskUserId(userId)}`);

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">
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
  const voice = await getUserVoice(userId);
  const digit = req.body.Digits || "";
  const from = req.body.From || "";

  console.log(`[PHONE-VERIFY] User ${maskUserId(userId)} pressed: ${digit}`);

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

      console.log(`[PHONE-VERIFY] Phone verified for user ${maskUserId(userId)}`);

      res.type("text/xml");
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Thank you! Your phone number is verified. Goodbye!</Say>
  <Hangup/>
</Response>`);
    } else if (digit === "2") {
      // User cancelled
      await supabase
        .from("phone_verification_attempts")
        .update({ status: "failed" })
        .eq("user_id", userId)
        .eq("status", "initiated");

      console.log(`[PHONE-VERIFY] Verification cancelled by user ${maskUserId(userId)}`);

      res.type("text/xml");
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Verification cancelled. Please try again. Goodbye!</Say>
  <Hangup/>
</Response>`);
    } else {
      // Timeout or invalid input
      await supabase
        .from("phone_verification_attempts")
        .update({ status: "timeout" })
        .eq("user_id", userId)
        .eq("status", "initiated");

      console.log(`[PHONE-VERIFY] Verification timeout for user ${maskUserId(userId)}`);

      res.type("text/xml");
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">No response received. Please try again. Goodbye!</Say>
  <Hangup/>
</Response>`);
    }
  } catch (error) {
    console.error("[PHONE-VERIFY] Error handling confirmation:", error);
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Sorry, something went wrong. Please try again later. Goodbye!</Say>
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
  console.log(`[DEPLOY-VERIFY] Wiring test deployment - commit d90c4af+`);

  // START HEALTH SYSTEM (The Final Boss - Never Fails)
  try {
    const { healthSystem } = await import("./services/health-system.js");
    healthSystem.startMonitoring();
    console.log(`[HEALTH] ✅ Never-fail health system started (30s monitoring)`);
  } catch (e) {
    console.error(`[HEALTH] Failed to start health system:`, e);
  }

  // START TASK WATCHDOG (Clean up stuck tasks every 5 minutes)
  setInterval(async () => {
    try {
      const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      const { data: stuckTasks } = await getSupabaseClient()
        .from('tasks')
        .select('id, email_subject')
        .eq('status', 'processing')
        .lt('started_at', twentyMinutesAgo);

      if (stuckTasks && stuckTasks.length > 0) {
        console.log(`[WATCHDOG] Found ${stuckTasks.length} stuck tasks (>20 min), cleaning up...`);

        const { data: cleaned } = await getSupabaseClient()
          .from('tasks')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: 'Task exceeded 20-minute timeout (watchdog cleanup)'
          })
          .eq('status', 'processing')
          .lt('started_at', twentyMinutesAgo)
          .select('id');

        console.log(`[WATCHDOG] Cleaned up ${cleaned?.length || 0} stuck tasks`);
      }
    } catch (e) {
      console.error('[WATCHDOG] Error cleaning stuck tasks:', e);
    }
  }, 5 * 60 * 1000); // Every 5 minutes
  console.log('[WATCHDOG] ✅ Task timeout watchdog started (5min interval, 20min timeout)');

  startScheduler();
  startInboxManager(); // Start AI inbox management (checks user inboxes every 5 min)
  // startInboxPoller(); // Disabled: Using Cloudflare Email Routing instead

  // Seed default skills (idempotent)
  try {
    const { seedDefaultSkills } = await import("./services/skill-registry.js");
    await seedDefaultSkills();
  } catch {
    // Non-critical — skills will be seeded on next restart
  }
});
