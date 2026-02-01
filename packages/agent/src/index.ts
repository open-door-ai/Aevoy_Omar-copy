import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
import express from "express";
import cors from "cors";
import { processTask, processIncomingTask, handleConfirmationReply, handleVerificationCodeReply } from "./services/processor.js";
import { startScheduler } from "./services/scheduler.js";
import type { TaskRequest } from "./types/index.js";

const app = express();
const PORT = process.env.AGENT_PORT || 3001;
const WEBHOOK_SECRET = process.env.AGENT_WEBHOOK_SECRET;

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

// Legacy task endpoint - direct processing (kept for backwards compatibility)
app.post("/task", async (req, res) => {
  // Verify webhook secret
  const secret = req.headers["x-webhook-secret"];
  if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) {
    return res.status(401).json({
      error: "unauthorized",
      message: "Invalid webhook secret",
    });
  }

  const task: TaskRequest = req.body;

  // Validate required fields
  if (!task.userId || !task.username || !task.from || !task.subject) {
    return res.status(400).json({
      error: "bad_request",
      message: "Missing required fields: userId, username, from, subject",
    });
  }

  // Log task received (but not content for privacy)
  console.log(`Task received for user: ${task.username}`, {
    subject: task.subject.substring(0, 50),
    timestamp: new Date().toISOString(),
  });

  // Process task asynchronously
  res.json({
    status: "queued",
    message: "Task received and processing",
  });

  // Process in background
  processTask(task)
    .then((result) => {
      console.log(`Task completed: ${result.taskId}`, {
        success: result.success,
        actionsExecuted: result.actions.length,
      });
    })
    .catch((error) => {
      console.error("Task processing failed:", error);
    });
});

// New incoming task endpoint - with confirmation flow
app.post("/task/incoming", async (req, res) => {
  // Verify webhook secret
  const secret = req.headers["x-webhook-secret"];
  if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) {
    return res.status(401).json({
      error: "unauthorized",
      message: "Invalid webhook secret",
    });
  }

  const task: TaskRequest = req.body;

  // Validate required fields
  if (!task.userId || !task.username || !task.from) {
    return res.status(400).json({
      error: "bad_request",
      message: "Missing required fields: userId, username, from",
    });
  }

  console.log(`Incoming task for user: ${task.username}`, {
    subject: task.subject?.substring(0, 50),
    timestamp: new Date().toISOString(),
  });

  res.json({
    status: "queued",
    message: "Task received and processing",
  });

  // Process with confirmation flow
  processIncomingTask(task)
    .then((result) => {
      console.log(`Incoming task processed: ${result.taskId}`, {
        success: result.success,
        response: result.response?.substring(0, 50),
      });
    })
    .catch((error) => {
      console.error("Incoming task processing failed:", error);
    });
});

// Confirmation reply endpoint
app.post("/task/confirm", async (req, res) => {
  // Verify webhook secret
  const secret = req.headers["x-webhook-secret"];
  if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) {
    return res.status(401).json({
      error: "unauthorized",
      message: "Invalid webhook secret",
    });
  }

  const { userId, username, from, taskId, replyText } = req.body;

  if (!userId || !username || !from || !taskId || !replyText) {
    return res.status(400).json({
      error: "bad_request",
      message: "Missing required fields: userId, username, from, taskId, replyText",
    });
  }

  console.log(`Confirmation reply for task: ${taskId}`, {
    user: username,
    timestamp: new Date().toISOString(),
  });

  res.json({
    status: "queued",
    message: "Confirmation received and processing",
  });

  // Handle confirmation
  handleConfirmationReply(userId, username, from, replyText, taskId)
    .then((result) => {
      console.log(`Confirmation processed: ${taskId}`, {
        success: result.success,
      });
    })
    .catch((error) => {
      console.error("Confirmation processing failed:", error);
    });
});

// Verification code reply endpoint
app.post("/task/verification", async (req, res) => {
  // Verify webhook secret
  const secret = req.headers["x-webhook-secret"];
  if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) {
    return res.status(401).json({
      error: "unauthorized",
      message: "Invalid webhook secret",
    });
  }

  const { userId, username, from, taskId, code } = req.body;

  if (!userId || !username || !from || !taskId || !code) {
    return res.status(400).json({
      error: "bad_request",
      message: "Missing required fields: userId, username, from, taskId, code",
    });
  }

  console.log(`Verification code for task: ${taskId}`, {
    user: username,
    timestamp: new Date().toISOString(),
  });

  res.json({
    status: "queued",
    message: "Verification code received and processing",
  });

  // Handle verification code
  handleVerificationCodeReply(userId, username, from, code, taskId)
    .then((result) => {
      console.log(`Verification processed: ${taskId}`, {
        success: result.success,
      });
    })
    .catch((error) => {
      console.error("Verification processing failed:", error);
    });
});

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: "internal_error",
    message: "An unexpected error occurred",
  });
  next();
});

// Start server
app.listen(PORT, () => {
  console.log(`Agent server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  
  // Start the scheduler for recurring tasks
  startScheduler();
});
