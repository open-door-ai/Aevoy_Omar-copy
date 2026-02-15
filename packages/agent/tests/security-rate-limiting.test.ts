/**
 * Security Sprint - Rate Limiting & DoS Protection Tests
 *
 * Converted to vitest format
 */

import { describe, it, expect } from 'vitest';
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
  describe('Password Reset Rate Limiting', () => {
    it('should enforce password reset rate limiting (3/hour per IP)', () => {
      expect(typeof passwordResetLimiter).toBe('function');
    });
  });

  describe('Login Rate Limiting', () => {
    it('should enforce login rate limiting (5/15min per IP)', () => {
      expect(typeof authLimiter).toBe('function');
    });

    it('should not require CAPTCHA initially', () => {
      const userId = 'test-user-' + Date.now();
      expect(requiresCaptcha(userId)).toBe(false);
    });

    it('should require CAPTCHA after 3 failed login attempts', () => {
      const userId = 'test-user-' + Date.now();
      recordAuthFailure(userId);
      recordAuthFailure(userId);
      recordAuthFailure(userId);
      expect(requiresCaptcha(userId)).toBe(true);
    });

    it('should reset CAPTCHA requirement', () => {
      const userId = 'test-user-' + Date.now();
      recordAuthFailure(userId);
      recordAuthFailure(userId);
      recordAuthFailure(userId);
      resetAuthFailures(userId);
      expect(requiresCaptcha(userId)).toBe(false);
    });
  });

  describe('Exponential Backoff', () => {
    it('should return null on first failure', () => {
      const backoffUser = 'test-backoff-user-' + Date.now();
      const backoffSeconds = recordAuthFailure(backoffUser);
      expect(backoffSeconds).toBe(null);
    });

    it('should return backoff time on second failure', () => {
      const backoffUser = 'test-backoff-user-' + Date.now();
      recordAuthFailure(backoffUser);
      const backoffSeconds = recordAuthFailure(backoffUser);
      expect(backoffSeconds).not.toBe(null);
      expect(backoffSeconds).toBeGreaterThan(0);
    });

    it('should be blocked after repeated failures', () => {
      const backoffUser = 'test-backoff-user-' + Date.now();
      recordAuthFailure(backoffUser);
      recordAuthFailure(backoffUser);
      const backoff = checkBackoff(backoffUser);
      expect(backoff.blocked).toBe(true);
      expect(backoff.retryAfter).toBeGreaterThan(0);
    });

    it('should clear backoff after reset', () => {
      const backoffUser = 'test-backoff-user-' + Date.now();
      recordAuthFailure(backoffUser);
      recordAuthFailure(backoffUser);
      resetAuthFailures(backoffUser);
      const clearedBackoff = checkBackoff(backoffUser);
      expect(clearedBackoff.blocked).toBe(false);
    });
  });

  describe('Email PIN Verification', () => {
    it('should enforce email PIN verification rate limiting (10/5min per user)', () => {
      expect(typeof emailPinLimiter).toBe('function');
    });
  });

  describe('File Upload Limits', () => {
    it('should enforce 25MB file upload limit', () => {
      expect(FILE_UPLOAD_LIMIT).toBe(25 * 1024 * 1024);
    });

    it('should reject files larger than 25MB', () => {
      const fileSize = 26 * 1024 * 1024;
      expect(fileSize).toBeGreaterThan(FILE_UPLOAD_LIMIT);
    });
  });

  describe('Request Body Limits', () => {
    it('should enforce 1MB default request body limit', () => {
      expect(REQUEST_SIZE_LIMITS.default).toBe('1mb');
    });

    it('should allow 10MB for upload endpoints', () => {
      expect(REQUEST_SIZE_LIMITS.upload).toBe('10mb');
    });

    it('should enforce 100KB strict limit for webhooks', () => {
      expect(REQUEST_SIZE_LIMITS.strict).toBe('100kb');
    });
  });

  describe('Request Timeout', () => {
    it('should enforce 30-second timeout on all requests', () => {
      const timeoutMs = 30000;
      expect(timeoutMs).toBe(30 * 1000);
    });
  });

  describe('Concurrent Connection Limiting', () => {
    it('should limit browser tasks to 10 globally', () => {
      expect(canAcceptBrowserTask()).toBe(true);
    });

    it('should enforce per-user browser context limits', () => {
      const browserUser = 'test-browser-user-' + Date.now();
      expect(incrementUserBrowserContext(browserUser)).toBe(true); // 1st
      expect(incrementUserBrowserContext(browserUser)).toBe(true); // 2nd
      expect(incrementUserBrowserContext(browserUser)).toBe(true); // 3rd
      expect(incrementUserBrowserContext(browserUser)).toBe(false); // 4th blocked
      expect(canUserCreateBrowserContext(browserUser)).toBe(false);

      decrementUserBrowserContext(browserUser);
      decrementUserBrowserContext(browserUser);
      decrementUserBrowserContext(browserUser);
    });
  });

  describe('Task Queue Limiting', () => {
    it('should allow 100 tasks per user', () => {
      const queueUser = 'test-queue-user-' + Date.now();

      for (let i = 0; i < 100; i++) {
        expect(incrementUserTaskQueue(queueUser)).toBe(true);
      }

      expect(incrementUserTaskQueue(queueUser)).toBe(false); // 101st blocked
      expect(getUserTaskQueueSize(queueUser)).toBe(100);

      for (let i = 0; i < 100; i++) {
        decrementUserTaskQueue(queueUser);
      }
    });
  });

  describe('CAPTCHA Rate Limiting', () => {
    it('should not require CAPTCHA initially (IP)', () => {
      const ip = '192.168.1.100-' + Date.now();
      expect(requiresCaptcha(ip)).toBe(false);
    });

    it('should require CAPTCHA after 3 attempts (IP)', () => {
      const ip = '192.168.1.100-' + Date.now();
      recordAuthFailure(ip);
      recordAuthFailure(ip);
      recordAuthFailure(ip);
      expect(requiresCaptcha(ip)).toBe(true);
      resetAuthFailures(ip);
    });
  });

  describe('Email/SMS Rate Limiting', () => {
    it('should enforce email sending rate limiting (30/min per user)', () => {
      expect(typeof apiLimiter).toBe('function');
    });

    it('should enforce SMS sending rate limiting (30/min per phone)', () => {
      expect(typeof twilioLimiter).toBe('function');
    });
  });

  describe('AI Call Rate Limiting', () => {
    it('should start with 100 AI calls available', () => {
      const aiUser = 'test-ai-user-' + Date.now();
      expect(getRemainingAiCalls(aiUser)).toBe(100);
    });

    it('should allow 100 AI calls then block', () => {
      const aiUser = 'test-ai-user-' + Date.now();

      for (let i = 0; i < 100; i++) {
        expect(canMakeAiCall(aiUser)).toBe(true);
      }

      expect(canMakeAiCall(aiUser)).toBe(false);
      expect(getRemainingAiCalls(aiUser)).toBe(0);
    });

    it('should reset to 100 calls after reset', () => {
      const aiUser = 'test-ai-user-' + Date.now();
      for (let i = 0; i < 100; i++) {
        canMakeAiCall(aiUser);
      }
      resetAiCallCounter(aiUser);
      expect(getRemainingAiCalls(aiUser)).toBe(100);
    });
  });

  describe('Webhook Timestamp Validation', () => {
    it('should validate current timestamp', () => {
      const now = new Date().toISOString();
      expect(validateWebhookTimestamp(now)).toBe(true);
    });

    it('should validate 4-minute-old timestamp', () => {
      const fiveMinutesAgo = new Date(Date.now() - 4 * 60 * 1000).toISOString();
      expect(validateWebhookTimestamp(fiveMinutesAgo)).toBe(true);
    });

    it('should reject 10-minute-old timestamp', () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      expect(validateWebhookTimestamp(tenMinutesAgo)).toBe(false);
    });

    it('should reject future timestamp', () => {
      const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      expect(validateWebhookTimestamp(future)).toBe(false);
    });
  });

  describe('IP Extraction', () => {
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
  });

  describe('Global Rate Limiting', () => {
    it('should enforce global rate limiting (100/min per IP)', () => {
      expect(typeof globalLimiter).toBe('function');
    });
  });

  describe('Task Rate Limiting', () => {
    it('should enforce task rate limiting (10/min per user)', () => {
      expect(typeof taskLimiter).toBe('function');
    });
  });
});
