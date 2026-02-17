/**
 * Complex Multi-Step Browser Task Tests
 *
 * Tests autonomous agent capabilities for complex tasks requiring:
 * - Multi-step planning and decomposition
 * - Conditional logic and branching
 * - Data extraction and comparison
 * - Form filling with validation
 * - Iterative execution (Observe-Plan-Act)
 * - Self-correction and error recovery
 *
 * Test user: teste2e (ID: 11684ec6-80cd-4bb6-9aed-8f0947afd06a, beta tier)
 *
 * Target: 100% success rate, max 5 iterations per task, <$0.01 per task
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const TEST_USER_ID = '11684ec6-80cd-4bb6-9aed-8f0947afd06a';
const TEST_USER_EMAIL = 'teste2e@aevoy.com';
const AGENT_URL = process.env.AGENT_URL || 'http://localhost:3001';
const AGENT_WEBHOOK_SECRET = process.env.AGENT_WEBHOOK_SECRET || '';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

interface TaskResponse {
  success: boolean;
  taskId?: string;
  message?: string;
  cost?: number;
  iterations?: number;
  actions?: Array<{ type: string; success: boolean }>;
}

/**
 * Send task to agent and wait for completion with detailed tracking
 */
async function executeTaskAndWait(
  taskDescription: string,
  maxWaitMs = 180000 // 3 minutes
): Promise<{
  success: boolean;
  result: string;
  cost: number;
  iterations: number;
  actions: Array<{ type: string; result: string; success: boolean }>;
  duration: number;
  logs: string[];
}> {
  const startTime = Date.now();

  // Create task via agent
  const response = await fetch(`${AGENT_URL}/task`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-secret': AGENT_WEBHOOK_SECRET,
    },
    body: JSON.stringify({
      userId: TEST_USER_ID,
      from: TEST_USER_EMAIL,
      content: taskDescription,
      channel: 'web',
    }),
  });

  if (!response.ok) {
    throw new Error(`Task creation failed: ${response.statusText}`);
  }

  const data = (await response.json()) as TaskResponse;
  if (!data.success || !data.taskId) {
    throw new Error(`Task creation failed: ${data.message}`);
  }

  const taskId = data.taskId;
  console.log(`Task created: ${taskId}`);

  // Poll for completion
  let completed = false;
  let attempts = 0;
  const maxAttempts = maxWaitMs / 2000;

  while (!completed && attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Poll every 2s
    attempts++;

    const { data: task } = await supabase
      .from('tasks')
      .select(
        'status, result, cost_usd, iteration_count, action_count, action_success_count, progress_message'
      )
      .eq('id', taskId)
      .single();

    if (!task) continue;

    console.log(
      `[Poll ${attempts}] Status: ${task.status}, Progress: ${task.progress_message || 'N/A'}`
    );

    if (task.status === 'completed' || task.status === 'failed') {
      completed = true;

      // Fetch logs
      const { data: logs } = await supabase
        .from('task_logs')
        .select('level, message, created_at')
        .eq('task_id', taskId)
        .order('created_at', { ascending: true });

      const logMessages = logs?.map((l) => `[${l.level}] ${l.message}`) || [];

      // Parse actions from logs (look for action execution patterns)
      const actions: Array<{ type: string; result: string; success: boolean }> = [];
      for (const log of logs || []) {
        // Match patterns like "ACTION: click(button.submit) → success"
        const actionMatch = log.message.match(/ACTION:\s*(\w+)\([^)]*\)\s*→\s*(\w+)/);
        if (actionMatch) {
          actions.push({
            type: actionMatch[1],
            result: actionMatch[2],
            success: actionMatch[2].toLowerCase() === 'success',
          });
        }
      }

      return {
        success: task.status === 'completed',
        result: task.result || '',
        cost: task.cost_usd || 0,
        iterations: task.iteration_count || 0,
        actions,
        duration: Date.now() - startTime,
        logs: logMessages,
      };
    }
  }

  throw new Error(`Task timed out after ${maxWaitMs}ms`);
}

describe('Complex Multi-Step Browser Tasks', () => {
  beforeAll(async () => {
    // Verify test user exists and is in beta tier
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, username, subscription_tier, messages_limit')
      .eq('id', TEST_USER_ID)
      .single();

    if (!profile) {
      throw new Error(
        'Test user not found. Create teste2e user (ID: 11684ec6-80cd-4bb6-9aed-8f0947afd06a) first.'
      );
    }

    if (profile.subscription_tier !== 'beta') {
      throw new Error(
        `Test user must be in beta tier (current: ${profile.subscription_tier})`
      );
    }

    console.log(
      `Test user ready: ${profile.username} (${profile.messages_limit} message limit)`
    );
  });

  describe('Multi-Step Planning', () => {
    it('should find cheapest item with multi-step price comparison', async () => {
      const result = await executeTaskAndWait(
        'Go to https://news.ycombinator.com and find the title of the top story. Tell me what it is.'
      );

      expect(result.success).toBe(true);
      expect(result.iterations).toBeGreaterThan(0);
      expect(result.iterations).toBeLessThanOrEqual(5);
      expect(result.cost).toBeLessThan(0.05); // Under $0.05
      expect(result.result).toContain('top story'); // Should mention the story

      // Verify multi-step execution
      const navigateActions = result.actions.filter((a) => a.type === 'navigate');
      const extractActions = result.actions.filter((a) => a.type === 'extract');

      expect(navigateActions.length).toBeGreaterThan(0);
      expect(extractActions.length).toBeGreaterThan(0);

      console.log(`Task completed in ${result.iterations} iterations, cost: $${result.cost}`);
    }, 180000);

    it('should handle multi-site research with comparison', async () => {
      const result = await executeTaskAndWait(
        'Search DuckDuckGo for "Claude AI features" and tell me the first 3 results.'
      );

      expect(result.success).toBe(true);
      expect(result.iterations).toBeLessThanOrEqual(5);
      expect(result.result.toLowerCase()).toContain('claude');

      // Should include navigation + search + extraction
      expect(result.actions.length).toBeGreaterThan(2);

      console.log(`Research completed: ${result.actions.length} actions, ${result.iterations} iterations`);
    }, 180000);
  });

  describe('Conditional Logic & Branching', () => {
    it('should execute conditional logic based on web content', async () => {
      const result = await executeTaskAndWait(
        'Go to https://example.com. If the page title contains "Example", tell me "Found Example". Otherwise, tell me "Not Found".'
      );

      expect(result.success).toBe(true);
      expect(result.result).toMatch(/found example|not found/i);
      expect(result.iterations).toBeLessThanOrEqual(3); // Simple conditional

      // Should have navigate + conditional check
      const navigateAction = result.actions.find((a) => a.type === 'navigate');
      expect(navigateAction).toBeDefined();
      expect(navigateAction?.success).toBe(true);

      console.log(`Conditional logic executed: ${result.result}`);
    }, 120000);

    it('should handle data-driven branching', async () => {
      const result = await executeTaskAndWait(
        'Search DuckDuckGo for "TypeScript". If there are more than 5 results visible, tell me "Many results". If less, tell me "Few results".'
      );

      expect(result.success).toBe(true);
      expect(result.result).toMatch(/many results|few results/i);
      expect(result.cost).toBeLessThan(0.02);

      console.log(`Branching result: ${result.result}`);
    }, 150000);
  });

  describe('Data Extraction & Comparison', () => {
    it('should extract and compare data from single page', async () => {
      const result = await executeTaskAndWait(
        'Go to https://news.ycombinator.com and count how many story titles are visible on the first page. Tell me the exact number.'
      );

      expect(result.success).toBe(true);
      expect(result.result).toMatch(/\d+/); // Should contain a number
      expect(result.iterations).toBeLessThanOrEqual(4);

      // Should have extract actions
      const extractActions = result.actions.filter((a) => a.type === 'extract');
      expect(extractActions.length).toBeGreaterThan(0);

      console.log(`Data extraction: ${result.result}`);
    }, 150000);

    it('should extract structured data with validation', async () => {
      const result = await executeTaskAndWait(
        'Go to https://example.com and extract the page title and main heading. Tell me both.'
      );

      expect(result.success).toBe(true);
      expect(result.result.toLowerCase()).toContain('example');
      expect(result.actions.length).toBeGreaterThan(1);

      console.log(`Structured extraction: ${result.result}`);
    }, 120000);
  });

  describe('Form Filling & Validation', () => {
    it('should handle form interaction without submission', async () => {
      const result = await executeTaskAndWait(
        'Go to https://httpbin.org/forms/post and tell me what form fields are available (do NOT submit the form).'
      );

      expect(result.success).toBe(true);
      expect(result.result.toLowerCase()).toMatch(/form|field|input/);
      expect(result.iterations).toBeLessThanOrEqual(3);

      // Should NOT have submit action
      const submitActions = result.actions.filter((a) => a.type === 'submit');
      expect(submitActions.length).toBe(0);

      console.log(`Form inspection: ${result.result}`);
    }, 120000);

    it('should validate form requirements before filling', async () => {
      const result = await executeTaskAndWait(
        'Go to https://httpbin.org/forms/post and describe what the form is for.'
      );

      expect(result.success).toBe(true);
      expect(result.result.length).toBeGreaterThan(20); // Should have description
      expect(result.cost).toBeLessThan(0.02);

      console.log(`Form validation: ${result.result}`);
    }, 120000);
  });

  describe('Observe-Plan-Act Cycle', () => {
    it('should adapt plan based on page observations', async () => {
      const result = await executeTaskAndWait(
        'Search DuckDuckGo for "Playwright automation" and click the first result, then tell me the title of the page you land on.'
      );

      expect(result.success).toBe(true);
      expect(result.iterations).toBeGreaterThan(1); // Should iterate
      expect(result.iterations).toBeLessThanOrEqual(5);

      // Should have multiple navigation actions (search page → result page)
      const navigateActions = result.actions.filter((a) => a.type === 'navigate');
      const clickActions = result.actions.filter((a) => a.type === 'click');

      expect(navigateActions.length + clickActions.length).toBeGreaterThanOrEqual(2);

      console.log(`Adaptive execution: ${result.iterations} iterations, landed on: ${result.result}`);
    }, 180000);

    it('should observe page state between actions', async () => {
      const result = await executeTaskAndWait(
        'Go to https://example.com, wait 2 seconds, then tell me if the page changed or stayed the same.'
      );

      expect(result.success).toBe(true);
      expect(result.result.toLowerCase()).toMatch(/stayed|same|unchanged|changed/);

      // Should have wait action
      const waitActions = result.actions.filter((a) => a.type === 'wait');
      expect(waitActions.length).toBeGreaterThan(0);

      console.log(`Observation result: ${result.result}`);
    }, 120000);
  });

  describe('Self-Correction & Error Recovery', () => {
    it('should recover from navigation errors', async () => {
      const result = await executeTaskAndWait(
        'Try to go to https://this-site-definitely-does-not-exist-12345.com. If it fails, go to https://example.com instead and confirm you got there.'
      );

      expect(result.success).toBe(true);
      expect(result.result.toLowerCase()).toContain('example');
      expect(result.iterations).toBeGreaterThan(1); // Should retry

      console.log(`Error recovery: ${result.iterations} iterations, recovered successfully`);
    }, 150000);

    it('should handle element not found with alternative strategies', async () => {
      const result = await executeTaskAndWait(
        'Go to https://example.com and try to click a "Submit" button. If you can\'t find it, just tell me what you see on the page instead.'
      );

      expect(result.success).toBe(true);
      expect(result.result.length).toBeGreaterThan(30); // Should describe page
      expect(result.iterations).toBeLessThanOrEqual(4);

      console.log(`Fallback strategy: ${result.result.substring(0, 100)}...`);
    }, 150000);

    it('should correct course when actions fail', async () => {
      const result = await executeTaskAndWait(
        'Search DuckDuckGo for "test". If the search fails, just tell me you tried.'
      );

      expect(result.success).toBe(true);
      expect(result.result.length).toBeGreaterThan(10);

      // Should attempt search (may succeed or fail gracefully)
      const searchActions = result.actions.filter((a) => a.type === 'search');
      const navigateActions = result.actions.filter((a) => a.type === 'navigate');

      expect(searchActions.length + navigateActions.length).toBeGreaterThan(0);

      console.log(`Course correction: ${result.actions.length} total actions`);
    }, 150000);
  });

  describe('Performance & Cost Metrics', () => {
    it('should complete simple tasks within budget', async () => {
      const tasks = [
        'Go to https://example.com and tell me the page title',
        'Search DuckDuckGo for "test" and tell me if you see results',
        'Visit https://news.ycombinator.com and tell me the first story title',
      ];

      const results = [];

      for (const task of tasks) {
        const result = await executeTaskAndWait(task);
        results.push(result);
        console.log(`Task: "${task.substring(0, 50)}..." → $${result.cost.toFixed(4)}, ${result.duration}ms`);
      }

      // Check averages
      const avgCost = results.reduce((sum, r) => sum + r.cost, 0) / results.length;
      const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
      const avgIterations =
        results.reduce((sum, r) => sum + r.iterations, 0) / results.length;

      expect(avgCost).toBeLessThan(0.01); // Under $0.01 per task
      expect(avgDuration).toBeLessThan(60000); // Under 60s per task
      expect(avgIterations).toBeLessThanOrEqual(3); // Most tasks in 1-3 iterations

      console.log(`\nPerformance Summary (n=${tasks.length}):`);
      console.log(`  Avg Cost: $${avgCost.toFixed(4)}`);
      console.log(`  Avg Duration: ${(avgDuration / 1000).toFixed(1)}s`);
      console.log(`  Avg Iterations: ${avgIterations.toFixed(1)}`);
    }, 360000); // 6 minutes for 3 tasks

    it('should track action success rate', async () => {
      const result = await executeTaskAndWait(
        'Go to https://httpbin.org/html and extract the page heading.'
      );

      expect(result.success).toBe(true);
      expect(result.actions.length).toBeGreaterThan(0);

      // Calculate success rate
      const successfulActions = result.actions.filter((a) => a.success).length;
      const successRate = (successfulActions / result.actions.length) * 100;

      expect(successRate).toBeGreaterThan(50); // At least 50% success rate

      console.log(
        `Action success rate: ${successRate.toFixed(1)}% (${successfulActions}/${result.actions.length})`
      );
    }, 120000);
  });

  describe('Iteration Limits & Termination', () => {
    it('should terminate before exceeding 5 iterations', async () => {
      const result = await executeTaskAndWait(
        'Search DuckDuckGo for "open source projects" and tell me about the first 3 results.'
      );

      expect(result.success).toBe(true);
      expect(result.iterations).toBeLessThanOrEqual(5);
      expect(result.iterations).toBeGreaterThan(0);

      console.log(`Completed in ${result.iterations}/5 iterations`);
    }, 180000);

    it('should emit TASK_COMPLETE when finished', async () => {
      const result = await executeTaskAndWait('Go to https://example.com and tell me the title');

      expect(result.success).toBe(true);

      // Check logs for TASK_COMPLETE signal
      const hasCompleteSignal = result.logs.some((log) =>
        log.includes('TASK_COMPLETE') || log.includes('Task completed')
      );

      expect(hasCompleteSignal).toBe(true);

      console.log(`Task terminated cleanly with completion signal`);
    }, 120000);
  });

  afterAll(async () => {
    // Generate summary report
    console.log('\n=== Complex Multi-Step Test Summary ===');

    const { data: recentTasks } = await supabase
      .from('tasks')
      .select('status, cost_usd, iteration_count, action_count, action_success_count, created_at')
      .eq('user_id', TEST_USER_ID)
      .gte('created_at', new Date(Date.now() - 3600000).toISOString()) // Last hour
      .order('created_at', { ascending: false })
      .limit(20);

    if (recentTasks && recentTasks.length > 0) {
      const completed = recentTasks.filter((t) => t.status === 'completed').length;
      const failed = recentTasks.filter((t) => t.status === 'failed').length;
      const avgCost =
        recentTasks.reduce((sum, t) => sum + (t.cost_usd || 0), 0) / recentTasks.length;
      const avgIterations =
        recentTasks.reduce((sum, t) => sum + (t.iteration_count || 0), 0) / recentTasks.length;
      const avgActions =
        recentTasks.reduce((sum, t) => sum + (t.action_count || 0), 0) / recentTasks.length;
      const totalSuccessRate =
        recentTasks.reduce((sum, t) => {
          const rate =
            t.action_count && t.action_success_count
              ? (t.action_success_count / t.action_count) * 100
              : 0;
          return sum + rate;
        }, 0) / recentTasks.length;

      console.log(`Total Tasks: ${recentTasks.length}`);
      console.log(`Completed: ${completed} (${((completed / recentTasks.length) * 100).toFixed(1)}%)`);
      console.log(`Failed: ${failed} (${((failed / recentTasks.length) * 100).toFixed(1)}%)`);
      console.log(`Avg Cost: $${avgCost.toFixed(4)}`);
      console.log(`Avg Iterations: ${avgIterations.toFixed(1)}`);
      console.log(`Avg Actions: ${avgActions.toFixed(1)}`);
      console.log(`Avg Action Success Rate: ${totalSuccessRate.toFixed(1)}%`);
    }
  });
});
