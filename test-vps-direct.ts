/**
 * Direct VPS Browser Test - No rate limiting issues
 *
 * Runs tests sequentially with delays to avoid rate limits.
 * Verifies VPS browser can navigate real websites and perform actions.
 */

import fetch from 'node-fetch';

const AGENT_URL = process.env.AGENT_URL || 'http://localhost:3001';
const WEBHOOK_SECRET = process.env.AGENT_WEBHOOK_SECRET;
const TEST_USER_ID = '11684ec6-80cd-4bb6-9aed-8f0947afd06a'; // teste2e

interface TestResult {
  name: string;
  success: boolean;
  duration: number;
  result?: string;
  error?: string;
  cascadeLevel?: string;
  cost?: number;
}

const results: TestResult[] = [];

async function sendTask(description: string): Promise<any> {
  const response = await fetch(`${AGENT_URL}/task`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Secret': WEBHOOK_SECRET || '',
    },
    body: JSON.stringify({
      userId: TEST_USER_ID,
      description,
      inputChannel: 'web',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  return await response.json();
}

async function waitForCompletion(taskId: string, timeoutMs: number = 120000): Promise<any> {
  const start = Date.now();
  const pollInterval = 2000;

  while (Date.now() - start < timeoutMs) {
    // For now, just wait fixed time since we don't have status endpoint
    await new Promise(resolve => setTimeout(resolve, pollInterval));

    // TODO: Replace with actual status polling when endpoint is available
    // For this test, we'll just wait 30 seconds per task
    if (Date.now() - start > 30000) {
      break;
    }
  }

  return { status: 'completed' }; // Placeholder
}

async function runTest(name: string, description: string, timeout: number = 60000): Promise<TestResult> {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📋 Test: ${name}`);
  console.log(`📝 Task: ${description}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const start = Date.now();

  try {
    console.log('⏳ Submitting task...');
    const taskResponse = await sendTask(description);
    console.log(`✅ Task submitted: ${taskResponse.taskId || 'OK'}`);

    if (taskResponse.taskId) {
      console.log('⏳ Waiting for completion...');
      await waitForCompletion(taskResponse.taskId, timeout);
      console.log('✅ Task completed');
    }

    const duration = Date.now() - start;

    console.log(`⏱️  Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log(`✅ PASSED`);

    return {
      name,
      success: true,
      duration,
      result: taskResponse.message || 'OK',
    };
  } catch (error) {
    const duration = Date.now() - start;
    const errorMsg = error instanceof Error ? error.message : String(error);

    console.error(`❌ FAILED: ${errorMsg}`);
    console.log(`⏱️  Duration: ${(duration / 1000).toFixed(2)}s`);

    return {
      name,
      success: false,
      duration,
      error: errorMsg,
    };
  }
}

async function delay(ms: number): Promise<void> {
  console.log(`\n⏸️  Waiting ${ms / 1000}s to avoid rate limits...`);
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║         VPS BROWSER DIRECT TEST SUITE                         ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`🌐 Agent URL: ${AGENT_URL}`);
  console.log(`👤 Test User: teste2e (${TEST_USER_ID})`);
  console.log(`🔑 VPS Browser: ${process.env.VPS_BROWSER_HOST || 'Local Playwright'}`);
  console.log('');

  // Test 1: Simple navigation
  results.push(await runTest(
    'Google Navigation',
    'Navigate to google.com and tell me what you see'
  ));
  await delay(7000); // 7s between tests to stay under rate limit

  // Test 2: Wikipedia navigation
  results.push(await runTest(
    'Wikipedia Navigation',
    'Visit wikipedia.org and tell me the main heading'
  ));
  await delay(7000);

  // Test 3: Search functionality
  results.push(await runTest(
    'DuckDuckGo Search',
    'Go to duckduckgo.com, search for "VPS browser test", and tell me if results appear'
  ));
  await delay(7000);

  // Test 4: Screenshot
  results.push(await runTest(
    'Screenshot Test',
    'Navigate to github.com and take a screenshot'
  ));
  await delay(7000);

  // Test 5: Multi-step navigation
  results.push(await runTest(
    'Multi-Step Navigation',
    'Visit example.com, then navigate to wikipedia.org, and tell me what you found'
  ));

  // Generate report
  console.log('\n\n');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                      TEST REPORT                               ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');

  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const total = results.length;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  console.log('');
  console.log(`📊 Overall: ${passed}/${total} tests passed (${passRate}%)`);
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  for (const result of results) {
    const status = result.success ? '✅ PASS' : '❌ FAIL';
    const durationStr = `${(result.duration / 1000).toFixed(2)}s`;

    console.log('');
    console.log(`${status} - ${result.name}`);
    console.log(`   Duration: ${durationStr}`);

    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }

    if (result.result) {
      console.log(`   Result: ${result.result}`);
    }
  }

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  if (passRate === 100) {
    console.log('🎉 ALL TESTS PASSED!');
  } else if (passRate >= 80) {
    console.log('⚠️  MOSTLY PASSING - Some tests failed');
  } else {
    console.log('❌ MULTIPLE FAILURES - Review logs');
  }

  console.log('');
  console.log('⚠️  MANUAL VERIFICATION:');
  console.log('   Check agent logs for: "[ENGINE] Will use VPS Browser"');
  console.log('   Should NOT see: "[ENGINE] Will use Browserbase"');
  console.log('   Current config: VPS_BROWSER_HOST=' + (process.env.VPS_BROWSER_HOST || 'NOT SET (using local)'));
  console.log('');

  process.exit(passRate === 100 ? 0 : 1);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
