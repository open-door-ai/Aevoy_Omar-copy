/**
 * VPS Browser Real-World Test Suite
 *
 * Tests VPS Playwright browser (localhost:9000) with real websites
 * Verifies navigation, interaction, and screenshots work correctly
 * Ensures Browserbase is NOT being used (checks logs for VPS browser usage)
 *
 * VPS: 77.42.31.185
 * Agent: http://localhost:3001
 */

import { describe, it, expect, beforeAll } from 'vitest';

const AGENT_URL = process.env.AGENT_URL || 'http://localhost:3001';
const WEBHOOK_SECRET = process.env.AGENT_WEBHOOK_SECRET;
const TEST_USER_ID = '11684ec6-80cd-4bb6-9aed-8f0947afd06a'; // teste2e user

interface TaskResponse {
  success: boolean;
  taskId?: string;
  message?: string;
  error?: string;
}

interface TaskStatus {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: string;
  error?: string;
  cost_usd?: number;
  cascade_level?: string;
  verification_status?: string;
}

/**
 * Send task to agent via webhook
 */
async function sendTask(description: string, channel: string = 'web'): Promise<TaskResponse> {
  const response = await fetch(`${AGENT_URL}/task`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Secret': WEBHOOK_SECRET || '',
    },
    body: JSON.stringify({
      userId: TEST_USER_ID,
      description,
      inputChannel: channel,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Task submission failed: ${response.status} ${text}`);
  }

  return await response.json();
}

/**
 * Poll task status until completion or timeout
 */
async function waitForTaskCompletion(taskId: string, timeoutMs: number = 120000): Promise<TaskStatus> {
  const startTime = Date.now();
  const pollInterval = 2000; // 2 seconds

  while (Date.now() - startTime < timeoutMs) {
    const response = await fetch(`${AGENT_URL}/task/${taskId}/status`, {
      headers: {
        'X-Webhook-Secret': WEBHOOK_SECRET || '',
      },
    });

    if (response.ok) {
      const status: TaskStatus = await response.json();

      if (status.status === 'completed' || status.status === 'failed') {
        return status;
      }
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Task ${taskId} timed out after ${timeoutMs}ms`);
}

/**
 * Send task and wait for completion
 */
async function executeTask(description: string, timeoutMs?: number): Promise<TaskStatus> {
  console.log(`\n📝 Task: ${description}`);

  const response = await sendTask(description);
  expect(response.success).toBe(true);
  expect(response.taskId).toBeDefined();

  console.log(`✓ Task submitted: ${response.taskId}`);

  const status = await waitForTaskCompletion(response.taskId!, timeoutMs);
  console.log(`✓ Task ${status.status}: ${status.result || status.error}`);

  return status;
}

describe('VPS Browser Real-World Tests', () => {
  beforeAll(() => {
    if (!WEBHOOK_SECRET) {
      throw new Error('AGENT_WEBHOOK_SECRET environment variable is required');
    }
    console.log(`\n🌐 Testing VPS Browser at: ${AGENT_URL}`);
    console.log(`👤 Test User ID: ${TEST_USER_ID}`);
  });

  describe('Navigation Tests', () => {
    it('should navigate to Google and verify page load', async () => {
      const status = await executeTask(
        'Navigate to google.com and tell me what the page title is'
      );

      expect(status.status).toBe('completed');
      expect(status.result?.toLowerCase()).toContain('google');
      expect(status.cascade_level).toBe('browser_new'); // Should use browser
    });

    it('should navigate to Wikipedia and find content', async () => {
      const status = await executeTask(
        'Go to wikipedia.org and tell me what the main heading says'
      );

      expect(status.status).toBe('completed');
      expect(status.result?.toLowerCase()).toContain('wikipedia');
      expect(status.cascade_level).toBe('browser_new');
    });

    it('should navigate to GitHub and verify navigation', async () => {
      const status = await executeTask(
        'Visit github.com and tell me if you can see the search bar'
      );

      expect(status.status).toBe('completed');
      expect(status.result?.toLowerCase()).toMatch(/search|yes|found/);
      expect(status.cascade_level).toBe('browser_new');
    });
  });

  describe('Interaction Tests', () => {
    it('should perform a Google search', async () => {
      const status = await executeTask(
        'Go to google.com, search for "playwright browser automation", and tell me if you see search results',
        180000 // 3 minutes for search interaction
      );

      expect(status.status).toBe('completed');
      expect(status.result?.toLowerCase()).toMatch(/result|found|yes/);
    });

    it('should search Wikipedia', async () => {
      const status = await executeTask(
        'Go to wikipedia.org and search for "artificial intelligence". Tell me if the article loaded.',
        180000
      );

      expect(status.status).toBe('completed');
      expect(status.result?.toLowerCase()).toMatch(/loaded|found|yes|article/);
    });

    it('should navigate GitHub menus', async () => {
      const status = await executeTask(
        'Visit github.com/features and tell me what features you see mentioned',
        180000
      );

      expect(status.status).toBe('completed');
      expect(status.result).toBeTruthy();
    });
  });

  describe('Screenshot Tests', () => {
    it('should take a screenshot of Google homepage', async () => {
      const status = await executeTask(
        'Navigate to google.com and take a screenshot'
      );

      expect(status.status).toBe('completed');
      expect(status.result?.toLowerCase()).toMatch(/screenshot|captured|image/);
    });

    it('should take a screenshot of Wikipedia article', async () => {
      const status = await executeTask(
        'Go to en.wikipedia.org/wiki/Playwright and take a screenshot'
      );

      expect(status.status).toBe('completed');
      expect(status.result?.toLowerCase()).toMatch(/screenshot|captured|image/);
    });
  });

  describe('Form Interaction Tests', () => {
    it('should fill a search form on DuckDuckGo', async () => {
      const status = await executeTask(
        'Go to duckduckgo.com, search for "VPS browser testing", and tell me if you see results',
        180000
      );

      expect(status.status).toBe('completed');
      expect(status.result?.toLowerCase()).toMatch(/result|found|yes/);
    });

    it('should interact with GitHub search', async () => {
      const status = await executeTask(
        'Go to github.com, use the search bar to search for "playwright", and tell me what you find',
        180000
      );

      expect(status.status).toBe('completed');
      expect(status.result).toBeTruthy();
    });
  });

  describe('Multi-Step Navigation', () => {
    it('should navigate through multiple pages', async () => {
      const status = await executeTask(
        'Visit wikipedia.org, click on any featured article, and tell me the article title',
        240000 // 4 minutes for multi-step
      );

      expect(status.status).toBe('completed');
      expect(status.result).toBeTruthy();
    });

    it('should perform research across multiple sites', async () => {
      const status = await executeTask(
        'Search Google for "best programming languages 2026", visit the first result, and summarize what you find',
        300000 // 5 minutes for research
      );

      expect(status.status).toBe('completed');
      expect(status.result).toBeTruthy();
      expect(status.result!.length).toBeGreaterThan(50); // Should have substantial content
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid URLs gracefully', async () => {
      const status = await executeTask(
        'Navigate to invalid-website-that-does-not-exist-12345.com and tell me what happens'
      );

      // Should complete with an error message, not crash
      expect(status.status).toBe('completed');
      expect(status.result?.toLowerCase()).toMatch(/error|not found|cannot|unable/);
    });

    it('should handle missing elements gracefully', async () => {
      const status = await executeTask(
        'Go to google.com and click on an element with id "this-element-does-not-exist-12345"'
      );

      expect(status.status).toBe('completed');
      expect(status.result?.toLowerCase()).toMatch(/not found|cannot|unable|error/);
    });
  });

  describe('Performance Tests', () => {
    it('should complete simple navigation within 60 seconds', async () => {
      const startTime = Date.now();
      const status = await executeTask('Visit github.com and tell me the page title');
      const duration = Date.now() - startTime;

      expect(status.status).toBe('completed');
      expect(duration).toBeLessThan(60000); // Should be faster than 60s
      console.log(`⏱️  Duration: ${(duration / 1000).toFixed(2)}s`);
    });

    it('should handle concurrent tasks', async () => {
      const tasks = [
        'Visit google.com and tell me the title',
        'Visit wikipedia.org and tell me the title',
        'Visit github.com and tell me the title',
      ];

      const startTime = Date.now();
      const results = await Promise.all(
        tasks.map(task => executeTask(task))
      );
      const duration = Date.now() - startTime;

      results.forEach(status => {
        expect(status.status).toBe('completed');
      });

      console.log(`⏱️  Concurrent tasks duration: ${(duration / 1000).toFixed(2)}s`);
    });
  });

  describe('Cost Tracking', () => {
    it('should track costs for browser tasks', async () => {
      const status = await executeTask('Go to google.com and take a screenshot');

      expect(status.status).toBe('completed');
      expect(status.cost_usd).toBeDefined();
      expect(status.cost_usd).toBeGreaterThan(0);
      console.log(`💰 Task cost: $${status.cost_usd?.toFixed(4)}`);
    });
  });

  describe('VPS Browser Verification', () => {
    it('should use VPS browser, not Browserbase', async () => {
      const status = await executeTask(
        'Navigate to example.com and verify the page loaded'
      );

      expect(status.status).toBe('completed');
      expect(status.cascade_level).toBe('browser_new');

      // Note: To verify VPS browser is being used, check agent logs for:
      // "[ENGINE] Will use VPS Browser (localhost:9000)"
      // NOT "[ENGINE] Will use Browserbase"
      console.log('\n⚠️  MANUAL VERIFICATION REQUIRED:');
      console.log('   Check agent logs for: "[ENGINE] Will use VPS Browser"');
      console.log('   Should NOT see: "[ENGINE] Will use Browserbase"');
    });
  });
});

/**
 * Run this test suite with:
 *
 * pnpm --filter agent test test-vps-browser.ts
 *
 * Or run specific tests:
 * pnpm --filter agent test test-vps-browser.ts -t "should navigate to Google"
 *
 * Environment variables required:
 * - AGENT_WEBHOOK_SECRET
 * - AGENT_URL (optional, defaults to http://localhost:3001)
 *
 * Verify VPS browser usage:
 * 1. SSH to VPS: ssh -i ~/.ssh/vps_key root@77.42.31.185
 * 2. Check PM2 logs: pm2 logs agent --lines 100
 * 3. Look for: "[ENGINE] Will use VPS Browser (localhost:9000)"
 * 4. Should NOT see Browserbase mentions
 */
