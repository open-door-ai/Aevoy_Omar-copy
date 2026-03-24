import dotenv from "dotenv";
import path from "path";
import fs from "fs";
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
import { processIncomingTask, handleConfirmationReply, handleVerificationCodeReply } from "./services/task-router.js";
import { processTaskV3 } from "./v3/processor-v3.js";
import { extractContext } from "./services/context-engine.js";
import { startScheduler } from "./services/scheduler.js";
import { startInboxPoller } from "./services/inbox-poller.js";
import { startInboxManager } from "./services/inbox-manager.js";
import { startReconciliationScheduler } from "./services/billing-reconciliation.js";
import { handleIncomingSms, handleIncomingVoice, processVoiceCommand, getTwilioConfig, twilioRequest, getUserVoice, DEFAULT_VOICE, escapeXml } from "./services/twilio.js";
import { trackServiceCost } from "./services/ai.js";
import { resolveUser } from "./services/identity/resolver.js";
import { getSupabaseClient } from "./utils/supabase.js";
import type { TaskRequest, TaskResult } from "./types/index.js";
import skillRoutes from "./routes/skills.js";
import { trackBackgroundJob } from "./utils/job-tracker.js";
import { maskPhone, maskEmail, maskUserId, maskPin } from "./utils/logging.js";
import { hashPin, verifyPinHash, isBcryptHash } from "./utils/hashing.js";
import { globalLimiter, taskLimiter, twilioLimiter } from "./middleware/rate-limit.js";
import { registerActiveTask, unregisterActiveTask, getActiveTaskInfo, injectTaskUpdate, classifyUpdateRelevance, clearAllActiveTasks } from "./utils/task-updates.js";
import { sanitizeTaskInput } from "./security/validator.js";

import crypto from "crypto";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { handleVoiceWebSocket, getActiveSessionCount } from "./services/voice-conversation.js";
import { logger } from "./utils/logger.js";
import { setupListenWebSocket } from "./routes/aurora-listen.js";

// ---- Global Error Handlers are at the END of the file ----
// (single registration point to avoid duplicate handlers)

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
        logger.info(`[SECURITY] User ${userId.slice(0, 8)} exceeded daily call limit (${result.calls_today}/${result.daily_limit})`);
      }
      return result.allowed;
    }
    return true; // Allow on RPC failure
  } catch (err) {
    logger.error('[CALL-LIMIT] RPC error:', err);
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
      logger.warn(`[SECURITY] CORS rejected: ${origin}`);
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
// File serving with signed URL verification — prevents UUID enumeration attacks
app.get('/files/:type/:filename', (req, res) => {
  const { type, filename } = req.params;
  const sig = req.query.sig as string;

  // Validate signature — proves the server generated this URL
  const secret = process.env.ENCRYPTION_KEY || WEBHOOK_SECRET || '';
  const expectedSig = crypto.createHmac('sha256', secret).update(`${type}/${filename}`).digest('hex').substring(0, 16);
  if (!sig || sig !== expectedSig) {
    return res.status(403).json({ error: 'Invalid or expired download link' });
  }

  // Prevent path traversal
  const safeName = path.basename(filename);
  const safeType = ['pdf', 'excel', 'word', 'powerpoint', 'images'].includes(type) ? type : '';
  if (!safeType || safeName !== filename || /\.\./.test(filename)) {
    return res.status(400).json({ error: 'Invalid file path' });
  }

  const filePath = path.join('/tmp', 'aevoy-files', safeType, safeName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'");

  // MIME types
  if (safeName.endsWith('.docx')) res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  else if (safeName.endsWith('.xlsx')) res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  else if (safeName.endsWith('.pptx')) res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  else if (safeName.endsWith('.pdf')) res.setHeader('Content-Type', 'application/pdf');
  else if (safeName.endsWith('.png')) res.setHeader('Content-Type', 'image/png');
  else if (safeName.endsWith('.jpg') || safeName.endsWith('.jpeg')) res.setHeader('Content-Type', 'image/jpeg');

  const isImage = /\.(png|jpe?g)$/.test(safeName);
  res.setHeader('Content-Disposition', `${isImage ? 'inline' : 'attachment'}; filename="${safeName}"`);
  res.sendFile(filePath);
});

// Timing-safe webhook secret comparison
function verifyWebhookSecret(provided: string | null | undefined): boolean {
  if (!provided || !WEBHOOK_SECRET) return false;
  // Pad both to same length to prevent length-based timing attacks
  const maxLen = Math.max(provided.length, WEBHOOK_SECRET.length);
  const paddedProvided = provided.padEnd(maxLen, '\0');
  const paddedSecret = WEBHOOK_SECRET.padEnd(maxLen, '\0');
  try {
    return crypto.timingSafeEqual(Buffer.from(paddedProvided), Buffer.from(paddedSecret));
  } catch {
    return false;
  }
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
      res.status(500).json({ error: "Service validation unavailable" });
      return;
    }
  }

  next();
}

// ---- Task concurrency control ----

import { getActiveBrowserTasks, canAcceptBrowserTask } from "./utils/concurrency.js";

let activeTasks = 0;
const MAX_CONCURRENT_TASKS = 10;
const MAX_CONCURRENT_BROWSER_TASKS = 6; // Temporarily raised for parallel AGI testing (was 3)
const taskQueue: Array<{ task: TaskRequest; resolve: (v: TaskResult) => void; reject: (e: Error) => void }> = [];

// ---- Webhook idempotency: prevent duplicate task creation from repeated webhooks ----
// Stores hash(userId + subject + 30s-bucket) → taskId for 60 seconds
const recentTaskFingerprints = new Map<string, { taskId: string; timestamp: number }>();
const DEDUP_WINDOW_MS = 30_000; // 30 seconds

function getTaskFingerprint(userId: string, subject: string): string {
  // Round timestamp to nearest 30-second bucket for fuzzy dedup
  const bucket = Math.floor(Date.now() / DEDUP_WINDOW_MS);
  const raw = `${userId}:${subject.trim().toLowerCase()}:${bucket}`;
  return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 16);
}

function checkAndRecordFingerprint(userId: string, subject: string, taskId?: string): string | null {
  const fp = getTaskFingerprint(userId, subject);
  const existing = recentTaskFingerprints.get(fp);
  if (existing && Date.now() - existing.timestamp < DEDUP_WINDOW_MS * 2) {
    return existing.taskId; // Duplicate — return existing task ID
  }
  // Also check the previous bucket (covers boundary cases)
  const prevBucket = Math.floor(Date.now() / DEDUP_WINDOW_MS) - 1;
  const prevRaw = `${userId}:${subject.trim().toLowerCase()}:${prevBucket}`;
  const prevFp = crypto.createHash('sha256').update(prevRaw).digest('hex').substring(0, 16);
  const prevExisting = recentTaskFingerprints.get(prevFp);
  if (prevExisting && Date.now() - prevExisting.timestamp < DEDUP_WINDOW_MS * 2) {
    return prevExisting.taskId;
  }
  // Record this fingerprint
  recentTaskFingerprints.set(fp, { taskId: taskId || 'pending', timestamp: Date.now() });
  return null;
}

// Cleanup stale fingerprints every 2 minutes
setInterval(() => {
  const cutoff = Date.now() - DEDUP_WINDOW_MS * 4;
  for (const [key, val] of recentTaskFingerprints) {
    if (val.timestamp < cutoff) recentTaskFingerprints.delete(key);
  }
}, 120_000);

// ---- Scheduler health tracking: when each background job last ran successfully ----
export const lastSchedulerRuns: Record<string, number> = {
  scheduler: 0,
  proactive: 0,
  inbox_manager: 0,
  reconciliation: 0,
  watchdog: 0,
  webhook_healer: 0,
};

export function recordSchedulerRun(name: string): void {
  lastSchedulerRuns[name] = Date.now();
}

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
      processTaskV3(queued.task)
        .then(queued.resolve)
        .catch(queued.reject)
        .finally(() => {
          activeTasks--;
          processQueuedTasks(); // try next in queue
        });
    }
  }
}

// Counter self-healing: reconcile activeTasks AND browserTasks with DB every 2 minutes
setInterval(async () => {
  try {
    const { count } = await getSupabaseClient()
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'processing');
    const dbProcessing = count || 0;
    const browserCount = getActiveBrowserTasks();

    if (activeTasks < 0) {
      logger.info(`[COUNTER-HEAL] Fixing negative activeTasks: ${activeTasks} → 0`);
      activeTasks = 0;
    } else if (activeTasks > 0 && dbProcessing === 0) {
      logger.info(`[COUNTER-HEAL] Resetting activeTasks from ${activeTasks} to 0 (DB shows 0 processing)`);
      activeTasks = 0;
    } else if (activeTasks > dbProcessing + 2) {
      logger.info(`[COUNTER-HEAL] Adjusting activeTasks from ${activeTasks} to ${dbProcessing} (DB has ${dbProcessing} processing)`);
      activeTasks = dbProcessing;
    }

    // Browser counter healing: if no tasks processing but browser counter > 0, reset it
    if (dbProcessing === 0 && browserCount > 0) {
      logger.info(`[COUNTER-HEAL] Resetting browser counter from ${browserCount} to 0`);
      // Reset by decrementing to 0
      const { decrementBrowserTasks: decBrowser } = await import("./utils/concurrency.js");
      for (let i = 0; i < browserCount; i++) decBrowser();
    }

    // Also process queued tasks if any
    if (taskQueue.length > 0) processQueuedTasks();
  } catch (err) {
    // Silent — don't crash on healing
  }
}, 2 * 60 * 1000);

// ---- Health Check (Enhanced) ----

// GET /task/:taskId/status — Live vision agent step visibility
app.get("/task/:taskId/status", async (req, res) => {
  const secret = req.headers["x-webhook-secret"];
  if (!verifyWebhookSecret(secret as string)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const { data } = await getSupabaseClient()
      .from("tasks")
      .select("id, status, input_text, email_subject, iteration_count, action_count, action_success_count, cost_usd, execution_time_ms, progress_message, verification_data, verification_status, response_text, created_at, completed_at, error_message, stuck_reason")
      .eq("id", req.params.taskId)
      .single();
    if (!data) return res.status(404).json({ error: "not_found" });
    const elapsed = data.completed_at
      ? new Date(data.completed_at).getTime() - new Date(data.created_at).getTime()
      : Date.now() - new Date(data.created_at).getTime();
    const vd = data.verification_data as any;
    res.json({
      id: data.id,
      status: data.status,
      task: data.email_subject || data.input_text,
      elapsedMs: elapsed,
      elapsedFormatted: `${Math.floor(elapsed / 60000)}m ${Math.floor((elapsed % 60000) / 1000)}s`,
      iterations: data.iteration_count,
      cost: data.cost_usd,
      progress: data.progress_message,
      actions: data.action_count,
      actionsSuccess: data.action_success_count,
      verificationStatus: (data as any).verification_status,
      response: (data as any).response_text?.substring(0, 2000),
      error: data.error_message || data.stuck_reason,
      visionAgent: vd?.visionAgent ? {
        currentStep: vd.currentStep,
        maxSteps: vd.maxSteps,
        currentUrl: vd.currentUrl,
        totalCost: vd.totalCost,
        stuckCount: vd.stuckCount,
        recentSteps: vd.recentSteps || [],
      } : null,
    });
  } catch (err) {
    logger.error("[TASK-STATUS] Error:", err);
    res.status(500).json({ error: "internal", message: "Internal error" });
  }
});

// GET /tasks/active — List all currently processing tasks with step visibility
app.get("/tasks/active", async (req, res) => {
  const secret = req.headers["x-webhook-secret"];
  if (!verifyWebhookSecret(secret as string)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const { data } = await getSupabaseClient()
      .from("tasks")
      .select("id, status, email_subject, progress_message, verification_data, created_at, cost_usd")
      .eq("status", "processing")
      .order("created_at", { ascending: false })
      .limit(20);
    const tasks = (data || []).map((t: any) => {
      const vd = t.verification_data as any;
      return {
        id: t.id,
        task: (t.email_subject || '').substring(0, 60),
        elapsed: `${Math.floor((Date.now() - new Date(t.created_at).getTime()) / 60000)}m`,
        cost: t.cost_usd,
        progress: t.progress_message,
        visionStep: vd?.currentStep || null,
        visionMaxSteps: vd?.maxSteps || null,
        currentUrl: vd?.currentUrl?.substring(0, 80) || null,
        stuck: (vd?.stuckCount || 0) >= 3,
      };
    });
    res.json({ active: tasks, count: tasks.length });
  } catch (err) {
    logger.error("[TASKS-ACTIVE] Error:", err);
    res.status(500).json({ error: "internal", message: "Internal error" });
  }
});

// Minimal public health check for load balancers
app.get("/health", async (_req, res) => {
  res.status(200).json({ status: "ok", uptime: process.uptime() });
});

// ---- Error Rate Tracker (imported from standalone utility) ----
import { trackError, getErrorCounts } from "./utils/error-tracker.js";
export { trackError };

// Public status endpoint — lightweight, no DB queries, just in-memory state
app.get("/aurora/status", async (_req, res) => {
  const status = {
    operational: true,
    services: {
      ai: { status: 'operational', detail: '' },
      sms: { status: 'operational', detail: '' },
      voice: { status: 'operational', detail: '' },
      email: { status: 'operational', detail: '' },
    } as Record<string, { status: string; detail: string }>,
    degraded: [] as string[],
    lastChecked: new Date().toISOString(),
  };

  // Check AI model backoff status
  try {
    const { getBackoffStatus } = await import("./v3/model-router.js");
    const backoff = getBackoffStatus();
    const backedOffModels = Object.entries(backoff).filter(([_, v]) => v.backedOff);

    if (backedOffModels.length > 0) {
      const allBacked = backedOffModels.length >= 3;
      status.services.ai = {
        status: allBacked ? 'down' : 'degraded',
        detail: allBacked
          ? 'AI models temporarily unavailable. Retrying...'
          : 'Some AI models rate-limited. Using fallbacks.',
      };
      if (allBacked) {
        status.operational = false;
      }
      status.degraded.push('ai');
    }
  } catch {
    // Model router not available — don't mark as down
  }

  // Check in-memory error rates for each service
  const counts = getErrorCounts();

  for (const svc of ['sms', 'voice', 'email'] as const) {
    if (counts[svc] > 3) {
      status.services[svc] = {
        status: 'degraded',
        detail: `${counts[svc]} errors in the last minute.`,
      };
      status.degraded.push(svc);
    }
  }

  if (status.degraded.length > 0 && status.operational) {
    // Degraded but not fully down
    status.operational = true;
  }

  res.json(status);
});

// Debug: trigger proactive checks on demand (requires webhook secret)
app.post("/debug/proactive", async (req, res) => {
  const secret = req.headers["x-webhook-secret"];
  if (!verifyWebhookSecret(secret as string)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  try {
    const { getProactiveEngine } = await import("./services/proactive.js");
    const engine = getProactiveEngine();
    const count = await engine.runForAllUsers();

    const { getProactiveEngagementEngine } = await import("./services/proactive-engagement.js");
    const engagement = getProactiveEngagementEngine();
    const digests = await engagement.sendDailyDigests();
    const reports = await engagement.sendWeeklyReports();

    res.json({ findings: count, digests, reports });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Detailed health check — requires webhook secret
app.get("/health/detailed", async (req, res) => {
  const secret = req.headers["x-webhook-secret"];
  if (!verifyWebhookSecret(secret as string)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  let supabaseStatus = "ok";
  try {
    const sb = getSupabaseClient();
    const { error } = await sb.from("profiles").select("id").limit(1);
    supabaseStatus = error ? "error" : "ok";
  } catch {
    supabaseStatus = "unavailable";
  }

  const allOk = supabaseStatus === "ok";

  // Scheduler health: check if each background job ran within 2x its expected interval
  const now = Date.now();
  const schedulerIntervals: Record<string, number> = {
    scheduler: 60_000,        // runs every ~1 min
    inbox_manager: 300_000,   // runs every 5 min
    reconciliation: 86_400_000, // runs daily
    watchdog: 300_000,        // runs every 5 min
    webhook_healer: 1_800_000, // runs every 30 min
  };
  const schedulerHealth: Record<string, string> = {};
  for (const [name, interval] of Object.entries(schedulerIntervals)) {
    const lastRun = lastSchedulerRuns[name] || 0;
    if (lastRun === 0) {
      schedulerHealth[name] = "never_ran";
    } else if (now - lastRun > interval * 2) {
      schedulerHealth[name] = `stale (last: ${Math.round((now - lastRun) / 1000)}s ago)`;
    } else {
      schedulerHealth[name] = "ok";
    }
  }

  res.status(allOk ? 200 : 503).json({
    status: allOk ? "healthy" : "degraded",
    version: "2.0.0-agi-v25",
    gitSha: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || "local",
    timestamp: new Date().toISOString(),
    activeTasks: Math.max(0, activeTasks),
    activeBrowserTasks: getActiveBrowserTasks(),
    activeVoiceSessions: getActiveSessionCount(),
    queuedTasks: taskQueue.length,
    maxConcurrent: MAX_CONCURRENT_TASKS,
    maxBrowserConcurrent: MAX_CONCURRENT_BROWSER_TASKS,
    conversationRelay: USE_CONVERSATION_RELAY,
    database: supabaseStatus,
    schedulers: schedulerHealth,
    capsolver: !!process.env.CAPSOLVER_API_KEY,
    groqApi: !!process.env.GROQ_API_KEY,
    deepseekApi: !!process.env.DEEPSEEK_API_KEY,
    googleApi: !!process.env.GOOGLE_API_KEY,
    anthropicApi: !!process.env.ANTHROPIC_API_KEY,
    openRouterApi: !!process.env.OPENROUTER_API_KEY,
    cerebrasApi: !!process.env.CEREBRAS_API_KEY,
    sambaNovaApi: !!process.env.SAMBANOVA_API_KEY,
    agentUrl: process.env.AGENT_URL ? "set" : "NOT SET",
    remoteBrowser: process.env.REMOTE_BROWSER_CDP || "not configured",
    brightData: process.env.BRIGHT_DATA_BROWSER_WS ? "configured" : "not configured",
    brightDataProxy: process.env.BRIGHT_DATA_PROXY_URL ? "configured" : "not configured",
    geonodeProxy: process.env.PROXY_URL ? "configured" : "not configured",
    display: process.env.DISPLAY || "not set",
    dedupMapSize: recentTaskFingerprints.size,
  });
});

// ---- Comprehensive Admin Health Check (T009) ----
app.get("/admin/health", async (req, res) => {
  // Require Bearer token auth using webhook secret
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.AGENT_WEBHOOK_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const services: Record<string, unknown> = {
    supabase: "unknown",
    twilio: "unknown",
    ai_models: "unknown",
    ai_backoff: {} as Record<string, unknown>,
  };

  // Check Supabase connectivity with a lightweight query (SELECT 1)
  let supabaseLatencyMs = 0;
  try {
    const sbStart = Date.now();
    const { error } = await getSupabaseClient().rpc('ping').maybeSingle();
    supabaseLatencyMs = Date.now() - sbStart;
    if (error) {
      // Fallback: try a simple table query if RPC 'ping' doesn't exist
      const sbStart2 = Date.now();
      const { error: err2 } = await getSupabaseClient().from("profiles").select("id").limit(1);
      supabaseLatencyMs = Date.now() - sbStart2;
      services.supabase = err2 ? `error: ${err2.message}` : "connected";
    } else {
      services.supabase = "connected";
    }
  } catch (e) {
    services.supabase = "unreachable";
  }

  // Check Twilio config
  services.twilio = process.env.TWILIO_ACCOUNT_SID ? "configured" : "not_configured";

  // Check AI model availability + backoff status
  const aiProviders = ["GROQ_API_KEY", "DEEPSEEK_API_KEY", "GOOGLE_API_KEY", "ANTHROPIC_API_KEY"];
  const configuredProviders = aiProviders.filter(k => !!process.env[k]).length;
  services.ai_models = configuredProviders > 0
    ? `${configuredProviders} provider(s) configured`
    : "none_configured";

  // Model-level backoff and performance stats
  try {
    const { getBackoffStatus, getSessionModelStats } = await import("./v3/model-router.js");
    services.ai_backoff = getBackoffStatus();
    services.ai_performance = getSessionModelStats();
  } catch {
    services.ai_backoff = "unavailable";
  }

  // Scheduler status: check last heartbeat timestamps
  const schedulerStatus: Record<string, unknown> = {};
  const now = Date.now();
  for (const [name, ts] of Object.entries(lastSchedulerRuns)) {
    const lastRun = ts as number;
    schedulerStatus[name] = {
      last_run: lastRun > 0 ? new Date(lastRun).toISOString() : "never",
      age_seconds: lastRun > 0 ? Math.round((now - lastRun) / 1000) : null,
      healthy: lastRun > 0 && (now - lastRun) < 5 * 60 * 1000, // stale if >5min
    };
  }

  // Proactive engine status
  const proactiveEnabled = process.env.PROACTIVE_ENGINE !== 'false';
  const proactiveStatus: Record<string, unknown> = {
    enabled: proactiveEnabled,
    last_run: lastSchedulerRuns['proactive']
      ? new Date(lastSchedulerRuns['proactive'] as number).toISOString()
      : "never",
  };

  // Check for any backed-off providers (degraded service)
  const backedOffProviders = Object.entries(services.ai_backoff as Record<string, { backedOff: boolean }> || {})
    .filter(([_, v]) => v?.backedOff)
    .map(([k]) => k);

  // Determine overall status
  let overallStatus = "ok";
  if (services.supabase !== "connected") overallStatus = "degraded";
  if (configuredProviders === 0) overallStatus = "degraded";
  if (backedOffProviders.length >= configuredProviders && configuredProviders > 0) overallStatus = "degraded";

  const health: Record<string, unknown> = {
    status: overallStatus,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: "aurora-v0",
    services,
    supabase_latency_ms: supabaseLatencyMs,
    scheduler: schedulerStatus,
    proactive_engine: proactiveStatus,
    active_tasks: activeTasks,
    sms_idempotency_cache_size: processedSmsSids.size,
    memory: process.memoryUsage(),
    processor_version: process.env.PROCESSOR_VERSION || "v3",
  };

  logger.info({ endpoint: "/admin/health" }, "Admin health check requested");
  res.json(health);
});

// ---- Takeover token validation (called by WebSocket handler) ----
app.post("/takeover/validate-token", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ valid: false, error: 'Token required' });
    }
    const { data } = await getSupabaseClient()
      .from('takeover_tokens')
      .select('task_id, user_id, expires_at, used')
      .eq('token', token)
      .single();
    if (!data || data.used || new Date(data.expires_at) < new Date()) {
      return res.status(401).json({ valid: false, error: 'Invalid or expired token' });
    }
    // Browser engine registry removed (Aurora doesn't use browser automation)
    return res.json({ valid: true, taskId: data.task_id, userId: data.user_id, hasEngine: false });
  } catch (err) {
    logger.error('[TAKEOVER] Token validation error:', err);
    return res.status(500).json({ valid: false, error: 'Internal error' });
  }
});

// ---- Engine registry status (for dashboard) — requires webhook secret ----
app.get("/engines", async (req, res) => {
  const secret = req.headers["x-webhook-secret"];
  if (!verifyWebhookSecret(secret as string)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  // Browser engine registry removed (Aurora doesn't use browser automation)
  return res.json({ activeEngines: 0 });
});

// ---- Clear stale active task entries (admin) ----
app.post("/admin/clear-active-tasks", async (req, res) => {
  const secret = req.headers["x-webhook-secret"];
  if (!verifyWebhookSecret(secret as string)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const cleared = clearAllActiveTasks();
  logger.info(`[ADMIN] Cleared ${cleared} active task entries`);
  return res.json({ cleared, activeTasks });
});

// ---- Memory subsystem health check ----
app.get("/health/memory", async (req, res) => {
  const secret = req.headers["x-webhook-secret"];
  if (!verifyWebhookSecret(secret as string)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const checks: Record<string, string> = {};

  // Supabase user_memory table
  try {
    const { error } = await getSupabaseClient().from("user_memory").select("id").limit(1);
    checks.supabase_memory = error ? "error" : "ok";
  } catch { checks.supabase_memory = "unavailable"; }

  // Check if pgvector extension works
  try {
    const { error } = await getSupabaseClient().rpc("match_user_memories", {
      query_embedding: Array(384).fill(0.0),
      match_user_id: "00000000-0000-4000-8000-000000000000",
      match_threshold: 0.99,
      match_count: 1,
    });
    checks.pgvector = error?.message?.includes("does not exist") ? "not_installed" : "ok";
  } catch { checks.pgvector = "error"; }

  // Check embedding service
  checks.cf_embedding = process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN
    ? "configured"
    : "not_configured (keyword fallback active)";
  checks.semantic_search = process.env.USE_SEMANTIC_SEARCH === "true" ? "enabled" : "disabled (flag off)";

  // Check long-term facts RPC
  try {
    const { error } = await getSupabaseClient().rpc("get_long_term_facts", {
      p_user_id: "00000000-0000-4000-8000-000000000000",
      p_limit: 1,
    });
    checks.long_term_facts_rpc = error ? `error: ${error.message}` : "ok";
  } catch { checks.long_term_facts_rpc = "unavailable"; }

  const allOk = Object.values(checks).every(v => v === "ok" || v.startsWith("not_configured") || v.startsWith("disabled") || v === "configured");
  res.status(allOk ? 200 : 503).json({
    status: allOk ? "healthy" : "degraded",
    ...checks,
    timestamp: new Date().toISOString(),
  });
});

// ---- Live API Key Validation — actually calls each API ----
app.get("/debug/test-apis", async (_req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  const secret = _req.query.secret;
  if (!verifyWebhookSecret(secret as string)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const results: Record<string, { status: string; detail?: string; latency_ms?: number }> = {};

  // 1. Gemini Flash
  if (process.env.GOOGLE_API_KEY) {
    const start = Date.now();
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GOOGLE_API_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: "Reply OK" }] }], generationConfig: { maxOutputTokens: 5 } }),
        signal: AbortSignal.timeout(10000),
      });
      const d = await r.json() as any;
      if (d.error) { results.gemini = { status: 'INVALID', detail: d.error.message, latency_ms: Date.now() - start }; }
      else { results.gemini = { status: 'OK', detail: d.candidates?.[0]?.content?.parts?.[0]?.text || 'no text', latency_ms: Date.now() - start }; }
    } catch (e: any) { results.gemini = { status: 'ERROR', detail: e.message, latency_ms: Date.now() - start }; }
  } else { results.gemini = { status: 'NOT_SET' }; }

  // 2. Anthropic (Claude)
  if (process.env.ANTHROPIC_API_KEY) {
    const start = Date.now();
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 5, messages: [{ role: 'user', content: 'Reply OK' }] }),
        signal: AbortSignal.timeout(10000),
      });
      const d = await r.json() as any;
      if (d.error) { results.anthropic = { status: 'INVALID', detail: d.error.message, latency_ms: Date.now() - start }; }
      else { results.anthropic = { status: 'OK', detail: d.content?.[0]?.text || 'no text', latency_ms: Date.now() - start }; }
    } catch (e: any) { results.anthropic = { status: 'ERROR', detail: e.message, latency_ms: Date.now() - start }; }
  } else { results.anthropic = { status: 'NOT_SET' }; }

  // 3. DeepSeek
  if (process.env.DEEPSEEK_API_KEY) {
    const start = Date.now();
    try {
      const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'Reply OK' }], max_tokens: 5 }),
        signal: AbortSignal.timeout(10000),
      });
      const d = await r.json() as any;
      if (d.error) { results.deepseek = { status: 'INVALID', detail: d.error.message, latency_ms: Date.now() - start }; }
      else { results.deepseek = { status: 'OK', detail: d.choices?.[0]?.message?.content || 'no text', latency_ms: Date.now() - start }; }
    } catch (e: any) { results.deepseek = { status: 'ERROR', detail: e.message, latency_ms: Date.now() - start }; }
  } else { results.deepseek = { status: 'NOT_SET' }; }

  // 4. Groq
  if (process.env.GROQ_API_KEY) {
    const start = Date.now();
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'meta-llama/llama-4-scout-17b-16e-instruct', messages: [{ role: 'user', content: 'Reply OK' }], max_tokens: 5 }),
        signal: AbortSignal.timeout(10000),
      });
      const d = await r.json() as any;
      if (d.error) { results.groq = { status: 'RATE_LIMITED_OR_INVALID', detail: d.error.message, latency_ms: Date.now() - start }; }
      else { results.groq = { status: 'OK', detail: d.choices?.[0]?.message?.content || 'no text', latency_ms: Date.now() - start }; }
    } catch (e: any) { results.groq = { status: 'ERROR', detail: e.message, latency_ms: Date.now() - start }; }
  } else { results.groq = { status: 'NOT_SET' }; }

  const allOk = Object.values(results).every(r => r.status === 'OK');
  res.json({ allApisWorking: allOk, results });
});

// ---- Image generation test endpoint ----
app.get("/debug/test-image-gen", async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  const secret = req.query.secret;
  if (!verifyWebhookSecret(secret as string)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const googleKey = process.env.GOOGLE_API_KEY;
  if (!googleKey) return res.json({ error: "Required API key not configured" });

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

  res.json({ models: results });
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
    sampleTwiml: `<ConversationRelay url="${wsUrl}" ttsProvider="ElevenLabs" voice="${defaultVoice}" transcriptionProvider="Deepgram" dtmfDetection="true" interruptible="false" welcomeGreeting="Hey! What can I help you with?" />`,
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

      const result = await processTaskV3(mockTask);

      process.env.AI_MOCK_MODE = origMock;

      res.json({
        success: result.success,
        taskId: result.taskId,
        actionsCount: result.actions.length,
        responseLength: result.response.length,
      });
    } catch (error) {
      logger.error("[SMOKE-TEST] Error:", error);
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

  if (!userId || !username || !from || (!body && !subject)) {
    return res.status(400).json({ error: "bad_request", message: "Missing required fields" });
  }

  // Sanitize + prompt injection check
  const sanitizedV2 = sanitizeTaskInput(subject || '', body || '');
  if (sanitizedV2.injectionDetected) {
    logger.warn(`[SECURITY] Prompt injection blocked for user ${String(userId).substring(0, 8)}: ${sanitizedV2.injectionPattern}`);
    return res.status(400).json({ error: "invalid_request", message: "Request contains disallowed patterns" });
  }

  logger.info(`[TASK-V2] Received`, {
    userId: maskUserId(userId),
    channel: inputChannel || "email",
    timestamp: new Date().toISOString(),
  });

  // ── Webhook idempotency: reject duplicate tasks within 30s window ──
  const taskSubjectV2 = sanitizedV2.subject || sanitizedV2.body || '';
  const existingTaskIdV2 = checkAndRecordFingerprint(userId, taskSubjectV2);
  if (existingTaskIdV2) {
    logger.info(`[DEDUP] Duplicate V2 task rejected for user ${String(userId).substring(0, 8)}: "${taskSubjectV2.substring(0, 60)}"`);
    return res.json({ status: "duplicate", taskId: existingTaskIdV2, message: "Task already received and processing" });
  }

  activeTasks++;

  const taskReq: TaskRequest = {
    userId,
    username,
    from,
    subject: sanitizedV2.subject || '',
    body: sanitizedV2.body || '',
    inputChannel: inputChannel || "email",
  };

  // ── Fire-and-forget: respond immediately, process in background ──
  // processTaskV3 creates the task record in DB, processes the task, and delivers
  // the response via atomicCompleteTask (email/SMS/WS/etc). The frontend gets
  // updates via Supabase realtime subscriptions on the tasks table.
  // This avoids Railway's 30s HTTP timeout killing multi_step browser tasks.
  res.json({
    status: "accepted",
    message: "Task received — processing now. You'll get the response via your channel.",
  });

  // Process in background — errors are handled inside processTaskV3 (user notification + DB update)
  processTaskV3(taskReq)
    .then((result) => {
      logger.info(`[TASK-V2] Background task completed: success=${result.success}, taskId=${result.taskId}`);
      // Aurora Intelligence: extract context in background (non-blocking)
      const messageContent = (taskReq.body || taskReq.subject || '').trim();
      if (messageContent) {
        extractContext(messageContent, userId, inputChannel || 'web').catch(err =>
          logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Context extraction failed')
        );
      }
    })
    .catch((error) => {
      logger.error("[TASK-V2] Background processing failed:", error);
    })
    .finally(() => {
      activeTasks--;
    });
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
    logger.warn(`[SECURITY] Prompt injection blocked for user ${task.userId.substring(0, 8)}: ${sanitized.injectionPattern}`);
    return res.status(400).json({ error: "invalid_request", message: "Request contains disallowed patterns" });
  }
  task.subject = sanitized.subject;
  task.body = sanitized.body;

  logger.info(`[TASK] Received`, {
    userId: task.userId.substring(0, 8),
    timestamp: new Date().toISOString(),
  });

  // ── Webhook idempotency: reject duplicate tasks within 30s window ──
  const existingTaskId = checkAndRecordFingerprint(task.userId, task.subject || '', task.taskId);
  if (existingTaskId) {
    logger.info(`[DEDUP] Duplicate task rejected for user ${task.userId.substring(0, 8)}: "${(task.subject || '').substring(0, 60)}" (existing: ${existingTaskId.substring(0, 8)})`);
    return res.json({ status: "duplicate", taskId: existingTaskId, message: "Task already received and processing" });
  }

  // Gate concurrency — queue if at capacity
  if (activeTasks >= MAX_CONCURRENT_TASKS) {
    logger.info(`[TASK] Queued (${activeTasks}/${MAX_CONCURRENT_TASKS} active, queue=${taskQueue.length})`);
    res.json({ status: "queued", message: "Task queued — processing shortly" });
    taskQueue.push({
      task,
      resolve: (result) => logger.info(`Queued task completed: ${result.taskId}`),
      reject: (err) => logger.error("Queued task failed:", err),
    });
    processQueuedTasks();
    return;
  }

  // ── Mid-task update detection ──
  // If user already has an active task running, check if this new message is an update to it.
  const activeTask = getActiveTaskInfo(task.userId);
  if (activeTask) {
    const newMsg = (task.subject || '') + ' ' + (task.body || '');
    const relevance = classifyUpdateRelevance(newMsg, activeTask.subject);

    if (relevance === 'obvious_update') {
      // Inject silently — short message, clearly a clarification
      injectTaskUpdate(task.userId, newMsg.trim());
      logger.info(`[MID-TASK] Injected obvious update for user ${task.userId.substring(0, 8)}`);
      res.json({ status: "update_injected", message: `Got it — I'll incorporate that into the task I'm working on.` });
      return;
    }

    if (relevance === 'likely_update') {
      // Inject and tell the user we're treating it as an update
      injectTaskUpdate(task.userId, newMsg.trim());
      logger.info(`[MID-TASK] Injected likely update for user ${task.userId.substring(0, 8)}`);
      res.json({ status: "update_injected", message: `Got it — I'll factor that into "${activeTask.subject.substring(0, 60)}". Let me know if you meant to start a different task instead.` });
      return;
    }
    // relevance === 'new_task' → fall through, check for awaiting-reply tasks before starting new
  }

  // ── Auto-proceed reply detection ──
  // If user has a task in needs_review/pending_approval/awaiting_confirmation with auto_proceed_at set,
  // it means the agent asked a question and is waiting for a reply. Handle the reply.
  try {
    const newMsg = ((task.subject || '') + ' ' + (task.body || '')).trim();
    const { data: awaitingTask } = await getSupabaseClient()
      .from('tasks')
      .select('id, input_text, email_subject, status, auto_proceed_at, auto_proceed_context')
      .eq('user_id', task.userId)
      .in('status', ['needs_review', 'pending_approval', 'awaiting_confirmation'])
      .not('auto_proceed_at', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (awaitingTask) {
      const msgLower = newMsg.toLowerCase();
      const isCancelRequest = /\b(cancel|stop|forget it|nevermind|never mind|ignore|scratch that|abort|don't|dont)\b/i.test(msgLower);

      // Distinguish replies from new independent tasks:
      // - Short messages (< 80 chars) without action verbs → likely a reply ("2 people", "7pm", "yes")
      // - Long messages or messages with task verbs → new independent task
      const _looksLikeNewTask = newMsg.length > 80
        || /\b(create|make|build|find|search|sign\s?up|book\s+(?:me\s+)?a|write|send|get\s+me|order\s+me|help\s+me|tell\s+me|show\s+me|set\s+up|look\s+up|check\s+(?:my|if|on)|how\s+(?:to|do|can)|what\s+is|who\s+is)\b/i.test(msgLower);

      if (_looksLikeNewTask && !isCancelRequest) {
        // This is a new task, not a reply — fall through to normal task processing
        logger.info(`[AUTO-PROCEED-REPLY] Message looks like new task, not reply to ${awaitingTask.id.slice(0, 8)}: "${newMsg.slice(0, 60)}"`);
      } else if (isCancelRequest) {
        // User wants to cancel the task
        await getSupabaseClient().from('tasks').update({
          status: 'completed',
          response_text: 'Task cancelled.',
          auto_proceed_at: null,
          auto_proceed_context: null,
          completed_at: new Date().toISOString(),
        }).eq('id', awaitingTask.id);

        logger.info(`[AUTO-PROCEED-REPLY] User cancelled task ${awaitingTask.id.slice(0, 8)}`);
        res.json({ status: "cancelled", message: "Got it — task cancelled." });
        return;
      } else {
        // User provided an answer — clear auto-proceed timer and re-process with their answer
        logger.info(`[AUTO-PROCEED-REPLY] User replied to awaiting task ${awaitingTask.id.slice(0, 8)}: "${newMsg.slice(0, 80)}"`);

        await getSupabaseClient().from('tasks').update({
          status: 'processing',
          auto_proceed_at: null,
          auto_proceed_context: null,
        }).eq('id', awaitingTask.id);

        res.json({ status: "update_received", message: "Got it — incorporating your reply and continuing." });

        activeTasks++;
        processTaskV3({
          userId: task.userId,
          username: task.username,
          from: task.from,
          subject: awaitingTask.email_subject || awaitingTask.input_text?.substring(0, 200) || task.subject,
          body: `${awaitingTask.input_text || ''}\n\nUser reply: ${newMsg}`,
          taskId: awaitingTask.id,
          inputChannel: task.inputChannel,
          responsePrefix: `You replied with additional info. Here's what I did:`,
        }).then((result) => {
          logger.info(`[AUTO-PROCEED-REPLY] Task ${awaitingTask.id.slice(0, 8)} completed: success=${result.success}`);
        }).catch((err) => {
          logger.error(`[AUTO-PROCEED-REPLY] Task ${awaitingTask.id.slice(0, 8)} failed:`, err);
        }).finally(() => { activeTasks--; processQueuedTasks(); });
        return;
      }
    }
  } catch {
    // Non-critical — fall through to normal processing
  }

  res.json({ status: "queued", message: "Task received and processing" });

  // Aurora Intelligence: extract context in background (non-blocking)
  const taskMessageContent = ((task.body || '') + ' ' + (task.subject || '')).trim();
  if (taskMessageContent) {
    extractContext(taskMessageContent, task.userId, (task.inputChannel as string) || 'email').catch(err =>
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Context extraction failed')
    );
  }

  activeTasks++;
  registerActiveTask(task.userId, task.taskId || '', task.subject || '');

  processTaskV3(task)
    .then((result) => {
      logger.info(`Task completed: ${result.taskId}`, { success: result.success, actionsExecuted: result.actions.length });
    })
    .catch(async (error) => {
      logger.error("Task processing failed:", error);
      // SAFETY NET: If processTaskV3 crashes without updating the DB,
      // mark the task as needs_review so it doesn't stay "processing" forever
      if (task.taskId) {
        try {
          const { getSupabaseClient } = await import("./utils/supabase.js");
          await getSupabaseClient().from('tasks')
            .update({
              status: 'needs_review',
              response_text: 'I ran into a technical issue processing your request. Please try again!',
              error_message: error instanceof Error ? error.message : String(error),
              completed_at: new Date().toISOString(),
            })
            .eq('id', task.taskId)
            .eq('status', 'processing');
        } catch { /* last resort — watchdog will clean up */ }
      }
    })
    .finally(() => { unregisterActiveTask(task.userId); activeTasks--; processQueuedTasks(); });
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
    logger.warn(`[SECURITY] Prompt injection blocked for user ${task.userId.substring(0, 8)}: ${sanitizedIncoming.injectionPattern}`);
    return res.status(400).json({ error: "invalid_request", message: "Request contains disallowed patterns" });
  }

  logger.info(`[TASK] Incoming (FULL PROCESSOR with 30x iterations)`, {
    userId: task.userId.substring(0, 8),
    channel: task.inputChannel || "email",
    timestamp: new Date().toISOString(),
  });

  // Gate concurrency — queue if at capacity
  if (activeTasks >= MAX_CONCURRENT_TASKS) {
    logger.info(`[TASK] Incoming queued (${activeTasks}/${MAX_CONCURRENT_TASKS} active, queue=${taskQueue.length})`);
    res.json({ status: "queued", message: "Task queued — processing shortly" });
    const incomingTask: TaskRequest = {
      userId: task.userId,
      username: task.username,
      from: task.from,
      subject: sanitizedIncoming.subject,
      body: sanitizedIncoming.body,
      inputChannel: (task.inputChannel as "email" | "sms" | "voice" | "web") || "email",
    };
    taskQueue.push({
      task: incomingTask,
      resolve: (result) => logger.info(`Queued incoming task completed: ${result.taskId || 'unknown'}`),
      reject: (err) => logger.error("Queued incoming task failed:", err),
    });
    processQueuedTasks();
    return;
  }

  res.json({ status: "queued", message: "Task received and processing" });

  // Aurora Intelligence: extract context in background (non-blocking)
  const incomingMsgContent = ((sanitizedIncoming.body || '') + ' ' + (sanitizedIncoming.subject || '')).trim();
  if (incomingMsgContent) {
    extractContext(incomingMsgContent, task.userId, (task.inputChannel as string) || 'email').catch(err =>
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Context extraction failed')
    );
  }

  // Route to V3 when enabled, V1 fallback
  activeTasks++;
  const incomingTaskReq = {
    userId: task.userId,
    username: task.username,
    from: task.from,
    subject: sanitizedIncoming.subject,
    body: sanitizedIncoming.body,
    inputChannel: (task.inputChannel as "email" | "sms" | "voice" | "web") || "email",
  };

  const taskPromise = processTaskV3(incomingTaskReq);

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
          ).catch((err) => logger.error("Failed to send timeout email:", err));
        });
      }
    }
  );

  taskPromise
    .then((result) => {
      logger.info(`Incoming task processed: ${result.taskId || 'unknown'}`, { success: result.success, actions: result.actions?.length || 0 });
    })
    .catch(async (error) => {
      logger.error("Incoming task processing failed:", error);

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
          logger.info(`[CRASH-RECOVERY] Marked task ${stuckTask.id} as completed with recovery message`);
        }
      } catch (dbErr) {
        logger.error('[CRASH-RECOVERY] Failed to update task in DB:', dbErr);
      }
    })
    .finally(() => { activeTasks--; processQueuedTasks(); });
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
  
  if (!userId || !username || !from || !taskId || !replyText) {
    return res.status(400).json({ error: "bad_request", message: "Missing required fields" });
  }

  res.json({ status: "queued", message: "Confirmation received" });

  activeTasks++;
  handleConfirmationReply(userId, username, from, replyText, taskId)
    .then((result) => logger.info(`Confirmation processed: ${taskId}`, { success: result.success }))
    .catch((error) => logger.error("Confirmation processing failed:", error))
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
    .then((result) => logger.info(`Verification processed: ${taskId}`, { success: result.success }))
    .catch((error) => logger.error("Verification processing failed:", error))
    .finally(() => { activeTasks--; });
});

// POST /task/email-pin - Direct PIN verification (web dashboard submission)
// Unified PIN verification endpoint — called by email router, SMS handler, etc.
// Uses bcrypt so it MUST run on the agent (not in Cloudflare Workers)
app.post("/api/verify-pin", taskLimiter, async (req, res) => {
  const { userId, pin } = req.body;
  const secret = req.headers["x-webhook-secret"];

  if (!verifyWebhookSecret(secret as string)) {
    return res.status(401).json({ error: "unauthorized" });
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
    logger.error("[VERIFY-PIN] Error:", error);
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
    logger.error("[IMAP-TEST] Connection test failed:", err);
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
      logger.error("[EMAIL] Resend error:", error);
      return res.status(500).json({ error: "Failed to send email" });
    }

    res.json({ success: true, message: "Email sent" });
  } catch (error) {
    logger.error("[EMAIL] Failed to send email:", error);
    res.status(500).json({ error: "Failed to send email" });
  }
});

// ---- Twilio Voice Webhooks ----

// ---- Demo Number Config ----
// The website "Call Me Now" demo number — allows ANY caller to talk to Aurora AI
const DEMO_PHONE_NUMBER = process.env.DEMO_PHONE_NUMBER || "+18882981661"; // Toll-free demo number (purchased 2026-03-15)
const DEMO_USER_ID = process.env.DEMO_USER_ID || ""; // Ties demo sessions to an account (set on Railway)
const DEMO_VOICE = "EXAVITQu4vr4xnSDxMaL"; // Sarah — warm, professional ElevenLabs voice
const DEMO_GREETING = "Hey! I'm your Aurora AI — think of me as an employee who actually does things. I browse websites, fill forms, send emails, make calls, do research, book reservations — whatever you need. Go ahead, test me. Ask me anything.";

// ---- Demo Daily Minute Cap (cost protection) ----
// INCIDENT 2026-03-16: Someone spammed "Call Me Now" 27 times in 10 min, burned $33.
// In-memory cap resets on Railway deploy. DB-backed cap added on Vercel side.
// This is the agent-side failsafe — Vercel also checks call_history table.
const DEMO_DAILY_MINUTE_CAP = 20; // 20 min/day max (~$1.20 worst case)
let demoDailyMinutes = 0;
let demoDayKey = new Date().toISOString().split('T')[0];

function checkDemoCap(callDurationMinutes: number = 3): boolean {
  const today = new Date().toISOString().split('T')[0];
  if (today !== demoDayKey) { demoDailyMinutes = 0; demoDayKey = today; }
  if (demoDailyMinutes + callDurationMinutes > DEMO_DAILY_MINUTE_CAP) return false;
  demoDailyMinutes += callDurationMinutes;
  return true;
}

// ---- Demo Outbound Call TwiML ----
// Called by Twilio when a demo outbound call connects (from "Call Me Now" button)
// Looks up caller in profiles for interview detection, returns ConversationRelay TwiML
app.post("/webhook/voice/demo-outbound", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const callerNumber = req.body.To || ""; // For outbound calls, To = the user's phone
  const callSid = req.body.CallSid || "";
  const queryUserId = req.query.userId as string || ""; // Passed from /api/demo/call for logged-in users
  const wsUrl = `${(process.env.AGENT_URL || "https://agent-production-1339.up.railway.app").replace("http", "ws")}/ws/voice`;

  logger.info(`[VOICE-DEMO] Outbound demo call connected to ${callerNumber?.slice(0, 4)}****, queryUserId=${queryUserId?.slice(0, 8) || "none"}`);

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
              ? `Hey ${name}! Welcome to Aurora — I'm your new AI employee. I'm stoked to start working for you. Let me ask you a few quick questions so I can be exactly the assistant you need. Ready?`
              : `Hey there! Welcome to Aurora — I'm your new AI employee. I'm stoked to start working for you. Let me ask you a few quick questions so I can be exactly the assistant you need. Ready?`;
            logger.info(`[VOICE-DEMO] Outbound matched logged-in user ${profile.id.slice(0, 8)} (${name}), starting onboarding setup`);
          } else {
            effectiveCallType = "demo";
            effectiveUserId = profile.id;
            effectiveGreeting = name
              ? `Hey ${name}! Good to hear from you. What can I help you with?`
              : `Hey there! Good to hear from you. What can I help you with?`;
            logger.info(`[VOICE-DEMO] Outbound user ${profile.id.slice(0, 8)} already onboarded, regular demo`);
          }

          // Phone number auto-save removed for security — phone numbers should only
          // be set through authenticated channels (onboarding, settings), not webhooks.
        }
      } catch (e: any) {
        logger.error("[VOICE-DEMO] Outbound userId lookup error:", e.message);
      }
    }
    // No phone number fallback — cold demo callers stay fully isolated from real accounts

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
    }).then(() => {}, (e: any) => logger.error("[VOICE-DEMO] Call history insert failed:", e));

    const cappedGreeting = effectiveGreeting.substring(0, 120);
    const escGreeting = cappedGreeting.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay url="${wsUrl}" ttsProvider="ElevenLabs" voice="${DEMO_VOICE}" transcriptionProvider="Deepgram" dtmfDetection="true" interruptible="false" welcomeGreeting="${escGreeting}">
      <Parameter name="userId" value="${effectiveUserId}" />
      <Parameter name="callType" value="${effectiveCallType}" />
      <Parameter name="callerNumber" value="${callerNumber}" />
    </ConversationRelay>
  </Connect>
  <Say voice="Polly.Joanna-Neural">Sorry, I lost our connection. Please call back and we'll pick up where we left off.</Say>
  <Hangup/>
</Response>`;

    logger.info(`[VOICE-DEMO] Outbound TwiML: ${effectiveCallType}, userId=${effectiveUserId?.slice(0, 8) || "none"}`);
    res.type("text/xml").send(twiml);
  } catch (error: any) {
    logger.error("[VOICE-DEMO] Outbound TwiML error:", error.message);
    // Fallback: simple greeting so the call doesn't fail silently
    const fallback = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">Hey there! I'm Aurora, your AI assistant. Something went wrong connecting to my brain, but I'm real! Visit aevoy.com to try again.</Say>
  <Hangup/>
</Response>`;
    res.type("text/xml").send(fallback);
  }
});

// ---- Outbound Call TwiML (for scheduled callbacks) ----
// Twilio fetches this URL when making outbound calls via callUser()
// Returns ConversationRelay TwiML for full conversational callbacks
app.post("/webhook/voice/outbound-twiml", twilioLimiter, validateTwilioSignature, async (req, res) => {
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

  const fullMessage = message || 'Hey! Your AI assistant is calling back. What can I help you with?';
  // Cap welcomeGreeting to prevent ElevenLabs TTS buffering delay (long text = 10s silence)
  // Full message is passed as a Parameter for handleSetup to use in conversation context
  const cappedGreeting = fullMessage.substring(0, 120);
  const shortGreeting = cappedGreeting.length > 80
    ? cappedGreeting.substring(0, cappedGreeting.lastIndexOf(' ', 80)) + '...'
    : cappedGreeting;
  const escGreeting = shortGreeting.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escFullMessage = fullMessage.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Use <Parameter> elements (not URL query params) so handleSetup receives them via customParameters
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay url="${wsUrl}" ttsProvider="ElevenLabs" voice="${voiceId}" transcriptionProvider="Deepgram" dtmfDetection="true" interruptible="false" welcomeGreeting="${escGreeting}">
      <Parameter name="userId" value="${userId}" />
      <Parameter name="callType" value="callback" />
      <Parameter name="fullMessage" value="${escFullMessage}" />
    </ConversationRelay>
  </Connect>
  <Say voice="Polly.Joanna-Neural">Sorry, I lost our connection. Please call back and we'll pick up where we left off.</Say>
  <Hangup/>
</Response>`;

  logger.info(`[VOICE] Outbound TwiML served for user ${userId?.slice(0, 8)}, voice=${voiceId}`);
  res.type('text/xml').send(twiml);
});

// ---- External Call TwiML (for calling restaurants, businesses, etc.) ----
// callExternal() creates the call and Twilio fetches this URL for TwiML.
// Returns ConversationRelay so the AI can have a REAL conversation with the business.
app.post("/webhook/voice/external-call-twiml", twilioLimiter, validateTwilioSignature, async (req, res) => {
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

  // SHORT welcomeGreeting — just "Hi" spoken immediately when business picks up.
  // The FULL script is passed via Parameter and delivered by the AI as its first
  // response. This eliminates the 10s dead air (TTS+WS+AI startup before interaction).
  const fullScript = script || `Hi, I'm calling on behalf of a customer to make a reservation.`;
  const escScript = fullScript.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay url="${wsUrl}" ttsProvider="ElevenLabs" voice="${voiceId}" transcriptionProvider="Deepgram" dtmfDetection="true" interruptible="false" welcomeGreeting="Hi there.">
      <Parameter name="userId" value="${userId}" />
      <Parameter name="callType" value="external_call" />
      <Parameter name="contextKey" value="${contextKey}" />
      <Parameter name="script" value="${escScript}" />
      <Parameter name="businessName" value="${businessName.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" />
    </ConversationRelay>
  </Connect>
</Response>`;

  logger.info(`[VOICE] External call TwiML for user ${userId?.slice(0, 8)}, business=${businessName}, voice=${voiceId}`);
  res.type('text/xml').send(twiml);
});

// ---- Incoming Voice Calls (Caller Identification) ----

app.post("/webhook/voice/incoming", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const callerNumber = req.body.From || "";
  const twilioNumber = req.body.To || "";
  const callSid = req.body.CallSid || "";
  let voice = DEFAULT_VOICE;
  const startTime = Date.now();

  logger.info(`[VOICE] Incoming call from ${maskPhone(callerNumber)} to ${maskPhone(twilioNumber)}`);

  try {
    const supabase = getSupabaseClient();

    // ---- DEMO NUMBER: ANY call to the demo number gets the demo experience ----
    // This check runs BEFORE user resolution — even registered users calling the demo
    // number get the demo, because the demo number is for the website "Call Me Now" button.
    const normalizedTo = twilioNumber.replace(/\D/g, "").slice(-10);
    const normalizedDemo = DEMO_PHONE_NUMBER.replace(/\D/g, "").slice(-10);
    const isDemoCall = normalizedTo === normalizedDemo;

    if (isDemoCall) {
      // COST GUARD: Daily minute cap for demo number (max 60 min/day ~$3.15)
      if (!checkDemoCap(3)) {
        logger.warn(`[VOICE-DEMO] Daily minute cap reached (${demoDailyMinutes}/${DEMO_DAILY_MINUTE_CAP} min). Rejecting demo call from ${maskPhone(callerNumber)}`);
        res.type("text/xml");
        return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">Sorry, our demo line is currently unavailable. Please visit aevoy.com to sign up and get your own AI assistant. Talk soon!</Say>
  <Hangup/>
</Response>`);
      }

      // Demo calls are fully isolated — no phone lookup, no account linking
      const effectiveCallType = "demo";
      const effectiveUserId = DEMO_USER_ID;
      const effectiveGreeting = DEMO_GREETING.substring(0, 120);

      logger.info(`[VOICE-DEMO] ${effectiveCallType} call from ${maskPhone(callerNumber)} (${Date.now() - startTime}ms)`);

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
      }).then(() => {}, (e: any) => logger.error("[VOICE] Demo call history insert failed:", e));

      res.type("text/xml");

      if (USE_CONVERSATION_RELAY) {
        const wsUrl = `${(process.env.AGENT_URL || "https://agent-production-1339.up.railway.app").replace("http", "ws")}/ws/voice`;
        logger.info(`[VOICE-DEMO] ConversationRelay ${effectiveCallType}: voice=${DEMO_VOICE}, userId=${effectiveUserId?.slice(0, 8) || "none"}`);
        return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay url="${wsUrl}" ttsProvider="ElevenLabs" voice="${DEMO_VOICE}" transcriptionProvider="Deepgram" dtmfDetection="true" interruptible="false" welcomeGreeting="${escapeXml(effectiveGreeting)}">
      <Parameter name="userId" value="${effectiveUserId}" />
      <Parameter name="callType" value="${effectiveCallType}" />
      <Parameter name="callerNumber" value="${callerNumber}" />
    </ConversationRelay>
  </Connect>
  <Say voice="Polly.Joanna-Neural">Sorry, I lost our connection. Please call back and we'll pick up where we left off.</Say>
  <Hangup/>
</Response>`);
      }

      // Legacy fallback for demo
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">${escapeXml(effectiveGreeting)}</Say>
  <Gather input="speech" timeout="10" speechTimeout="auto" speechModel="phone_call" enhanced="true"
    action="${process.env.AGENT_URL || 'https://agent-production-1339.up.railway.app'}/webhook/voice/demo" method="POST" />
  <Say voice="${voice}">I didn't catch that. Feel free to call back anytime!</Say>
  <Hangup/>
</Response>`);
    }

    // OPTIMIZATION: Resolve user once, then load profile (eliminates duplicate resolveUser call)
    const resolved = await resolveUser(callerNumber);

    if (!resolved) {
      // ---- Not demo, not recognized — look up who owns the called number ----
      const calledUser = await resolveUser(twilioNumber);

      if (!calledUser) {
        // Nobody owns this number
        logger.info(`[VOICE] Unknown caller ${maskPhone(callerNumber)} to unowned number ${maskPhone(twilioNumber)} (${Date.now() - startTime}ms)`);
        supabase.from("call_history").insert({
          call_sid: callSid, direction: "inbound", from_number: callerNumber,
          to_number: twilioNumber, call_type: "unknown", pin_required: false, pin_success: false
        }).then(() => {}, (e: any) => logger.error("[VOICE] Call history insert failed:", e));
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

      logger.info(`[VOICE] Unknown caller ${maskPhone(callerNumber)} to ${calledUser.username}'s number, PIN required: ${hasPinSet} (${Date.now() - startTime}ms)`);

      supabase.from("call_history").insert({
        call_sid: callSid, direction: "inbound", from_number: callerNumber,
        to_number: twilioNumber, call_type: hasPinSet ? "pin_challenge" : "receptionist",
        user_id: calledUser.userId, pin_required: hasPinSet, pin_success: null
      }).then(() => {}, (e: any) => logger.error("[VOICE] Call history insert failed:", e));

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
  <Hangup/>
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
      logger.info(`[VOICE] Failed to load profile for user ${userId.slice(0, 8)} (${Date.now() - startTime}ms)`);
      res.type("text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Sorry, something went wrong. Please try again.</Say>
  <Hangup/>
</Response>`);
    }

    const isPinLocked = profile.voice_pin_locked_until && new Date(profile.voice_pin_locked_until) > new Date();

    if (!withinLimit) {
      logger.info(`[VOICE] User ${userId.slice(0, 8)} exceeded daily call limit (${Date.now() - startTime}ms)`);

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
      }).then(() => {}, (e: any) => logger.error("[VOICE] Call history insert failed:", e));

      res.type("text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">You've reached your daily call limit of 50 calls. Please try again tomorrow or contact us at aevoy dot com.</Say>
  <Hangup/>
</Response>`);
    }

    if (isPinLocked) {
      logger.info(`[VOICE] User ${userId.slice(0, 8)} is PIN-locked until ${profile.voice_pin_locked_until} (${Date.now() - startTime}ms)`);

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
      }).then(() => {}, (e: any) => logger.error("[VOICE] Call history insert failed:", e));

      res.type("text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Your account is temporarily locked due to too many failed PIN attempts. Please try again in 15 minutes, or contact support.</Say>
  <Hangup/>
</Response>`);
    }

    // Verified caller — route to task handler
    logger.info(`[VOICE] Recognized user: ${profile.username} (${userId.slice(0, 8)})`);

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
    }).then(() => {}, (e: any) => logger.error("[VOICE] Call history insert failed:", e));

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
      const rawGreeting = greetingStyle === 'jarvis'
        ? `${timeGreeting}, ${userName}. How may I assist you?`
        : `Hey ${userName}! What can I help you with?`;
      const greeting = rawGreeting.substring(0, 120);

      logger.info(`[VOICE-INCOMING] ConversationRelay for ${userId.slice(0, 8)}: voice=${elevenlabsVoice}`);
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay url="${wsUrl}" ttsProvider="ElevenLabs" voice="${elevenlabsVoice}" transcriptionProvider="Deepgram" dtmfDetection="true" interruptible="false" welcomeGreeting="${escapeXml(greeting)}">
      <Parameter name="userId" value="${userId}" />
      <Parameter name="callType" value="task" />
    </ConversationRelay>
  </Connect>
  <Say voice="Polly.Joanna-Neural">Sorry, I lost our connection. Please call back and we'll pick up where we left off.</Say>
  <Hangup/>
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
  <Hangup/>
</Response>`);
  } catch (error) {
    logger.error("[VOICE] Incoming call error:", error);
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

  logger.info(`[TWILIO] Incoming voice call for user ${maskUserId(userId)} from ${maskPhone(callerNum)}`);

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
        logger.info(`[TWILIO] Unknown caller to ${maskUserId(userId)}'s number — PIN challenge`);
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
      logger.info(`[TWILIO] Unknown caller to ${maskUserId(userId)}'s number — receptionist mode`);
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Hello! You've reached ${escapeXml(userName)}'s assistant. They're not available right now, but I can take a message.</Say>
  <Gather input="speech" timeout="15" speechTimeout="auto"
    action="${processUrl}" method="POST">
    <Say voice="${voice}">Please leave your message. What would you like me to tell ${escapeXml(userName)}?</Say>
  </Gather>
  <Say voice="${voice}">I didn't hear a message. Goodbye!</Say>
  <Hangup/>
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
        const rawGreeting2 = greetingStyle === 'jarvis'
          ? `${timeGreeting}, ${userName}. How may I assist you?`
          : `Hey ${userName}! It's ${botName}. What can I help you with?`;
        greeting = rawGreeting2.substring(0, 120);
      } catch { greeting = "Hey! What can I help with?"; }

      logger.info(`[VOICE] ConversationRelay TwiML for ${userId.slice(0, 8)}: voice=${elevenlabsVoice}, wsUrl=${wsUrl}`);
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay url="${wsUrl}" ttsProvider="ElevenLabs" voice="${elevenlabsVoice}" transcriptionProvider="Deepgram" dtmfDetection="true" interruptible="false" welcomeGreeting="${escapeXml(greeting)}">
      <Parameter name="userId" value="${userId}" />
      <Parameter name="callType" value="task" />
    </ConversationRelay>
  </Connect>
  <Say voice="Polly.Joanna-Neural">Sorry, I lost our connection. Please call back and we'll pick up where we left off.</Say>
  <Hangup/>
</Response>`);
    }

    // Legacy fallback
    const from = req.body.From || "";
    const to = req.body.To || "";
    const callSid = req.body.CallSid || "";
    const twiml = await handleIncomingVoice({ from, to, callSid });
    res.send(twiml);
  } catch (error) {
    logger.error("[TWILIO] Voice webhook error:", error);
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Sorry, an error occurred. Please try again later.</Say>
  <Hangup/>
</Response>`);
  }
});

app.post("/webhook/voice/process/:userId", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const userId = req.params.userId;
  const voice = await getUserVoice(userId);
  const speechResult = req.body.SpeechResult || "";

  logger.info(`[TWILIO] Voice command received for user ${maskUserId(userId)}`);

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
          .catch((err: unknown) => logger.error({ err }, 'Task processing failed'))
          .finally(() => { activeTasks--; });
      }
    }
  } catch (error) {
    logger.error("[TWILIO] Voice process error:", error);
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Sorry, I had trouble processing that. Please try again.</Say>
  <Hangup/>
</Response>`);
  }
});

// ---- Email Voice Decision Webhook ----

app.post("/webhook/voice/email-decision/:userId/:queueId", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const userId = req.params.userId;
  const queueId = req.params.queueId;
  const speechResult = req.body.SpeechResult || "";

  logger.info(`[TWILIO] Email decision received for user ${maskUserId(userId)}, queue ${queueId?.slice(0, 8)}`);

  try {
    const { processEmailVoiceDecision } = await import("./services/twilio.js");
    const twiml = await processEmailVoiceDecision(userId, queueId, speechResult);
    
    res.type("text/xml");
    res.send(twiml);
  } catch (error) {
    logger.error("[TWILIO] Email decision error:", error);
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${DEFAULT_VOICE}">Sorry, I had trouble processing your response. I'll queue this in your dashboard for you to review later.</Say>
  <Hangup/>
</Response>`);
  }
});

// ---- Twilio Message-Taking Webhook (Receptionist) ----

app.post("/webhook/voice/message/:userId", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const userId = req.params.userId;
  const voice = await getUserVoice(userId);
  const speechResult = req.body.SpeechResult || "";
  const callerNumber = req.query.caller as string || req.body.From || "unknown";

  logger.info(`[TWILIO] Message received for user ${maskUserId(userId)} from ${maskPhone(callerNumber)}`);

  try {
    // Respond to the caller
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Thank you! I've recorded your message and will make sure it's delivered right away. Goodbye!</Say>
  <Hangup/>
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
            body: `[Aurora] Missed call from ${callerNumber}: "${speechResult.substring(0, 140)}"`,
          });
        }

        logger.info(`[TWILIO] Message delivered to ${profile.username} from ${maskPhone(callerNumber)}`);
      }
    }
  } catch (error) {
    logger.error("[TWILIO] Message recording error:", error);
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Sorry, there was an error. Please try calling back later.</Say>
  <Hangup/>
</Response>`);
  }
});

// ---- SMS Idempotency: prevent duplicate processing of the same Twilio message ----
const processedSmsSids = new Map<string, number>(); // MessageSid -> timestamp
const SMS_IDEMPOTENCY_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Cleanup stale entries every 2 minutes
setInterval(() => {
  const cutoff = Date.now() - SMS_IDEMPOTENCY_TTL_MS;
  for (const [sid, ts] of processedSmsSids) {
    if (ts < cutoff) processedSmsSids.delete(sid);
  }
}, 2 * 60 * 1000);

function isSmsDuplicate(messageSid: string): boolean {
  if (!messageSid) return false;
  if (processedSmsSids.has(messageSid)) {
    logger.info(`[SMS] Duplicate MessageSid ${messageSid.slice(0, 12)} — skipping`);
    return true;
  }
  processedSmsSids.set(messageSid, Date.now());
  return false;
}

// ---- SMS STOP/Unsubscribe keyword handling (U004) ----
const SMS_STOP_KEYWORDS = new Set(['stop', 'unsubscribe', 'cancel', 'opt out']);
const SMS_START_KEYWORDS = new Set(['start', 'subscribe', 'opt in', 'resume']);

// ---- Twilio SMS Webhook ----

app.post("/webhook/sms/:userId", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const from = req.body.From || "";
  const to = req.body.To || "";
  const body = req.body.Body || "";
  const messageSid = req.body.MessageSid || "";

  // Idempotency: skip duplicate message SIDs (T031)
  if (isSmsDuplicate(messageSid)) {
    res.type("text/xml");
    return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
  }

  logger.info(`[TWILIO] Incoming SMS received`);

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
          if (result.isReplyToAwaiting) {
            // User replied to an awaiting task — re-process with their answer
            activeTasks++;
            const { data: awTask } = await getSupabaseClient()
              .from('tasks')
              .select('id, input_text, email_subject')
              .eq('id', result.taskId)
              .single();

            processTaskV3({
              userId: profile.userId,
              username: profile.username,
              from: profile.email,
              subject: awTask?.email_subject || body.substring(0, 200),
              body: `${awTask?.input_text || ''}\n\nUser reply: ${body}`,
              taskId: result.taskId,
              inputChannel: "sms",
              responsePrefix: `You replied with additional info. Here's what I did:`,
            })
              .catch((err: unknown) => logger.error({ err }, 'Task processing failed'))
              .finally(() => { activeTasks--; });
          } else {
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
              .catch((err: unknown) => logger.error({ err }, 'Task processing failed'))
              .finally(() => { activeTasks--; });
          }
        }
      }
    } else {
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Sorry, I couldn't process that message. Please try again or email your AI.</Message>
</Response>`);
    }
  } catch (error) {
    logger.error("[TWILIO] SMS webhook error:", error);
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

  // Idempotency: skip duplicate message SIDs (T031)
  if (isSmsDuplicate(messageSid)) {
    res.type("text/xml");
    return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
  }

  logger.info(`[SMS] Incoming from ${maskPhone(senderNumber)}: "${message.slice(0, 50)}..."`);

  // Track inbound SMS cost for the resolved user (called once per request)
  const { SMS_MARKUP: smsMarkupIncoming, TWILIO_RATES: twilioRatesIncoming } = await import('./utils/cost-calculator.js');
  const trackInboundSmsCost = (userId: string) => {
    trackServiceCost(userId, 'twilio', 'sms_inbound', twilioRatesIncoming.SMS_INBOUND_NA, 'sms_inbound', undefined, smsMarkupIncoming).catch(() => {});
  };

  try {
    const supabase = getSupabaseClient();

    // Use identity resolver to handle both twilio_number and phone_number
    const resolved = await resolveUser(senderNumber);

    if (!resolved) {
      // Unknown sender — look up who owns the Aurora number being texted
      const recipientUser = await resolveUser(twilioNumber);

      if (!recipientUser) {
        logger.info(`[SMS] Unknown sender ${maskPhone(senderNumber)} to unowned number ${maskPhone(twilioNumber)}`);
        res.type("text/xml");
        return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Sorry, this number is not in service. Visit aevoy.com for more information.</Message>
</Response>`);
      }

      // ── Intercept verification codes from automated senders (website 2FA) ──
      // Before PIN check: if sender looks automated and message has a code, store it
      const incomingCodeMatch = message.match(
        /(?:verification|confirm|verify|auth|code|pin|otp|token|security)\s*(?:is|:)?\s*[:\-–—]?\s*(\d{4,8})\b/i
      ) || message.match(
        /\b(\d{4,8})\s*(?:is your|is the)\s*(?:verification|confirm|auth|code|pin|otp)/i
      ) || message.match(
        /(?:enter|use|type)\s+(?:this\s+)?(?:code|pin|otp)[:\s]+(\d{4,8})\b/i
      ) || message.match(
        /\bcode[:\s]+(\d{4,8})\b/i
      ) || (message.trim().match(/^\d{4,8}$/) ? message.trim().match(/^(\d{4,8})$/) : null);

      const senderLooksAutomated = /^\+?\d{4,6}$/.test(senderNumber) || senderNumber.length <= 8 || /\b(verify|code|otp|confirm)\b/i.test(message);

      if (incomingCodeMatch?.[1] && senderLooksAutomated) {
        const verifCode = incomingCodeMatch[1];
        logger.info(`[SMS] Verification code "${verifCode}" intercepted from ${maskPhone(senderNumber)} for user ${recipientUser.userId.slice(0, 8)}`);
        try {
          const { storeTfaCode } = await import("./services/tfa.js");
          await storeTfaCode(recipientUser.userId, null, verifCode, "sms");
        } catch { /* non-critical */ }

        // Resume any task stuck waiting for verification
        try {
          const { data: stuckTask } = await supabase
            .from("tasks")
            .select("id, structured_intent")
            .eq("user_id", recipientUser.userId)
            .eq("status", "awaiting_user_input")
            .eq("stuck_reason", "verification_code")
            .order("created_at", { ascending: false })
            .limit(1)
            .single();

          if (stuckTask) {
            await supabase.from("tasks").update({
              status: "processing",
              stuck_reason: null,
              structured_intent: {
                ...(stuckTask.structured_intent as Record<string, unknown> || {}),
                verification_code: verifCode,
              },
            }).eq("id", stuckTask.id);
            logger.info(`[SMS] Resumed stuck task ${stuckTask.id.slice(0, 8)} with verification code`);
          }
        } catch { /* non-critical */ }

        res.type("text/xml");
        return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
      }

      // Track inbound SMS cost for the recipient user (Twilio charges us per inbound SMS)
      trackInboundSmsCost(recipientUser.userId);

      // Found the user — check if PIN is required
      const { hasPin: smsHasPin, verifyUnifiedPin: smsVerifyPin, getRemainingAttempts: smsGetRemaining } = await import("./utils/pin-auth.js");
      const hasPinSet = await smsHasPin(recipientUser.userId);

      if (!hasPinSet) {
        // No PIN — process message directly for the user
        logger.info(`[SMS] No PIN set for ${recipientUser.username} — processing message from unknown sender`);
        await processTaskV3({
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
      logger.info(`[SMS] PIN verified for unknown sender ${maskPhone(senderNumber)} -> ${recipientUser.username}`);

      await processTaskV3({
        userId: recipientUser.userId, username: recipientUser.username,
        from: senderNumber, subject: (cleanMessage || message).substring(0, 200), body: "", inputChannel: "sms"
      });

      res.type("text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
    }

    const userId = resolved.userId;
    const username = resolved.username;
    logger.info(`[SMS] Recognized user: ${username} (${userId.slice(0, 8)})`);

    // Track inbound SMS cost (Twilio charges us per inbound SMS)
    trackInboundSmsCost(userId);

    // ── STOP/Unsubscribe handling (U004) ──
    // Check for opt-out keywords BEFORE any task processing
    const smsNormalized = message.trim().toLowerCase();
    if (SMS_STOP_KEYWORDS.has(smsNormalized)) {
      logger.info(`[SMS] User ${userId.slice(0, 8)} sent STOP keyword — disabling proactive`);
      try {
        await supabase.from('user_settings').upsert({
          user_id: userId,
          proactive_enabled: false,
        }, { onConflict: 'user_id' });
      } catch (err) {
        logger.error('[SMS] Failed to update proactive setting:', err);
      }
      res.type("text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Got it. Aurora will stop reaching out. Text START anytime to resume.</Message>
</Response>`);
    }

    if (SMS_START_KEYWORDS.has(smsNormalized)) {
      logger.info(`[SMS] User ${userId.slice(0, 8)} sent START keyword — enabling proactive`);
      try {
        await supabase.from('user_settings').upsert({
          user_id: userId,
          proactive_enabled: true,
        }, { onConflict: 'user_id' });
      } catch (err) {
        logger.error('[SMS] Failed to update proactive setting:', err);
      }
      res.type("text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Welcome back! Aurora will now proactively reach out when there's something useful to share.</Message>
</Response>`);
    }

    // ── Commitment completion via SMS (U040) ──
    // If message starts with "done" or "completed", mark the most recent pending commitment
    const commitmentMatch = smsNormalized.match(/^(done|completed)\b/);
    if (commitmentMatch) {
      try {
        const { data: pendingCommitment } = await supabase
          .from('commitments')
          .select('id, description')
          .eq('user_id', userId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (pendingCommitment) {
          await supabase.from('commitments').update({
            status: 'completed',
            completed_at: new Date().toISOString(),
          }).eq('id', pendingCommitment.id);

          logger.info(`[SMS] User ${userId.slice(0, 8)} completed commitment: ${pendingCommitment.description.slice(0, 50)}`);
          res.type("text/xml");
          return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Marked as done: ${pendingCommitment.description.substring(0, 140)}</Message>
</Response>`);
        }
        // No pending commitment found — fall through to normal processing
      } catch {
        // Non-critical — fall through to normal processing
      }
    }

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
      logger.info(`[SMS] PIN verified for unrecognized number ${maskPhone(senderNumber)}`);

      await processTaskV3({
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

    // ── Auto-proceed reply detection (SMS) ──
    // Check if user has a task waiting for their reply before creating a new task
    try {
      const { data: smsAwaitingTask } = await supabase
        .from('tasks')
        .select('id, input_text, email_subject, status, auto_proceed_at')
        .eq('user_id', userId)
        .in('status', ['needs_review', 'pending_approval', 'awaiting_confirmation'])
        .not('auto_proceed_at', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (smsAwaitingTask) {
        const smsLower = message.toLowerCase().trim();
        const smsCancelRequest = /\b(cancel|stop|forget it|nevermind|never mind|ignore|scratch that|abort|don't|dont)\b/i.test(smsLower);

        if (smsCancelRequest) {
          await supabase.from('tasks').update({
            status: 'completed',
            response_text: 'Task cancelled.',
            auto_proceed_at: null,
            auto_proceed_context: null,
            completed_at: new Date().toISOString(),
          }).eq('id', smsAwaitingTask.id);

          logger.info(`[SMS-AUTO-PROCEED] User cancelled task ${smsAwaitingTask.id.slice(0, 8)} via SMS`);
          res.type("text/xml");
          return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Got it, task cancelled.</Message>
</Response>`);
        }

        // User provided an answer — clear timer and re-process
        logger.info(`[SMS-AUTO-PROCEED] User replied to awaiting task ${smsAwaitingTask.id.slice(0, 8)} via SMS`);

        await supabase.from('tasks').update({
          status: 'processing',
          auto_proceed_at: null,
          auto_proceed_context: null,
        }).eq('id', smsAwaitingTask.id);

        processTaskV3({
          userId,
          username,
          from: senderNumber,
          subject: smsAwaitingTask.email_subject || smsAwaitingTask.input_text?.substring(0, 200) || message.substring(0, 200),
          body: `${smsAwaitingTask.input_text || ''}\n\nUser reply: ${message}`,
          taskId: smsAwaitingTask.id,
          inputChannel: "sms",
          responsePrefix: `You replied with additional info. Here's what I did:`,
        }).catch((err: Error) => {
          logger.error(`[SMS-AUTO-PROCEED] Task ${smsAwaitingTask.id.slice(0, 8)} failed:`, err);
        });

        res.type("text/xml");
        return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Got it! Continuing with your task.</Message>
</Response>`);
      }
    } catch {
      // Non-critical — fall through to normal SMS processing
    }

    // Process SMS as task (sender is the account owner or no PIN set)
    await processTaskV3({
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
    logger.error("[SMS] Incoming SMS error:", error);
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

  logger.info(`[PIN] Verification attempt from ${maskPhone(callerNumber)}, entered: ${maskPin(enteredPin)}`);

  try {
    const supabase = getSupabaseClient();

    // Resolve user identity — try caller first, then the called number (To)
    let resolved = await resolveUser(callerNumber);

    if (!resolved) {
      // Unknown caller — resolve by the Aurora number being called (To)
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
      logger.info(`[PIN] Invalid PIN from ${maskPhone(callerNumber)}, ${remaining} attempts remaining`);

      res.type("text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Incorrect PIN. You have ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.</Say>
  <Gather action="${process.env.AGENT_URL}/webhook/voice/pin-verify" numDigits="6" finishOnKey="#" timeout="10">
    <Say voice="${voice}">Please enter your 4 to 6 digit PIN, then press pound.</Say>
  </Gather>
  <Hangup/>
</Response>`);
    }

    logger.info(`[PIN] Successful verification for ${profile.username} (${userId.slice(0, 8)})`);

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
  <Hangup/>
</Response>`);
  } catch (error) {
    logger.error("[PIN] Verification error:", error);
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

  logger.info(`[VOICE-PREMIUM] Call to user ${userId.slice(0, 8)} from ${maskPhone(from)}`);

  try {
    const supabase = getSupabaseClient();

    // Check if caller is the registered phone owner
    const { isRegisteredPhone: isPremiumVoiceOwner, hasPin: premiumVoiceHasPin } = await import("./utils/pin-auth.js");
    const callerIsOwner = from ? await isPremiumVoiceOwner(userId, from) : false;

    if (!callerIsOwner && from) {
      const hasPinSet = await premiumVoiceHasPin(userId);
      const agentUrl = process.env.AGENT_URL || 'https://agent-production-1339.up.railway.app';

      if (hasPinSet) {
        logger.info(`[VOICE-PREMIUM] Unknown caller ${maskPhone(from)} — PIN challenge`);
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
      logger.info(`[VOICE-PREMIUM] Unknown caller ${maskPhone(from)} — receptionist mode`);
      res.type("text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Hello! You've reached ${escapeXml(userName)}'s assistant. They're not available right now, but I can take a message.</Say>
  <Gather input="speech" timeout="15" speechTimeout="auto"
    action="${processUrl}" method="POST">
    <Say voice="${voice}">Please leave your message.</Say>
  </Gather>
  <Say voice="${voice}">I didn't hear a message. Goodbye!</Say>
  <Hangup/>
</Response>`);
    }

    // Check daily call limit (50/day per user)
    if (!(await checkDailyCallLimit(userId))) {
      logger.info(`[VOICE-PREMIUM] User ${userId.slice(0, 8)} exceeded daily call limit`);

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

      logger.info(`[VOICE-PREMIUM] ConversationRelay for ${userId.slice(0, 8)}: voice=${elevenlabsVoice}`);
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay url="${wsUrl}" ttsProvider="ElevenLabs" voice="${elevenlabsVoice}" transcriptionProvider="Deepgram" dtmfDetection="true" interruptible="false" welcomeGreeting="Hey! What can I help you with?">
      <Parameter name="userId" value="${userId}" />
      <Parameter name="callType" value="task" />
    </ConversationRelay>
  </Connect>
  <Say voice="Polly.Joanna-Neural">Sorry, I lost our connection. Please call back and we'll pick up where we left off.</Say>
  <Hangup/>
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
  <Hangup/>
</Response>`);
  } catch (error) {
    logger.error("[VOICE-PREMIUM] Error:", error);
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

  // Idempotency: skip duplicate message SIDs (T031)
  if (isSmsDuplicate(messageSid)) {
    res.type("text/xml");
    return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
  }

  logger.info(`[SMS-PREMIUM] Message to user ${userId.slice(0, 8)} from ${maskPhone(from)}: "${smsBody.slice(0, 50)}..."`);

  // Track inbound SMS cost for premium number (Twilio charges us per inbound SMS)
  {
    const { SMS_MARKUP: smsMarkupPrem, TWILIO_RATES: twilioRatesPrem } = await import('./utils/cost-calculator.js');
    trackServiceCost(userId, 'twilio', 'sms_inbound', twilioRatesPrem.SMS_INBOUND_NA, 'sms_inbound', undefined, smsMarkupPrem).catch(() => {});
  }

  try {
    const supabase = getSupabaseClient();
    const { data: profile } = await supabase
      .from("profiles")
      .select("username, phone_number")
      .eq("id", userId)
      .single();

    // Check if sender is the registered phone owner
    const { isRegisteredPhone: isPremiumOwner, hasPin: premiumHasPin, verifyUnifiedPin: premiumVerifyPin, getRemainingAttempts: premiumGetRemaining } = await import("./utils/pin-auth.js");
    const callerIsOwner = from ? await isPremiumOwner(userId, from) : false;

    // ── Intercept verification codes from non-user senders (e.g. website SMS 2FA) ──
    // If the sender is NOT the user and the message looks like a verification code,
    // store it in tfa_codes for the browser agent to pick up. Don't require PIN.
    if (!callerIsOwner && from) {
      const verificationCodeMatch = smsBody.match(
        /(?:verification|confirm|verify|auth|code|pin|otp|token|security)\s*(?:is|:)?\s*[:\-–—]?\s*(\d{4,8})\b/i
      ) || smsBody.match(
        /\b(\d{4,8})\s*(?:is your|is the)\s*(?:verification|confirm|auth|code|pin|otp)/i
      ) || smsBody.match(
        /(?:enter|use|type)\s+(?:this\s+)?(?:code|pin|otp)[:\s]+(\d{4,8})\b/i
      ) || smsBody.match(
        /\bcode[:\s]+(\d{4,8})\b/i
      ) || (smsBody.trim().match(/^\d{4,8}$/) ? smsBody.trim().match(/^(\d{4,8})$/) : null);

      // Also detect messages that are clearly automated verification (short codes, service numbers)
      const isLikelyAutomated = /^\+?\d{4,6}$/.test(from) || from.length <= 8 || /\b(verify|code|otp|confirm)\b/i.test(smsBody);

      if (verificationCodeMatch?.[1] && isLikelyAutomated) {
        const code = verificationCodeMatch[1];
        logger.info(`[SMS-PREMIUM] Verification code "${code}" intercepted from ${maskPhone(from)} for user ${userId.slice(0, 8)}`);
        try {
          const { storeTfaCode } = await import("./services/tfa.js");
          await storeTfaCode(userId, null, code, "sms");
        } catch { /* non-critical */ }

        // Also resume any task stuck waiting for a verification code
        try {
          const { data: stuckTask } = await supabase
            .from("tasks")
            .select("id, structured_intent")
            .eq("user_id", userId)
            .eq("status", "awaiting_user_input")
            .eq("stuck_reason", "verification_code")
            .order("created_at", { ascending: false })
            .limit(1)
            .single();

          if (stuckTask) {
            await supabase.from("tasks").update({
              status: "processing",
              stuck_reason: null,
              structured_intent: {
                ...(stuckTask.structured_intent as Record<string, unknown> || {}),
                verification_code: code,
              },
            }).eq("id", stuckTask.id);
            logger.info(`[SMS-PREMIUM] Resumed stuck task ${stuckTask.id.slice(0, 8)} with verification code`);
          }
        } catch { /* non-critical */ }

        res.type("text/xml");
        return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
      }
    }

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
        logger.info(`[SMS-PREMIUM] PIN verified for ${maskPhone(from)} -> user ${userId.slice(0, 8)}`);
      }
    }

    // ── STOP/Unsubscribe handling for premium SMS (U004) ──
    const premiumNormalized = smsBody.trim().toLowerCase();
    if (SMS_STOP_KEYWORDS.has(premiumNormalized)) {
      logger.info(`[SMS-PREMIUM] User ${userId.slice(0, 8)} sent STOP keyword — disabling proactive`);
      try {
        await supabase.from('user_settings').upsert({
          user_id: userId,
          proactive_enabled: false,
        }, { onConflict: 'user_id' });
      } catch (err) {
        logger.error('[SMS-PREMIUM] Failed to update proactive setting:', err);
      }
      res.type("text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Got it. Aurora will stop reaching out. Text START anytime to resume.</Message>
</Response>`);
    }

    if (SMS_START_KEYWORDS.has(premiumNormalized)) {
      logger.info(`[SMS-PREMIUM] User ${userId.slice(0, 8)} sent START keyword — enabling proactive`);
      try {
        await supabase.from('user_settings').upsert({
          user_id: userId,
          proactive_enabled: true,
        }, { onConflict: 'user_id' });
      } catch (err) {
        logger.error('[SMS-PREMIUM] Failed to update proactive setting:', err);
      }
      res.type("text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Welcome back! Aurora will now proactively reach out when there's something useful to share.</Message>
</Response>`);
    }

    // ── Commitment completion via SMS (U040) ──
    if (/^(done|completed)\b/i.test(premiumNormalized)) {
      try {
        const { data: pendingCommitment } = await supabase
          .from('commitments')
          .select('id, description')
          .eq('user_id', userId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (pendingCommitment) {
          await supabase.from('commitments').update({
            status: 'completed',
            completed_at: new Date().toISOString(),
          }).eq('id', pendingCommitment.id);

          logger.info(`[SMS-PREMIUM] User ${userId.slice(0, 8)} completed commitment: ${pendingCommitment.description.slice(0, 50)}`);
          res.type("text/xml");
          return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Marked as done: ${pendingCommitment.description.substring(0, 140)}</Message>
</Response>`);
        }
      } catch {
        // No pending commitment found — fall through to normal processing
      }
    }

    // Process as task — use the SMS body as subject (not "[SMS Premium]" which confuses the AI
    // into searching for "SMS Premium" as a topic)
    await processTaskV3({
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
    logger.error("[SMS-PREMIUM] Error:", error);
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Oops, something went wrong. Please try again.</Message>
</Response>`);
  }
});

// ---- Telegram Webhook ----

app.post("/webhook/telegram", twilioLimiter, async (req, res) => {
  // Validate Telegram webhook secret header
  const { verifyTelegramWebhookSecret, sendTelegramMessage } = await import("./services/telegram.js");
  const headerSecret = req.headers["x-telegram-bot-api-secret-token"] as string || "";
  if (!verifyTelegramWebhookSecret(headerSecret)) {
    logger.warn("[TELEGRAM] Invalid webhook secret");
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

    // Handle /start {code} — link Telegram account to Aurora user
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
          await sendTelegramMessage(chatId, "✅ Connected! Your Aurora AI is now available on Telegram. Send me any message to get started.");
        } else {
          await sendTelegramMessage(chatId, "❌ That link code is invalid or expired. Please get a new code from your Aurora dashboard.");
        }
        return;
      }
    }

    // Resolve Aurora user by telegram_chat_id
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, username, email, phone")
      .eq("telegram_chat_id", chatId)
      .single();

    if (!profile) {
      await sendTelegramMessage(chatId, "👋 I don't recognize this account. Please connect your Telegram from your Aurora dashboard at aevoy.com");
      return;
    }

    // Track inbound Telegram message for audit trail
    trackServiceCost(profile.id, 'telegram', 'telegram_inbound', 0.0001, 'telegram_inbound').catch(() => {});

    // Determine message body (text or transcribed voice note)
    let body = text;

    if (voice && !text) {
      await sendTelegramMessage(chatId, "I can't process voice notes yet — please type your message as text and I'll help you right away!");
      return;
    }

    if (!body.trim()) return;

    // Handle "call me" shortcut
    const CALL_ME = /^(call me|call my phone|ring me)\b/i;
    if (CALL_ME.test(body.trim())) {
      if (profile.phone) {
        const { callUser } = await import("./services/twilio.js");
        await callUser({ userId: profile.id, to: profile.phone, message: "Calling you now from your Aurora AI assistant." });
        await sendTelegramMessage(chatId, "📞 Calling you now on " + profile.phone.replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3") + "...");
      } else {
        await sendTelegramMessage(chatId, "⚠️ No phone number registered. Add one in your Aurora settings to enable calling.");
      }
      return;
    }

    // Process as normal task
    activeTasks++;
    processTaskV3({
      userId: profile.id,
      username: profile.username,
      from: chatId,
      subject: "[Telegram]",
      body,
      inputChannel: "telegram",
    })
      .catch((err: unknown) => logger.error({ err }, 'Task processing failed'))
      .finally(() => { activeTasks--; });

  } catch (err) {
    logger.error("[TELEGRAM] Webhook error:", err);
  }
});

// ---- WhatsApp Webhook (Twilio) ----

app.post("/webhook/whatsapp", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const rawFrom = req.body.From || ""; // "whatsapp:+1234567890"
  const message = (req.body.Body || "").trim();

  // Strip "whatsapp:" prefix to get E.164 phone number
  const fromPhone = rawFrom.replace(/^whatsapp:/i, "");

  logger.info(`[WHATSAPP] Incoming from ${maskPhone(fromPhone)}: "${message.slice(0, 50)}"`);

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
            "x-whatsapp-link-secret": process.env.WHATSAPP_WEBHOOK_SECRET || process.env.TELEGRAM_WEBHOOK_SECRET || "",
          },
          body: JSON.stringify({ code, phone: fromPhone }),
        });

        if (linkRes.ok) {
          await sendWhatsAppMessage(fromPhone,
            "✅ Your WhatsApp is now linked to your Aurora account!\n\nSend me any message to get started. Try: \"What can you do?\" or \"call me\"");
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
        "👋 Hi! To use Aurora AI on WhatsApp:\n\n1. Sign up at aevoy.com\n2. Go to Connected Apps\n3. Scan the WhatsApp QR code\n\nTakes 30 seconds!");
      return;
    }

    // Track inbound WhatsApp cost
    trackServiceCost(profile.id, 'twilio', 'whatsapp_inbound', 0.005, 'whatsapp_inbound', undefined, 1.5).catch(() => {});

    // ── STEP 3: Handle built-in shortcuts ──
    const CALL_ME = /^(call me|call my phone|ring me)\b/i;
    if (CALL_ME.test(message)) {
      const callTo = profile.phone || fromPhone;
      if (callTo) {
        const { callUser } = await import("./services/twilio.js");
        await callUser({ userId: profile.id, to: callTo, message: "Calling you now from your Aurora AI." });
        await sendWhatsAppMessage(fromPhone, "📞 Calling you now...");
      } else {
        await sendWhatsAppMessage(fromPhone, "⚠️ No phone number on file. Add one in Settings to enable calling.");
      }
      return;
    }

    // ── STEP 4: Process as AI task ──
    activeTasks++;
    processTaskV3({
      userId: profile.id,
      username: profile.username,
      from: fromPhone,
      subject: "[WhatsApp]",
      body: message,
      inputChannel: "whatsapp",
    })
      .catch((err: unknown) => logger.error({ err }, 'Task processing failed'))
      .finally(() => { activeTasks--; });

  } catch (err) {
    logger.error("[WHATSAPP] Webhook error:", err);
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

  logger.info(`[CHECKIN] ${callType} call webhook for user ${userId.slice(0, 8)}`);

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

      greeting = greeting.substring(0, 120);
      logger.info(`[VOICE-CHECKIN] ConversationRelay for ${userId.slice(0, 8)}: voice=${elevenlabsVoice}`);
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay url="${wsUrl}" ttsProvider="ElevenLabs" voice="${elevenlabsVoice}" transcriptionProvider="Deepgram" dtmfDetection="true" interruptible="false" welcomeGreeting="${escapeXml(greeting)}">
      <Parameter name="userId" value="${userId}" />
      <Parameter name="callType" value="${checkinCallType}" />
    </ConversationRelay>
  </Connect>
  <Say voice="Polly.Joanna-Neural">Sorry, I lost our connection. Please call back and we'll pick up where we left off.</Say>
  <Hangup/>
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
  <Hangup/>
</Response>`);
  } catch (error) {
    logger.error("[CHECKIN] Webhook error:", error);
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

  logger.info(`[CHECKIN] Response from ${userId.slice(0, 8)}: "${transcription.slice(0, 50)}..."`);

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

      await processTaskV3({
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
    logger.error("[CHECKIN] Response handler error:", error);
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

  logger.info(`[ONBOARDING] Interview call initiated for user ${maskUserId(userId)}`);

  try {
    const { handleInterviewCall } = await import("./services/onboarding-interview.js");
    const twiml = await handleInterviewCall({ userId, from, to, callSid });
    res.type("text/xml");
    res.send(twiml);
  } catch (error) {
    logger.error("[ONBOARDING] Interview call error:", error);
    const { generateErrorTwiml } = await import("./services/onboarding-interview.js");
    res.type("text/xml");
    res.send(generateErrorTwiml("Sorry, we couldn't start your interview. Please try again from the dashboard."));
  }
});

app.post("/webhook/interview-call/response/:userId", twilioLimiter, validateTwilioSignature, async (req, res) => {
  const userId = req.params.userId;
  const transcription = req.body.SpeechResult || req.body.TranscriptionText || "";
  const questionIndex = parseInt(req.query.question as string || "0");

  logger.info(`[ONBOARDING] Interview response from ${maskUserId(userId)}, Q${questionIndex}: "${transcription.slice(0, 50)}..."`);

  try {
    const { processInterviewResponse } = await import("./services/onboarding-interview.js");
    const twiml = await processInterviewResponse(userId, questionIndex, transcription);
    res.type("text/xml");
    res.send(twiml);
  } catch (error) {
    logger.error("[ONBOARDING] Interview response error:", error);
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

  logger.info(`[PHONE-VERIFY] Initiating verification call to ${maskPhone(phone)} for user ${maskUserId(userId)}`);

  try {
    const config = getTwilioConfig();
    if (!config) {
      return res.status(503).json({ error: "Service temporarily unavailable" });
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
      logger.error(`[PHONE-VERIFY] Twilio error: ${errorData}`);
      return res.status(502).json({ error: "Failed to initiate call" });
    }

    const callData = await response.json() as { sid: string };
    logger.info(`[PHONE-VERIFY] Call initiated: ${callData.sid}`);

    res.json({ success: true, callSid: callData.sid });
  } catch (error) {
    logger.error("[PHONE-VERIFY] Error:", error);
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

  logger.info(`[PHONE-VERIFY] Playing gather prompt for user ${maskUserId(userId)}`);

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">
    Hi! This is Aurora verifying your phone number. 
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

  logger.info(`[PHONE-VERIFY] User ${maskUserId(userId)} pressed: ${digit}`);

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

      logger.info(`[PHONE-VERIFY] Phone verified for user ${maskUserId(userId)}`);

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

      logger.info(`[PHONE-VERIFY] Verification cancelled by user ${maskUserId(userId)}`);

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

      logger.info(`[PHONE-VERIFY] Verification timeout for user ${maskUserId(userId)}`);

      res.type("text/xml");
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">No response received. Please try again. Goodbye!</Say>
  <Hangup/>
</Response>`);
    }
  } catch (error) {
    logger.error("[PHONE-VERIFY] Error handling confirmation:", error);
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">Sorry, something went wrong. Please try again later. Goodbye!</Say>
  <Hangup/>
</Response>`);
  }
});

// ---- Call Cost Tracking (StatusCallback) ----

// POST /webhook/voice/call-end — Twilio StatusCallback for completed calls
// Receives actual call duration and calculates real cost (replaces hardcoded estimate)
app.post('/webhook/voice/call-end', validateTwilioSignature, async (req, res) => {
  res.sendStatus(204); // Respond immediately — Twilio doesn't need a response body

  const { CallSid, CallDuration, Direction, CallStatus, To, From } = req.body;
  if (CallStatus !== 'completed' || !CallDuration) return;

  const durationSeconds = parseInt(CallDuration, 10);
  if (isNaN(durationSeconds) || durationSeconds <= 0) return;

  logger.info(`[CALL-END] CallSid=${CallSid} Duration=${durationSeconds}s Direction=${Direction}`);

  try {
    const supabase = getSupabaseClient();

    // Try to find user from their dedicated Twilio number
    const phoneToSearch = Direction?.includes('inbound') ? To : From;
    const { data: numberRecord } = await supabase
      .from('user_twilio_numbers')
      .select('user_id')
      .eq('phone_number', phoneToSearch)
      .single();

    let userId = numberRecord?.user_id;

    // Fallback: if not found in user_twilio_numbers, check call_history for this CallSid
    if (!userId && CallSid) {
      const { data: callRecord } = await supabase
        .from('call_history')
        .select('user_id')
        .eq('call_sid', CallSid)
        .not('user_id', 'is', null)
        .single();
      if (callRecord?.user_id) {
        userId = callRecord.user_id;
        logger.info(`[CALL-END] Found user via call_history: ${maskUserId(userId)}`);
      }
    }

    if (!userId) {
      // Demo/platform call — log as platform cost (no user to bill)
      logger.info(`[CALL-END] No user found for phone ${maskPhone(phoneToSearch)} — demo/platform call (${durationSeconds}s, unbilled)`);
      return;
    }

    // Calculate real cost based on actual duration (raw cost, no markup)
    const { calculateVoiceCost, VOICE_MARKUP: voiceMarkup } = await import('./utils/cost-calculator.js');
    const direction: 'inbound' | 'outbound' = Direction?.includes('inbound') ? 'inbound' : 'outbound';
    const realCost = calculateVoiceCost(durationSeconds, direction);

    // Dedup: prevent double-billing if Twilio retries the StatusCallback
    const { data: existingLog } = await supabase
      .from('ai_cost_log')
      .select('id')
      .eq('provider', 'twilio')
      .eq('purpose', `voice_${direction}`)
      .eq('user_id', userId)
      .gte('created_at', new Date(Date.now() - 60000).toISOString()) // within last 60s
      .limit(1);

    if (existingLog && existingLog.length > 0) {
      logger.info(`[CALL-END] Dedup: cost already logged for ${direction} call within 60s for user ${maskUserId(userId)}`);
      return;
    }

    // Log the actual cost with VOICE_MARKUP (1.5×) on top of base 1.296× = 1.944× total
    await trackServiceCost(userId, 'twilio', `voice_${direction}_actual`, realCost, `voice_${direction}`, undefined, voiceMarkup);

    logger.info(`[CALL-END] Logged real cost $${(realCost * 1.944).toFixed(4)} (billed) for ${durationSeconds}s ${direction} call (user ${maskUserId(userId)})`);
  } catch (err) {
    logger.error('[CALL-END] Failed to log call cost:', err);
  }
});

// POST /webhook/voice/amd-status — AMD (Answering Machine Detection) result callback
app.post('/webhook/voice/amd-status', validateTwilioSignature, async (req, res) => {
  res.sendStatus(204);
  const { CallSid, AnsweredBy } = req.body;
  logger.info(`[AMD] CallSid=${CallSid} AnsweredBy=${AnsweredBy}`);
  if (AnsweredBy && AnsweredBy.startsWith('machine')) {
    try {
      const { triggerAmdHangup } = await import('./services/voice-conversation.js');
      triggerAmdHangup(CallSid, AnsweredBy);
    } catch (err) {
      logger.error('[AMD] Failed to trigger hangup:', err);
    }
  }
});

// ---- Skill System Routes ----

app.use("/skills", skillRoutes);

// ---- Error Handler ----

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error("Unhandled error:", err);
  res.status(500).json({ error: "internal_error", message: "An unexpected error occurred" });
});

// ---- Process Crash Handlers ----

process.on("uncaughtException", (err) => {
  logger.error("[FATAL] Uncaught exception:", err);
  // Give time for logs to flush, then exit
  setTimeout(() => process.exit(1), 1000);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("[FATAL] Unhandled rejection:", reason);
  if (reason instanceof Error && reason.stack) {
    logger.error("[FATAL] Stack:", reason.stack);
  }
  // Exit so Railway restarts the process — a hanging process is worse than a restart
  setTimeout(() => process.exit(1), 1000);
});

process.on("SIGTERM", async () => {
  logger.info("[SHUTDOWN] SIGTERM received — cleaning up in-flight tasks before exit...");
  try {
    await getSupabaseClient()
      .from('tasks')
      .update({
        status: 'needs_review',
        completed_at: new Date().toISOString(),
        response_text: 'The service was restarted while processing this task. Please try again and I\'ll pick up right where we left off!',
      })
      .eq('status', 'processing');
    logger.info(`[SHUTDOWN] Marked in-flight tasks as needs_review`);
  } catch (e) {
    logger.error("[SHUTDOWN] Failed to clean up tasks:", e);
  }
  setTimeout(() => process.exit(0), 1500);
});

process.on("SIGINT", () => {
  logger.info("[SHUTDOWN] SIGINT received, shutting down...");
  process.exit(0);
});

// ---- Aurora Communication Endpoints ----

// POST /aurora/settings — update user communication settings
app.post('/aurora/settings', taskLimiter, async (req, res) => {
  const secret = req.headers["x-webhook-secret"];
  if (!verifyWebhookSecret(secret as string)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  try {
    const { userId, ...settingsUpdate } = req.body as {
      userId: string;
      daily_spend_cap_cents?: number;
      proactive_channel?: string;
      proactive_enabled?: boolean;
      quiet_hours_start?: number;
      quiet_hours_end?: number;
    };

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    // Whitelist allowed fields to prevent injection
    const allowedFields: Record<string, unknown> = {};
    if (settingsUpdate.daily_spend_cap_cents !== undefined) {
      allowedFields.daily_spend_cap_cents = Math.max(0, Math.min(10000, settingsUpdate.daily_spend_cap_cents));
    }
    if (settingsUpdate.proactive_channel !== undefined) {
      const validChannels = ['sms', 'voice', 'whatsapp', 'email', 'telegram', 'in_app'];
      if (validChannels.includes(settingsUpdate.proactive_channel)) {
        allowedFields.proactive_channel = settingsUpdate.proactive_channel;
      }
    }
    if (settingsUpdate.proactive_enabled !== undefined) {
      allowedFields.proactive_enabled = !!settingsUpdate.proactive_enabled;
    }
    if (settingsUpdate.quiet_hours_start !== undefined) {
      allowedFields.quiet_hours_start = Math.max(0, Math.min(23, settingsUpdate.quiet_hours_start));
    }
    if (settingsUpdate.quiet_hours_end !== undefined) {
      allowedFields.quiet_hours_end = Math.max(0, Math.min(23, settingsUpdate.quiet_hours_end));
    }

    if (Object.keys(allowedFields).length === 0) {
      return res.status(400).json({ error: "No valid settings provided" });
    }

    const { data, error } = await getSupabaseClient()
      .from('user_settings')
      .upsert({ user_id: userId, ...allowedFields }, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) {
      console.error('[AURORA-SETTINGS] Update error:', error);
      return res.status(500).json({ error: "Failed to update settings" });
    }

    res.json({ success: true, settings: data });
  } catch (err) {
    console.error('[AURORA-SETTINGS] Error:', err);
    res.status(500).json({ error: "Internal error" });
  }
});

// GET /aurora/feed/:userId — get user's activity feed (conversation_context + proactive_queue)
// Supports pagination: ?limit=50&offset=0
// Returns: { feed: [...], total: number, hasMore: boolean }
function stripHtml(text: string): string {
  return text ? text.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, '') : '';
}

app.get('/aurora/feed/:userId', async (req, res) => {
  const secret = req.headers["x-webhook-secret"];
  if (!verifyWebhookSecret(secret as string)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  try {
    const { userId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

    // Get total counts first for proper pagination metadata
    const [contextCountResult, queueCountResult] = await Promise.all([
      getSupabaseClient()
        .from('conversation_context')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId),
      getSupabaseClient()
        .from('proactive_queue')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId),
    ]);

    const totalCount = (contextCountResult.count || 0) + (queueCountResult.count || 0);

    // Fetch conversation context (in-app messages)
    // Over-fetch by limit to ensure we have enough after merging
    const fetchLimit = limit + 1; // +1 to detect hasMore
    const { data: contextItems, error: contextError } = await getSupabaseClient()
      .from('conversation_context')
      .select('id, role, content, source, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + fetchLimit - 1);

    if (contextError) {
      console.error('[AURORA-FEED] Context query error:', contextError);
    }

    // Fetch proactive queue items (pending + completed)
    const { data: queueItems, error: queueError } = await getSupabaseClient()
      .from('proactive_queue')
      .select('id, type, priority, content, status, trigger_at, delivered_at, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + fetchLimit - 1);

    if (queueError) {
      console.error('[AURORA-FEED] Queue query error:', queueError);
    }

    // Combine and sort by timestamp
    interface FeedItem {
      id: string;
      type: 'context' | 'proactive';
      content: string;
      source: string;
      status?: string;
      priority?: string;
      timestamp: string;
    }

    const feed: FeedItem[] = [];

    for (const item of (contextItems || [])) {
      feed.push({
        id: item.id,
        type: 'context',
        content: stripHtml(item.content),
        source: item.source || item.role,
        timestamp: item.created_at,
      });
    }

    for (const item of (queueItems || [])) {
      feed.push({
        id: item.id,
        type: 'proactive',
        content: stripHtml(item.content),
        source: item.type,
        status: item.status,
        priority: item.priority,
        timestamp: item.created_at,
      });
    }

    // Sort combined feed by timestamp descending
    feed.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Apply limit to combined results (take only `limit`, not fetchLimit)
    const paginatedFeed = feed.slice(0, limit);
    const hasMore = feed.length > limit || (offset + limit) < totalCount;

    res.json({ feed: paginatedFeed, total: totalCount, hasMore });
  } catch (err) {
    console.error('[AURORA-FEED] Error:', err);
    res.status(500).json({ error: "Internal error" });
  }
});

// POST /aurora/onboard — Trigger onboarding call to new user
// Enhanced: AMD voicemail detection, retry scheduling, SMS fallback after 2 failures
app.post('/aurora/onboard', taskLimiter, async (req, res) => {
  const secret = req.headers['x-webhook-secret'];
  if (!verifyWebhookSecret(secret as string)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }

  try {
    // Get user profile
    const { data: profile } = await getSupabaseClient()
      .from('profiles')
      .select('phone_number, display_name, username')
      .eq('id', userId)
      .single();

    if (!profile?.phone_number) {
      return res.status(400).json({ error: 'User has no phone number' });
    }

    // Check onboarding attempt count from user_settings
    const { data: settings } = await getSupabaseClient()
      .from('user_settings')
      .select('onboarding_call_attempts, onboarding_call_status')
      .eq('user_id', userId)
      .single();

    const attempts = settings?.onboarding_call_attempts || 0;
    const status = settings?.onboarding_call_status || 'pending';

    // If already completed or already fell back to SMS, don't call again
    if (status === 'completed' || status === 'sms_fallback') {
      return res.json({ status, message: 'Onboarding already handled' });
    }

    // After 2 failed call attempts, fall back to text-based onboarding via SMS
    if (attempts >= 2) {
      const { sendSms } = await import('./services/twilio.js');
      await sendSms({
        userId,
        to: profile.phone_number,
        body: "Hey, I tried calling twice but couldn't reach you. No worries — text me what's on your plate this week and I'll get to work. I'm Aurora, your new AI assistant.",
      });

      // Update status to sms_fallback
      await getSupabaseClient()
        .from('user_settings')
        .upsert({
          user_id: userId,
          onboarding_call_status: 'sms_fallback',
          onboarding_call_attempts: attempts,
        }, { onConflict: 'user_id' });

      return res.json({ status: 'sms_fallback', attempts, message: 'Fell back to SMS after 2 failed calls' });
    }

    // Initiate outbound call via Twilio
    const { callUser, sendSms } = await import('./services/twilio.js');

    const displayName = profile.display_name || profile.username || 'there';
    const callResult = await callUser({
      userId,
      to: profile.phone_number,
      message: `Hey ${displayName}, this is Aurora. I'm about to become the most useful thing in your life, but right now I know absolutely nothing about you. What's stressing you out this week?`,
    });

    // Increment attempt counter
    const newAttempts = attempts + 1;
    await getSupabaseClient()
      .from('user_settings')
      .upsert({
        user_id: userId,
        onboarding_call_attempts: newAttempts,
        onboarding_call_status: callResult.success ? 'calling' : 'failed',
      }, { onConflict: 'user_id' });

    // If call fails immediately (no Twilio number, international, etc.), send SMS fallback
    if (!callResult.success) {
      // If this was attempt 2, fall back to SMS
      if (newAttempts >= 2) {
        await sendSms({
          userId,
          to: profile.phone_number,
          body: "I tried calling but couldn't reach you. Text me what's on your plate this week and I'll get to work.",
        });
        await getSupabaseClient()
          .from('user_settings')
          .update({ onboarding_call_status: 'sms_fallback' })
          .eq('user_id', userId);
        return res.json({ status: 'sms_fallback', attempts: newAttempts });
      }

      // Schedule retry in 1 hour via scheduled_tasks
      const retryAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await getSupabaseClient()
        .from('scheduled_tasks')
        .insert({
          user_id: userId,
          task_type: 'onboarding_call_retry',
          cron_expression: null,
          next_run_at: retryAt,
          timezone: 'UTC',
          payload: { userId, attempt: newAttempts },
          status: 'active',
        });

      return res.json({ status: 'retry_scheduled', attempts: newAttempts, retryAt });
    }

    // Call was placed successfully — AMD callback will handle voicemail detection
    // Store the callSid so the AMD webhook can match it to this onboarding call
    if (callResult.callSid) {
      await getSupabaseClient()
        .from('user_settings')
        .update({ onboarding_call_sid: callResult.callSid })
        .eq('user_id', userId);
    }

    res.json({ status: 'calling', callSid: callResult.callSid, attempts: newAttempts });
  } catch (err) {
    logger.error({ err, userId }, 'Onboarding call failed');
    res.status(500).json({ error: 'Failed to initiate onboarding' });
  }
});

// POST /aurora/onboard/amd — Called by AMD webhook when onboarding call hits voicemail
// The existing /webhook/voice/amd-status handles generic AMD. This supplements it
// specifically for onboarding calls: hang up + schedule retry.
app.post('/aurora/onboard/amd', taskLimiter, async (req, res) => {
  const { callSid, answeredBy, userId } = req.body;
  res.sendStatus(204);

  if (!callSid || !answeredBy || !userId) return;

  // Only act on machine/voicemail detections
  if (!answeredBy.startsWith('machine')) return;

  logger.info({ callSid, answeredBy, userId }, 'Onboarding call hit voicemail — scheduling retry');

  try {
    // Get current attempts
    const { data: settings } = await getSupabaseClient()
      .from('user_settings')
      .select('onboarding_call_attempts')
      .eq('user_id', userId)
      .single();

    const attempts = settings?.onboarding_call_attempts || 1;

    if (attempts >= 2) {
      // Fall back to SMS
      const { data: profile } = await getSupabaseClient()
        .from('profiles')
        .select('phone_number')
        .eq('id', userId)
        .single();

      if (profile?.phone_number) {
        const { sendSms } = await import('./services/twilio.js');
        await sendSms({
          userId,
          to: profile.phone_number,
          body: "Hey, I tried calling twice but got your voicemail. Text me what's on your plate this week and I'll get to work. I'm Aurora.",
        });
      }

      await getSupabaseClient()
        .from('user_settings')
        .update({ onboarding_call_status: 'sms_fallback' })
        .eq('user_id', userId);
    } else {
      // Schedule retry in 1 hour
      const retryAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await getSupabaseClient()
        .from('scheduled_tasks')
        .insert({
          user_id: userId,
          task_type: 'onboarding_call_retry',
          cron_expression: null,
          next_run_at: retryAt,
          timezone: 'UTC',
          payload: { userId, attempt: attempts },
          status: 'active',
        });

      await getSupabaseClient()
        .from('user_settings')
        .update({ onboarding_call_status: 'voicemail_retry_scheduled' })
        .eq('user_id', userId);

      logger.info({ userId, retryAt }, 'Onboarding retry scheduled after voicemail');
    }
  } catch (err) {
    logger.error({ err, userId }, 'Onboarding AMD handler failed');
  }
});

// POST /aurora/error — Frontend error reporting endpoint
app.post('/aurora/error', taskLimiter, async (req, res) => {
  const { error, context, userId } = req.body;
  logger.error({ userId: userId?.slice?.(0, 8), error, context }, 'Frontend error reported');
  res.json({ received: true });
});

// ---- Start Server ----

const server = createServer(app);

// WebSocket server for ConversationRelay voice calls
const wss = new WebSocketServer({ noServer: true });

// WebSocket server for browser takeover
const takeoverWss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url!, `http://${request.headers.host}`);
  if (url.pathname === "/ws/voice") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else if (url.pathname.startsWith("/ws/browser/")) {
    const taskId = url.pathname.split("/ws/browser/")[1];
    const token = url.searchParams.get("token");
    if (!taskId || !token) {
      socket.destroy();
      return;
    }
    takeoverWss.handleUpgrade(request, socket, head, async (ws) => {
      try {
        // Browser takeover removed (Aurora doesn't use browser automation)
        ws.close(4404, "Browser takeover not available");
      } catch (err) {
        logger.error("[TAKEOVER-WS] Handler error:", err);
        ws.close(4500, "Internal error");
      }
    });
  } else if (url.pathname === '/aurora/listen/ws') {
    // Handled by setupListenWebSocket — don't destroy
    return;
  } else {
    socket.destroy();
  }
});

wss.on("connection", (ws, request) => {
  handleVoiceWebSocket(ws, request);
});

// Deepgram listening proxy — browser mic → transcription → context extraction
setupListenWebSocket(server);

server.listen(PORT, async () => {
  logger.info(`Agent server v2.0 running on port ${PORT}`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
  logger.info(`WebSocket: ws://localhost:${PORT}/ws/voice`);
  logger.info(`ConversationRelay: ${USE_CONVERSATION_RELAY ? "ENABLED" : "DISABLED (legacy TwiML)"}`);
  logger.info(`[DEPLOY-VERIFY] Voice pipeline v18 — ElevenLabs Sarah, bare voice IDs, TwiML fallback`);

  // START HEALTH SYSTEM (The Final Boss - Never Fails)
  try {
    const { healthSystem } = await import("./services/health-system.js");
    // Run startup validation FIRST — logs all issues loudly
    await healthSystem.runStartupValidation();
    healthSystem.startMonitoring();
    logger.info(`[HEALTH] ✅ Never-fail health system started (30s monitoring)`);
  } catch (e) {
    logger.error(`[HEALTH] Failed to start health system:`, e);
  }

  // START TASK WATCHDOG (Gracefully resolve stuck tasks — users NEVER see "failed")
  // Runs immediately on startup (catches Railway-restart orphans) then every 5 min.
  const runTaskWatchdog = async () => {
    try {
      // Use updated_at (not started_at) so Railway-restart-killed tasks are caught quickly.
      // 50 min: processor master timeout is 40min, vision agent heartbeats every 10 steps.
      // Tasks that are genuinely running keep updating updated_at via heartbeats.
      // Only truly dead tasks (Railway restart, OOM) go 50+ min without an update.
      // 10 min threshold: V3 tasks update progress every iteration (~5-15s each).
      // Any task stuck for 10+ min without an update was killed by a deploy/crash.
      const stuckThreshold = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: stuckTasks } = await getSupabaseClient()
        .from('tasks')
        .select('id, email_subject, input_channel, user_id')
        .eq('status', 'processing')
        .lt('updated_at', stuckThreshold);

      if (stuckTasks && stuckTasks.length > 0) {
        logger.info(`[WATCHDOG] Found ${stuckTasks.length} stuck task(s) (no update >10 min) — resolving gracefully...`);

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
            logger.info(`[WATCHDOG] Gracefully resolved task ${task.id} (channel: ${channel})`);

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
                  const agentFrom = `${profile.username || 'Aurora'}@aevoy.com`;
                  await sendResponse({
                    to: profile.email,
                    from: agentFrom,
                    subject: task.email_subject || 'Your task',
                    body: gracefulResponse,
                  });
                  logger.info(`[WATCHDOG] Sent recovery email to ${maskEmail(profile.email)}`);
                }
              } catch (emailErr) {
                logger.warn('[WATCHDOG] Could not send recovery email:', emailErr);
              }
            }
          }
        }

        logger.info(`[WATCHDOG] Resolved ${stuckTasks.length} stuck task(s)`);
      }
      recordSchedulerRun('watchdog');
    } catch (e) {
      logger.error('[WATCHDOG] Error in task watchdog:', e);
    }
  };

  // Run immediately on startup to catch tasks from previous server instance
  runTaskWatchdog();
  setInterval(runTaskWatchdog, 5 * 60 * 1000); // Then every 5 minutes
  logger.info('[WATCHDOG] ✅ Task watchdog started (immediate + 5min interval, 50min updated_at threshold, graceful recovery + email notify)');

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
            logger.info(`[WEBHOOK-HEALER] Repairing ${maskPhone(num.phone_number)}: ${data.voice_url} → ${expectedVoice}`);

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
            logger.info(`[WEBHOOK-HEALER] ✅ Fixed ${maskPhone(num.phone_number)}`);
          }
        } catch (err) {
          logger.error(`[WEBHOOK-HEALER] Error checking ${maskPhone(num.phone_number)}:`, err);
        }
      }
      recordSchedulerRun('webhook_healer');
    } catch (e) {
      logger.error('[WEBHOOK-HEALER] Error:', e);
    }
  };

  // Run on startup + every 30 minutes
  validateAndRepairWebhooks();
  setInterval(validateAndRepairWebhooks, 30 * 60 * 1000);
  logger.info('[WEBHOOK-HEALER] ✅ Webhook self-healer started (30min interval)');

  startScheduler();
  startInboxManager(); // Start AI inbox management (checks user inboxes every 5 min)
  startReconciliationScheduler(); // Daily billing reconciliation (Anthropic Admin API)
  // startInboxPoller(); // Disabled: Using Cloudflare Email Routing instead

  // Wire scheduler health tracking via shared heartbeat module
  try {
    const { schedulerHeartbeat } = await import("./utils/scheduler-heartbeat.js");
    schedulerHeartbeat.onBeat = (name: string) => { recordSchedulerRun(name); };
  } catch {
    logger.warn('[HEALTH] Could not wire scheduler heartbeat — health check will show never_ran');
  }

  // Seed default skills (idempotent)
  try {
    const { seedDefaultSkills } = await import("./services/skill-registry.js");
    await seedDefaultSkills();
  } catch {
    // Non-critical — skills will be seeded on next restart
  }
});

// 1773093487
// API key swap Thu Mar 19 16:32:34 UTC 2026
// key revert Thu Mar 19 16:43:36 UTC 2026
