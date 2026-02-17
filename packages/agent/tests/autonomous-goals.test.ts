/**
 * Autonomous Goal-Seeking and Persistence Tests
 *
 * Tests the agent's ability to:
 * 1. Figure out HOW to achieve high-level goals autonomously
 * 2. Break down into steps without explicit instructions
 * 3. Execute persistently until success
 * 4. Adapt and retry on failures
 * 5. Try multiple approaches when blocked
 * 6. Verify success autonomously
 *
 * Test Scenarios:
 * - Make $1 (micro-tasks, surveys)
 * - Find free PDF (legal sources, library sites)
 * - Get discount code (search, verify validity)
 * - Find job listings (search, filter, extract)
 *
 * Success Criteria:
 * - Agent must figure out HOW without explicit steps
 * - Must try alternative approaches on failure
 * - Must verify results autonomously
 * - Cost per task < $0.01 (target: $0.005)
 * - Complete within 20min timeout
 * - Proper TASK_COMPLETE signal
 */

import { describe, it, expect } from 'vitest';
import axios from 'axios';

// Test configuration
const AGENT_URL = process.env.AGENT_URL || 'http://localhost:3001';
const TEST_USER_ID = '11684ec6-80cd-4bb6-9aed-8f0947afd06a'; // teste2e user
const TEST_EMAIL = 'teste2e@aevoy.com';
const WEBHOOK_SECRET = process.env.AGENT_WEBHOOK_SECRET || 'dev-secret';

// Timeout for goal-seeking tasks (20 minutes)
const GOAL_TIMEOUT = 20 * 60 * 1000;

// Cost targets
const MAX_COST_PER_TASK = 0.01; // $0.01 max
const TARGET_COST_PER_TASK = 0.005; // $0.005 target

interface TaskResponse {
  taskId: string;
  success: boolean;
  response: string;
  actions: Array<{
    type: string;
    success: boolean;
    result?: unknown;
    error?: string;
  }>;
  cost?: number;
  iterations?: number;
  duration?: number;
  error?: string;
}

/**
 * Submit a task to the agent and wait for completion
 */
async function submitGoalTask(goal: string, context?: string): Promise<TaskResponse> {
  const requestBody = {
    userId: TEST_USER_ID,
    username: 'teste2e',
    from: TEST_EMAIL,
    subject: goal,
    body: context || goal,
    inputChannel: 'email',
  };

  console.log(`\n[TEST] Submitting goal: "${goal}"`);
  console.log(`[TEST] Context: ${context || '(none)'}`);

  const startTime = Date.now();

  try {
    const response = await axios.post(
      `${AGENT_URL}/task`,
      requestBody,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': WEBHOOK_SECRET,
        },
        timeout: GOAL_TIMEOUT,
      }
    );

    const duration = Date.now() - startTime;
    console.log(`[TEST] Task completed in ${(duration / 1000).toFixed(1)}s`);
    console.log(`[TEST] Success: ${response.data.success}`);
    console.log(`[TEST] Response preview: ${response.data.response?.substring(0, 200)}...`);

    return {
      ...response.data,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    if (axios.isAxiosError(error)) {
      console.error(`[TEST] Task failed after ${(duration / 1000).toFixed(1)}s:`, error.response?.data || error.message);
      return {
        taskId: '',
        success: false,
        response: error.response?.data?.error || error.message,
        actions: [],
        error: error.message,
        duration,
      };
    }
    throw error;
  }
}

/**
 * Verify the agent tried multiple approaches
 */
function verifyMultipleApproaches(actions: TaskResponse['actions']): {
  tried: boolean;
  approaches: string[];
  count: number;
} {
  const uniqueApproaches = new Set<string>();

  for (const action of actions) {
    if (action.type === 'navigate') {
      const url = (action.result as { url?: string })?.url;
      if (url) {
        const domain = new URL(url).hostname;
        uniqueApproaches.add(domain);
      }
    } else if (action.type === 'search') {
      uniqueApproaches.add('search_engine');
    }
  }

  const approaches = Array.from(uniqueApproaches);
  return {
    tried: approaches.length > 1,
    approaches,
    count: approaches.length,
  };
}

/**
 * Verify the agent adapted and retried after failures
 */
function verifyAdaptiveRetry(actions: TaskResponse['actions']): {
  hadFailures: boolean;
  recovered: boolean;
  retryCount: number;
} {
  const failures = actions.filter(a => !a.success);
  const recoveries = [];

  for (let i = 0; i < actions.length - 1; i++) {
    if (!actions[i].success && actions[i + 1].success) {
      recoveries.push(i);
    }
  }

  return {
    hadFailures: failures.length > 0,
    recovered: recoveries.length > 0,
    retryCount: recoveries.length,
  };
}

describe('Autonomous Goal-Seeking Tests', () => {
  describe('Scenario 1: Make $1', () => {
    it.skip('should figure out how to earn $1 through micro-tasks', async () => {
      const result = await submitGoalTask(
        'Make me $1',
        'I need you to figure out how to earn $1. Try survey sites, micro-task platforms, or any legal method. Keep trying until you succeed or verify that $1 has been earned.'
      );

      // Verify task completion
      expect(result.success).toBe(true);
      expect(result.response).toContain('[TASK_COMPLETE]');

      // Verify autonomous planning
      expect(result.actions.length).toBeGreaterThan(3);
      const approaches = verifyMultipleApproaches(result.actions);
      expect(approaches.tried).toBe(true);
      console.log(`[TEST] Tried ${approaches.count} different approaches: ${approaches.approaches.join(', ')}`);

      // Verify adaptive retry
      const retry = verifyAdaptiveRetry(result.actions);
      if (retry.hadFailures) {
        expect(retry.recovered).toBe(true);
        console.log(`[TEST] Recovered from ${retry.retryCount} failure(s)`);
      }

      // Verify cost efficiency
      expect(result.cost).toBeLessThan(MAX_COST_PER_TASK);
      console.log(`[TEST] Cost: $${result.cost?.toFixed(4)} (target: $${TARGET_COST_PER_TASK})`);

      // Verify iterations
      expect(result.iterations).toBeLessThanOrEqual(5);
      console.log(`[TEST] Completed in ${result.iterations} iteration(s)`);
    }, GOAL_TIMEOUT);

    it('should search for legitimate micro-task platforms', async () => {
      const result = await submitGoalTask(
        'Find legitimate ways to make $1 online',
        'Search for reputable micro-task platforms like Amazon MTurk, Clickworker, or similar. Extract platform names, earnings potential, and signup links.'
      );

      expect(result.success).toBe(true);

      // Verify search was performed
      const searchActions = result.actions.filter(a => a.type === 'search' || a.type === 'browse');
      expect(searchActions.length).toBeGreaterThan(0);

      // Verify data extraction
      const extractActions = result.actions.filter(a => a.type === 'extract');
      expect(extractActions.length).toBeGreaterThan(0);

      // Verify cost
      expect(result.cost).toBeLessThan(MAX_COST_PER_TASK);
      console.log(`[TEST] Found micro-task platforms, cost: $${result.cost?.toFixed(4)}`);
    }, GOAL_TIMEOUT);
  });

  describe('Scenario 2: Find Free PDF', () => {
    it('should find a free Python programming PDF from legal sources', async () => {
      const result = await submitGoalTask(
        'Find me a free PDF of Python programming book',
        'Search for free, legal Python programming books. Try: Project Gutenberg, OpenLibrary, university resources, official documentation PDFs. Verify the PDF is downloadable and free.'
      );

      expect(result.success).toBe(true);

      // Verify multiple sources tried
      const approaches = verifyMultipleApproaches(result.actions);
      expect(approaches.tried).toBe(true);
      console.log(`[TEST] Searched ${approaches.count} sources: ${approaches.approaches.join(', ')}`);

      // Verify navigation to legitimate sites
      const navActions = result.actions.filter(a => a.type === 'navigate');
      expect(navActions.length).toBeGreaterThan(0);

      // Verify result contains PDF reference
      expect(result.response.toLowerCase()).toMatch(/pdf|download|book/);

      // Verify cost
      expect(result.cost).toBeLessThan(MAX_COST_PER_TASK);
      console.log(`[TEST] Found Python PDF, cost: $${result.cost?.toFixed(4)}`);
    }, GOAL_TIMEOUT);

    it('should handle CAPTCHAs and blocks gracefully', async () => {
      const result = await submitGoalTask(
        'Find a free programming tutorial PDF',
        'Search for free programming PDFs. If you encounter CAPTCHAs or bot blocks, try alternative sources.'
      );

      // Should complete even with obstacles
      expect(result.success).toBe(true);

      // Verify retry logic
      const retry = verifyAdaptiveRetry(result.actions);
      console.log(`[TEST] Had failures: ${retry.hadFailures}, Recovered: ${retry.recovered}`);

      // If there were failures, verify recovery
      if (retry.hadFailures) {
        expect(retry.recovered).toBe(true);
      }

      expect(result.cost).toBeLessThan(MAX_COST_PER_TASK);
    }, GOAL_TIMEOUT);
  });

  describe('Scenario 3: Get Discount Code', () => {
    it('should find and verify a pizza delivery discount code', async () => {
      const result = await submitGoalTask(
        'Get me a discount code for pizza delivery',
        'Search for current, valid promo codes for pizza delivery (Dominos, Pizza Hut, etc.). Try multiple coupon sites. Verify the code is not expired. Extract the code and terms.'
      );

      expect(result.success).toBe(true);

      // Verify search performed
      const searchActions = result.actions.filter(a => a.type === 'search' || a.type === 'browse');
      expect(searchActions.length).toBeGreaterThan(0);

      // Verify multiple sites tried
      const approaches = verifyMultipleApproaches(result.actions);
      expect(approaches.tried).toBe(true);
      console.log(`[TEST] Checked ${approaches.count} coupon sites`);

      // Verify code extraction
      expect(result.response).toMatch(/code|promo|discount|coupon/i);

      // Verify cost
      expect(result.cost).toBeLessThan(MAX_COST_PER_TASK);
      console.log(`[TEST] Found discount code, cost: $${result.cost?.toFixed(4)}`);
    }, GOAL_TIMEOUT);

    it('should verify discount codes are not expired', async () => {
      const result = await submitGoalTask(
        'Find a valid (non-expired) pizza discount code',
        'Search for pizza promo codes. Check the expiration date or terms. Only report codes that are currently valid.'
      );

      expect(result.success).toBe(true);

      // Verify extraction of terms
      const extractActions = result.actions.filter(a => a.type === 'extract');
      expect(extractActions.length).toBeGreaterThan(0);

      // Verify response mentions validity
      expect(result.response.toLowerCase()).toMatch(/valid|expire|active|current/);

      expect(result.cost).toBeLessThan(MAX_COST_PER_TASK);
    }, GOAL_TIMEOUT);
  });

  describe('Scenario 4: Find Job Listings', () => {
    it('should find 3 remote Python developer job listings', async () => {
      const result = await submitGoalTask(
        'Find me 3 remote job listings for Python developers',
        'Search job boards (Indeed, LinkedIn, etc.) for remote Python developer positions. Filter for recent listings (< 1 week old). Extract: job title, company, location, salary (if listed), and application link.'
      );

      expect(result.success).toBe(true);

      // Verify search performed
      const searchActions = result.actions.filter(a => a.type === 'search' || a.type === 'browse');
      expect(searchActions.length).toBeGreaterThan(0);

      // Verify data extraction
      const extractActions = result.actions.filter(a => a.type === 'extract');
      expect(extractActions.length).toBeGreaterThan(0);

      // Verify 3 jobs mentioned (rough check)
      const jobMatches = (result.response.match(/job|position|developer|engineer/gi) || []).length;
      expect(jobMatches).toBeGreaterThan(3);

      // Verify cost
      expect(result.cost).toBeLessThan(MAX_COST_PER_TASK);
      console.log(`[TEST] Found job listings, cost: $${result.cost?.toFixed(4)}`);
    }, GOAL_TIMEOUT);

    it('should filter job listings by recency (< 1 week)', async () => {
      const result = await submitGoalTask(
        'Find recent Python jobs (posted within last 7 days)',
        'Search for Python developer jobs. Check the posting date. Only extract jobs posted within the last week.'
      );

      expect(result.success).toBe(true);

      // Verify response mentions recency
      expect(result.response.toLowerCase()).toMatch(/recent|week|day|posted/);

      // Verify extraction performed
      const extractActions = result.actions.filter(a => a.type === 'extract');
      expect(extractActions.length).toBeGreaterThan(0);

      expect(result.cost).toBeLessThan(MAX_COST_PER_TASK);
    }, GOAL_TIMEOUT);
  });

  describe('Persistence and Iteration', () => {
    it('should iterate until goal achieved or max iterations reached', async () => {
      const result = await submitGoalTask(
        'Find the current price of Bitcoin',
        'Search for the current Bitcoin price in USD. Try multiple sources if needed. Keep trying until you get a numeric value.'
      );

      expect(result.success).toBe(true);

      // Verify iterations
      expect(result.iterations).toBeGreaterThanOrEqual(1);
      expect(result.iterations).toBeLessThanOrEqual(5);

      // Verify result contains price
      expect(result.response).toMatch(/\$|USD|price|bitcoin/i);

      console.log(`[TEST] Found Bitcoin price in ${result.iterations} iteration(s)`);
    }, GOAL_TIMEOUT);

    it('should emit TASK_COMPLETE when goal achieved', async () => {
      const result = await submitGoalTask(
        'What is 2 + 2?',
        'Simple math question - should complete in 1 iteration.'
      );

      expect(result.success).toBe(true);
      expect(result.response).toContain('[TASK_COMPLETE]');
      expect(result.iterations).toBe(1);

      console.log('[TEST] Verified TASK_COMPLETE signal on simple task');
    }, GOAL_TIMEOUT);

    it('should try alternative approaches when blocked', async () => {
      const result = await submitGoalTask(
        'Find information about open source licenses',
        'Search for information about MIT, GPL, and Apache licenses. If one source fails, try another. Extract key differences.'
      );

      expect(result.success).toBe(true);

      // Verify multiple approaches
      const approaches = verifyMultipleApproaches(result.actions);
      expect(approaches.count).toBeGreaterThanOrEqual(1);

      // Verify adaptive retry
      const retry = verifyAdaptiveRetry(result.actions);
      if (retry.hadFailures) {
        console.log(`[TEST] Recovered from ${retry.retryCount} failure(s) by trying alternatives`);
        expect(retry.recovered).toBe(true);
      }

      expect(result.cost).toBeLessThan(MAX_COST_PER_TASK);
    }, GOAL_TIMEOUT);
  });

  describe('Cost and Performance Metrics', () => {
    it('should maintain cost below $0.01 per task', async () => {
      const results = await Promise.all([
        submitGoalTask('What is the capital of France?'),
        submitGoalTask('Find the latest Node.js version'),
        submitGoalTask('Search for Python best practices'),
      ]);

      for (const result of results) {
        expect(result.cost).toBeLessThan(MAX_COST_PER_TASK);
        console.log(`[TEST] Task cost: $${result.cost?.toFixed(4)}`);
      }

      const avgCost = results.reduce((sum, r) => sum + (r.cost || 0), 0) / results.length;
      console.log(`[TEST] Average cost: $${avgCost.toFixed(4)}`);
      expect(avgCost).toBeLessThan(TARGET_COST_PER_TASK);
    }, GOAL_TIMEOUT * 3);

    it('should complete simple goals in < 1 minute', async () => {
      const result = await submitGoalTask(
        'Search for "React hooks tutorial"',
        'Quick search task'
      );

      expect(result.success).toBe(true);
      expect(result.duration).toBeLessThan(60000); // 60 seconds
      console.log(`[TEST] Completed in ${(result.duration! / 1000).toFixed(1)}s`);
    }, 120000); // 2 min timeout

    it('should track action success rate above 70%', async () => {
      const result = await submitGoalTask(
        'Find the weather in San Francisco',
        'Search for current weather in San Francisco. Extract temperature and conditions.'
      );

      expect(result.success).toBe(true);

      const successfulActions = result.actions.filter(a => a.success);
      const successRate = (successfulActions.length / result.actions.length) * 100;

      console.log(`[TEST] Action success rate: ${successRate.toFixed(1)}%`);
      expect(successRate).toBeGreaterThan(70);
    }, GOAL_TIMEOUT);
  });

  describe('Autonomous Decision Making', () => {
    it('should choose appropriate search engine autonomously', async () => {
      const result = await submitGoalTask(
        'Find information about TypeScript decorators'
      );

      expect(result.success).toBe(true);

      // Verify search was performed
      const searchActions = result.actions.filter(a => a.type === 'search');
      expect(searchActions.length).toBeGreaterThan(0);

      console.log('[TEST] Agent autonomously chose search strategy');
    }, GOAL_TIMEOUT);

    it('should decide when to extract vs when to browse', async () => {
      const result = await submitGoalTask(
        'Get me the top 5 headlines from Hacker News'
      );

      expect(result.success).toBe(true);

      // Should navigate AND extract
      const navActions = result.actions.filter(a => a.type === 'navigate' || a.type === 'browse');
      const extractActions = result.actions.filter(a => a.type === 'extract');

      expect(navActions.length).toBeGreaterThan(0);
      expect(extractActions.length).toBeGreaterThan(0);

      console.log('[TEST] Agent correctly combined navigation + extraction');
    }, GOAL_TIMEOUT);

    it('should autonomously verify success before completing', async () => {
      const result = await submitGoalTask(
        'Find the GitHub repository for React',
        'Search and verify you found the official React repo.'
      );

      expect(result.success).toBe(true);

      // Verify TASK_COMPLETE was emitted (autonomous verification)
      expect(result.response).toContain('[TASK_COMPLETE]');

      // Verify result contains github
      expect(result.response.toLowerCase()).toContain('github');

      console.log('[TEST] Agent autonomously verified success');
    }, GOAL_TIMEOUT);
  });

  describe('Error Recovery and Resilience', () => {
    it('should recover from 404 errors by trying alternatives', async () => {
      const result = await submitGoalTask(
        'Find documentation for a fictional framework called "NonExistentJS"',
        'Try to find docs. If you get 404s or no results, acknowledge that it doesn\'t exist and suggest alternatives.'
      );

      // Should complete with explanation
      expect(result.success).toBe(true);

      // Should mention not found or alternatives
      expect(result.response.toLowerCase()).toMatch(/not found|doesn't exist|alternative|similar/);

      console.log('[TEST] Agent gracefully handled non-existent resource');
    }, GOAL_TIMEOUT);

    it('should handle network errors with retries', async () => {
      const result = await submitGoalTask(
        'Search for "cloud computing basics"'
      );

      expect(result.success).toBe(true);

      // Check for any retries in action sequence
      const retry = verifyAdaptiveRetry(result.actions);
      if (retry.hadFailures) {
        console.log(`[TEST] Successfully recovered from network/browser errors`);
        expect(retry.recovered).toBe(true);
      }
    }, GOAL_TIMEOUT);

    it('should provide helpful feedback when goals are impossible', async () => {
      const result = await submitGoalTask(
        'Travel to Mars',
        'Obviously impossible goal - test graceful failure'
      );

      // Should complete with explanation
      expect(result.success).toBe(true);

      // Should explain limitations
      expect(result.response.toLowerCase()).toMatch(/cannot|unable|impossible|not possible/);

      console.log('[TEST] Agent explained why goal is unachievable');
    }, GOAL_TIMEOUT);
  });
});
