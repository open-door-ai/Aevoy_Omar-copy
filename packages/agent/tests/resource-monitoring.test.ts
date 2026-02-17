/**
 * Resource Monitoring & Leak Detection Test
 *
 * Monitors Railway agent resource usage during load:
 * - Memory usage patterns
 * - Connection pool exhaustion
 * - Database query performance
 * - Memory leak detection
 * - CPU usage patterns
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { performance } from 'perf_hooks';

// ============================================================================
// CONFIGURATION
// ============================================================================

const PRODUCTION_AGENT_URL = 'https://agent-production-1339.up.railway.app';
const WEBHOOK_SECRET = process.env.AGENT_WEBHOOK_SECRET || '';
const TEST_USER_ID = '11684ec6-80cd-4bb6-9aed-8f0947afd06a';

if (!WEBHOOK_SECRET) {
  throw new Error('AGENT_WEBHOOK_SECRET required');
}

// ============================================================================
// TYPES
// ============================================================================

interface ResourceSnapshot {
  timestamp: number;
  memoryUsageMB?: number;
  activeTasks?: number;
  queueDepth?: number;
  dbConnections?: number;
  cpuPercent?: number;
  responseTimeMs: number;
  healthy: boolean;
}

interface MemoryTrend {
  startMB: number;
  endMB: number;
  peakMB: number;
  growthMB: number;
  growthPercent: number;
  leakDetected: boolean;
  averageMB: number;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get detailed health metrics from agent
 */
async function getResourceSnapshot(signal?: AbortSignal): Promise<ResourceSnapshot> {
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
      memoryUsageMB: data?.metrics?.memoryUsageMB,
      activeTasks: data?.metrics?.activeTasks,
      queueDepth: data?.metrics?.queueDepth,
      dbConnections: data?.metrics?.dbConnections,
      cpuPercent: data?.metrics?.cpuPercent,
      responseTimeMs,
      healthy: response.ok && data?.status === 'healthy',
    };
  } catch (error) {
    const responseTimeMs = performance.now() - startTime;
    return {
      timestamp: Date.now(),
      responseTimeMs,
      healthy: false,
    };
  }
}

/**
 * Send task to agent
 */
async function sendTask(
  description: string,
  signal?: AbortSignal
): Promise<{ success: boolean; taskId?: string }> {
  try {
    const response = await fetch(`${PRODUCTION_AGENT_URL}/task`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        userId: TEST_USER_ID,
        description,
        channel: 'web',
        metadata: { resourceTest: true },
      }),
      signal,
    });

    const data = response.ok ? await response.json() : null;
    return { success: response.ok, taskId: data?.taskId };
  } catch (error) {
    return { success: false };
  }
}

/**
 * Analyze memory trends for leak detection
 */
function analyzeMemoryTrend(snapshots: ResourceSnapshot[]): MemoryTrend {
  const memoryValues = snapshots
    .map(s => s.memoryUsageMB)
    .filter((m): m is number => m !== undefined);

  if (memoryValues.length === 0) {
    return {
      startMB: 0,
      endMB: 0,
      peakMB: 0,
      growthMB: 0,
      growthPercent: 0,
      leakDetected: false,
      averageMB: 0,
    };
  }

  const startMB = memoryValues[0];
  const endMB = memoryValues[memoryValues.length - 1];
  const peakMB = Math.max(...memoryValues);
  const averageMB = memoryValues.reduce((sum, m) => sum + m, 0) / memoryValues.length;
  const growthMB = endMB - startMB;
  const growthPercent = (growthMB / startMB) * 100;

  // Detect memory leak: sustained growth >20% without stabilization
  const lastQuarter = memoryValues.slice(Math.floor(memoryValues.length * 0.75));
  const avgLastQuarter = lastQuarter.reduce((sum, m) => sum + m, 0) / lastQuarter.length;
  const leakDetected = growthPercent > 20 && avgLastQuarter > averageMB * 1.15;

  return {
    startMB,
    endMB,
    peakMB,
    growthMB,
    growthPercent,
    leakDetected,
    averageMB,
  };
}

/**
 * Calculate response time percentiles
 */
function calculatePercentiles(values: number[]): { p50: number; p95: number; p99: number } {
  if (values.length === 0) return { p50: 0, p95: 0, p99: 0 };

  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: sorted[Math.floor(sorted.length * 0.5)] || 0,
    p95: sorted[Math.floor(sorted.length * 0.95)] || 0,
    p99: sorted[Math.floor(sorted.length * 0.99)] || 0,
  };
}

// ============================================================================
// RESOURCE MONITORING TESTS
// ============================================================================

describe('Resource Monitoring & Leak Detection', () => {
  let abortController: AbortController;

  afterAll(() => {
    if (abortController) {
      abortController.abort();
    }
  });

  it('should monitor memory usage during sustained load', async () => {
    abortController = new AbortController();
    const snapshots: ResourceSnapshot[] = [];

    console.log('\n[MEMORY TEST] Starting 2-minute sustained load test...');

    // Monitor every 5 seconds for 2 minutes
    const monitoringInterval = setInterval(async () => {
      const snapshot = await getResourceSnapshot(abortController.signal);
      snapshots.push(snapshot);

      if (snapshot.memoryUsageMB) {
        console.log(`  [${new Date(snapshot.timestamp).toISOString()}] Memory: ${snapshot.memoryUsageMB.toFixed(1)}MB, Active: ${snapshot.activeTasks || 0}, Queue: ${snapshot.queueDepth || 0}`);
      }
    }, 5000);

    // Send steady stream of tasks (1 every 2 seconds)
    const taskInterval = setInterval(async () => {
      await sendTask('Memory test task - what is the capital of France?', abortController.signal);
    }, 2000);

    // Run for 2 minutes
    await new Promise(resolve => setTimeout(resolve, 120000));

    clearInterval(monitoringInterval);
    clearInterval(taskInterval);

    // Analyze memory trend
    const memoryTrend = analyzeMemoryTrend(snapshots);

    console.log('\n[MEMORY TEST] Results:');
    console.log(`  Start Memory: ${memoryTrend.startMB.toFixed(1)}MB`);
    console.log(`  End Memory: ${memoryTrend.endMB.toFixed(1)}MB`);
    console.log(`  Peak Memory: ${memoryTrend.peakMB.toFixed(1)}MB`);
    console.log(`  Average Memory: ${memoryTrend.averageMB.toFixed(1)}MB`);
    console.log(`  Growth: ${memoryTrend.growthMB > 0 ? '+' : ''}${memoryTrend.growthMB.toFixed(1)}MB (${memoryTrend.growthPercent.toFixed(1)}%)`);
    console.log(`  Leak Detected: ${memoryTrend.leakDetected ? '⚠️  YES' : '✅ NO'}`);

    // Assertions
    expect(snapshots.length).toBeGreaterThan(10); // Should have multiple snapshots
    expect(memoryTrend.leakDetected).toBe(false); // No memory leak
    expect(memoryTrend.growthPercent).toBeLessThan(50); // Memory growth <50%
  }, 150000); // 2.5 minutes timeout

  it('should detect connection pool exhaustion', async () => {
    abortController = new AbortController();
    const snapshots: ResourceSnapshot[] = [];

    console.log('\n[CONNECTION POOL TEST] Sending 50 concurrent tasks...');

    // Monitor connections
    const monitoringInterval = setInterval(async () => {
      const snapshot = await getResourceSnapshot(abortController.signal);
      snapshots.push(snapshot);

      if (snapshot.dbConnections !== undefined) {
        console.log(`  [${new Date(snapshot.timestamp).toISOString()}] DB Connections: ${snapshot.dbConnections}, Active Tasks: ${snapshot.activeTasks || 0}`);
      }
    }, 1000);

    // Send 50 concurrent tasks
    const promises = [];
    for (let i = 0; i < 50; i++) {
      promises.push(sendTask(`Connection pool test ${i + 1}`, abortController.signal));
    }

    await Promise.all(promises);

    // Monitor for another 10 seconds
    await new Promise(resolve => setTimeout(resolve, 10000));

    clearInterval(monitoringInterval);

    const maxConnections = Math.max(
      ...snapshots.map(s => s.dbConnections || 0)
    );

    const avgConnections = snapshots
      .filter(s => s.dbConnections !== undefined)
      .reduce((sum, s) => sum + (s.dbConnections || 0), 0) / snapshots.filter(s => s.dbConnections !== undefined).length;

    console.log('\n[CONNECTION POOL TEST] Results:');
    console.log(`  Max Connections: ${maxConnections}`);
    console.log(`  Avg Connections: ${avgConnections.toFixed(1)}`);

    // Supabase connection limit is typically 25-100 depending on plan
    expect(maxConnections).toBeLessThan(100); // Should not exhaust pool
  }, 90000);

  it('should measure response time degradation under load', async () => {
    abortController = new AbortController();
    const snapshots: ResourceSnapshot[] = [];

    console.log('\n[RESPONSE TIME TEST] Measuring health endpoint performance...');

    // Take baseline measurements (no load)
    console.log('  Phase 1: Baseline (no load)');
    for (let i = 0; i < 10; i++) {
      const snapshot = await getResourceSnapshot(abortController.signal);
      snapshots.push(snapshot);
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const baselineResponseTimes = snapshots.map(s => s.responseTimeMs);
    const baselineP50 = calculatePercentiles(baselineResponseTimes).p50;

    // Send moderate load
    console.log('  Phase 2: Moderate load (20 tasks)');
    const loadPromises = [];
    for (let i = 0; i < 20; i++) {
      loadPromises.push(sendTask(`Load test ${i + 1}`, abortController.signal));
    }

    // Measure during load
    const loadSnapshots: ResourceSnapshot[] = [];
    const loadInterval = setInterval(async () => {
      const snapshot = await getResourceSnapshot(abortController.signal);
      loadSnapshots.push(snapshot);
    }, 500);

    await Promise.all(loadPromises);
    await new Promise(resolve => setTimeout(resolve, 5000));

    clearInterval(loadInterval);

    const loadResponseTimes = loadSnapshots.map(s => s.responseTimeMs);
    const loadP50 = calculatePercentiles(loadResponseTimes).p50;
    const loadP95 = calculatePercentiles(loadResponseTimes).p95;

    const degradation = ((loadP50 - baselineP50) / baselineP50) * 100;

    console.log('\n[RESPONSE TIME TEST] Results:');
    console.log(`  Baseline P50: ${baselineP50.toFixed(0)}ms`);
    console.log(`  Load P50: ${loadP50.toFixed(0)}ms`);
    console.log(`  Load P95: ${loadP95.toFixed(0)}ms`);
    console.log(`  Degradation: ${degradation > 0 ? '+' : ''}${degradation.toFixed(1)}%`);

    // Response time should not degrade >200% under moderate load
    expect(degradation).toBeLessThan(200);
    expect(loadP95).toBeLessThan(5000); // P95 should be <5s
  }, 60000);

  it('should verify recovery after load spike', async () => {
    abortController = new AbortController();

    console.log('\n[RECOVERY TEST] Testing recovery after load spike...');

    // Take baseline
    console.log('  Phase 1: Baseline');
    const baselineSnapshot = await getResourceSnapshot(abortController.signal);

    // Send load spike (30 concurrent tasks)
    console.log('  Phase 2: Load spike (30 tasks)');
    const promises = [];
    for (let i = 0; i < 30; i++) {
      promises.push(sendTask(`Recovery test ${i + 1}`, abortController.signal));
    }

    await Promise.all(promises);

    // Wait for recovery
    console.log('  Phase 3: Recovery (waiting 30s)');
    await new Promise(resolve => setTimeout(resolve, 30000));

    // Check if system recovered
    const recoverySnapshot = await getResourceSnapshot(abortController.signal);

    console.log('\n[RECOVERY TEST] Results:');
    console.log(`  Baseline:`);
    console.log(`    Memory: ${baselineSnapshot.memoryUsageMB?.toFixed(1) || 'N/A'}MB`);
    console.log(`    Active Tasks: ${baselineSnapshot.activeTasks || 0}`);
    console.log(`    Queue Depth: ${baselineSnapshot.queueDepth || 0}`);
    console.log(`  After Recovery:`);
    console.log(`    Memory: ${recoverySnapshot.memoryUsageMB?.toFixed(1) || 'N/A'}MB`);
    console.log(`    Active Tasks: ${recoverySnapshot.activeTasks || 0}`);
    console.log(`    Queue Depth: ${recoverySnapshot.queueDepth || 0}`);

    // System should recover
    expect(recoverySnapshot.healthy).toBe(true);
    expect(recoverySnapshot.activeTasks || 0).toBeLessThan(5); // Most tasks should be done
    expect(recoverySnapshot.queueDepth || 0).toBeLessThan(3); // Queue should be clear
  }, 90000);

  it('should measure database query performance under load', async () => {
    abortController = new AbortController();

    console.log('\n[DB PERFORMANCE TEST] Testing query performance...');

    // Send tasks that require DB operations
    const promises = [];
    const startTime = performance.now();

    for (let i = 0; i < 20; i++) {
      promises.push(sendTask(`DB test ${i + 1}`, abortController.signal));
    }

    await Promise.all(promises);
    const totalDuration = performance.now() - startTime;

    const avgTaskDuration = totalDuration / 20;

    console.log('\n[DB PERFORMANCE TEST] Results:');
    console.log(`  Total Duration: ${(totalDuration / 1000).toFixed(2)}s`);
    console.log(`  Avg Task Duration: ${avgTaskDuration.toFixed(0)}ms`);

    // Database should handle 20 concurrent queries efficiently
    expect(avgTaskDuration).toBeLessThan(10000); // Avg <10s per task
  }, 90000);

  it('should verify no resource leaks after 100 tasks', async () => {
    abortController = new AbortController();

    console.log('\n[LEAK TEST] Running 100 tasks and monitoring resources...');

    // Take initial snapshot
    const initialSnapshot = await getResourceSnapshot(abortController.signal);
    console.log(`  Initial Memory: ${initialSnapshot.memoryUsageMB?.toFixed(1) || 'N/A'}MB`);

    // Run 100 tasks in batches of 10
    for (let batch = 0; batch < 10; batch++) {
      const promises = [];
      for (let i = 0; i < 10; i++) {
        const taskNum = batch * 10 + i + 1;
        promises.push(sendTask(`Leak test ${taskNum}`, abortController.signal));
      }

      await Promise.all(promises);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Brief pause between batches

      const batchSnapshot = await getResourceSnapshot(abortController.signal);
      console.log(`  Batch ${batch + 1}/10: Memory: ${batchSnapshot.memoryUsageMB?.toFixed(1) || 'N/A'}MB, Active: ${batchSnapshot.activeTasks || 0}`);
    }

    // Wait for cleanup
    console.log('  Waiting for cleanup (15s)...');
    await new Promise(resolve => setTimeout(resolve, 15000));

    // Take final snapshot
    const finalSnapshot = await getResourceSnapshot(abortController.signal);

    const memoryGrowth = (finalSnapshot.memoryUsageMB || 0) - (initialSnapshot.memoryUsageMB || 0);
    const memoryGrowthPercent = ((finalSnapshot.memoryUsageMB || 0) / (initialSnapshot.memoryUsageMB || 1) - 1) * 100;

    console.log('\n[LEAK TEST] Results:');
    console.log(`  Initial Memory: ${initialSnapshot.memoryUsageMB?.toFixed(1) || 'N/A'}MB`);
    console.log(`  Final Memory: ${finalSnapshot.memoryUsageMB?.toFixed(1) || 'N/A'}MB`);
    console.log(`  Growth: ${memoryGrowth > 0 ? '+' : ''}${memoryGrowth.toFixed(1)}MB (${memoryGrowthPercent.toFixed(1)}%)`);
    console.log(`  Active Tasks: ${finalSnapshot.activeTasks || 0}`);

    // Memory growth should be minimal after 100 tasks
    expect(memoryGrowthPercent).toBeLessThan(30); // <30% growth is acceptable
    expect(finalSnapshot.activeTasks || 0).toBeLessThan(5); // Cleanup completed
  }, 300000); // 5 minutes timeout
});
