/**
 * Complex Multi-Step Browser Task Tests (Sequential)
 *
 * Sequential test execution to respect rate limits (10 tasks/min).
 * Tests autonomous agent capabilities:
 * - Multi-step planning
 * - Conditional logic
 * - Data extraction
 * - Observe-Plan-Act cycle
 * - Error recovery
 *
 * Test user: teste2e (ID: 11684ec6-80cd-4bb6-9aed-8f0947afd06a, beta tier)
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

interface TaskResult {
  success: boolean;
  result: string;
  cost: number;
  iterations: number;
  actions: Array<{ type: string; result: string; success: boolean }>;
  duration: number;
  logs: string[];
}

/**
 * Send task to agent and wait for completion
 */
async function executeTaskAndWait(
  taskDescription: string,
  maxWaitMs = 180000 // 3 minutes
): Promise<TaskResult> {
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
    const errorText = await response.text();
    throw new Error(`Task creation failed: ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  if (!data.success || !data.taskId) {
    throw new Error(`Task creation failed: ${data.message}`);
  }

  const taskId = data.taskId;
  console.log(`\n[${new Date().toISOString()}] Task created: ${taskId}`);
  console.log(`Task: "${taskDescription.substring(0, 80)}..."`);

  // Poll for completion
  let completed = false;
  let attempts = 0;
  const maxAttempts = maxWaitMs / 3000; // Poll every 3s

  while (!completed && attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    attempts++;

    const { data: task } = await supabase
      .from('tasks')
      .select('status, result, cost_usd, iteration_count, action_count, action_success_count, progress_message')
      .eq('id', taskId)
      .single();

    if (!task) continue;

    console.log(`[Poll ${attempts}/${Math.floor(maxAttempts)}] Status: ${task.status}, Progress: ${task.progress_message || 'N/A'}`);

    if (task.status === 'completed' || task.status === 'failed') {
      completed = true;

      // Fetch logs
      const { data: logs } = await supabase
        .from('task_logs')
        .select('level, message, created_at')
        .eq('task_id', taskId)
        .order('created_at', { ascending: true });

      const logMessages = logs?.map((l) => `[${l.level}] ${l.message}`) || [];

      // Parse actions from logs
      const actions: Array<{ type: string; result: string; success: boolean }> = [];
      for (const log of logs || []) {
        const actionMatch = log.message.match(/ACTION:\s*(\w+)\([^)]*\)\s*→\s*(\w+)/);
        if (actionMatch) {
          actions.push({
            type: actionMatch[1],
            result: actionMatch[2],
            success: actionMatch[2].toLowerCase() === 'success',
          });
        }
      }

      const finalResult: TaskResult = {
        success: task.status === 'completed',
        result: task.result || '',
        cost: task.cost_usd || 0,
        iterations: task.iteration_count || 0,
        actions,
        duration: Date.now() - startTime,
        logs: logMessages,
      };

      console.log(`Task ${task.status}: $${finalResult.cost.toFixed(4)}, ${finalResult.iterations} iterations, ${finalResult.duration}ms`);
      if (!finalResult.success) {
        console.log(`Failed result: ${finalResult.result}`);
      }

      return finalResult;
    }
  }

  throw new Error(`Task timed out after ${maxWaitMs}ms`);
}

/**
 * Sleep to avoid rate limits (10 tasks/min = 1 task per 6 seconds)
 */
async function respectRateLimit() {
  console.log('Waiting 7 seconds to respect rate limits...');
  await new Promise(resolve => setTimeout(resolve, 7000));
}

describe('Complex Multi-Step Tasks (Sequential)', () => {
  beforeAll(async () => {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, username, subscription_tier, messages_limit')
      .eq('id', TEST_USER_ID)
      .single();

    if (!profile) {
      throw new Error('Test user not found');
    }

    if (profile.subscription_tier !== 'beta') {
      throw new Error(`Test user must be in beta tier (current: ${profile.subscription_tier})`);
    }

    console.log(`\n=== Test Suite Started ===`);
    console.log(`User: ${profile.username}`);
    console.log(`Tier: ${profile.subscription_tier}`);
    console.log(`Limit: ${profile.messages_limit} messages`);
    console.log(`Agent: ${AGENT_URL}`);
    console.log(`==========================\n`);
  });

  it('TEST 1: Simple page navigation and data extraction', async () => {
    const result = await executeTaskAndWait(
      'Go to https://example.com and tell me the page title.'
    );

    expect(result.success).toBe(true);
    expect(result.result.toLowerCase()).toContain('example');
    expect(result.iterations).toBeLessThanOrEqual(3);
    expect(result.cost).toBeLessThan(0.02);

    await respectRateLimit();
  }, 200000);

  it('TEST 2: Multi-step research with navigation', async () => {
    const result = await executeTaskAndWait(
      'Go to https://news.ycombinator.com and find the title of the top story. Tell me what it is.'
    );

    expect(result.success).toBe(true);
    expect(result.iterations).toBeGreaterThan(0);
    expect(result.iterations).toBeLessThanOrEqual(5);
    expect(result.cost).toBeLessThan(0.05);
    expect(result.result.length).toBeGreaterThan(10);

    const navigateActions = result.actions.filter((a) => a.type === 'navigate');
    expect(navigateActions.length).toBeGreaterThan(0);

    await respectRateLimit();
  }, 200000);

  it('TEST 3: Search engine interaction', async () => {
    const result = await executeTaskAndWait(
      'Search DuckDuckGo for "TypeScript documentation" and tell me if you see results.'
    );

    expect(result.success).toBe(true);
    expect(result.iterations).toBeLessThanOrEqual(5);
    expect(result.result.toLowerCase()).toMatch(/result|search|found|yes|no/);

    await respectRateLimit();
  }, 200000);

  it('TEST 4: Conditional logic based on page content', async () => {
    const result = await executeTaskAndWait(
      'Go to https://example.com. If the page title contains "Example", tell me "Found Example". Otherwise, tell me "Not Found".'
    );

    expect(result.success).toBe(true);
    expect(result.result).toMatch(/found example|not found/i);
    expect(result.iterations).toBeLessThanOrEqual(3);

    const navigateAction = result.actions.find((a) => a.type === 'navigate');
    expect(navigateAction).toBeDefined();

    await respectRateLimit();
  }, 180000);

  it('TEST 5: Data extraction and counting', async () => {
    const result = await executeTaskAndWait(
      'Go to https://news.ycombinator.com and tell me approximately how many story titles you see.'
    );

    expect(result.success).toBe(true);
    expect(result.result).toMatch(/\d+|many|several|few/i);
    expect(result.iterations).toBeLessThanOrEqual(4);

    await respectRateLimit();
  }, 180000);

  it('TEST 6: Form inspection without submission', async () => {
    const result = await executeTaskAndWait(
      'Go to https://httpbin.org/forms/post and tell me what form fields are available. Do NOT submit the form.'
    );

    expect(result.success).toBe(true);
    expect(result.result.toLowerCase()).toMatch(/form|field|input/);
    expect(result.iterations).toBeLessThanOrEqual(3);

    // Should NOT have submit action
    const submitActions = result.actions.filter((a) => a.type === 'submit');
    expect(submitActions.length).toBe(0);

    await respectRateLimit();
  }, 180000);

  it('TEST 7: Multi-step navigation with click', async () => {
    const result = await executeTaskAndWait(
      'Go to https://news.ycombinator.com and tell me what happens if you click the "new" link at the top.'
    );

    expect(result.success).toBe(true);
    expect(result.iterations).toBeGreaterThan(1);
    expect(result.iterations).toBeLessThanOrEqual(5);

    await respectRateLimit();
  }, 200000);

  it('TEST 8: Error recovery from bad URL', async () => {
    const result = await executeTaskAndWait(
      'Try to go to https://this-site-does-not-exist-12345.com. If it fails, go to https://example.com instead and tell me you recovered.'
    );

    expect(result.success).toBe(true);
    expect(result.result.toLowerCase()).toMatch(/recover|example|success|instead/);
    expect(result.iterations).toBeGreaterThan(1);

    await respectRateLimit();
  }, 180000);

  afterAll(async () => {
    console.log('\n\n=== Test Suite Complete ===');

    // Generate summary report
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
      const avgCost = recentTasks.reduce((sum, t) => sum + (t.cost_usd || 0), 0) / recentTasks.length;
      const avgIterations = recentTasks.reduce((sum, t) => sum + (t.iteration_count || 0), 0) / recentTasks.length;
      const avgActions = recentTasks.reduce((sum, t) => sum + (t.action_count || 0), 0) / recentTasks.length;
      const avgSuccessRate = recentTasks.reduce((sum, t) => {
        const rate = t.action_count && t.action_success_count
          ? (t.action_success_count / t.action_count) * 100
          : 0;
        return sum + rate;
      }, 0) / recentTasks.length;

      console.log(`\nSummary (last hour):`);
      console.log(`  Total Tasks: ${recentTasks.length}`);
      console.log(`  Completed: ${completed} (${((completed / recentTasks.length) * 100).toFixed(1)}%)`);
      console.log(`  Failed: ${failed} (${((failed / recentTasks.length) * 100).toFixed(1)}%)`);
      console.log(`  Avg Cost: $${avgCost.toFixed(4)}`);
      console.log(`  Avg Iterations: ${avgIterations.toFixed(1)}`);
      console.log(`  Avg Actions: ${avgActions.toFixed(1)}`);
      console.log(`  Avg Action Success: ${avgSuccessRate.toFixed(1)}%`);
    }

    console.log('==========================\n');
  });
});
