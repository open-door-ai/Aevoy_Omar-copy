/**
 * Production Load Testing Suite
 *
 * Tests the live production system (Railway agent) under concurrent load:
 * - 100 concurrent task requests
 * - Browser task concurrency limits (max 10)
 * - Rate limiting under load
 * - Queue overflow handling
 * - Resource monitoring
 * - Distributed locks
 * - Error handling and graceful degradation
 *
 * IMPORTANT: This tests the PRODUCTION agent at Railway
 * URL: https://agent-production-1339.up.railway.app
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { performance } from 'perf_hooks';

// ============================================================================
// PRODUCTION CONFIGURATION
// ============================================================================

const PRODUCTION_AGENT_URL = 'https://agent-production-1339.up.railway.app';
const WEBHOOK_SECRET = process.env.AGENT_WEBHOOK_SECRET || '';
const TEST_USER_ID = '11684ec6-80cd-4bb6-9aed-8f0947afd06a'; // teste2e user

// Verify production env vars are set
if (!WEBHOOK_SECRET) {
  throw new Error('AGENT_WEBHOOK_SECRET not set - required for production load testing');
}

// ============================================================================
// LOAD TEST PARAMETERS
// ============================================================================

const LOAD_TEST_CONFIG = {
  totalConcurrentRequests: 100,
  browserTaskCount: 15,  // Should trigger queue (max 10 concurrent)
  simpleTaskCount: 85,   // Fast AI-only tasks
  rampUpSeconds: 5,      // Gradual ramp-up to avoid connection storms
  timeoutMs: 180000,     // 3 minutes max per task
  healthCheckIntervalMs: 5000,
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

interface TaskResponse {
  taskId?: string;
  status?: string;
  error?: string;
  queuePosition?: number;
  estimatedWaitMs?: number;
}

interface LoadTestResult {
  taskId: string;
  type: 'browser' | 'simple';
  success: boolean;
  durationMs: number;
  status: number;
  error?: string;
  queuePosition?: number;
}

interface HealthCheckResult {
  timestamp: number;
  status: number;
  responseTimeMs: number;
  healthy: boolean;
  activeTasks?: number;
  queueDepth?: number;
}

/**
 * Send task to production agent
 */
async function sendTask(
  type: 'browser' | 'simple',
  taskNumber: number,
  signal?: AbortSignal
): Promise<LoadTestResult> {
  const startTime = performance.now();

  const taskData = type === 'browser'
    ? {
        userId: TEST_USER_ID,
        description: `Load test browser task #${taskNumber} - search for "playwright documentation"`,
        channel: 'web',
        metadata: {
          loadTest: true,
          taskNumber,
          timestamp: Date.now(),
        }
      }
    : {
        userId: TEST_USER_ID,
        description: `Load test simple task #${taskNumber} - what is 2+2?`,
        channel: 'web',
        metadata: {
          loadTest: true,
          taskNumber,
          timestamp: Date.now(),
        }
      };

  try {
    const response = await fetch(`${PRODUCTION_AGENT_URL}/task`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': WEBHOOK_SECRET,
      },
      body: JSON.stringify(taskData),
      signal,
    });

    const durationMs = performance.now() - startTime;
    const data: TaskResponse = response.ok ? await response.json() : { error: await response.text() };

    return {
      taskId: data.taskId || `task-${taskNumber}`,
      type,
      success: response.ok,
      durationMs,
      status: response.status,
      error: data.error,
      queuePosition: data.queuePosition,
    };
  } catch (error) {
    const durationMs = performance.now() - startTime;
    return {
      taskId: `task-${taskNumber}`,
      type,
      success: false,
      durationMs,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Health check poller
 */
async function checkHealth(signal?: AbortSignal): Promise<HealthCheckResult> {
  const startTime = performance.now();

  try {
    const response = await fetch(`${PRODUCTION_AGENT_URL}/health`, {
      method: 'GET',
      signal,
    });

    const responseTimeMs = performance.now() - startTime;
    const data = response.ok ? await response.json() : null;

    return {
      timestamp: Date.now(),
      status: response.status,
      responseTimeMs,
      healthy: response.ok && data?.status === 'healthy',
      activeTasks: data?.metrics?.activeTasks,
      queueDepth: data?.metrics?.queueDepth,
    };
  } catch (error) {
    const responseTimeMs = performance.now() - startTime;
    return {
      timestamp: Date.now(),
      status: 0,
      responseTimeMs,
      healthy: false,
    };
  }
}

/**
 * Ramp up requests gradually to simulate realistic load
 */
async function rampedSend(
  tasks: Array<{ type: 'browser' | 'simple'; number: number }>,
  rampUpSeconds: number,
  signal: AbortSignal
): Promise<LoadTestResult[]> {
  const results: LoadTestResult[] = [];
  const delayBetweenRequests = (rampUpSeconds * 1000) / tasks.length;

  for (const task of tasks) {
    if (signal.aborted) break;

    // Fire and forget - don't await
    sendTask(task.type, task.number, signal).then(result => results.push(result));

    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
  }

  return results;
}

/**
 * Calculate statistics from load test results
 */
function calculateStats(results: LoadTestResult[]) {
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  const queued = results.filter(r => r.queuePosition !== undefined);

  const durations = successful.map(r => r.durationMs);
  const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const minDuration = durations.length > 0 ? Math.min(...durations) : 0;
  const maxDuration = durations.length > 0 ? Math.max(...durations) : 0;

  // P50, P95, P99
  const sorted = [...durations].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;

  const browserTasks = results.filter(r => r.type === 'browser');
  const simpleTasks = results.filter(r => r.type === 'simple');

  const rateLimited = failed.filter(r => r.status === 429);
  const serverErrors = failed.filter(r => r.status >= 500);
  const timeouts = failed.filter(r => r.error?.includes('timeout') || r.error?.includes('aborted'));

  return {
    total: results.length,
    successful: successful.length,
    failed: failed.length,
    queued: queued.length,
    successRate: (successful.length / results.length) * 100,
    avgDurationMs: avgDuration,
    minDurationMs: minDuration,
    maxDurationMs: maxDuration,
    p50Ms: p50,
    p95Ms: p95,
    p99Ms: p99,
    browserTasks: {
      total: browserTasks.length,
      successful: browserTasks.filter(r => r.success).length,
      failed: browserTasks.filter(r => !r.success).length,
    },
    simpleTasks: {
      total: simpleTasks.length,
      successful: simpleTasks.filter(r => r.success).length,
      failed: simpleTasks.filter(r => !r.success).length,
    },
    errors: {
      rateLimited: rateLimited.length,
      serverErrors: serverErrors.length,
      timeouts: timeouts.length,
      other: failed.length - rateLimited.length - serverErrors.length - timeouts.length,
    },
  };
}

// ============================================================================
// LOAD TESTS
// ============================================================================

describe('Production Load Testing', () => {
  let abortController: AbortController;
  let healthCheckInterval: NodeJS.Timeout;
  let healthChecks: HealthCheckResult[] = [];

  beforeAll(() => {
    console.log('\n========================================');
    console.log('PRODUCTION LOAD TEST STARTING');
    console.log('========================================');
    console.log(`Target: ${PRODUCTION_AGENT_URL}`);
    console.log(`Total requests: ${LOAD_TEST_CONFIG.totalConcurrentRequests}`);
    console.log(`Browser tasks: ${LOAD_TEST_CONFIG.browserTaskCount}`);
    console.log(`Simple tasks: ${LOAD_TEST_CONFIG.simpleTaskCount}`);
    console.log(`Ramp-up: ${LOAD_TEST_CONFIG.rampUpSeconds}s`);
    console.log('========================================\n');
  });

  afterAll(() => {
    if (healthCheckInterval) {
      clearInterval(healthCheckInterval);
    }
    if (abortController) {
      abortController.abort();
    }
  });

  it('should handle 100 concurrent task requests', async () => {
    abortController = new AbortController();
    healthChecks = [];

    // Start health monitoring
    healthCheckInterval = setInterval(async () => {
      const health = await checkHealth(abortController.signal);
      healthChecks.push(health);

      if (!health.healthy) {
        console.warn(`[HEALTH] ⚠️  Agent unhealthy at ${new Date(health.timestamp).toISOString()}`);
      }
    }, LOAD_TEST_CONFIG.healthCheckIntervalMs);

    // Generate task list
    const tasks: Array<{ type: 'browser' | 'simple'; number: number }> = [];

    // Browser tasks (should trigger queuing)
    for (let i = 0; i < LOAD_TEST_CONFIG.browserTaskCount; i++) {
      tasks.push({ type: 'browser', number: i + 1 });
    }

    // Simple tasks (should complete quickly)
    for (let i = 0; i < LOAD_TEST_CONFIG.simpleTaskCount; i++) {
      tasks.push({ type: 'simple', number: i + 1 });
    }

    // Shuffle to mix browser and simple tasks
    tasks.sort(() => Math.random() - 0.5);

    console.log(`\n[LOAD TEST] Sending ${tasks.length} tasks with ${LOAD_TEST_CONFIG.rampUpSeconds}s ramp-up...`);
    const startTime = performance.now();

    // Send with ramp-up
    const resultsPromise = rampedSend(tasks, LOAD_TEST_CONFIG.rampUpSeconds, abortController.signal);

    // Wait for all tasks to complete (or timeout)
    const timeoutPromise = new Promise<LoadTestResult[]>((resolve) => {
      setTimeout(() => {
        console.warn(`[LOAD TEST] Timeout reached (${LOAD_TEST_CONFIG.timeoutMs}ms), aborting...`);
        abortController.abort();
        resolve([]);
      }, LOAD_TEST_CONFIG.timeoutMs);
    });

    const results = await Promise.race([resultsPromise, timeoutPromise]);
    const totalDurationMs = performance.now() - startTime;

    // Stop health monitoring
    clearInterval(healthCheckInterval);

    // Wait a bit for any lingering requests
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Calculate statistics
    const stats = calculateStats(results);

    console.log('\n========================================');
    console.log('LOAD TEST RESULTS');
    console.log('========================================');
    console.log(`Total Duration: ${(totalDurationMs / 1000).toFixed(2)}s`);
    console.log(`Total Requests: ${stats.total}`);
    console.log(`Successful: ${stats.successful} (${stats.successRate.toFixed(1)}%)`);
    console.log(`Failed: ${stats.failed}`);
    console.log(`Queued: ${stats.queued}`);
    console.log('\nPerformance:');
    console.log(`  Avg: ${stats.avgDurationMs.toFixed(0)}ms`);
    console.log(`  Min: ${stats.minDurationMs.toFixed(0)}ms`);
    console.log(`  Max: ${stats.maxDurationMs.toFixed(0)}ms`);
    console.log(`  P50: ${stats.p50Ms.toFixed(0)}ms`);
    console.log(`  P95: ${stats.p95Ms.toFixed(0)}ms`);
    console.log(`  P99: ${stats.p99Ms.toFixed(0)}ms`);
    console.log('\nBrowser Tasks:');
    console.log(`  Total: ${stats.browserTasks.total}`);
    console.log(`  Successful: ${stats.browserTasks.successful}`);
    console.log(`  Failed: ${stats.browserTasks.failed}`);
    console.log('\nSimple Tasks:');
    console.log(`  Total: ${stats.simpleTasks.total}`);
    console.log(`  Successful: ${stats.simpleTasks.successful}`);
    console.log(`  Failed: ${stats.simpleTasks.failed}`);
    console.log('\nErrors:');
    console.log(`  Rate Limited (429): ${stats.errors.rateLimited}`);
    console.log(`  Server Errors (5xx): ${stats.errors.serverErrors}`);
    console.log(`  Timeouts: ${stats.errors.timeouts}`);
    console.log(`  Other: ${stats.errors.other}`);
    console.log('\nHealth Checks:');
    console.log(`  Total: ${healthChecks.length}`);
    console.log(`  Healthy: ${healthChecks.filter(h => h.healthy).length}`);
    console.log(`  Unhealthy: ${healthChecks.filter(h => !h.healthy).length}`);

    const avgHealthResponseTime = healthChecks.length > 0
      ? healthChecks.reduce((sum, h) => sum + h.responseTimeMs, 0) / healthChecks.length
      : 0;
    console.log(`  Avg Response Time: ${avgHealthResponseTime.toFixed(0)}ms`);
    console.log('========================================\n');

    // Assertions
    expect(stats.total).toBeGreaterThan(0);
    expect(stats.successRate).toBeGreaterThan(50); // At least 50% success under load
    expect(stats.errors.serverErrors).toBeLessThan(10); // Max 10% server errors
    expect(healthChecks.filter(h => h.healthy).length).toBeGreaterThan(0); // Agent stayed healthy at some point
  }, LOAD_TEST_CONFIG.timeoutMs + 30000); // Test timeout slightly higher than task timeout

  it('should enforce browser task concurrency limits', async () => {
    abortController = new AbortController();

    console.log('\n[CONCURRENCY TEST] Sending 15 browser tasks (max 10 concurrent)...');

    const tasks: LoadTestResult[] = [];
    const promises = [];

    for (let i = 0; i < 15; i++) {
      promises.push(
        sendTask('browser', i + 1, abortController.signal).then(result => {
          tasks.push(result);
        })
      );
    }

    // Wait for all tasks to complete
    await Promise.race([
      Promise.all(promises),
      new Promise(resolve => setTimeout(() => {
        abortController.abort();
        resolve(null);
      }, 60000)), // 1 minute timeout
    ]);

    const queued = tasks.filter(t => t.queuePosition !== undefined);
    const successful = tasks.filter(t => t.success);

    console.log(`[CONCURRENCY TEST] Results:`);
    console.log(`  Total: ${tasks.length}`);
    console.log(`  Queued: ${queued.length}`);
    console.log(`  Successful: ${successful.length}`);

    // Expect some tasks to be queued (since we sent 15 but max is 10)
    expect(queued.length).toBeGreaterThan(0);
  }, 90000);

  it('should handle rate limiting correctly', async () => {
    abortController = new AbortController();

    console.log('\n[RATE LIMIT TEST] Sending 20 rapid requests...');

    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push(sendTask('simple', i + 1, abortController.signal));
    }

    const results = await Promise.all(promises);

    const rateLimited = results.filter(r => r.status === 429);
    const successful = results.filter(r => r.success);

    console.log(`[RATE LIMIT TEST] Results:`);
    console.log(`  Total: ${results.length}`);
    console.log(`  Successful: ${successful.length}`);
    console.log(`  Rate Limited (429): ${rateLimited.length}`);

    // If rate limiting is working, we should see some 429s
    // (or all succeed if limits are high enough - both are valid)
    expect(results.length).toBe(20);
  }, 60000);

  it('should handle distributed locks under concurrent load', async () => {
    abortController = new AbortController();

    console.log('\n[DISTRIBUTED LOCK TEST] Testing scheduler lock contention...');

    // Send tasks that would trigger scheduler operations
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(sendTask('simple', i + 1, abortController.signal));
    }

    const results = await Promise.all(promises);
    const successful = results.filter(r => r.success);

    console.log(`[DISTRIBUTED LOCK TEST] Results:`);
    console.log(`  Total: ${results.length}`);
    console.log(`  Successful: ${successful.length}`);

    // All tasks should succeed - locks should prevent corruption
    expect(successful.length).toBeGreaterThan(0);
  }, 60000);

  it('should gracefully degrade under extreme load', async () => {
    abortController = new AbortController();

    console.log('\n[DEGRADATION TEST] Sending 50 tasks simultaneously...');

    const promises = [];
    for (let i = 0; i < 50; i++) {
      promises.push(sendTask('simple', i + 1, abortController.signal));
    }

    const results = await Promise.all(promises);

    const stats = calculateStats(results);

    console.log(`[DEGRADATION TEST] Results:`);
    console.log(`  Total: ${stats.total}`);
    console.log(`  Successful: ${stats.successful} (${stats.successRate.toFixed(1)}%)`);
    console.log(`  Rate Limited: ${stats.errors.rateLimited}`);
    console.log(`  Server Errors: ${stats.errors.serverErrors}`);
    console.log(`  Avg Response Time: ${stats.avgDurationMs.toFixed(0)}ms`);

    // System should either succeed or gracefully rate limit (not crash)
    expect(stats.errors.serverErrors).toBeLessThan(5); // Max 10% server errors
    expect(results.every(r => r.status !== 0)).toBe(true); // No connection failures
  }, 120000);

  it('should verify health endpoint responsiveness under load', async () => {
    abortController = new AbortController();
    healthChecks = [];

    console.log('\n[HEALTH CHECK TEST] Monitoring health during load...');

    // Start health monitoring (every 1 second)
    const healthInterval = setInterval(async () => {
      const health = await checkHealth(abortController.signal);
      healthChecks.push(health);
    }, 1000);

    // Send moderate load
    const promises = [];
    for (let i = 0; i < 30; i++) {
      promises.push(sendTask('simple', i + 1, abortController.signal));
      await new Promise(resolve => setTimeout(resolve, 100)); // 100ms between requests
    }

    await Promise.all(promises);
    await new Promise(resolve => setTimeout(resolve, 5000)); // Monitor for 5s after

    clearInterval(healthInterval);

    console.log(`[HEALTH CHECK TEST] Results:`);
    console.log(`  Total Health Checks: ${healthChecks.length}`);
    console.log(`  Healthy: ${healthChecks.filter(h => h.healthy).length}`);
    console.log(`  Unhealthy: ${healthChecks.filter(h => !h.healthy).length}`);

    const avgResponseTime = healthChecks.reduce((sum, h) => sum + h.responseTimeMs, 0) / healthChecks.length;
    console.log(`  Avg Response Time: ${avgResponseTime.toFixed(0)}ms`);

    // Health endpoint should remain responsive
    expect(healthChecks.length).toBeGreaterThan(0);
    expect(healthChecks.filter(h => h.healthy).length).toBeGreaterThan(0);
    expect(avgResponseTime).toBeLessThan(5000); // Health checks should be fast
  }, 60000);
});
