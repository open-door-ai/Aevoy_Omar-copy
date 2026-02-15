/**
 * Rate Limiting Integration Test
 *
 * Verifies rate limiting middleware works with real HTTP requests
 */

import express, { type Express, type Request, type Response } from 'express';
import type { Server } from 'http';
import {
  globalLimiter,
  taskLimiter,
  authLimiter,
  passwordResetLimiter,
  emailPinLimiter,
} from '../src/middleware/rate-limit.js';

// Create test server
function createTestServer(): Express {
  const app = express();
  app.use(express.json());

  // Global limiter on all routes
  app.use(globalLimiter);

  // Test endpoints
  app.post('/task', taskLimiter, (req: Request, res: Response) => {
    res.json({ success: true });
  });

  app.post('/auth/login', authLimiter, (req: Request, res: Response) => {
    res.json({ success: true });
  });

  app.post('/auth/reset-password', passwordResetLimiter, (req: Request, res: Response) => {
    res.json({ success: true });
  });

  app.post('/email-pin', emailPinLimiter, (req: Request, res: Response) => {
    res.json({ success: true });
  });

  return app;
}

// Simple HTTP client
async function makeRequest(
  url: string,
  method: string = 'POST',
  body?: any
): Promise<{ status: number; data: any; headers: Record<string, string> }> {
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  let data: any;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  return { status: response.status, data, headers };
}

// Test runner
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

async function runTests(): Promise<void> {
  console.log('\n=== Rate Limiting Integration Tests ===\n');

  const app = createTestServer();
  const server: Server = app.listen(0); // Random port
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://localhost:${port}`;

  console.log(`Test server running on port ${port}\n`);

  try {
    // ---- Test 1: Task Rate Limiter (10/min) ----
    console.log('Test Group: Task Rate Limiting');

    // First request should succeed
    let response = await makeRequest(`${baseUrl}/task`, 'POST', { userId: 'test-user-1' });
    assert(response.status === 200, 'should allow first task request');

    // Make 9 more requests (total 10)
    for (let i = 0; i < 9; i++) {
      await makeRequest(`${baseUrl}/task`, 'POST', { userId: 'test-user-1' });
    }

    // 11th request should be rate limited
    response = await makeRequest(`${baseUrl}/task`, 'POST', { userId: 'test-user-1' });
    assert(response.status === 429, 'should rate limit after 10 requests');
    assert(response.data.error === 'rate_limited', 'should return rate_limited error');

    // Different user should not be affected
    response = await makeRequest(`${baseUrl}/task`, 'POST', { userId: 'test-user-2' });
    assert(response.status === 200, 'should allow request from different user');

    // ---- Test 2: Auth Rate Limiter (5/15min) ----
    console.log('\nTest Group: Auth Rate Limiting');

    // First request should succeed
    response = await makeRequest(`${baseUrl}/auth/login`, 'POST', {});
    assert(response.status === 200, 'should allow first login request');

    // Make 4 more requests (total 5)
    for (let i = 0; i < 4; i++) {
      await makeRequest(`${baseUrl}/auth/login`, 'POST', {});
    }

    // 6th request should be rate limited
    response = await makeRequest(`${baseUrl}/auth/login`, 'POST', {});
    assert(response.status === 429, 'should rate limit after 5 login attempts');

    // ---- Test 3: Rate Limit Headers ----
    console.log('\nTest Group: Rate Limit Headers');

    response = await makeRequest(`${baseUrl}/email-pin`, 'POST', { userId: 'test-user-3' });
    assert(response.status === 200, 'should allow email-pin request');
    assert('ratelimit-limit' in response.headers, 'should include RateLimit-Limit header');
    assert('ratelimit-remaining' in response.headers, 'should include RateLimit-Remaining header');
    assert('ratelimit-reset' in response.headers, 'should include RateLimit-Reset header');

    // ---- Test 4: Password Reset Rate Limiter (3/hour) ----
    console.log('\nTest Group: Password Reset Rate Limiting');

    // Use unique IP header for each test
    const ip = `192.168.1.${Math.floor(Math.random() * 256)}`;

    // First 3 requests should succeed
    for (let i = 0; i < 3; i++) {
      response = await makeRequest(`${baseUrl}/auth/reset-password`, 'POST', {});
      assert(response.status === 200, `should allow password reset request ${i + 1}/3`);
    }

    // 4th request should be rate limited
    response = await makeRequest(`${baseUrl}/auth/reset-password`, 'POST', {});
    assert(response.status === 429, 'should rate limit after 3 password reset attempts');

    console.log(`\n=== Integration Test Summary ===`);
    console.log(`✓ Passed: ${passed}`);
    console.log(`✗ Failed: ${failed}`);

    if (failed > 0) {
      process.exit(1);
    } else {
      console.log('\n✓ All integration tests passed!\n');
      process.exit(0);
    }
  } catch (error) {
    console.error('Test error:', error);
    process.exit(1);
  } finally {
    server.close();
  }
}

// Run tests
runTests().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
