/**
 * Rate Limiting & DoS Protection Middleware
 *
 * Comprehensive rate limiting to prevent:
 * - Brute force attacks (auth, password reset, PIN verification)
 * - Cost attacks (AI API abuse)
 * - Resource exhaustion (DB connections, file uploads)
 */

import rateLimit from 'express-rate-limit';
import type { Request, RequestHandler } from 'express';

// ============================================================================
// CLIENT IP EXTRACTION
// ============================================================================

/**
 * Extract client IP from request (handles proxies correctly)
 * IPv6-compatible: normalizes ::ffff:127.0.0.1 to 127.0.0.1
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  let clientIp = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : req.ip;

  // Normalize IPv6-mapped IPv4 addresses
  if (clientIp?.startsWith('::ffff:')) {
    clientIp = clientIp.substring(7);
  }

  return clientIp || 'unknown';
}

// ============================================================================
// RATE LIMITERS
// ============================================================================

/**
 * Global rate limiter: 100 requests per minute per IP
 */
export const globalLimiter: RequestHandler = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many requests, slow down' },
});

/**
 * Task rate limiter: 10 tasks per minute per user
 */
export const taskLimiter: RequestHandler = rateLimit({
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
export const authLimiter: RequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  keyGenerator: getClientIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'rate_limited',
    message: 'Too many login attempts, please try again in 15 minutes',
  },
  validate: false, // Disable validation since we handle IPv6 in getClientIp
});

/**
 * Password reset limiter: 3 attempts per hour per IP
 */
export const passwordResetLimiter: RequestHandler = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  keyGenerator: getClientIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'rate_limited',
    message: 'Too many password reset requests, please try again in 1 hour',
  },
  validate: false, // Disable validation since we handle IPv6 in getClientIp
});

/**
 * Email PIN verification limiter: 10 attempts per 5 minutes per user
 */
export const emailPinLimiter: RequestHandler = rateLimit({
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
export const apiLimiter: RequestHandler = rateLimit({
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
export const twilioLimiter: RequestHandler = rateLimit({
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
  default: '1mb',     // Default limit
  upload: '10mb',     // Upload endpoints
  strict: '100kb',    // Webhooks and strict endpoints
  json: '10mb',       // JSON payload limit
  urlencoded: '10mb', // URL-encoded form limit
  raw: '50mb',        // Raw body limit
  text: '10mb',       // Text limit
} as const;

export const FILE_UPLOAD_LIMIT = 25 * 1024 * 1024; // 25MB

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
 * Returns backoff time in seconds if applicable, null otherwise
 */
export function recordAuthFailure(identifier: string): number | null {
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

  // Calculate backoff if count >= 2
  const record = failureStore.get(identifier);
  if (record && record.count >= 2) {
    const backoffSeconds = Math.min(Math.pow(2, record.count - 1), 3600);
    return backoffSeconds;
  }

  return null;
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
 * Calculate exponential backoff time
 * Returns { blocked: boolean, retryAfter: number (seconds) }
 */
export function checkBackoff(identifier: string): { blocked: boolean; retryAfter: number } {
  const record = failureStore.get(identifier);
  if (!record || record.count < 2) {
    return { blocked: false, retryAfter: 0 };
  }

  // Exponential backoff: 2^(n-1) seconds (max 1 hour)
  const backoffSeconds = Math.min(Math.pow(2, record.count - 1), 3600);
  const backoffMs = backoffSeconds * 1000;

  const timeSinceLastFailure = Date.now() - record.lastFailure;
  const remainingBackoff = backoffMs - timeSinceLastFailure;

  if (remainingBackoff > 0) {
    return { blocked: true, retryAfter: Math.ceil(remainingBackoff / 1000) };
  }

  return { blocked: false, retryAfter: 0 };
}

// ============================================================================
// WEBHOOK TIMESTAMP VALIDATION (prevent replay attacks)
// ============================================================================

const WEBHOOK_TIMESTAMP_TOLERANCE = 5 * 60 * 1000; // 5 minutes

/**
 * Validate webhook timestamp to prevent replay attacks
 */
export function validateWebhookTimestamp(timestamp: string | number): boolean {
  const now = Date.now();
  const ts = typeof timestamp === 'string' ? new Date(timestamp).getTime() : timestamp;

  if (isNaN(ts)) return false;

  const diff = Math.abs(now - ts);
  return diff < WEBHOOK_TIMESTAMP_TOLERANCE;
}

// ============================================================================
// AI CALL RATE LIMITING (prevent cost attacks)
// ============================================================================

interface AiCallRecord {
  count: number;
  windowStart: number;
}

const AI_CALL_LIMIT_PER_MINUTE = 100;
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

// Browser task concurrency — use utils/concurrency.ts (single source of truth)
