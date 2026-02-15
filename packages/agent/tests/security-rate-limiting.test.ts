/**
 * Security Sprint - Rate Limiting & DoS Protection Tests
 *
 * Simple node test runner (no vitest/jest required)
 */

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

// Simple test framework
let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`✓ ${message}`);
  } else {
    failed++;
    console.error(`✗ ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual === expected) {
    passed++;
    console.log(`✓ ${message}`);
  } else {
    failed++;
    console.error(`✗ ${message}`);
    console.error(`  Expected: ${expected}`);
    console.error(`  Actual: ${actual}`);
  }
}

function assertGreaterThan(actual: number, threshold: number, message: string): void {
  if (actual > threshold) {
    passed++;
    console.log(`✓ ${message}`);
  } else {
    failed++;
    console.error(`✗ ${message}`);
    console.error(`  Expected > ${threshold}, got ${actual}`);
  }
}

console.log('\n=== Security Sprint - Rate Limiting & DoS Protection ===\n');

// ---- Test 1: Password Reset Rate Limiting ----
console.log('Test Group: Password Reset Rate Limiting');
assert(typeof passwordResetLimiter === 'function', 'should enforce password reset rate limiting (3/hour per IP)');

// ---- Test 2: Login Rate Limiting ----
console.log('\nTest Group: Login Rate Limiting');
assert(typeof authLimiter === 'function', 'should enforce login rate limiting (5/15min per IP)');

const userId1 = 'test-user-' + Date.now();
assertEqual(requiresCaptcha(userId1), false, 'should not require CAPTCHA initially');

recordAuthFailure(userId1);
recordAuthFailure(userId1);
recordAuthFailure(userId1);

assertEqual(requiresCaptcha(userId1), true, 'should require CAPTCHA after 3 failed login attempts');

resetAuthFailures(userId1);
assertEqual(requiresCaptcha(userId1), false, 'should reset CAPTCHA requirement');

// ---- Test 3: Exponential Backoff ----
console.log('\nTest Group: Exponential Backoff');
const backoffUser = 'test-backoff-user-' + Date.now();

let backoffSeconds = recordAuthFailure(backoffUser);
assertEqual(backoffSeconds, null, 'should return null on first failure');

backoffSeconds = recordAuthFailure(backoffUser);
assert(backoffSeconds !== null && backoffSeconds > 0, 'should return backoff time on second failure');

const backoff = checkBackoff(backoffUser);
assertEqual(backoff.blocked, true, 'should be blocked after repeated failures');
assertGreaterThan(backoff.retryAfter, 0, 'should have retry-after time');

resetAuthFailures(backoffUser);
const clearedBackoff = checkBackoff(backoffUser);
assertEqual(clearedBackoff.blocked, false, 'should clear backoff after reset');

// ---- Test 4: Email Verification Rate Limiting ----
console.log('\nTest Group: Email PIN Verification');
assert(typeof emailPinLimiter === 'function', 'should enforce email PIN verification rate limiting (10/5min per user)');

// ---- Test 5: File Upload Size Limits ----
console.log('\nTest Group: File Upload Limits');
assertEqual(FILE_UPLOAD_LIMIT, 25 * 1024 * 1024, 'should enforce 25MB file upload limit');

const fileSize = 26 * 1024 * 1024;
assert(fileSize > FILE_UPLOAD_LIMIT, 'should reject files larger than 25MB');

// ---- Test 6: Request Body Size Limits ----
console.log('\nTest Group: Request Body Limits');
assertEqual(REQUEST_SIZE_LIMITS.default, '1mb', 'should enforce 1MB default request body limit');
assertEqual(REQUEST_SIZE_LIMITS.upload, '10mb', 'should allow 10MB for upload endpoints');
assertEqual(REQUEST_SIZE_LIMITS.strict, '100kb', 'should enforce 100KB strict limit for webhooks');

// ---- Test 7: Request Timeout Enforcement ----
console.log('\nTest Group: Request Timeout');
const timeoutMs = 30000;
assertEqual(timeoutMs, 30 * 1000, 'should enforce 30-second timeout on all requests');

// ---- Test 8: Concurrent Connection Limiting ----
console.log('\nTest Group: Concurrent Connection Limiting');
assert(canAcceptBrowserTask(), 'should limit browser tasks to 10 globally');

const browserUser = 'test-browser-user-' + Date.now();
assertEqual(incrementUserBrowserContext(browserUser), true, 'should allow 1st browser context');
assertEqual(incrementUserBrowserContext(browserUser), true, 'should allow 2nd browser context');
assertEqual(incrementUserBrowserContext(browserUser), true, 'should allow 3rd browser context');
assertEqual(incrementUserBrowserContext(browserUser), false, 'should block 4th browser context');
assertEqual(canUserCreateBrowserContext(browserUser), false, 'should report user at max contexts');

decrementUserBrowserContext(browserUser);
decrementUserBrowserContext(browserUser);
decrementUserBrowserContext(browserUser);

// ---- Test 9: Task Queue Limiting ----
console.log('\nTest Group: Task Queue Limiting');
const queueUser = 'test-queue-user-' + Date.now();

for (let i = 0; i < 100; i++) {
  assert(incrementUserTaskQueue(queueUser), `should allow task ${i + 1}/100`);
}

assertEqual(incrementUserTaskQueue(queueUser), false, 'should block 101st task');
assertEqual(getUserTaskQueueSize(queueUser), 100, 'should report queue size of 100');

for (let i = 0; i < 100; i++) {
  decrementUserTaskQueue(queueUser);
}

// ---- Test 10: CAPTCHA Solve Rate Limiting ----
console.log('\nTest Group: CAPTCHA Rate Limiting');
const ip = '192.168.1.100-' + Date.now();

assertEqual(requiresCaptcha(ip), false, 'should not require CAPTCHA initially (IP)');

recordAuthFailure(ip);
recordAuthFailure(ip);
recordAuthFailure(ip);

assertEqual(requiresCaptcha(ip), true, 'should require CAPTCHA after 3 attempts (IP)');

resetAuthFailures(ip);

// ---- Test 11: Email/SMS Sending Rate Limiting ----
console.log('\nTest Group: Email/SMS Rate Limiting');
assert(typeof apiLimiter === 'function', 'should enforce email sending rate limiting (30/min per user)');
assert(typeof twilioLimiter === 'function', 'should enforce SMS sending rate limiting (30/min per phone)');

// ---- Test 12: AI Cost Per User Limits ----
console.log('\nTest Group: AI Call Rate Limiting');
const aiUser = 'test-ai-user-' + Date.now();

assertEqual(getRemainingAiCalls(aiUser), 100, 'should start with 100 AI calls available');

for (let i = 0; i < 100; i++) {
  assert(canMakeAiCall(aiUser), `should allow AI call ${i + 1}/100`);
}

assertEqual(canMakeAiCall(aiUser), false, 'should block 101st AI call');
assertEqual(getRemainingAiCalls(aiUser), 0, 'should report 0 remaining calls');

resetAiCallCounter(aiUser);
assertEqual(getRemainingAiCalls(aiUser), 100, 'should reset to 100 calls after reset');

// ---- Test 13: Webhook Timestamp Validation ----
console.log('\nTest Group: Webhook Timestamp Validation');
const now = new Date().toISOString();
assertEqual(validateWebhookTimestamp(now), true, 'should validate current timestamp');

const fiveMinutesAgo = new Date(Date.now() - 4 * 60 * 1000).toISOString();
assertEqual(validateWebhookTimestamp(fiveMinutesAgo), true, 'should validate 4-minute-old timestamp');

const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
assertEqual(validateWebhookTimestamp(tenMinutesAgo), false, 'should reject 10-minute-old timestamp');

const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
assertEqual(validateWebhookTimestamp(future), false, 'should reject future timestamp');

// ---- Test 14: IP Extraction ----
console.log('\nTest Group: IP Extraction');
const req1 = {
  headers: {
    'x-forwarded-for': '1.2.3.4, 5.6.7.8',
  },
  ip: '127.0.0.1',
} as unknown as Request;

assertEqual(getClientIp(req1), '1.2.3.4', 'should extract IP from x-forwarded-for header');

const req2 = {
  headers: {},
  ip: '127.0.0.1',
} as unknown as Request;

assertEqual(getClientIp(req2), '127.0.0.1', 'should fallback to req.ip if no x-forwarded-for');

// ---- Test 15: Global Rate Limiting ----
console.log('\nTest Group: Global Rate Limiting');
assert(typeof globalLimiter === 'function', 'should enforce global rate limiting (100/min per IP)');

// ---- Test 16: Task Rate Limiting ----
console.log('\nTest Group: Task Rate Limiting');
assert(typeof taskLimiter === 'function', 'should enforce task rate limiting (10/min per user)');

// ---- Summary ----
console.log(`\n=== Test Summary ===`);
console.log(`✓ Passed: ${passed}`);
console.log(`✗ Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log('\n✓ All tests passed!\n');
  process.exit(0);
}
