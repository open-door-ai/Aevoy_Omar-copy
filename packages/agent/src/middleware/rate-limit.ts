/**
 * Rate Limiting & DoS Protection Middleware
 *
 * Comprehensive rate limiting to prevent:
 * - Brute force attacks (auth, password reset, PIN verification)
 * - Cost attacks (AI API abuse)
 * - Resource exhaustion (DB connections, file uploads)
 */

import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

// ============================================================================
// CLIENT IP EXTRACTION
// ============================================================================

/**
 * Extract client IP from request (handles proxies correctly)
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const clientIp = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : req.ip;
  return clientIp || 'unknown';
}

// ============================================================================
// RATE LIMITERS
// ============================================================================

/**
 * Global rate limiter: 100 requests per minute per IP
 */
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many requests, slow down' },
});

/**
 * Task rate limiter: 10 tasks per minute per user
 */
export const taskLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.body?.userId || getClientIp(req),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many tasks, please wait' },
  validate: false,
});

/**
 * Auth rate limiter: 5 attempts per 15 minutes per IP
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  keyGenerator: getClientIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'rate_limited',
    message: 'Too many login attempts, please try again in 15 minutes',
  },
  validate: { trustProxy: false },
});

/**
 * Password reset limiter: 3 attempts per hour per IP
 */
export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  keyGenerator: getClientIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'rate_limited',
    message: 'Too many password reset requests, please try again in 1 hour',
  },
  validate: { trustProxy: false },
});

/**
 * Email PIN verification limiter: 10 attempts per 5 minutes per user
 */
export const emailPinLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10,
  keyGenerator: (req) => req.body?.userId || getClientIp(req),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'rate_limited',
    message: 'Too many PIN attempts, please wait 5 minutes',
  },
  validate: false,
});

/**
 * API rate limiter: 60 requests per minute per user
 */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.body?.userId || getClientIp(req),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'API rate limit exceeded' },
  validate: false,
});

/**
 * Twilio webhook limiter: 30 requests per minute per phone number
 */
export const twilioLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.body?.From || getClientIp(req),
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Rate limited',
  validate: false,
});

// ============================================================================
// REQUEST SIZE LIMITS
// ============================================================================

export const REQUEST_SIZE_LIMITS = {
  json: '10mb',      // JSON payload limit
  urlencoded: '10mb', // URL-encoded form limit
  raw: '50mb',       // Raw body limit
  text: '10mb',      // Text limit
} as const;

export const FILE_UPLOAD_LIMIT = 50 * 1024 * 1024; // 50MB

// ============================================================================
// AUTH FAILURE TRACKING (for exponential backoff + CAPTCHA)
// ============================================================================

interface FailureRecord {
  count: number;
  firstFailure: number;
  lastFailure: number;
}

const failureStore = new Map<string, FailureRecord>();

/**
 * Record authentication failure for a user/IP
 */
export function recordAuthFailure(identifier: string): void {
  const existing = failureStore.get(identifier);
  const now = Date.now();

  if (existing) {
    existing.count++;
    existing.lastFailure = now;
  } else {
    failureStore.set(identifier, {
      count: 1,
      firstFailure: now,
      lastFailure: now,
    });
  }

  // Clean up old records (>24 hours)
  for (const [key, record] of failureStore.entries()) {
    if (now - record.lastFailure > 24 * 60 * 60 * 1000) {
      failureStore.delete(key);
    }
  }
}

/**
 * Reset auth failures for a user/IP (after successful login)
 */
export function resetAuthFailures(identifier: string): void {
  failureStore.delete(identifier);
}

/**
 * Check if CAPTCHA is required (after 3 failures)
 */
export function requiresCaptcha(identifier: string): boolean {
  const record = failureStore.get(identifier);
  return (record?.count || 0) >= 3;
}

/**
 * Calculate exponential backoff time in milliseconds
 */
export function checkBackoff(identifier: string): number {
  const record = failureStore.get(identifier);
  if (!record || record.count === 0) return 0;

  // Exponential backoff: 2^n seconds (max 1 hour)
  const backoffSeconds = Math.min(Math.pow(2, record.count), 3600);
  const backoffMs = backoffSeconds * 1000;

  const timeSinceLastFailure = Date.now() - record.lastFailure;
  const remainingBackoff = backoffMs - timeSinceLastFailure;

  return Math.max(0, remainingBackoff);
}

// ============================================================================
// WEBHOOK TIMESTAMP VALIDATION (prevent replay attacks)
// ============================================================================

const WEBHOOK_TIMESTAMP_TOLERANCE = 5 * 60 * 1000; // 5 minutes

/**
 * Validate webhook timestamp to prevent replay attacks
 */
export function validateWebhookTimestamp(timestamp: number): boolean {
  const now = Date.now();
  const diff = Math.abs(now - timestamp);
  return diff < WEBHOOK_TIMESTAMP_TOLERANCE;
}

// ============================================================================
// AI CALL RATE LIMITING (prevent cost attacks)
// ============================================================================

interface AiCallRecord {
  count: number;
  windowStart: number;
}

const AI_CALL_LIMIT_PER_MINUTE = 30;
const AI_CALL_WINDOW = 60 * 1000; // 1 minute

const aiCallStore = new Map<string, AiCallRecord>();

/**
 * Check if user can make an AI call (30/minute limit)
 */
export function canMakeAiCall(userId: string): boolean {
  const now = Date.now();
  const record = aiCallStore.get(userId);

  if (!record || now - record.windowStart > AI_CALL_WINDOW) {
    // New window
    aiCallStore.set(userId, { count: 1, windowStart: now });
    return true;
  }

  if (record.count >= AI_CALL_LIMIT_PER_MINUTE) {
    return false; // Rate limited
  }

  record.count++;
  return true;
}

/**
 * Get remaining AI calls for user in current window
 */
export function getRemainingAiCalls(userId: string): number {
  const record = aiCallStore.get(userId);
  if (!record) return AI_CALL_LIMIT_PER_MINUTE;

  const now = Date.now();
  if (now - record.windowStart > AI_CALL_WINDOW) {
    return AI_CALL_LIMIT_PER_MINUTE; // Window expired
  }

  return Math.max(0, AI_CALL_LIMIT_PER_MINUTE - record.count);
}

/**
 * Reset AI call counter for user (admin function)
 */
export function resetAiCallCounter(userId: string): void {
  aiCallStore.delete(userId);
}

// ============================================================================
// BROWSER TASK CONCURRENCY LIMITER
// ============================================================================

let activeBrowserTasks = 0;
const MAX_CONCURRENT_BROWSER_TASKS = 10;

/**
 * Check if system can accept another browser task
 */
export function canAcceptBrowserTask(): boolean {
  return activeBrowserTasks < MAX_CONCURRENT_BROWSER_TASKS;
}

/**
 * Increment active browser task counter
 */
export function incrementBrowserTasks(): void {
  activeBrowserTasks++;
}

/**
 * Decrement active browser task counter
 */
export function decrementBrowserTasks(): void {
  activeBrowserTasks = Math.max(0, activeBrowserTasks - 1);
}

/**
 * Get current browser task count
 */
export function getActiveBrowserTasks(): number {
  return activeBrowserTasks;
}
