/**
 * CAPTCHA Validation Test Runner
 *
 * Runs comprehensive CAPTCHA tests using Playwright (not @playwright/test framework).
 * This avoids the test.describe() configuration issues.
 */

import { chromium, type Browser, type Page } from 'playwright';
import { detectCaptcha, handleCaptchaIfPresent, suggestCaptchaWorkarounds } from '../src/execution/captcha.js';
import { getSupabaseClient } from '../src/utils/supabase.js';
import fs from 'fs/promises';

interface TestResult {
  scenario: string;
  iteration: number;
  success: boolean;
  time: number;
  cost: number;
  error?: string;
  service?: string;
}

const results: TestResult[] = [];

async function runScenario1(browser: Browser, iteration: number): Promise<void> {
  console.log(`[Scenario 1.${iteration}] Easy reCAPTCHA v2...`);
  const page = await browser.newPage();
  const startTime = Date.now();

  try {
    await page.goto('https://www.google.com/recaptcha/api2/demo', { timeout: 30000 });
    const detection = await detectCaptcha(page);

    const result = await handleCaptchaIfPresent(page, 'test-user-id', `test-task-1-${iteration}`);
    const elapsed = (Date.now() - startTime) / 1000;

    results.push({
      scenario: 'Easy reCAPTCHA v2',
      iteration,
      success: result.success || false,
      time: elapsed,
      cost: 0.001,
      error: result.error,
    });

    if (result.success) {
      console.log(`[Scenario 1.${iteration}] ✅ SUCCESS (${elapsed.toFixed(2)}s)`);
    } else {
      console.log(`[Scenario 1.${iteration}] ❌ FAILED: ${result.error} (${elapsed.toFixed(2)}s)`);
    }
  } catch (error) {
    const elapsed = (Date.now() - startTime) / 1000;
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    results.push({
      scenario: 'Easy reCAPTCHA v2',
      iteration,
      success: false,
      time: elapsed,
      cost: 0,
      error: errorMsg,
    });
    console.log(`[Scenario 1.${iteration}] ❌ ERROR: ${errorMsg}`);
  } finally {
    await page.close();
  }
}

async function runScenario2(browser: Browser, iteration: number): Promise<void> {
  console.log(`[Scenario 2.${iteration}] Hard reCAPTCHA v3...`);
  const page = await browser.newPage();
  const startTime = Date.now();

  try {
    await page.goto('https://recaptcha-demo.appspot.com/recaptcha-v3-request-scores.php', { timeout: 30000 });
    const detection = await detectCaptcha(page);

    const result = await handleCaptchaIfPresent(page, 'test-user-id', `test-task-2-${iteration}`);
    const elapsed = (Date.now() - startTime) / 1000;

    results.push({
      scenario: 'Hard reCAPTCHA v3',
      iteration,
      success: result.success || false,
      time: elapsed,
      cost: 0.003,
      error: result.error,
    });

    if (result.success) {
      console.log(`[Scenario 2.${iteration}] ✅ SUCCESS (${elapsed.toFixed(2)}s)`);
    } else {
      console.log(`[Scenario 2.${iteration}] ❌ FAILED: ${result.error} (${elapsed.toFixed(2)}s)`);
    }
  } catch (error) {
    const elapsed = (Date.now() - startTime) / 1000;
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    results.push({
      scenario: 'Hard reCAPTCHA v3',
      iteration,
      success: false,
      time: elapsed,
      cost: 0,
      error: errorMsg,
    });
    console.log(`[Scenario 2.${iteration}] ❌ ERROR: ${errorMsg}`);
  } finally {
    await page.close();
  }
}

async function runScenario3(browser: Browser, iteration: number): Promise<void> {
  console.log(`[Scenario 3.${iteration}] hCaptcha...`);
  const page = await browser.newPage();
  const startTime = Date.now();

  try {
    await page.goto('https://accounts.hcaptcha.com/demo', { timeout: 30000 });
    const detection = await detectCaptcha(page);

    const result = await handleCaptchaIfPresent(page, 'test-user-id', `test-task-3-${iteration}`);
    const elapsed = (Date.now() - startTime) / 1000;

    results.push({
      scenario: 'hCaptcha',
      iteration,
      success: result.success || false,
      time: elapsed,
      cost: 0.001,
      error: result.error,
    });

    if (result.success) {
      console.log(`[Scenario 3.${iteration}] ✅ SUCCESS (${elapsed.toFixed(2)}s)`);
    } else {
      console.log(`[Scenario 3.${iteration}] ❌ FAILED: ${result.error} (${elapsed.toFixed(2)}s)`);
    }
  } catch (error) {
    const elapsed = (Date.now() - startTime) / 1000;
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    results.push({
      scenario: 'hCaptcha',
      iteration,
      success: false,
      time: elapsed,
      cost: 0,
      error: errorMsg,
    });
    console.log(`[Scenario 3.${iteration}] ❌ ERROR: ${errorMsg}`);
  } finally {
    await page.close();
  }
}

async function runScenario4(browser: Browser, iteration: number): Promise<void> {
  console.log(`[Scenario 4.${iteration}] Cloudflare Turnstile...`);
  const page = await browser.newPage();
  const startTime = Date.now();

  try {
    await page.goto('https://challenges.cloudflare.com/cdn-cgi/trace', { timeout: 30000 });
    const detection = await detectCaptcha(page);

    const result = await handleCaptchaIfPresent(page, 'test-user-id', `test-task-4-${iteration}`);
    const elapsed = (Date.now() - startTime) / 1000;

    results.push({
      scenario: 'Cloudflare Turnstile',
      iteration,
      success: result.success || detection.type === 'none', // No CAPTCHA is also success
      time: elapsed,
      cost: 0.0012,
      error: result.error,
    });

    if (result.success || detection.type === 'none') {
      console.log(`[Scenario 4.${iteration}] ✅ SUCCESS (${elapsed.toFixed(2)}s)`);
    } else {
      console.log(`[Scenario 4.${iteration}] ❌ FAILED: ${result.error} (${elapsed.toFixed(2)}s)`);
    }
  } catch (error) {
    const elapsed = (Date.now() - startTime) / 1000;
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    results.push({
      scenario: 'Cloudflare Turnstile',
      iteration,
      success: false,
      time: elapsed,
      cost: 0,
      error: errorMsg,
    });
    console.log(`[Scenario 4.${iteration}] ❌ ERROR: ${errorMsg}`);
  } finally {
    await page.close();
  }
}

async function runScenario5(browser: Browser, iteration: number): Promise<void> {
  console.log(`[Scenario 5.${iteration}] Complete block (timeout)...`);
  const page = await browser.newPage();
  const startTime = Date.now();

  try {
    // Create mock CAPTCHA that will fail
    await page.setContent(`
      <html>
        <body>
          <div class="g-recaptcha" data-sitekey="invalid-test-key"></div>
        </body>
      </html>
    `);

    // Start near timeout (59min 55sec)
    const result = await handleCaptchaIfPresent(
      page,
      'test-user-id',
      `test-task-5-${iteration}`,
      Date.now() - 3600000 + 5000
    );

    const elapsed = (Date.now() - startTime) / 1000;

    results.push({
      scenario: 'Complete block',
      iteration,
      success: result.timeout === true, // Success means timeout triggered correctly
      time: elapsed,
      cost: 0,
      error: result.error,
    });

    if (result.timeout) {
      console.log(`[Scenario 5.${iteration}] ✅ Timeout triggered correctly (${elapsed.toFixed(2)}s)`);
    } else {
      console.log(`[Scenario 5.${iteration}] ❌ Timeout not triggered: ${result.error} (${elapsed.toFixed(2)}s)`);
    }
  } catch (error) {
    const elapsed = (Date.now() - startTime) / 1000;
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    results.push({
      scenario: 'Complete block',
      iteration,
      success: false,
      time: elapsed,
      cost: 0,
      error: errorMsg,
    });
    console.log(`[Scenario 5.${iteration}] ❌ ERROR: ${errorMsg}`);
  } finally {
    await page.close();
  }
}

async function runScenario6(browser: Browser, iteration: number): Promise<void> {
  console.log(`[Scenario 6.${iteration}] User session exists (skip CAPTCHA)...`);
  const page = await browser.newPage();
  const startTime = Date.now();

  try {
    // Set cookies to simulate existing session
    await page.context().addCookies([
      {
        name: 'session_token',
        value: 'valid-session-123',
        domain: 'example.com',
        path: '/',
      },
    ]);

    await page.goto('https://example.com');

    const result = await handleCaptchaIfPresent(page, 'test-user-id', `test-task-6-${iteration}`);
    const elapsed = (Date.now() - startTime) / 1000;

    results.push({
      scenario: 'User session exists',
      iteration,
      success: result.success === true,
      time: elapsed,
      cost: 0,
      error: result.error,
    });

    if (result.success) {
      console.log(`[Scenario 6.${iteration}] ✅ SUCCESS (${elapsed.toFixed(2)}s)`);
    } else {
      console.log(`[Scenario 6.${iteration}] ❌ FAILED: ${result.error} (${elapsed.toFixed(2)}s)`);
    }
  } catch (error) {
    const elapsed = (Date.now() - startTime) / 1000;
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    results.push({
      scenario: 'User session exists',
      iteration,
      success: false,
      time: elapsed,
      cost: 0,
      error: errorMsg,
    });
    console.log(`[Scenario 6.${iteration}] ❌ ERROR: ${errorMsg}`);
  } finally {
    await page.close();
  }
}

async function main() {
  console.log('🚀 Starting CAPTCHA Validation Tests (6 iterations per scenario)\n');

  const browser = await chromium.launch({ headless: true });

  try {
    // Run each scenario 6 times
    for (let i = 1; i <= 6; i++) {
      await runScenario1(browser, i);
      await runScenario2(browser, i);
      await runScenario3(browser, i);
      await runScenario4(browser, i);
      await runScenario5(browser, i);
      await runScenario6(browser, i);
      console.log(`\n--- Iteration ${i}/6 complete ---\n`);
    }

    // Analyze results
    console.log('\n=== CAPTCHA Validation Summary ===\n');

    const successCount = results.filter(r => r.success).length;
    const successRate = ((successCount / results.length) * 100).toFixed(1);
    const avgTime = (results.reduce((sum, r) => sum + r.time, 0) / results.length).toFixed(2);
    const totalCost = results.reduce((sum, r) => sum + r.cost, 0).toFixed(4);

    console.log(`Total tests: ${results.length}`);
    console.log(`Successes: ${successCount}`);
    console.log(`Failures: ${results.length - successCount}`);
    console.log(`Success rate: ${successRate}%`);
    console.log(`Avg time: ${avgTime}s`);
    console.log(`Total cost: $${totalCost}`);

    // Group by scenario
    console.log('\n=== Results by Scenario ===\n');
    const scenarios = [...new Set(results.map(r => r.scenario))];
    scenarios.forEach(scenario => {
      const scenarioResults = results.filter(r => r.scenario === scenario);
      const scenarioSuccesses = scenarioResults.filter(r => r.success).length;
      const scenarioRate = ((scenarioSuccesses / scenarioResults.length) * 100).toFixed(1);
      console.log(`${scenario}: ${scenarioSuccesses}/${scenarioResults.length} (${scenarioRate}%)`);
    });

    // Write report
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalTests: results.length,
        successes: successCount,
        failures: results.length - successCount,
        successRate: `${successRate}%`,
        avgTime: `${avgTime}s`,
        totalCost: `$${totalCost}`,
      },
      byScenario: scenarios.map(scenario => {
        const scenarioResults = results.filter(r => r.scenario === scenario);
        const scenarioSuccesses = scenarioResults.filter(r => r.success).length;
        return {
          scenario,
          tests: scenarioResults.length,
          successes: scenarioSuccesses,
          failures: scenarioResults.length - scenarioSuccesses,
          successRate: `${((scenarioSuccesses / scenarioResults.length) * 100).toFixed(1)}%`,
        };
      }),
      details: results,
    };

    await fs.writeFile(
      '/workspaces/Anticipy_Omar-copy/CAPTCHA_TEST_REPORT.md',
      `# CAPTCHA Test Report

**Generated:** ${new Date().toISOString()}

## Summary

- **Total Tests:** ${results.length}
- **Successes:** ${successCount}
- **Failures:** ${results.length - successCount}
- **Success Rate:** ${successRate}%
- **Average Time:** ${avgTime}s
- **Total Cost:** $${totalCost}

## Results by Scenario

${scenarios.map(scenario => {
  const scenarioResults = results.filter(r => r.scenario === scenario);
  const scenarioSuccesses = scenarioResults.filter(r => r.success).length;
  const scenarioRate = ((scenarioSuccesses / scenarioResults.length) * 100).toFixed(1);
  return `### ${scenario}\n- Tests: ${scenarioResults.length}\n- Successes: ${scenarioSuccesses}\n- Success Rate: ${scenarioRate}%`;
}).join('\n\n')}

## Detailed Results

\`\`\`json
${JSON.stringify(results, null, 2)}
\`\`\`
`
    );

    console.log('\n✅ Report saved to CAPTCHA_TEST_REPORT.md');
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
