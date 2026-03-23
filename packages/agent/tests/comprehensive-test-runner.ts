/**
 * Comprehensive Test Runner
 *
 * Runs all test suites 6 times each as requested for 1,000,000% verification.
 * Continuous testing with detailed reporting.
 */

import { execSync } from 'child_process';

const TEST_SUITES = [
  {
    name: 'Cost Tracking',
    command: 'pnpm exec tsx tests/cost-tracking-test.ts',
    criticalLevel: 'HIGH',
  },
  {
    name: 'CAPTCHA Validation',
    command: 'pnpm exec tsx tests/run-captcha-validation.ts',
    criticalLevel: 'CRITICAL',
  },
  {
    name: 'Rate Limiting',
    command: 'pnpm exec tsx tests/run-rate-limit-validation.ts',
    criticalLevel: 'HIGH',
  },
  {
    name: 'Budget Enforcement',
    command: 'pnpm exec tsx tests/test-budget-enforcement.ts',
    criticalLevel: 'CRITICAL',
  },
  {
    name: 'Billing Flip Switch',
    command: 'pnpm exec tsx tests/billing-flip-switch.test.ts',
    criticalLevel: 'CRITICAL',
  },
  {
    name: 'Phone Cost Calculator',
    command: 'pnpm exec tsx tests/phone-cost-calculator.test.ts',
    criticalLevel: 'MEDIUM',
  },
  {
    name: 'OAuth Sessions',
    command: 'pnpm exec tsx tests/security-oauth-sessions.test.ts',
    criticalLevel: 'HIGH',
  },
  {
    name: 'Security Rate Limiting',
    command: 'pnpm exec tsx tests/security-rate-limiting.test.ts',
    criticalLevel: 'HIGH',
  },
  {
    name: 'XSS Protection',
    command: 'pnpm exec tsx tests/security-xss-protection.test.ts',
    criticalLevel: 'CRITICAL',
  },
];

const ITERATIONS = 6;

interface TestResult {
  suite: string;
  iteration: number;
  success: boolean;
  duration: number;
  output?: string;
  error?: string;
}

const results: TestResult[] = [];
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

async function runTest(suite: typeof TEST_SUITES[0], iteration: number): Promise<TestResult> {
  const startTime = Date.now();

  console.log(`\n[${'='.repeat(60)}]`);
  console.log(`[RUN ${iteration + 1}/${ITERATIONS}] ${suite.name} (${suite.criticalLevel})`);
  console.log(`[${'='.repeat(60)}]\n`);

  try {
    const output = execSync(suite.command, {
      cwd: '/workspaces/Aurora_Omar-copy/packages/agent',
      encoding: 'utf-8',
      timeout: 120000, // 2 min timeout per test
    });

    const duration = Date.now() - startTime;
    console.log(`✓ PASS (${duration}ms)\n`);

    return {
      suite: suite.name,
      iteration: iteration + 1,
      success: true,
      duration,
      output,
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error(`✗ FAIL (${duration}ms)`);
    console.error(`Error: ${error.message}\n`);

    return {
      suite: suite.name,
      iteration: iteration + 1,
      success: false,
      duration,
      error: error.message,
      output: error.stdout || error.stderr,
    };
  }
}

async function main() {
  console.log('\n\n');
  console.log('═'.repeat(80));
  console.log('  COMPREHENSIVE TEST SUITE - 1,000,000% VERIFICATION');
  console.log(`  Running ${TEST_SUITES.length} test suites × ${ITERATIONS} iterations each`);
  console.log(`  Total tests: ${TEST_SUITES.length * ITERATIONS}`);
  console.log('═'.repeat(80));
  console.log('\n');

  const startTime = Date.now();

  // Run each suite 6 times
  for (const suite of TEST_SUITES) {
    console.log(`\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  SUITE: ${suite.name} (${suite.criticalLevel} criticality)`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    for (let i = 0; i < ITERATIONS; i++) {
      const result = await runTest(suite, i);
      results.push(result);
      totalTests++;

      if (result.success) {
        passedTests++;
      } else {
        failedTests++;
      }

      // Brief pause between iterations
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  const totalDuration = Date.now() - startTime;

  // Generate final report
  console.log('\n\n');
  console.log('═'.repeat(80));
  console.log('  FINAL TEST REPORT');
  console.log('═'.repeat(80));
  console.log(`\n  Total Duration: ${(totalDuration / 1000).toFixed(2)}s`);
  console.log(`  Total Tests: ${totalTests}`);
  console.log(`  Passed: ${passedTests} (${((passedTests / totalTests) * 100).toFixed(1)}%)`);
  console.log(`  Failed: ${failedTests} (${((failedTests / totalTests) * 100).toFixed(1)}%)`);
  console.log('\n');

  // Per-suite breakdown
  console.log('  Per-Suite Results:');
  console.log('  ' + '-'.repeat(76));

  for (const suite of TEST_SUITES) {
    const suiteResults = results.filter(r => r.suite === suite.name);
    const suitePassed = suiteResults.filter(r => r.success).length;
    const suiteFailed = suiteResults.filter(r => !r.success).length;
    const avgDuration = suiteResults.reduce((acc, r) => acc + r.duration, 0) / suiteResults.length;

    const status = suitePassed === ITERATIONS ? '✓' : '✗';
    const statusColor = suitePassed === ITERATIONS ? 'PASS' : 'FAIL';

    console.log(`  ${status} ${suite.name.padEnd(30)} ${suitePassed}/${ITERATIONS} passed  (avg ${avgDuration.toFixed(0)}ms)  [${statusColor}]`);
  }

  console.log('\n');

  // Failed tests details
  const failedResults = results.filter(r => !r.success);
  if (failedResults.length > 0) {
    console.log('  Failed Tests Details:');
    console.log('  ' + '-'.repeat(76));

    for (const result of failedResults) {
      console.log(`\n  ✗ ${result.suite} - Iteration ${result.iteration}`);
      console.log(`    Duration: ${result.duration}ms`);
      console.log(`    Error: ${result.error || 'Unknown'}`);
      if (result.output) {
        console.log(`    Output: ${result.output.substring(0, 200)}...`);
      }
    }
  }

  console.log('\n');
  console.log('═'.repeat(80));

  if (failedTests === 0) {
    console.log('  ✓ ALL TESTS PASSED - System is 1,000,000% verified!');
    console.log('═'.repeat(80));
    console.log('\n');
    process.exit(0);
  } else {
    console.log(`  ✗ ${failedTests} TESTS FAILED - Review errors above`);
    console.log('═'.repeat(80));
    console.log('\n');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('\n\nFATAL ERROR:', error);
  process.exit(1);
});
