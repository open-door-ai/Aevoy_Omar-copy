/**
 * Integration Test Runner
 *
 * Runs E2E integration tests against the agent server.
 * Can run against local server or production.
 */

import { fakeEmailServer, enableTestMode, disableTestMode } from './fake-email-server.js';

export interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

export interface TestSuite {
  name: string;
  tests: Array<() => Promise<void>>;
}

export class IntegrationRunner {
  private results: TestResult[] = [];
  private startTime: number = 0;

  async runSuite(suite: TestSuite): Promise<{ passed: number; failed: number; total: number }> {
    console.log(`\n========== Running ${suite.name} ==========\n`);

    this.startTime = Date.now();
    enableTestMode();
    fakeEmailServer.reset();

    for (const test of suite.tests) {
      await this.runTest(test);
    }

    disableTestMode();

    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;

    console.log(`\n========== Results ==========`);
    console.log(`Total: ${this.results.length}`);
    console.log(`Passed: ${passed} ✅`);
    console.log(`Failed: ${failed} ❌`);
    console.log(`Duration: ${Date.now() - this.startTime}ms\n`);

    if (failed > 0) {
      console.log('\n========== Failures ==========');
      this.results
        .filter(r => !r.passed)
        .forEach(r => {
          console.log(`❌ ${r.name}`);
          console.log(`   Error: ${r.error}\n`);
        });
    }

    return { passed, failed, total: this.results.length };
  }

  private async runTest(test: () => Promise<void>): Promise<void> {
    const testName = test.name || 'Anonymous test';
    const testStart = Date.now();

    try {
      fakeEmailServer.reset();
      await test();
      const duration = Date.now() - testStart;
      this.results.push({ name: testName, passed: true, duration });
      console.log(`✅ ${testName} (${duration}ms)`);
    } catch (error) {
      const duration = Date.now() - testStart;
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.results.push({ name: testName, passed: false, duration, error: errorMsg });
      console.log(`❌ ${testName} (${duration}ms)`);
      console.log(`   ${errorMsg}`);
    }
  }

  getResults(): TestResult[] {
    return this.results;
  }
}

// Load test runner
export async function runLoadTest(
  concurrency: number,
  totalTasks: number,
  testFn: (taskId: number) => Promise<void>
): Promise<{
  successCount: number;
  failureCount: number;
  avgLatency: number;
  maxLatency: number;
  totalDuration: number;
}> {
  console.log(`\n========== Load Test: ${totalTasks} tasks (${concurrency} concurrent) ==========\n`);

  const startTime = Date.now();
  const results: Array<{ success: boolean; latency: number }> = [];

  // Run tasks in batches of `concurrency`
  for (let i = 0; i < totalTasks; i += concurrency) {
    const batch = [];
    for (let j = 0; j < concurrency && i + j < totalTasks; j++) {
      const taskId = i + j;
      const taskStart = Date.now();

      batch.push(
        testFn(taskId)
          .then(() => {
            const latency = Date.now() - taskStart;
            results.push({ success: true, latency });
          })
          .catch(() => {
            const latency = Date.now() - taskStart;
            results.push({ success: false, latency });
          })
      );
    }

    await Promise.all(batch);
  }

  const totalDuration = Date.now() - startTime;
  const successCount = results.filter(r => r.success).length;
  const failureCount = results.filter(r => !r.success).length;
  const latencies = results.map(r => r.latency);
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const maxLatency = Math.max(...latencies);

  console.log(`\n========== Load Test Results ==========`);
  console.log(`Total tasks: ${totalTasks}`);
  console.log(`Success: ${successCount} (${((successCount / totalTasks) * 100).toFixed(1)}%)`);
  console.log(`Failures: ${failureCount} (${((failureCount / totalTasks) * 100).toFixed(1)}%)`);
  console.log(`Avg latency: ${avgLatency.toFixed(0)}ms`);
  console.log(`Max latency: ${maxLatency}ms`);
  console.log(`Total duration: ${totalDuration}ms`);
  console.log(`Throughput: ${((totalTasks / totalDuration) * 1000).toFixed(1)} tasks/sec\n`);

  return { successCount, failureCount, avgLatency, maxLatency, totalDuration };
}
