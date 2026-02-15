/**
 * Rate Limiting Integration Test
 *
 * Verifies rate limiting middleware works with real HTTP requests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

describe('Rate Limiting Integration Tests', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(() => {
    const app = createTestServer();
    server = app.listen(0); // Random port
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(() => {
    server.close();
  });

  describe('Task Rate Limiter (10/min)', () => {
    it('should allow first task request', async () => {
      const response = await makeRequest(`${baseUrl}/task`, 'POST', { userId: 'test-user-1' });
      expect(response.status).toBe(200);
    });

    it('should rate limit after 10 requests', async () => {
      // Make 9 more requests (total 10 from previous test)
      for (let i = 0; i < 9; i++) {
        await makeRequest(`${baseUrl}/task`, 'POST', { userId: 'test-user-1' });
      }

      // 11th request should be rate limited
      const response = await makeRequest(`${baseUrl}/task`, 'POST', { userId: 'test-user-1' });
      expect(response.status).toBe(429);
      expect(response.data.error).toBe('rate_limited');
    });

    it('should allow request from different user', async () => {
      const response = await makeRequest(`${baseUrl}/task`, 'POST', { userId: 'test-user-2' });
      expect(response.status).toBe(200);
    });
  });

  describe('Auth Rate Limiter (5/15min)', () => {
    it('should allow first login request', async () => {
      const response = await makeRequest(`${baseUrl}/auth/login`, 'POST', {});
      expect(response.status).toBe(200);
    });

    it('should rate limit after 5 login attempts', async () => {
      // Make 4 more requests (total 5)
      for (let i = 0; i < 4; i++) {
        await makeRequest(`${baseUrl}/auth/login`, 'POST', {});
      }

      // 6th request should be rate limited
      const response = await makeRequest(`${baseUrl}/auth/login`, 'POST', {});
      expect(response.status).toBe(429);
    });
  });

  describe('Rate Limit Headers', () => {
    it('should include RateLimit headers', async () => {
      const response = await makeRequest(`${baseUrl}/email-pin`, 'POST', { userId: 'test-user-3' });
      expect(response.status).toBe(200);
      expect(response.headers).toHaveProperty('ratelimit-limit');
      expect(response.headers).toHaveProperty('ratelimit-remaining');
      expect(response.headers).toHaveProperty('ratelimit-reset');
    });
  });

  describe('Password Reset Rate Limiter (3/hour)', () => {
    it('should allow first 3 password reset requests', async () => {
      for (let i = 0; i < 3; i++) {
        const response = await makeRequest(`${baseUrl}/auth/reset-password`, 'POST', {});
        expect(response.status).toBe(200);
      }
    });

    it('should rate limit after 3 password reset attempts', async () => {
      const response = await makeRequest(`${baseUrl}/auth/reset-password`, 'POST', {});
      expect(response.status).toBe(429);
    });
  });
});
