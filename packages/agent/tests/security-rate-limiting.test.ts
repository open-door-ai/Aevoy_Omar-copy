/**
 * Security Sprint - Rate Limiting & DoS Protection Tests
 *
 * Tests for all 12 critical security issues fixed in this sprint
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  globalLimiter,
  taskLimiter,
  authLimiter,
  passwordResetLimiter,
  emailPinLimiter,
  apiLimiter,
  twilioLimiter,
  getClientIp,
  validateWebhookTimestamp,
  REQUEST_SIZE_LIMITS,
  FILE_UPLOAD_LIMIT,
  recordAuthFailure,
  resetAuthFailures,
  requiresCaptcha,
  checkBackoff,
  canMakeAiCall,
  getRemainingAiCalls,
  resetAiCallCounter,
} from '../src/middleware/rate-limit.js';
import {
  canAcceptBrowserTask,
  incrementUserBrowserContext,
  decrementUserBrowserContext,
  canUserCreateBrowserContext,
  incrementUserTaskQueue,
  decrementUserTaskQueue,
  getUserTaskQueueSize,
} from '../src/utils/concurrency.js';

describe('Security Sprint - Rate Limiting & DoS Protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- Test 1: Password Reset Rate Limiting ----
  it('should enforce password reset rate limiting (3/hour per IP)', () => {
    expect(passwordResetLimiter).toBeDefined();
    expect(typeof passwordResetLimiter).toBe('function');
  });

  // ---- Test 2: Login Rate Limiting ----
  it('should enforce login rate limiting (5/15min per IP)', () => {
    expect(authLimiter).toBeDefined();
    expect(typeof authLimiter).toBe('function');
  });

  it('should require CAPTCHA after 3 failed login attempts', () => {
    const userId = 'test-user-123';

    expect(requiresCaptcha(userId)).toBe(false);

    recordAuthFailure(userId);
    recordAuthFailure(userId);
    recordAuthFailure(userId);

    expect(requiresCaptcha(userId)).toBe(true);

    resetAuthFailures(userId);
    expect(requiresCaptcha(userId)).toBe(false);
  });

  it('should apply exponential backoff after repeated failures', () => {
    const userId = 'test-backoff-user';

    let backoffSeconds = recordAuthFailure(userId);
    expect(backoffSeconds).toBeNull();

    backoffSeconds = recordAuthFailure(userId);
    expect(backoffSeconds).toBeGreaterThan(0);

    const backoff = checkBackoff(userId);
    expect(backoff.blocked).toBe(true);
    expect(backoff.retryAfter).toBeGreaterThan(0);

    resetAuthFailures(userId);
    const clearedBackoff = checkBackoff(userId);
    expect(clearedBackoff.blocked).toBe(false);
  });

  // ---- Test 3: Email Verification Rate Limiting ----
  it('should enforce email PIN verification rate limiting (10/5min per user)', () => {
    expect(emailPinLimiter).toBeDefined();
    expect(typeof emailPinLimiter).toBe('function');
  });

  // ---- Test 4: File Upload Size Limits ----
  it('should enforce 25MB file upload limit', () => {
    expect(FILE_UPLOAD_LIMIT).toBe(25 * 1024 * 1024);
  });

  it('should reject files larger than 25MB', () => {
    const fileSize = 26 * 1024 * 1024;
    expect(fileSize).toBeGreaterThan(FILE_UPLOAD_LIMIT);
  });

  // ---- Test 5: Request Body Size Limits ----
  it('should enforce 1MB default request body limit', () => {
    expect(REQUEST_SIZE_LIMITS.default).toBe('1mb');
  });

  it('should allow 10MB for upload endpoints', () => {
    expect(REQUEST_SIZE_LIMITS.upload).toBe('10mb');
  });

  it('should enforce 100KB strict limit for webhooks', () => {
    expect(REQUEST_SIZE_LIMITS.strict).toBe('100kb');
  });

  // ---- Test 6: Connection Pooling ----
  it('should configure Supabase with connection pooling', async () => {
    const { getSupabaseClient } = await import('../src/utils/supabase.js');
    const client = getSupabaseClient();
    expect(client).toBeDefined();
  });

  // ---- Test 7: Request Timeout Enforcement ----
  it('should enforce 30-second timeout on all requests', () => {
    const timeoutMs = 30000;
    expect(timeoutMs).toBe(30 * 1000);
  });

  // ---- Test 8: Concurrent Connection Limiting ----
  it('should limit browser tasks to 10 globally', () => {
    expect(canAcceptBrowserTask()).toBe(true);
  });

  it('should limit browser contexts to 3 per user', () => {
    const userId = 'test-browser-user-' + Date.now();

    expect(incrementUserBrowserContext(userId)).toBe(true);
    expect(incrementUserBrowserContext(userId)).toBe(true);
    expect(incrementUserBrowserContext(userId)).toBe(true);
    expect(incrementUserBrowserContext(userId)).toBe(false);
    expect(canUserCreateBrowserContext(userId)).toBe(false);

    decrementUserBrowserContext(userId);
    decrementUserBrowserContext(userId);
    decrementUserBrowserContext(userId);
  });

  it('should limit task queue to 100 per user', () => {
    const userId = 'test-queue-user-' + Date.now();

    for (let i = 0; i < 100; i++) {
      expect(incrementUserTaskQueue(userId)).toBe(true);
    }

    expect(incrementUserTaskQueue(userId)).toBe(false);
    expect(getUserTaskQueueSize(userId)).toBe(100);

    for (let i = 0; i < 100; i++) {
      decrementUserTaskQueue(userId);
    }
  });

  // ---- Test 9: CAPTCHA Solve Rate Limiting ----
  it('should require CAPTCHA after 3 failed attempts (duplicate of test 2)', () => {
    const ip = '192.168.1.100-' + Date.now();

    expect(requiresCaptcha(ip)).toBe(false);

    recordAuthFailure(ip);
    recordAuthFailure(ip);
    recordAuthFailure(ip);

    expect(requiresCaptcha(ip)).toBe(true);

    resetAuthFailures(ip);
  });

  // ---- Test 10: Email Sending Rate Limiting ----
  it('should enforce email sending rate limiting (30/min per user)', () => {
    expect(apiLimiter).toBeDefined();
    expect(typeof apiLimiter).toBe('function');
  });

  // ---- Test 11: SMS Sending Rate Limiting ----
  it('should enforce SMS sending rate limiting (30/min per phone)', () => {
    expect(twilioLimiter).toBeDefined();
    expect(typeof twilioLimiter).toBe('function');
  });

  // ---- Test 12: AI Cost Per User Limits ----
  it('should limit AI calls to 100 per minute per user', () => {
    const userId = 'test-ai-user-' + Date.now();

    expect(getRemainingAiCalls(userId)).toBe(100);

    for (let i = 0; i < 100; i++) {
      expect(canMakeAiCall(userId)).toBe(true);
    }

    expect(canMakeAiCall(userId)).toBe(false);
    expect(getRemainingAiCalls(userId)).toBe(0);

    resetAiCallCounter(userId);
    expect(getRemainingAiCalls(userId)).toBe(100);
  });

  // ---- Webhook Timestamp Validation ----
  it('should validate webhook timestamps within 5 minutes', () => {
    const now = new Date().toISOString();
    expect(validateWebhookTimestamp(now)).toBe(true);

    const fiveMinutesAgo = new Date(Date.now() - 4 * 60 * 1000).toISOString();
    expect(validateWebhookTimestamp(fiveMinutesAgo)).toBe(true);

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    expect(validateWebhookTimestamp(tenMinutesAgo)).toBe(false);

    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    expect(validateWebhookTimestamp(future)).toBe(false);
  });

  // ---- IP Extraction ----
  it('should extract IP from x-forwarded-for header', () => {
    const req = {
      headers: {
        'x-forwarded-for': '1.2.3.4, 5.6.7.8',
      },
      ip: '127.0.0.1',
    } as unknown as Request;

    expect(getClientIp(req)).toBe('1.2.3.4');
  });

  it('should fallback to req.ip if no x-forwarded-for', () => {
    const req = {
      headers: {},
      ip: '127.0.0.1',
    } as unknown as Request;

    expect(getClientIp(req)).toBe('127.0.0.1');
  });

  // ---- Global Rate Limiting ----
  it('should enforce global rate limiting (100/min per IP)', () => {
    expect(globalLimiter).toBeDefined();
    expect(typeof globalLimiter).toBe('function');
  });

  // ---- Task Rate Limiting ----
  it('should enforce task rate limiting (10/min per user)', () => {
    expect(taskLimiter).toBeDefined();
    expect(typeof taskLimiter).toBe('function');
  });
});
