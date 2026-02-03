import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
import express from "express";
import cors from "cors";
import { processTask, processIncomingTask, handleConfirmationReply, handleVerificationCodeReply } from "./services/processor.js";
import { startScheduler } from "./services/scheduler.js";
import { handleIncomingSms, handleIncomingVoice, processVoiceCommand } from "./services/twilio.js";
import type { TaskRequest } from "./types/index.js";

import crypto from "crypto";

const app = express();
const PORT = process.env.AGENT_PORT || 3001;
const WEBHOOK_SECRET = process.env.AGENT_WEBHOOK_SECRET;

// Middleware — restrict CORS to known origins
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "https://aevoy.com,https://www.aevoy.com,http://localhost:3000").split(",");
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, curl)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
}));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true })); // For Twilio webhooks

// Timing-safe webhook secret comparison
function verifyWebhookSecret(provided: string | null | undefined): boolean {
  if (!provided || !WEBHOOK_SECRET) return false;
  if (provided.length !== WEBHOOK_SECRET.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(WEBHOOK_SECRET));
}

// Twilio signature validation middleware
function validateTwilioSignature(req: express.Request, res: express.Response, next: express.NextFunction): void {
  // Skip validation in test mode
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
    const twilio = require("twilio");
    const url = `${process.env.AGENT_URL || "http://localhost:3001"}${req.originalUrl}`;
    const isValid = twilio.validateRequest(
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
    // If twilio module not available, reject in production
    if (process.env.NODE_ENV === "production") {
      res.status(500).json({ error: "Twilio validation unavailable" });
      return;
    }
  }

  next();
}

// Health check
app.get("/health", (_req, res) => {
  res.json({
    status: "healthy",
    version: "2.0.0",
    timestamp: new Date().toISOString(),
  });
});

// ---- Task Endpoints ----

// Legacy task endpoint - direct processing
app.post("/task", async (req, res) => {
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

  processTask(task)
    .then((result) => {
      console.log(`Task completed: ${result.taskId}`, { success: result.success, actionsExecuted: result.actions.length });
    })
    .catch((error) => console.error("Task processing failed:", error));
});

// New incoming task endpoint - with confirmation flow
app.post("/task/incoming", async (req, res) => {
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

  processIncomingTask(task)
    .then((result) => {
      console.log(`Incoming task processed: ${result.taskId}`, { success: result.success });
    })
    .catch((error) => console.error("Incoming task processing failed:", error));
});

// Confirmation reply endpoint
app.post("/task/confirm", async (req, res) => {
  const secret = req.headers["x-webhook-secret"];
  if (!verifyWebhookSecret(secret as string)) {
    return res.status(401).json({ error: "unauthorized", message: "Invalid webhook secret" });
  }

  const { userId, username, from, taskId, replyText } = req.body;
  if (!userId || !username || !from || !taskId || !replyText) {
    return res.status(400).json({ error: "bad_request", message: "Missing required fields" });
  }

  res.json({ status: "queued", message: "Confirmation received" });

  handleConfirmationReply(userId, username, from, replyText, taskId)
    .then((result) => console.log(`Confirmation processed: ${taskId}`, { success: result.success }))
    .catch((error) => console.error("Confirmation processing failed:", error));
});

// Verification code reply endpoint
app.post("/task/verification", async (req, res) => {
  const secret = req.headers["x-webhook-secret"];
  if (!verifyWebhookSecret(secret as string)) {
    return res.status(401).json({ error: "unauthorized", message: "Invalid webhook secret" });
  }

  const { userId, username, from, taskId, code } = req.body;
  if (!userId || !username || !from || !taskId || !code) {
    return res.status(400).json({ error: "bad_request", message: "Missing required fields" });
  }

  res.json({ status: "queued", message: "Verification code received" });

  handleVerificationCodeReply(userId, username, from, code, taskId)
    .then((result) => console.log(`Verification processed: ${taskId}`, { success: result.success }))
    .catch((error) => console.error("Verification processing failed:", error));
});

// ---- Twilio Voice Webhooks ----

// Incoming voice call (Twilio signature validated)
app.post("/webhook/voice/:userId", validateTwilioSignature, async (req, res) => {
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

// Process voice command (after speech-to-text, Twilio validated)
app.post("/webhook/voice/process/:userId", validateTwilioSignature, async (req, res) => {
  const userId = req.params.userId;
  const speechResult = req.body.SpeechResult || "";

  console.log(`[TWILIO] Voice command received for user ${userId?.slice(0, 8)}`);

  try {
    const twiml = await processVoiceCommand(userId, speechResult);
    res.type("text/xml");
    res.send(twiml);

    // Process the voice task in background
    if (speechResult.trim()) {
      const { data: profile } = await (await import("@supabase/supabase-js")).createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || "",
        process.env.SUPABASE_SERVICE_ROLE_KEY || ""
      ).from("profiles").select("username, email").eq("id", userId).single();

      if (profile) {
        processIncomingTask({
          userId,
          username: profile.username,
          from: profile.email,
          subject: "Voice Task",
          body: speechResult,
          inputChannel: "voice",
        }).catch(console.error);
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

// ---- Twilio SMS Webhook ----

app.post("/webhook/sms/:userId", validateTwilioSignature, async (req, res) => {
  const from = req.body.From || "";
  const to = req.body.To || "";
  const body = req.body.Body || "";

  console.log(`[TWILIO] Incoming SMS received`);

  try {
    const result = await handleIncomingSms({ from, to, body });

    // Reply with acknowledgment
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

      // Process the SMS task in background (if not a verification code)
      if (!result.isVerificationCode && result.taskId) {
        const { createClient } = await import("@supabase/supabase-js");
        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL || "",
          process.env.SUPABASE_SERVICE_ROLE_KEY || ""
        );
        const { data: profile } = await supabase
          .from("profiles")
          .select("id, username, email")
          .eq("twilio_number", to)
          .single();

        if (profile) {
          processIncomingTask({
            userId: profile.id,
            username: profile.username,
            from: profile.email,
            subject: "SMS Task",
            body,
            taskId: result.taskId,
            inputChannel: "sms",
          }).catch(console.error);
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

app.use((err: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "internal_error", message: "An unexpected error occurred" });
  next();
});

// ---- Start Server ----

app.listen(PORT, () => {
  console.log(`Agent server v2.0 running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);

  // Start the scheduler for recurring tasks
  startScheduler();
});
