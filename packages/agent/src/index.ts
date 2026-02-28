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
    { key: "AGENT_URL", label: "Agent public URL (e.g. https://agent-production-1339.up.railway.app)" },
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
    "REMOTE_BROWSER_CDP", // Remote Chrome CDP endpoint (VPS headless browser)
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
import { handleIncomingSms, handleIncomingVoice, processVoiceCommand, getTwilioConfig, twilioRequest, getUserVoice, DEFAULT_VOICE, escapeXml } from "./services/twilio.js";
import { resolveUser } from "./services/identity/resolver.js";
import { getSupabaseClient } from "./utils/supabase.js";
import type { TaskRequest, TaskResult } from "./types/index.js";
import skillRoutes from "./routes/skills.js";
import { trackBackgroundJob } from "./utils/job-tracker.js";
import { maskPhone, maskEmail, maskUserId, maskPin } from "./utils/logging.js";
import { hashPin, verifyPinHash, isBcryptHash } from "./utils/hashing.js";
import { globalLimiter, taskLimiter, twilioLimiter } from "./middleware/rate-limit.js";
import { sanitizeTaskInput } from "./security/validator.js";

import crypto from "crypto";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { handleVoiceWebSocket, getActiveSessionCount } from "./services/voice-conversation.js";

const app = express();
const PORT = process.env.AGENT_PORT || 3001;
const USE_CONVERSATION_RELAY = process.env.USE_CONVERSATION_RELAY !== "false"; // default: true
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

// Serve generated documents and files from the /tmp/aevoy-files directory
// Using /tmp ensures writability in all containerized environments (Railway, Docker, etc.)
// Files are served at /files/word/name.docx, /files/excel/name.xlsx, etc.
app.use('/files', express.static(path.join('/tmp', 'aevoy-files'), {
  setHeaders: (res, filePath) => {
    // Force download for Office documents
    if (filePath.endsWith('.docx')) res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    else if (filePath.endsWith('.xlsx')) res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    else if (filePath.endsWith('.pptx')) res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    else if (filePath.endsWith('.pdf')) res.setHeader('Content-Type', 'application/pdf');
    else if (filePath.endsWith('.png')) res.setHeader('Content-Type', 'image/png');
    else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) res.setHeader('Content-Type', 'image/jpeg');
    // Images should display inline, not download
    if (filePath.endsWith('.png') || filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) {
      res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}"`);
    } else {
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
    }
  }
}));

// Timing-safe webhook secret comparison
function verifyWebhookSecret(provided: string | null | undefined): boolean {
  if (!provided || !WEBHOOK_SECRET) return false;
  if (provided.length !== WEBHOOK_SECRET.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(WEBHOOK_SECRET));
}

// Twilio signature validation middleware (async for dynamic import)
async function validateTwilioSignature(req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> {
  if (process.env.TEST_MODE === "true" && process.env.NODE_ENV !== "production") {
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
    version: "2.0.0-agi-v22",
    gitSha: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || "local",
    timestamp: new Date().toISOString(),
    activeTasks,
    activeBrowserTasks: getActiveBrowserTasks(),
    activeVoiceSessions: getActiveSessionCount(),
    queuedTasks: taskQueue.length,
    maxConcurrent: MAX_CONCURRENT_TASKS,
    maxBrowserConcurrent: MAX_CONCURRENT_BROWSER_TASKS,
    conversationRelay: USE_CONVERSATION_RELAY,
    database: supabaseStatus,
    capsolver: !!process.env.CAPSOLVER_API_KEY,
    googleApi: !!process.env.GOOGLE_API_KEY,
    anthropicApi: !!process.env.ANTHROPIC_API_KEY,
    agentUrl: process.env.AGENT_URL ? "set" : "NOT SET",
    remoteBrowser: process.env.REMOTE_BROWSER_CDP || "not configured",
  });
});

// ---- Image generation test endpoint ----
app.get("/debug/test-image-gen", async (req, res) => {
  const googleKey = process.env.GOOGLE_API_KEY;
  if (!googleKey) return res.json({ error: "GOOGLE_API_KEY not set" });

  const models = [
    'gemini-2.0-flash-exp-image-generation',
    'gemini-2.5-flash-image',
    'gemini-3.1-flash-image-preview',
    'gemini-3-pro-image-preview',
  ];
  const results: Record<string, string> = {};

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'x-goog-api-key': googleKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Generate an image: A simple red circle on white background' }] }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '1:1' } },
        }),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        results[model] = `ERROR ${resp.status}: ${errText.substring(0, 200)}`;
      } else {
        const data = await resp.json() as any;
        const parts = data?.candidates?.[0]?.content?.parts || [];
        const hasImage = parts.some((p: any) => p.inlineData?.data);
        results[model] = hasImage ? `SUCCESS (image returned, ${parts.length} parts)` : `NO IMAGE in response (${parts.length} parts)`;
      }
    } catch (err: any) {
      results[model] = `EXCEPTION: ${err.message}`;
    }
  }

  res.json({ models: results, keyPrefix: googleKey.substring(0, 8) });
});

// ---- Voice diagnostic endpoint (for verifying TwiML generation) ----
app.get("/debug/voice-twiml", (req, res) => {
  const secret = req.query.secret;
  if (!verifyWebhookSecret(secret as string)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const wsUrl = `${(process.env.AGENT_URL || "http://localhost:3001").replace("http", "ws")}/ws/voice`;
  const defaultVoice = process.env.ELEVENLABS_DEFAULT_VOICE_ID || "EXAVITQu4vr4xnSDxMaL";
  res.json({
    conversationRelay: USE_CONVERSATION_RELAY,
    sampleTwiml: `<ConversationRelay url="${wsUrl}" ttsProvider="ElevenLabs" voice="${defaultVoice}" transcriptionProvider="Deepgram" dtmfDetection="true" interruptible="true" welcomeGreeting="Hey! What can I help you with?" />`,
  });
});

// ---- Email diagnostic endpoint (protected by webhook secret) ----
app.post("/debug/email-test", async (req, res) => {
  const secret = req.headers["x-webhook-secret"];
  if (!verifyWebhookSecret(secret as string)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const diagnostics: Record<string, unknown> = {
    resendConfigured: !!process.env.RESEND_API_KEY,
    testModeEmail: process.env.TEST_MODE === 'true',
    nodeEnv: process.env.NODE_ENV,
  };

  // Actually try to send a test email (hardcoded recipient only)
  try {
    const { sendResponse: sr } = await import("./services/email.js");
    const sent = await sr({
      to: "ebrahimo@mulgrave.com",
      from: "sage@aevoy.com",
      subject: "Railway Email Diagnostic",
      body: "This test email was sent directly from Railway to diagnose email delivery.",
    });
    diagnostics.emailSent = sent;
  } catch (err) {
    diagnostics.emailError = "send_failed";
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
      console.error("[SMOKE-TEST] Error:", error);
      res.status(500).json({ success: false, error: "Internal server error" });
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

  // Sanitize + prompt injection check
  const sanitizedV2 = sanitizeTaskInput(subject || '', body || '');
  if (sanitizedV2.injectionDetected) {
    console.warn(`[SECURITY] Prompt injection blocked for user ${String(userId).substring(0, 8)}: ${sanitizedV2.injectionPattern}`);
    return res.status(400).json({ error: "invalid_request", message: "Request contains disallowed patterns" });
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
      task: sanitizedV2.body,
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
      message: "An unexpected error occurred while processing your task"
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

  // Sanitize + prompt injection check
  const sanitized = sanitizeTaskInput(task.subject || '', task.body || '');
  if (sanitized.injectionDetected) {
    console.warn(`[SECURITY] Prompt injection blocked for user ${task.userId.substring(0, 8)}: ${sanitized.injectionPattern}`);
    return res.status(400).json({ error: "invalid_request", message: "Request contains disallowed patterns" });
  }
  task.subject = sanitized.subject;
  task.body = sanitized.body;

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

  // Sanitize + prompt injection check
  const sanitizedIncoming = sanitizeTaskInput(task.subject || '', task.body || '');
  if (sanitizedIncoming.injectionDetected) {
    console.warn(`[SECURITY] Prompt injection blocked for user ${task.userId.substring(0, 8)}: ${sanitizedIncoming.injectionPattern}`);
    return res.status(400).json({ error: "invalid_request", message: "Request contains disallowed patterns" });
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
    subject: sanitizedIncoming.subject,
    body: sanitizedIncoming.body,
    inputChannel: (task.inputChannel as "email" | "sms" | "voice" | "web") || "email",
  });

  // Track with 45-minute timeout (matches processor MASTER_TIMEOUT_MS)
  trackBackgroundJob(
    crypto.randomUUID(),
    task.userId,
    taskPromise,
    () => {
      if (task.from) {
        import("./services/email.js").then(({ sendErrorEmail }) => {
          sendErrorEmail(
            task.from,
            process.env.RESEND_FROM_EMAIL || 'noreply@aevoy.com',
            task.subject || 'Your Task',
            'This task took longer than expected. I\'m still working on complex tasks, but please try again if you need a faster response.'
          ).catch((err) => console.error("Failed to send timeout email:", err));
        });
      }
    }
  );

  taskPromise
    .then((result) => {
      console.log(`Incoming task processed: ${result.taskId || 'unknown'}`, { success: result.success, actions: result.actions?.length || 0 });
    })
    .catch(async (error) => {
      console.error("Incoming task processing failed:", error);

      // CRITICAL: Mark the task as completed in DB so it doesn't stay "processing" forever
      // Find the most recent processing task for this user and mark it done
      try {
        const { data: stuckTask } = await getSupabaseClient()
          .from('tasks')
          .select('id')
          .eq('user_id', task.userId)
          .eq('status', 'processing')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (stuckTask) {
          const errMsg = error instanceof Error ? error.message : String(error);
          const isTimeout = errMsg.includes('timeout') || errMsg.includes('Timeout');
          const isBrowser = errMsg.includes('browser') || errMsg.includes('CDP') || errMsg.includes('page') || errMsg.includes('Target closed');
          const userResponse = isTimeout
            ? `This task took longer than expected. Please try again — I'll work faster this time.`
            : isBrowser
            ? `I ran into a browser issue while working on this. Please try again and I'll use a different approach.`
            : `I encountered an unexpected issue. Please try again — I'll improve my approach.`;

          await getSupabaseClient()
            .from('tasks')
            .update({
              status: 'completed',
              response_text: userResponse,
              error_message: errMsg.substring(0, 500),
              completed_at: new Date().toISOString(),
            })
            .eq('id', stuckTask.id);
          console.log(`[CRASH-RECOVERY] Marked task ${stuckTask.id} as completed with recovery message`);
        }
      } catch (dbErr) {
        console.error('[CRASH-RECOVERY] Failed to update task in DB:', dbErr);
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
// Unified PIN verification endpoint — called by email router, SMS handler, etc.
// Uses bcrypt so it MUST run on the agent (not in Cloudflare Workers)
app.post("/api/verify-pin", taskLimiter, async (req, res) => {
  const { userId, pin } = req.body;
  const secret = req.headers["x-webhook-secret"];

  if (secret !== process.env.AGENT_WEBHOOK_SECRET) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (!userId || !pin) {
    return res.status(400).json({ error: "userId and pin required" });
  }

  try {
    const { verifyUnifiedPin, getRemainingAttempts } = await import("./utils/pin-auth.js");
    const result = await verifyUnifiedPin(userId, pin);
    const remaining = result === "invalid" ? await getRemainingAttempts(userId) : undefined;

    res.json({ result, remaining });
  } catch (error) {
    console.error("[VERIFY-PIN] Error:", error);
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
    console.error("[IMAP-TEST] Connection test failed:", err);
    return res.json({ success: false, error: "Email connection test failed" });
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

// ---- Demo Number Config ----
// The website "Call Me Now" demo number — allows ANY caller to talk to Aevoy AI
const DEMO_PHONE_NUMBER = process.env.DEMO_PHONE_NUMBER || "+17789008951";
const DEMO_USER_ID = process.env.DEMO_USER_ID || ""; // Ties demo sessions to an account (set on Railway)
const DEMO_VOICE = "EXAVITQu4vr4xnSDxMaL"; // Sarah — warm, professional ElevenLabs voice
const DEMO_GREETING = "Hey! I'm your Aevoy AI — think of me as an employee who actually does things. I browse websites, fill forms, send emails, make calls, do research, book reservations — whatever you need. Go ahead, test me. Ask me anything.";

// ---- Demo Outbound Call TwiML ----
// Called by Twilio when a demo outbound call connects (from "Call Me Now" button)
// Looks up caller in profiles for interview detection, returns ConversationRelay TwiML
app.post("/webhook/voice/demo-outbound", async (req, res) => {
  const callerNumber = req.body.To || ""; // For outbound calls, To = the user's phone
  const callSid = req.body.CallSid || "";
  const queryUserId = req.query.userId as string || ""; // Passed from /api/demo/call for logged-in users
  const wsUrl = `${(process.env.AGENT_URL || "https://agent-production-1339.up.railway.app").replace("http", "ws")}/ws/voice`;

  console.log(`[VOICE-DEMO] Outbound demo call connected to ${callerNumber?.slice(0, 4)}****, queryUserId=${queryUserId?.slice(0, 8) || "none"}`);

  try {
    const supabase = getSupabaseClient();
    const callerDigits = callerNumber.replace(/\D/g, "").slice(-10);
    let effectiveCallType = "demo";
    let effectiveUserId = queryUserId || DEMO_USER_ID;
    let effectiveGreeting = DEMO_GREETING;

    // Resolution priority: 1) queryUserId from web API, 2) phone number lookup, 3) cold demo
    if (queryUserId) {
      // Logged-in user — look up their profile directly by userId
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("id, display_name, username, onboarding_interview_status")
          .eq("id", queryUserId)
          .single();

        if (profile) {
          const interviewDone = profile.onboarding_interview_status === "phone_call_completed"
            || profile.onboarding_interview_status === "web_completed";
          const name = profile.display_name || profile.username || "";

          if (!interviewDone) {
            effectiveCallType = "onboarding_setup";
            effectiveUserId = profile.id;
            effectiveGreeting = name
              ? `Hey ${name}! Welcome to Aevoy — I'm your new AI employee. I'm stoked to start working for you. Let me ask you a few quick questions so I can be exactly the assistant you need. Ready?`
              : `Hey there! Welcome to Aevoy — I'm your new AI employee. I'm stoked to start working for you. Let me ask you a few quick questions so I can be exactly the assistant you need. Ready?`;
            console.log(`[VOICE-DEMO] Outbound matched logged-in user ${profile.id.slice(0, 8)} (${name}), starting onboarding setup`);
          } else {
            effectiveCallType = "demo";
            effectiveUserId = profile.id;
            effectiveGreeting = name
              ? `Hey ${name}! Good to hear from you. What can I help you with?`
              : `Hey there! Good to hear from you. What can I help you with?`;
            console.log(`[VOICE-DEMO] Outbound user ${profile.id.slice(0, 8)} already onboarded, regular demo`);
          }

          // Auto-save the caller's phone number to their profile if not already set
          if (callerDigits.length >= 10) {
            const { data: currentProfile } = await supabase
              .from("profiles")
              .select("phone_number")
              .eq("id", profile.id)
              .single();
            if (currentProfile && !currentProfile.phone_number) {
              const normalized = callerNumber.startsWith("+") ? callerNumber : `+${callerNumber.replace(/\D/g, "")}`;
              await supabase.from("profiles").update({ phone_number: normalized }).eq("id", profile.id);
              console.log(`[VOICE-DEMO] Auto-saved phone number for user ${profile.id.slice(0, 8)}`);
            }
          }
        }
      } catch (e: any) {
        console.error("[VOICE-DEMO] Outbound userId lookup error:", e.message);
      }
    } else if (callerDigits.length >= 10) {
      // No userId — fall back to phone number lookup
      try {
        const { data: matchedProfiles } = await supabase
          .from("profiles")
          .select("id, display_name, username, onboarding_interview_status")
          .or(`phone_number.ilike.%${callerDigits}`);

        if (matchedProfiles && matchedProfiles.length > 0) {
          const profile = matchedProfiles[0];
          const interviewDone = profile.onboarding_interview_status === "phone_call_completed"
            || profile.onboarding_interview_status === "web_completed";

          if (!interviewDone) {
            effectiveCallType = "onboarding_setup";
            effectiveUserId = profile.id;
            const name = profile.display_name || profile.username || "";
            effectiveGreeting = name
              ? `Hey ${name}! Welcome to Aevoy — I'm your new AI employee. I'm stoked to start working for you. Let me ask you a few quick questions so I can be exactly the assistant you need. Ready?`
              : `Hey there! Welcome to Aevoy — I'm your new AI employee. I'm stoked to start working for you. Let me ask you a few quick questions so I can be exactly the assistant you need. Ready?`;
            console.log(`[VOICE-DEMO] Outbound matched registered user ${profile.id.slice(0, 8)} (${name}), starting onboarding setup`);
          } else {
            console.log(`[VOICE-DEMO] Outbound matched user ${profile.id.slice(0, 8)} but interview already done`);
          }
        }
      } catch (e: any) {
        console.error("[VOICE-DEMO] Outbound caller lookup error:", e.message);
      }
    }

    // Log demo call (fire-and-forget)
    supabase.from("call_history").insert({
      call_sid: callSid,
      direction: "outbound",
      from_number: DEMO_PHONE_NUMBER,
      to_number: callerNumber,
      call_type: effectiveCallType,
      user_id: effectiveUserId || null,
      pin_required: false,
      pin_success: null,
    }).then(() => {}, (e: any) => console.error("[VOICE-DEMO] Call history insert failed:", e));

    const escGreeting = effectiveGreeting.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay url="${wsUrl}" ttsProvider="ElevenLabs" voice="${DEMO_VOICE}" transcriptionProvider="Deepgram" dtmfDetection="true" interruptible="true" welcomeGreeting="${escGreeting}">
      <Parameter name="userId" value="${effectiveUserId}" />
      <Parameter name="callType" value="${effectiveCallType}" />
      <Parameter name="callerNumber" value="${callerNumber}" />
    </ConversationRelay>
  </Connect>
  <Say voice="Polly.Joanna-Neural">${escGreeting}</Say>
</Response>`;

    console.log(`[VOICE-DEMO] Outbound TwiML: ${effectiveCallType}, userId=${effectiveUserId?.slice(0, 8) || "none"}`);
    res.type("text/xml").send(twiml);
  } catch (error: any) {
    console.error("[VOICE-DEMO] Outbound TwiML error:", error.message);
    // Fallback: simple greeting so the call doesn't fail silently
    const fallback = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">Hey there! I'm Aevoy, your AI assistant. Something went wrong connecting to my brain, but I'm real! Visit aevoy.com to try again.</Say>
</Response>`;
    res.type("text/xml").send(fallback);
  }
});

// ---- Outbound Call TwiML (for scheduled callbacks) ----
// Twilio fetches this URL when making outbound calls via callUser()
// Returns ConversationRelay TwiML for full conversational callbacks
app.post("/webhook/voice/outbound-twiml", async (req, res) => {
  const userId = req.query.userId as string || req.body.userId || '';
  const message = req.query.message as string || req.body.message || '';
  const wsUrl = `${(process.env.AGENT_URL || 'http://localhost:3001').replace('http', 'ws')}/ws/voice`;
  let voiceId = process.env.ELEVENLABS_DEFAULT_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';

  // Load user's voice preference
  if (userId) {
    try {
      const { data: vs } = await getSupabaseClient()
        .from("user_settings")
        .select("voice_preference")
        .eq("user_id", userId)
        .single();
      if (vs?.voice_preference && !vs.voice_preference.includes('.')) {
        voiceId = vs.voice_preference;
      }
    } catch { /* use default */ }
  }

  const greeting = message || 'Hey! Your AI assistant is calling back. What can I help you with?';
  const escGreeting = greeting.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Use <Parameter> elements (not URL query params) so handleSetup receives them via customParameters
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay url="${wsUrl}" ttsProvider="ElevenLabs" voice="${voiceId}" transcriptionProvider="Deepgram" dtmfDetection="true" interruptible="true" welcomeGreeting="${escGreeting}">
      <Parameter name="userId" value="${userId}" />
      <Parameter name="callType" value="callback" />
    </ConversationRelay>
  </Connect>
  <Say voice="Polly.Joanna-Neural">${escGreeting}</Say>
</Response>`;

  console.log(`[VOICE] Outbound TwiML served for user ${userId?.slice(0, 8)}, voice=${voiceId}`);
  res.type('text/xml').send(twiml);
});

// ---- External Call TwiML (for calling restaurants, businesses, etc.) ----
// callExternal() creates the call and Twilio fetches this URL for TwiML.
// Returns ConversationRelay so the AI can have a REAL conversation with the business.
app.post("/webhook/voice/external-call-twiml", async (req, res) => {
  const userId = req.query.userId as string || '';
  const contextKey = req.query.contextKey as string || '';
  const script = req.query.script as string || '';
  const businessName = req.query.businessName as string || 'the business';
  const wsUrl = `${(process.env.AGENT_URL || 'http://localhost:3001').replace('http', 'ws')}/ws/voice`;
  let voiceId = process.env.ELEVENLABS_DEFAULT_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';

  // Load user's voice preference
  if (userId) {
    try {
      const { data: vs } = await getSupabaseClient()
        .from("user_settings")
        .select("voice_preference")
        .eq("user_id", userId)
        .single();
      if (vs?.voice_preference && !vs.voice_preference.includes('.')) {
        voiceId = vs.voice_preference;
      }
    } catch { /* use default */ }
  }

  // Opening line for the business (spoken immediately when they pick up)
  const greeting = script
    ? script.substring(0, 200) // Use the script as the opening line
    : `Hi, I'm calling on behalf of a customer to make a reservation.`;
  const escGreeting = greeting.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay url="${wsUrl}" ttsProvider="ElevenLabs" voice="${voiceId}" transcriptionProvider="Deepgram" dtmfDetection="true" interruptible="true" welcomeGreeting="${escGreeting}">
      <Parameter name="userId" value="${userId}" />
      <Parameter name="callType" value="external_call" />
      <Parameter name="contextKey" value="${contextKey}" />
      <Parameter name="script" value="${escGreeting}" />
      <Parameter name="businessName" value="${businessName.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" />
    </ConversationRelay>
  </Connect>
</Response>`;

  console.log(`[VOICE] External call TwiML for user ${userId?.slice(0, 8)}, business=${businessName}, voice=${voiceId}`);
  res.type('text/xml').send(twiml);
});

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

    // ---- DEMO NUMBER: ANY call to the demo number gets the demo experience ----
    // This check runs BEFORE user resolution — even registered users calling the demo
    // number get the demo, because the demo number is for the website "Call Me Now" button.
    const normalizedTo = twilioNumber.replace(/\D/g, "").slice(-10);
    const normalizedDemo = DEMO_PHONE_NUMBER.replace(/\D/g, "").slice(-10);
    const isDemoCall = normalizedTo === normalizedDemo;

    if (isDemoCall) {
      // Check if this caller is a registered user (by phone number)
      const callerDigits = callerNumber.replace(/\D/g, "").slice(-10);
      let registeredUserId = "";
      let registeredUserName = "";
      let isRegisteredCaller = false;

      if (callerDigits.length >= 10) {
        try {
          const { data: matchedProfiles } = await supabase
            .from("profiles")
            .select("id, display_name, username, onboarding_interview_status")
            .or(`phone_number.ilike.%${callerDigits}`);

          if (matchedProfiles && matchedProfiles.length > 0) {
            const profile = matchedProfiles[0];
            registeredUserId = profile.id;
            registeredUserName = profile.display_name || profile.username || "";
            // Only do interview if they haven't completed it yet
            const interviewDone = profile.onboarding_interview_status === "phone_call_completed"
              || profile.onboarding_interview_status === "web_completed";
            isRegisteredCaller = !interviewDone;
            console.log(`[VOICE-DEMO] Matched caller to user ${registeredUserId.slice(0, 8)} (${registeredUserName}), interview_done=${interviewDone}`);
          }
        } catch (e: any) {
          console.error("[VOICE-DEMO] Caller lookup error:", e.message);
        }
      }

      const effectiveCallType = isRegisteredCaller ? "onboarding_setup" : "demo";
      const effectiveUserId = isRegisteredCaller ? registeredUserId : DEMO_USER_ID;
      const interviewGreeting = registeredUserName
        ? `Hey ${registeredUserName}! Welcome to Aevoy — I'm your new AI employee. I'm stoked to start working for you. Let me ask you a few quick questions so I can be exactly the assistant you need. Ready?`
        : `Hey there! Welcome to Aevoy — I'm your new AI employee. I'm stoked to start working for you. Let me ask you a few quick questions so I can be exactly the assistant you need. Ready?`;
      const effectiveGreeting = isRegisteredCaller ? interviewGreeting : DEMO_GREETING;

      console.log(`[VOICE-DEMO] ${effectiveCallType} call from ${maskPhone(callerNumber)} (${Date.now() - startTime}ms)`);

      // Log demo call (fire-and-forget)
      supabase.from("call_history").insert({
        call_sid: callSid,
        direction: "inbound",
        from_number: callerNumber,
        to_number: twilioNumber,
        call_type: effectiveCallType,
        user_id: effectiveUserId || null,
        pin_required: false,
        pin_success: null
      }).then(() => {}, (e: any) => console.error("[VOICE] Demo call history insert failed:", e));

      res.type("text/xml");

      if (USE_CONVERSATION_RELAY) {
        const wsUrl = `${(process.env.AGENT_URL || "https://agent-production-1339.up.railway.app").replace("http", "ws")}/ws/voice`;
        console.log(`[VOICE-DEMO] ConversationRelay ${effectiveCallType}: voice=${DEMO_VOICE}, userId=${effectiveUserId?.slice(0, 8) || "none"}`);
        return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay url="${wsUrl}" ttsProvider="ElevenLabs" voice="${DEMO_VOICE}" transcriptionProvider="Deepgram" dtmfDetection="true" interruptible="true" welcomeGreeting="${escapeXml(effectiveGreeting)}">
      <Parameter name="userId" value="${effectiveUserId}" />
      <Parameter name="callType" value="${effectiveCallType}" />
      <Parameter name="callerNumber" value="${callerNumber}" />
    </ConversationRelay>
  </Connect>
  <Say voice="Polly.Joanna-Neural">${escapeXml(effectiveGreeting)}</Say>
</Response>`);
      }

      // Legacy fallback for demo
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">${escapeXml(effectiveGreeting)}</Say>
  <Gather input="speech" timeout="10" speechTimeout="auto" speechModel="phone_call" enhanced="true"
    action="${process.env.AGENT_URL || 'https://agent-production-1339.up.railway.app'}/webhook/voice/demo" method="POST" />
  <Say voice="${voice}">I didn't catch that. Feel free to call back anytime!</Say>
</Response>`);
    }

    // OPTIMIZATION: Resolve user once, then load profile (eliminates duplicate resolveUser call)
    const resolved = await resolveUser(callerNumber);

    if (!resolved) {
      // ---- Not demo, not recognized — look up who owns the called number ----
      const calledUser = await resolveUser(twilioNumber);

      if (!calledUser) {
        // Nobody owns this number
        console.log(`[VOICE] Unknown caller ${maskPhone(callerNumber)} to unowned number ${maskPhone(twilioNumber)} (${Date.now() - startTime}ms)`);
        supabase.from("call_history").insert({
          call_sid: callSid, direction: "inbound", from_number: callerNumber,
          to_number: twilioNumber, call_type: "unknown", pin_required: false, pin_success: false
        }).then(() => {}, (e: any) => console.error("[VOICE] Call history insert failed:", e));
        res.type("text/xml");
        return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Sorry, this number is not in service. Visit aevoy dot com for more information.</Say>
  <Hangup/>
</Response>`);
      }

      // Found the user who owns this number — check if PIN is required
      const { hasPin: userHasPinCheck } = await import("./utils/pin-auth.js");
      const hasPinSet = await userHasPinCheck(calledUser.userId);
      voice = await getUserVoice(calledUser.userId);
      const agentUrl = process.env.AGENT_URL || 'https://agent-production-1339.up.railway.app';

      console.log(`[VOICE] Unknown caller ${maskPhone(callerNumber)} to ${calledUser.username}'s number, PIN required: ${hasPinSet} (${Date.now() - startTime}ms)`);

      supabase.from("call_history").insert({
        call_sid: callSid, direction: "inbound", from_number: callerNumber,
        to_number: twilioNumber, call_type: hasPinSet ? "pin_challenge" : "receptionist",
        user_id: calledUser.userId, pin_required: hasPinSet, pin_success: null
      }).then(() => {}, (e: any) => console.error("[VOICE] Call history insert failed:", e));

      res.type("text/xml");

      if (hasPinSet) {
        // Prompt for PIN via DTMF keypad
        return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Welcome to ${escapeXml(calledUser.username)}'s assistant. I don't recognize your phone number. Please enter your security PIN using your keypad, then press pound.</Say>
  <Gather action="${agentUrl}/webhook/voice/pin-verify" numDigits="6" timeout="15" finishOnKey="#">
    <Say voice="${voice}">Enter your 4 to 6 digit PIN now.</Say>
  </Gather>
  <Say voice="${voice}">I didn't receive a PIN. Goodbye.</Say>
  <Hangup/>
</Response>`);
      }

      // No PIN set — receptionist mode (take a message)
      const processUrl = `${agentUrl}/webhook/voice/message/${calledUser.userId}?caller=${encodeURIComponent(callerNumber)}`;
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Hello! You've reached ${escapeXml(calledUser.username)}'s assistant. They're not available right now, but I can take a message.</Say>
  <Gather input="speech" timeout="15" speechTimeout="auto"
    action="${processUrl}" method="POST">
    <Say voice="${voice}">Please leave your message. What would you like me to tell ${escapeXml(calledUser.username)}?</Say>
  </Gather>
  <Say voice="${voice}">I didn't hear a message. I'll let ${escapeXml(calledUser.username)} know you called. Goodbye!</Say>
</Response>`);
    }

    const userId = resolved.userId;

    // Load profile + check call limit in parallel (saves ~200-400ms)
    const [profileResult, withinLimit] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, username, display_name, bot_name, voice_pin, voice_pin_hash, voice_pin_attempts, voice_pin_locked_until, timezone")
        .eq("id", userId)
        .single(),
      checkDailyCallLimit(userId),
    ]);
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

    const isPinLocked = profile.voice_pin_locked_until && new Date(profile.voice_pin_locked_until) > new Date();

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

    // Verified caller — route to task handler
    console.log(`[VOICE] Recognized user: ${profile.username} (${userId.slice(0, 8)})`);

    // OPTIMIZATION: Fire call_history insert + settings fetch in parallel (non-blocking)
    const settingsPromise = supabase
      .from('user_settings')
      .select('greeting_style, voice_preference, elevenlabs_voice_id')
      .eq('user_id', userId)
      .single();

    // Fire-and-forget call history (don't block TwiML response)
    supabase.from("call_history").insert({
      user_id: userId,
      call_sid: callSid,
      direction: "inbound",
      from_number: callerNumber,
      to_number: twilioNumber,
      call_type: "task",
      pin_required: false,
      pin_success: null
    }).then(() => {}, (e: any) => console.error("[VOICE] Call history insert failed:", e));

    const { data: settings } = await settingsPromise;
    const greetingStyle = settings?.greeting_style || 'casual';

    res.type("text/xml");

    // ConversationRelay: real-time two-way voice conversation via WebSocket
    if (USE_CONVERSATION_RELAY) {
      const wsUrl = `${(process.env.AGENT_URL || "http://localhost:3001").replace("http", "ws")}/ws/voice`;
      // Use user's voice preference (stored as ElevenLabs voice ID), fall back to Rachel
      const elevenlabsVoice = settings?.voice_preference && !settings.voice_preference.includes('.') ? settings.voice_preference : (process.env.ELEVENLABS_DEFAULT_VOICE_ID || "EXAVITQu4vr4xnSDxMaL");

      // OPTIMIZATION: Use fast template greeting for TwiML (avoid blocking on AI API call)
      const userName = profile.display_name || profile.username || "there";
      const botName = profile.bot_name || "Dave";
      const hour = new Date().getHours();
      const timeGreeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
      const greeting = greetingStyle === 'jarvis'
        ? `${timeGreeting}, ${userName}. How may I assist you?`
        : `Hey ${userName}! What can I help you with?`;

      console.log(`[VOICE-INCOMING] ConversationRelay for ${userId.slice(0, 8)}: voice=${elevenlabsVoice}`);
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay url="${wsUrl}" ttsProvider="ElevenLabs" voice="${elevenlabsVoice}" transcriptionProvider="Deepgram" dtmfDetection="true" interruptible="true" welcomeGreeting="${escapeXml(greeting)}">
      <Parameter name="userId" value="${userId}" />
      <Parameter name="callType" value="task" />
    </ConversationRelay>
  </Connect>
  <Say voice="Polly.Joanna-Neural">${escapeXml(greeting)}</Say>
  <Gather input="speech" timeout="10" speechTimeout="auto" speechModel="phone_call" enhanced="true"
    action="${process.env.AGENT_URL}/webhook/voice/process/${userId}" method="POST" />
  <Say voice="Polly.Joanna-Neural">I didn't catch that. Please try calling back.</Say>
</Response>`);
    }

    // Legacy fallback: TwiML Say + Gather
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
  const callerNum = req.body.From || "";

  console.log(`[TWILIO] Incoming voice call for user ${maskUserId(userId)} from ${maskPhone(callerNum)}`);

  try {
    res.type("text/xml");

    // Check if caller is the registered phone owner
    const { isRegisteredPhone: isCallerOwner, hasPin: callerHasPin } = await import("./utils/pin-auth.js");
    const callerIsOwner = callerNum ? await isCallerOwner(userId, callerNum) : false;

    if (!callerIsOwner && callerNum) {
      // Unknown caller — check if user has PIN
      const hasPinSet = await callerHasPin(userId);
      const agentUrl = process.env.AGENT_URL || 'https://agent-production-1339.up.railway.app';

      if (hasPinSet) {
        // Prompt for PIN via DTMF
        console.log(`[TWILIO] Unknown caller to ${maskUserId(userId)}'s number — PIN challenge`);
        return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">I don't recognize your phone number. Please enter your security PIN using your keypad, then press pound.</Say>
  <Gather action="${agentUrl}/webhook/voice/pin-verify" numDigits="6" timeout="15" finishOnKey="#">
    <Say voice="${voice}">Enter your 4 to 6 digit PIN now.</Say>
  </Gather>
  <Say voice="${voice}">I didn't receive a PIN. Goodbye.</Say>
  <Hangup/>
</Response>`);
      }

      // No PIN set — receptionist mode
      const { data: ownerProfile } = await getSupabaseClient().from("profiles").select("username").eq("id", userId).single();
      const userName = ownerProfile?.username || "the user";
      const processUrl = `${agentUrl}/webhook/voice/message/${userId}?caller=${encodeURIComponent(callerNum)}`;
      console.log(`[TWILIO] Unknown caller to ${maskUserId(userId)}'s number — receptionist mode`);
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Hello! You've reached ${escapeXml(userName)}'s assistant. They're not available right now, but I can take a message.</Say>
  <Gather input="speech" timeout="15" speechTimeout="auto"
    action="${processUrl}" method="POST">
    <Say voice="${voice}">Please leave your message. What would you like me to tell ${escapeXml(userName)}?</Say>
  </Gather>
  <Say voice="${voice}">I didn't hear a message. Goodbye!</Say>
</Response>`);
    }

    if (USE_CONVERSATION_RELAY) {
      const wsUrl = `${(process.env.AGENT_URL || "http://localhost:3001").replace("http", "ws")}/ws/voice`;

      // Fetch user's voice preference (ElevenLabs voice ID) from DB
      let elevenlabsVoice = process.env.ELEVENLABS_DEFAULT_VOICE_ID || "EXAVITQu4vr4xnSDxMaL";
      let greeting: string;
      try {
        const { data: profile } = await getSupabaseClient().from("profiles").select("display_name, username, bot_name, timezone").eq("id", userId).single();
        const { data: userSettings } = await getSupabaseClient().from("user_settings").select("voice_preference, greeting_style").eq("user_id", userId).single();
        if (userSettings?.voice_preference && !userSettings.voice_preference.includes('.')) {
          elevenlabsVoice = userSettings.voice_preference;
        }
        // Fast template greeting (no API call — keeps TwiML response instant)
        const userName = profile?.display_name || profile?.username || "there";
        const botName = profile?.bot_name || "Dave";
        const hour = new Date().getHours();
        const timeGreeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
        const greetingStyle = userSettings?.greeting_style || "casual";
        greeting = greetingStyle === 'jarvis'
          ? `${timeGreeting}, ${userName}. How may I assist you?`
          : `Hey ${userName}! It's ${botName}. What can I help you with?`;
      } catch { greeting = "Hey! What can I help with?"; }

      console.log(`[VOICE] ConversationRelay TwiML for ${userId.slice(0, 8)}: voice=${elevenlabsVoice}, wsUrl=${wsUrl}`);
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay url="${wsUrl}" ttsProvider="ElevenLabs" voice="${elevenlabsVoice}" transcriptionProvider="Deepgram" dtmfDetection="true" interruptible="true" welcomeGreeting="${escapeXml(greeting)}">
      <Parameter name="userId" value="${userId}" />
      <Parameter name="callType" value="task" />
    </ConversationRelay>
  </Connect>
  <Say voice="Polly.Joanna-Neural">${escapeXml(greeting)}</Say>
  <Gather input="speech" timeout="10" speechTimeout="auto" speechModel="phone_call" enhanced="true"
    action="${process.env.AGENT_URL}/webhook/voice/process/${userId}" method="POST" />
  <Say voice="Polly.Joanna-Neural">I didn't catch that. Please try calling back.</Say>
</Response>`);
    }

    // Legacy fallback
    const from = req.body.From || "";
    const to = req.body.To || "";
    const callSid = req.body.CallSid || "";
    const twiml = await handleIncomingVoice({ from, to, callSid });
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
            subject: body.substring(0, 200),
            body: "",
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
      // Unknown sender — look up who owns the Aevoy number being texted
      const recipientUser = await resolveUser(twilioNumber);

      if (!recipientUser) {
        console.log(`[SMS] Unknown sender ${maskPhone(senderNumber)} to unowned number ${maskPhone(twilioNumber)}`);
        res.type("text/xml");
        return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Sorry, this number is not in service. Visit aevoy.com for more information.</Message>
</Response>`);
      }

      // Found the user — check if PIN is required
      const { hasPin: smsHasPin, verifyUnifiedPin: smsVerifyPin, getRemainingAttempts: smsGetRemaining } = await import("./utils/pin-auth.js");
      const hasPinSet = await smsHasPin(recipientUser.userId);

      if (!hasPinSet) {
        // No PIN — process message directly for the user
        console.log(`[SMS] No PIN set for ${recipientUser.username} — processing message from unknown sender`);
        const { processTask: smsProcessTask } = await import("./services/processor.js");
        await smsProcessTask({
          userId: recipientUser.userId, username: recipientUser.username,
          from: senderNumber, subject: message.substring(0, 200), body: "", inputChannel: "sms"
        });
        res.type("text/xml");
        return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
      }

      // PIN required — look for 4-6 digit PIN in message body
      const pinMatch = message.match(/\b(\d{4,6})\b/);

      if (!pinMatch) {
        res.type("text/xml");
        return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Hi! This is ${recipientUser.username}'s AI assistant. I don't recognize your number. Please include your 4-6 digit security PIN in your message to verify your identity.</Message>
</Response>`);
      }

      const pinResult = await smsVerifyPin(recipientUser.userId, pinMatch[1]);

      if (pinResult === "locked") {
        res.type("text/xml");
        return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Too many incorrect PIN attempts. Please try again in about an hour.</Message>
</Response>`);
      }

      if (pinResult !== "valid") {
        const remaining = await smsGetRemaining(recipientUser.userId);
        res.type("text/xml");
        return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Incorrect PIN. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining. Include your correct PIN and resend.</Message>
</Response>`);
      }

      // PIN verified — strip PIN and process
      const cleanMessage = message.replace(new RegExp(`\\b${pinMatch[1]}\\b`), "").trim();
      console.log(`[SMS] PIN verified for unknown sender ${maskPhone(senderNumber)} -> ${recipientUser.username}`);

      const { processTask: smsProcessTask } = await import("./services/processor.js");
      await smsProcessTask({
        userId: recipientUser.userId, username: recipientUser.username,
        from: senderNumber, subject: (cleanMessage || message).substring(0, 200), body: "", inputChannel: "sms"
      });

      res.type("text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
    }

    const userId = resolved.userId;
    const username = resolved.username;
    console.log(`[SMS] Recognized user: ${username} (${userId.slice(0, 8)})`);

    // Check if sender is the registered phone number or needs PIN
    const { isRegisteredPhone, hasPin: userHasPin, verifyUnifiedPin } = await import("./utils/pin-auth.js");
    const isSenderOwner = await isRegisteredPhone(userId, senderNumber);

    if (!isSenderOwner && await userHasPin(userId)) {
      // Unrecognized number — look for 4-6 digit PIN in message body
      const pinMatch = message.match(/\b(\d{4,6})\b/);

      if (!pinMatch) {
        res.type("text/xml");
        return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>I don't recognize this number. Include your 4-6 digit security PIN in the message to verify your identity.</Message>
</Response>`);
      }

      const enteredPin = pinMatch[1];
      const pinResult = await verifyUnifiedPin(userId, enteredPin);

      if (pinResult === "locked") {
        res.type("text/xml");
        return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Too many incorrect PIN attempts. Please try again in about an hour.</Message>
</Response>`);
      }

      if (pinResult !== "valid") {
        const { getRemainingAttempts } = await import("./utils/pin-auth.js");
        const remaining = await getRemainingAttempts(userId);
        res.type("text/xml");
        return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Incorrect PIN. ${remaining} attempts remaining. Include your correct PIN and resend.</Message>
</Response>`);
      }

      // PIN verified — strip PIN from message before processing
      const cleanMessage = message.replace(new RegExp(`\\b${enteredPin}\\b`), "").trim();
      console.log(`[SMS] PIN verified for unrecognized number ${maskPhone(senderNumber)}`);

      const { processTask } = await import("./services/processor.js");
      await processTask({
        userId,
        username,
        from: senderNumber,
        subject: (cleanMessage || message).substring(0, 200),
        body: "",
        inputChannel: "sms"
      });

      res.type("text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
    }

    // Process SMS as task (sender is the account owner or no PIN set)
    const { processTask } = await import("./services/processor.js");
    await processTask({
      userId,
      username,
      from: senderNumber,
      subject: message.substring(0, 200),
      body: "",
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

    // Resolve user identity — try caller first, then the called number (To)
    let resolved = await resolveUser(callerNumber);

    if (!resolved) {
      // Unknown caller — resolve by the Aevoy number being called (To)
      const calledNumber = req.body.To || req.body.Called || "";
      if (calledNumber) {
        resolved = await resolveUser(calledNumber);
      }
    }

    if (!resolved) {
      // Also check ownerId query parameter (backup from Gather URL)
      const ownerId = (req.query as Record<string, string>).ownerId;
      if (ownerId) {
        const { data: ownerProfile } = await supabase
          .from("profiles").select("id, username, email").eq("id", ownerId).single();
        if (ownerProfile) {
          resolved = { userId: ownerProfile.id, username: ownerProfile.username, email: ownerProfile.email, phone: null };
        }
      }
    }

    if (!resolved) {
      res.type("text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">No account found. Please sign up at aevoy dot com.</Say>
  <Hangup/>
</Response>`);
    }

    const userId = resolved.userId;
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, username, unified_pin_hash, voice_pin_hash, voice_pin")
      .eq("id", userId)
      .single();

    if (!profile || (!profile.unified_pin_hash && !profile.voice_pin_hash && !profile.voice_pin)) {
      res.type("text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">No PIN set. Please set your security PIN at aevoy dot com slash dashboard slash settings.</Say>
  <Hangup/>
</Response>`);
    }

    voice = await getUserVoice(profile.id);

    // Unified PIN verification (handles all hash formats + auto-migration)
    const { verifyUnifiedPin } = await import("./utils/pin-auth.js");
    const pinResult = await verifyUnifiedPin(userId, enteredPin);

    if (pinResult === "locked") {
      res.type("text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Too many incorrect attempts. Your account is locked for 1 hour. Goodbye.</Say>
  <Hangup/>
</Response>`);
    }

    if (pinResult !== "valid") {
      const { getRemainingAttempts } = await import("./utils/pin-auth.js");
      const remaining = await getRemainingAttempts(userId);
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

  console.log(`[VOICE-PREMIUM] Call to user ${userId.slice(0, 8)} from ${maskPhone(from)}`);

  try {
    const supabase = getSupabaseClient();

    // Check if caller is the registered phone owner
    const { isRegisteredPhone: isPremiumVoiceOwner, hasPin: premiumVoiceHasPin } = await import("./utils/pin-auth.js");
    const callerIsOwner = from ? await isPremiumVoiceOwner(userId, from) : false;

    if (!callerIsOwner && from) {
      const hasPinSet = await premiumVoiceHasPin(userId);
      const agentUrl = process.env.AGENT_URL || 'https://agent-production-1339.up.railway.app';

      if (hasPinSet) {
        console.log(`[VOICE-PREMIUM] Unknown caller ${maskPhone(from)} — PIN challenge`);
        res.type("text/xml");
        return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">I don't recognize your phone number. Please enter your security PIN using your keypad, then press pound.</Say>
  <Gather action="${agentUrl}/webhook/voice/pin-verify" numDigits="6" timeout="15" finishOnKey="#">
    <Say voice="${voice}">Enter your 4 to 6 digit PIN now.</Say>
  </Gather>
  <Say voice="${voice}">I didn't receive a PIN. Goodbye.</Say>
  <Hangup/>
</Response>`);
      }

      // No PIN — receptionist mode
      const { data: ownerProfile } = await supabase.from("profiles").select("username").eq("id", userId).single();
      const userName = ownerProfile?.username || "the user";
      const processUrl = `${agentUrl}/webhook/voice/message/${userId}?caller=${encodeURIComponent(from)}`;
      console.log(`[VOICE-PREMIUM] Unknown caller ${maskPhone(from)} — receptionist mode`);
      res.type("text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Hello! You've reached ${escapeXml(userName)}'s assistant. They're not available right now, but I can take a message.</Say>
  <Gather input="speech" timeout="15" speechTimeout="auto"
    action="${processUrl}" method="POST">
    <Say voice="${voice}">Please leave your message.</Say>
  </Gather>
  <Say voice="${voice}">I didn't hear a message. Goodbye!</Say>
</Response>`);
    }

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

    // Route to conversation handler
    res.type("text/xml");

    if (USE_CONVERSATION_RELAY) {
      const wsUrl = `${(process.env.AGENT_URL || "http://localhost:3001").replace("http", "ws")}/ws/voice`;
      // Read user's ElevenLabs voice preference
      let elevenlabsVoice = process.env.ELEVENLABS_DEFAULT_VOICE_ID || "EXAVITQu4vr4xnSDxMaL";
      try {
        const { data: vs } = await supabase.from("user_settings").select("voice_preference").eq("user_id", userId).single();
        if (vs?.voice_preference && !vs.voice_preference.includes('.')) elevenlabsVoice = vs.voice_preference;
      } catch {}

      console.log(`[VOICE-PREMIUM] ConversationRelay for ${userId.slice(0, 8)}: voice=${elevenlabsVoice}`);
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay url="${wsUrl}" ttsProvider="ElevenLabs" voice="${elevenlabsVoice}" transcriptionProvider="Deepgram" dtmfDetection="true" interruptible="true" welcomeGreeting="Hey! What can I help you with?">
      <Parameter name="userId" value="${userId}" />
      <Parameter name="callType" value="task" />
    </ConversationRelay>
  </Connect>
  <Say voice="Polly.Joanna-Neural">Hey! What can I help you with?</Say>
  <Gather input="speech" timeout="10" speechTimeout="auto" speechModel="phone_call" enhanced="true"
    action="${process.env.AGENT_URL}/webhook/voice/process/${userId}" method="POST" />
  <Say voice="Polly.Joanna-Neural">I didn't catch that. Please try calling back.</Say>
</Response>`);
    }

    // Legacy fallback
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
  let smsBody = req.body.Body || "";
  const messageSid = req.body.MessageSid || "";

  console.log(`[SMS-PREMIUM] Message to user ${userId.slice(0, 8)} from ${maskPhone(from)}: "${smsBody.slice(0, 50)}..."`);

  try {
    const supabase = getSupabaseClient();
    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", userId)
      .single();

    // Check if sender is the registered phone owner
    const { isRegisteredPhone: isPremiumOwner, hasPin: premiumHasPin, verifyUnifiedPin: premiumVerifyPin, getRemainingAttempts: premiumGetRemaining } = await import("./utils/pin-auth.js");
    const callerIsOwner = from ? await isPremiumOwner(userId, from) : false;

    if (!callerIsOwner && from) {
      const hasPinSet = await premiumHasPin(userId);

      if (hasPinSet) {
        // PIN required — look for 4-6 digit PIN in message
        const pinMatch = smsBody.match(/\b(\d{4,6})\b/);

        if (!pinMatch) {
          res.type("text/xml");
          return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>I don't recognize this number. Include your 4-6 digit security PIN in the message to verify your identity.</Message>
</Response>`);
        }

        const pinResult = await premiumVerifyPin(userId, pinMatch[1]);

        if (pinResult === "locked") {
          res.type("text/xml");
          return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Too many incorrect PIN attempts. Please try again in about an hour.</Message>
</Response>`);
        }

        if (pinResult !== "valid") {
          const remaining = await premiumGetRemaining(userId);
          res.type("text/xml");
          return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Incorrect PIN. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.</Message>
</Response>`);
        }

        // Strip PIN from message
        smsBody = smsBody.replace(new RegExp(`\\b${pinMatch[1]}\\b`), "").trim() || smsBody;
        console.log(`[SMS-PREMIUM] PIN verified for ${maskPhone(from)} -> user ${userId.slice(0, 8)}`);
      }
    }

    // Process as task — use the SMS body as subject (not "[SMS Premium]" which confuses the AI
    // into searching for "SMS Premium" as a topic)
    const { processTask } = await import("./services/processor.js");
    await processTask({
      userId,
      username: profile?.username || "user",
      from,
      subject: smsBody.substring(0, 200),
      body: "",
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

// ---- Telegram Webhook ----

app.post("/webhook/telegram", async (req, res) => {
  // Validate Telegram webhook secret header
  const { verifyTelegramWebhookSecret, sendTelegramMessage } = await import("./services/telegram.js");
  const headerSecret = req.headers["x-telegram-bot-api-secret-token"] as string || "";
  if (!verifyTelegramWebhookSecret(headerSecret)) {
    console.warn("[TELEGRAM] Invalid webhook secret");
    return res.status(401).json({ ok: false });
  }

  res.json({ ok: true }); // Respond immediately (Telegram requires fast response)

  try {
    const update = req.body;
    const message = update?.message;
    if (!message) return;

    const chatId = String(message.chat?.id || "");
    const text = message.text || "";
    const voice = message.voice;

    if (!chatId) return;

    const supabase = getSupabaseClient();

    // Handle /start {code} — link Telegram account to Aevoy user
    if (text.startsWith("/start ") || text.startsWith("/start@")) {
      const parts = text.split(" ");
      const code = parts[1]?.trim();
      if (code) {
        // Call Next.js link API to complete the linking
        const webUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.aevoy.com";
        const linkRes = await fetch(`${webUrl}/api/integrations/telegram/link`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-telegram-link-secret": process.env.TELEGRAM_WEBHOOK_SECRET || "",
          },
          body: JSON.stringify({ code, chatId }),
        });
        if (linkRes.ok) {
          await sendTelegramMessage(chatId, "✅ Connected! Your Aevoy AI is now available on Telegram. Send me any message to get started.");
        } else {
          await sendTelegramMessage(chatId, "❌ That link code is invalid or expired. Please get a new code from your Aevoy dashboard.");
        }
        return;
      }
    }

    // Resolve Aevoy user by telegram_chat_id
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, username, email, phone")
      .eq("telegram_chat_id", chatId)
      .single();

    if (!profile) {
      await sendTelegramMessage(chatId, "👋 I don't recognize this account. Please connect your Telegram from your Aevoy dashboard at aevoy.com");
      return;
    }

    // Determine message body (text or transcribed voice note)
    let body = text;

    if (voice && !text) {
      // Voice note received — transcription coming soon
      await sendTelegramMessage(chatId, "🎙️ Voice notes coming soon! Please send your message as text for now.");
      return;
    }

    if (!body.trim()) return;

    // Handle "call me" shortcut
    const CALL_ME = /^(call me|call my phone|ring me)\b/i;
    if (CALL_ME.test(body.trim())) {
      if (profile.phone) {
        const { callUser } = await import("./services/twilio.js");
        await callUser({ userId: profile.id, to: profile.phone, message: "Calling you now from your Aevoy AI assistant." });
        await sendTelegramMessage(chatId, "📞 Calling you now on " + profile.phone.replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3") + "...");
      } else {
        await sendTelegramMessage(chatId, "⚠️ No phone number registered. Add one in your Aevoy settings to enable calling.");
      }
      return;
    }

    // Process as normal task
    activeTasks++;
    const { processTask } = await import("./services/processor.js");
    processTask({
      userId: profile.id,
      username: profile.username,
      from: chatId,
      subject: "[Telegram]",
      body,
      inputChannel: "telegram",
    })
      .catch(console.error)
      .finally(() => { activeTasks--; });

  } catch (err) {
    console.error("[TELEGRAM] Webhook error:", err);
  }
});

// ---- WhatsApp Webhook (Twilio) ----

app.post("/webhook/whatsapp", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const rawFrom = req.body.From || ""; // "whatsapp:+1234567890"
  const message = (req.body.Body || "").trim();

  // Strip "whatsapp:" prefix to get E.164 phone number
  const fromPhone = rawFrom.replace(/^whatsapp:/i, "");

  console.log(`[WHATSAPP] Incoming from ${maskPhone(fromPhone)}: "${message.slice(0, 50)}"`);

  // Respond immediately with empty TwiML (Twilio requires fast ack)
  res.type("text/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);

  if (!fromPhone || !message) return;

  const { sendWhatsAppMessage } = await import("./services/whatsapp.js");

  try {
    const webUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.aevoy.com";

    // ── STEP 1: Handle account linking via "AEVOY {code}" message ──
    // Users generate a code from aevoy.com/dashboard/apps, then send it here
    if (/^AEVOY\s+[0-9a-f]{24}$/i.test(message)) {
      const code = message.split(/\s+/)[1]?.trim();
      if (code) {
        const linkRes = await fetch(`${webUrl}/api/integrations/whatsapp/link`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-whatsapp-link-secret": process.env.TELEGRAM_WEBHOOK_SECRET || "",
          },
          body: JSON.stringify({ code, phone: fromPhone }),
        });

        if (linkRes.ok) {
          await sendWhatsAppMessage(fromPhone,
            "✅ Your WhatsApp is now linked to your Aevoy account!\n\nSend me any message to get started. Try: \"What can you do?\" or \"call me\"");
        } else {
          const err = await linkRes.json().catch(() => ({})) as { error?: string };
          const reason = err?.error === "Code expired"
            ? "That link code has expired. Please generate a new one from your dashboard."
            : "That link code is invalid or already used. Get a fresh code at aevoy.com/dashboard/apps";
          await sendWhatsAppMessage(fromPhone, `❌ ${reason}`);
        }
        return;
      }
    }

    // ── STEP 2: Resolve user — only by whatsapp_phone (explicit link) ──
    // We do NOT auto-link by profile.phone — that's insecure (shared phones, SIM swaps)
    const supabase = getSupabaseClient();
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, username, email, phone")
      .eq("whatsapp_phone", fromPhone)
      .maybeSingle();

    if (!profile) {
      await sendWhatsAppMessage(fromPhone,
        "👋 Hi! To use Aevoy AI on WhatsApp:\n\n1. Sign up at aevoy.com\n2. Go to Connected Apps\n3. Scan the WhatsApp QR code\n\nTakes 30 seconds!");
      return;
    }

    // ── STEP 3: Handle built-in shortcuts ──
    const CALL_ME = /^(call me|call my phone|ring me)\b/i;
    if (CALL_ME.test(message)) {
      const callTo = profile.phone || fromPhone;
      if (callTo) {
        const { callUser } = await import("./services/twilio.js");
        await callUser({ userId: profile.id, to: callTo, message: "Calling you now from your Aevoy AI." });
        await sendWhatsAppMessage(fromPhone, "📞 Calling you now...");
      } else {
        await sendWhatsAppMessage(fromPhone, "⚠️ No phone number on file. Add one in Settings to enable calling.");
      }
      return;
    }

    // ── STEP 4: Process as AI task ──
    activeTasks++;
    const { processTask } = await import("./services/processor.js");
    processTask({
      userId: profile.id,
      username: profile.username,
      from: fromPhone,
      subject: "[WhatsApp]",
      body: message,
      inputChannel: "whatsapp",
    })
      .catch(console.error)
      .finally(() => { activeTasks--; });

  } catch (err) {
    console.error("[WHATSAPP] Webhook error:", err);
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

    res.type("text/xml");

    if (USE_CONVERSATION_RELAY) {
      const wsUrl = `${(process.env.AGENT_URL || "http://localhost:3001").replace("http", "ws")}/ws/voice`;
      // Read user's ElevenLabs voice preference
      let elevenlabsVoice = process.env.ELEVENLABS_DEFAULT_VOICE_ID || "EXAVITQu4vr4xnSDxMaL";
      try {
        const supabase = getSupabaseClient();
        const { data: vs } = await supabase.from("user_settings").select("voice_preference").eq("user_id", userId).single();
        if (vs?.voice_preference && !vs.voice_preference.includes('.')) elevenlabsVoice = vs.voice_preference;
      } catch {}
      const checkinCallType = callType === "evening" ? "checkin_evening" : "checkin_morning";

      let greeting: string;
      try {
        const { generatePersonalizedGreeting } = await import("./services/voice-prompts.js");
        greeting = await generatePersonalizedGreeting({
          userId, userName, botName,
          callType: checkinCallType as any,
          greetingStyle: "casual",
          timezone: "America/Los_Angeles",
        });
      } catch {
        greeting = callType === "morning"
          ? `Good morning ${userName}! How's your day looking?`
          : `Hey ${userName}! How did today go?`;
      }

      console.log(`[VOICE-CHECKIN] ConversationRelay for ${userId.slice(0, 8)}: voice=${elevenlabsVoice}`);
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay url="${wsUrl}" ttsProvider="ElevenLabs" voice="${elevenlabsVoice}" transcriptionProvider="Deepgram" dtmfDetection="true" interruptible="true" welcomeGreeting="${escapeXml(greeting)}">
      <Parameter name="userId" value="${userId}" />
      <Parameter name="callType" value="${checkinCallType}" />
    </ConversationRelay>
  </Connect>
  <Say voice="Polly.Joanna-Neural">${escapeXml(greeting)}</Say>
  <Gather input="speech" timeout="10" speechTimeout="auto" speechModel="phone_call" enhanced="true"
    action="${process.env.AGENT_URL}/webhook/voice/process/${userId}" method="POST" />
  <Say voice="Polly.Joanna-Neural">I didn't catch that. Please try calling back.</Say>
</Response>`);
    }

    // Legacy fallback
    const { generateCheckinGreeting } = await import("./services/checkin.js");
    const greeting = await generateCheckinGreeting(userName, botName, callType as "morning" | "evening");

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
      return res.status(502).json({ error: "Failed to initiate call" });
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

process.on("unhandledRejection", (reason, promise) => {
  console.error("[FATAL] Unhandled rejection:", reason);
  if (reason instanceof Error && reason.stack) {
    console.error("[FATAL] Stack:", reason.stack);
  }
});

process.on("SIGTERM", async () => {
  console.log("[SHUTDOWN] SIGTERM received — cleaning up in-flight tasks before exit...");
  try {
    await getSupabaseClient()
      .from('tasks')
      .update({
        status: 'needs_review',
        completed_at: new Date().toISOString(),
        response_text: 'The service was restarted while processing this task. Please try again and I\'ll pick up right where we left off!',
      })
      .eq('status', 'processing');
    console.log(`[SHUTDOWN] Marked in-flight tasks as needs_review`);
  } catch (e) {
    console.error("[SHUTDOWN] Failed to clean up tasks:", e);
  }
  setTimeout(() => process.exit(0), 1500);
});

process.on("SIGINT", () => {
  console.log("[SHUTDOWN] SIGINT received, shutting down...");
  process.exit(0);
});

// ---- Start Server ----

const server = createServer(app);

// WebSocket server for ConversationRelay voice calls
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url!, `http://${request.headers.host}`);
  if (url.pathname === "/ws/voice") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on("connection", (ws, request) => {
  handleVoiceWebSocket(ws, request);
});

server.listen(PORT, async () => {
  console.log(`Agent server v2.0 running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`WebSocket: ws://localhost:${PORT}/ws/voice`);
  console.log(`ConversationRelay: ${USE_CONVERSATION_RELAY ? "ENABLED" : "DISABLED (legacy TwiML)"}`);
  console.log(`[DEPLOY-VERIFY] Voice pipeline v18 — ElevenLabs Sarah, bare voice IDs, TwiML fallback`);

  // START HEALTH SYSTEM (The Final Boss - Never Fails)
  try {
    const { healthSystem } = await import("./services/health-system.js");
    // Run startup validation FIRST — logs all issues loudly
    await healthSystem.runStartupValidation();
    healthSystem.startMonitoring();
    console.log(`[HEALTH] ✅ Never-fail health system started (30s monitoring)`);
  } catch (e) {
    console.error(`[HEALTH] Failed to start health system:`, e);
  }

  // START TASK WATCHDOG (Gracefully resolve stuck tasks — users NEVER see "failed")
  // Runs immediately on startup (catches Railway-restart orphans) then every 5 min.
  const runTaskWatchdog = async () => {
    try {
      // Use updated_at (not started_at) so Railway-restart-killed tasks are caught quickly.
      // 50 min: processor master timeout is 40min, vision agent heartbeats every 10 steps.
      // Tasks that are genuinely running keep updating updated_at via heartbeats.
      // Only truly dead tasks (Railway restart, OOM) go 50+ min without an update.
      const twentyFiveMinutesAgo = new Date(Date.now() - 50 * 60 * 1000).toISOString();
      const { data: stuckTasks } = await getSupabaseClient()
        .from('tasks')
        .select('id, email_subject, input_channel, user_id')
        .eq('status', 'processing')
        .lt('updated_at', twentyFiveMinutesAgo);

      if (stuckTasks && stuckTasks.length > 0) {
        console.log(`[WATCHDOG] Found ${stuckTasks.length} stuck task(s) (no update >50 min) — resolving gracefully...`);

        // Gracefully complete each stuck task with a helpful message.
        // NEVER mark as "failed" — users should always see a usable response.
        for (const task of stuckTasks) {
          const channel = task.input_channel || 'web';
          const gracefulResponse =
            `I ran into a technical hiccup and wasn't able to complete this task — the process was interrupted (likely a server restart). ` +
            `Please try again and I'll pick up right where we left off!`;

          const { error: updateErr } = await getSupabaseClient()
            .from('tasks')
            .update({
              status: 'completed',
              response_text: gracefulResponse,
              completed_at: new Date().toISOString(),
            })
            .eq('id', task.id)
            .eq('status', 'processing'); // double-check it's still stuck

          if (!updateErr) {
            console.log(`[WATCHDOG] Gracefully resolved task ${task.id} (channel: ${channel})`);

            // For email-channel tasks: notify the user so they're not left waiting
            if (channel === 'email' && task.user_id) {
              try {
                const { data: profile } = await getSupabaseClient()
                  .from('profiles')
                  .select('email, username')
                  .eq('id', task.user_id)
                  .single();
                if (profile?.email) {
                  const { sendResponse } = await import('./services/email.js');
                  const agentFrom = `${profile.username || 'Aevoy'}@aevoy.com`;
                  await sendResponse({
                    to: profile.email,
                    from: agentFrom,
                    subject: task.email_subject || 'Your task',
                    body: gracefulResponse,
                  });
                  console.log(`[WATCHDOG] Sent recovery email to ${profile.email}`);
                }
              } catch (emailErr) {
                console.warn('[WATCHDOG] Could not send recovery email:', emailErr);
              }
            }
          }
        }

        console.log(`[WATCHDOG] Resolved ${stuckTasks.length} stuck task(s)`);
      }
    } catch (e) {
      console.error('[WATCHDOG] Error in task watchdog:', e);
    }
  };

  // Run immediately on startup to catch tasks from previous server instance
  runTaskWatchdog();
  setInterval(runTaskWatchdog, 5 * 60 * 1000); // Then every 5 minutes
  console.log('[WATCHDOG] ✅ Task watchdog started (immediate + 5min interval, 50min updated_at threshold, graceful recovery + email notify)');

  // WEBHOOK SELF-HEALER — auto-repair phone numbers pointing to wrong URL
  const validateAndRepairWebhooks = async () => {
    try {
      const agentUrl = process.env.AGENT_URL;
      const twilioSid = process.env.TWILIO_ACCOUNT_SID;
      const twilioToken = process.env.TWILIO_AUTH_TOKEN;
      if (!agentUrl || !twilioSid || !twilioToken) return;

      // Get all user phone numbers from DB
      const { data: userNumbers } = await getSupabaseClient()
        .from('user_twilio_numbers')
        .select('user_id, phone_number, twilio_sid')
        .eq('is_active', true);

      if (!userNumbers || userNumbers.length === 0) return;

      // Check each number's webhook via Twilio API
      const auth = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');

      for (const num of userNumbers) {
        if (!num.twilio_sid) continue;
        try {
          const res = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/IncomingPhoneNumbers/${num.twilio_sid}.json`,
            { headers: { Authorization: `Basic ${auth}` } }
          );
          if (!res.ok) continue;

          const data = await res.json();
          const expectedVoice = `${agentUrl}/webhook/voice/premium/${num.user_id}`;
          const expectedSms = `${agentUrl}/webhook/sms/premium/${num.user_id}`;

          // If webhook is wrong (localhost, dead IP, different host), repair it
          if (data.voice_url !== expectedVoice || data.sms_url !== expectedSms) {
            console.log(`[WEBHOOK-HEALER] Repairing ${num.phone_number}: ${data.voice_url} → ${expectedVoice}`);

            await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/IncomingPhoneNumbers/${num.twilio_sid}.json`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Basic ${auth}`,
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                  VoiceUrl: expectedVoice,
                  VoiceMethod: 'POST',
                  SmsUrl: expectedSms,
                  SmsMethod: 'POST',
                }).toString(),
              }
            );
            console.log(`[WEBHOOK-HEALER] ✅ Fixed ${num.phone_number}`);
          }
        } catch (err) {
          console.error(`[WEBHOOK-HEALER] Error checking ${num.phone_number}:`, err);
        }
      }
    } catch (e) {
      console.error('[WEBHOOK-HEALER] Error:', e);
    }
  };

  // Run on startup + every 30 minutes
  validateAndRepairWebhooks();
  setInterval(validateAndRepairWebhooks, 30 * 60 * 1000);
  console.log('[WEBHOOK-HEALER] ✅ Webhook self-healer started (30min interval)');

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

