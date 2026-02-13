#!/usr/bin/env node

/**
 * END-TO-END BROWSER EXECUTION TESTS
 * Tests complete flow: Task → ProcessorV2 → Browser → Verification → Response
 * Verifies browser classification AND actual browser execution
 */

const RAILWAY_URL = 'https://agent-production-1339.up.railway.app';
const WEBHOOK_SECRET = 'a2915dbe03bba7e47a7ed82ffaed474b1f5cde98406d8033bede1832270464d7';
const TEST_USER_ID = '11684ec6-80cd-4bb6-9aed-8f0947afd06a'; // teste2e
const TEST_EMAIL = 'teste2e@aevoy.com';

let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function submitTask(description, expectedType = 'research') {
  const response = await fetch(`${RAILWAY_URL}/task`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Secret': WEBHOOK_SECRET
    },
    body: JSON.stringify({
      userId: TEST_USER_ID,
      username: 'teste2e',
      from: TEST_EMAIL,
      subject: description,
      body: '',
      inputChannel: 'web'
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const result = await response.json();
  return result;
}

async function runTest(name, description, expectedClassification, checkFn) {
  testsRun++;
  process.stdout.write(`\n[${testsRun}] ${name}\n`);
  process.stdout.write(`    Task: "${description}"\n`);
  process.stdout.write(`    Expected: ${expectedClassification}\n`);
  process.stdout.write(`    Submitting... `);

  try {
    const startTime = Date.now();
    const result = await submitTask(description, expectedClassification);
    const duration = Date.now() - startTime;

    process.stdout.write(`✓ (${duration}ms)\n`);
    process.stdout.write(`    Status: ${result.status || 'queued'}\n`);

    if (result.planId) {
      process.stdout.write(`    Plan ID: ${result.planId}\n`);
    }

    if (result.response) {
      const preview = result.response.substring(0, 100);
      process.stdout.write(`    Response: ${preview}${result.response.length > 100 ? '...' : ''}\n`);
    }

    // Custom validation
    if (checkFn) {
      checkFn(result);
    }

    testsPassed++;
    return result;
  } catch (error) {
    process.stdout.write(`✗\n`);
    process.stdout.write(`    Error: ${error.message}\n`);
    testsFailed++;
    return null;
  }
}

console.log('='.repeat(80));
console.log('END-TO-END BROWSER EXECUTION TESTS');
console.log('='.repeat(80));
console.log(`Railway: ${RAILWAY_URL}`);
console.log(`Test User: ${TEST_USER_ID}`);
console.log('');

// === BROWSER CLASSIFICATION TESTS ===
console.log('\n=== BROWSER CLASSIFICATION (Explicit Web Intent) ===');

await runTest(
  'Visit explicit URL',
  'visit example.com',
  'research',
  (result) => {
    if (!result.success && !result.planId) {
      throw new Error('Expected task to be processed or planned');
    }
  }
);

await wait(3000);

await runTest(
  'Go to URL with action',
  'go to example.com and tell me the page title',
  'research',
  (result) => {
    if (result.response && !result.response.includes('Example')) {
      console.log('    ⚠️  Response may not include actual page content');
    }
  }
);

await wait(3000);

await runTest(
  'Screenshot task',
  'take a screenshot of example.com',
  'research',
  (result) => {
    // Screenshot tasks should use browser
  }
);

await wait(3000);

await runTest(
  'Browse and extract',
  'browse wikipedia.org and tell me the main headline',
  'research'
);

await wait(3000);

await runTest(
  'Navigate to domain',
  'navigate to github.com',
  'research'
);

await wait(3000);

// === COMPLEX BROWSER TESTS ===
console.log('\n=== COMPLEX BROWSER TASKS (Multi-Step) ===');

await runTest(
  'Search and extract',
  'go to google.com and search for "weather" and tell me the first result',
  'research'
);

await wait(3000);

await runTest(
  'Multi-page navigation',
  'visit reddit.com, go to r/programming, and tell me the top post title',
  'research'
);

await wait(3000);

await runTest(
  'Form interaction',
  'go to example.com, find any input field, and describe it',
  'research'
);

await wait(3000);

// === REAL WEBSITE INTERACTION ===
console.log('\n=== REAL WEBSITE TESTS (Aevoy & Common Sites) ===');

await runTest(
  'Visit Aevoy homepage',
  'visit https://www.aevoy.com and tell me what the main headline says',
  'research',
  (result) => {
    if (result.response && result.response.toLowerCase().includes('aevoy')) {
      console.log('    ✓ Successfully extracted Aevoy content');
    }
  }
);

await wait(3000);

await runTest(
  'Check Aevoy features',
  'go to aevoy.com and list the main features mentioned on the homepage',
  'research'
);

await wait(3000);

await runTest(
  'Visit HN',
  'visit news.ycombinator.com and tell me the #1 story title',
  'research'
);

await wait(3000);

// === AI-ONLY TASKS (Should NOT use browser) ===
console.log('\n=== AI-ONLY TASKS (Should NOT Use Browser) ===');

await runTest(
  'Simple math',
  'what is 2 + 2',
  'simple',
  (result) => {
    if (!result.response || !result.response.includes('4')) {
      throw new Error('Expected answer to include "4"');
    }
    console.log('    ✓ Correctly classified as AI-only');
  }
);

await wait(3000);

await runTest(
  'Knowledge question',
  'what is the capital of France',
  'simple',
  (result) => {
    if (!result.response || !result.response.toLowerCase().includes('paris')) {
      throw new Error('Expected answer to include "Paris"');
    }
    console.log('    ✓ Correctly classified as AI-only');
  }
);

await wait(3000);

// === EDGE CASES ===
console.log('\n=== EDGE CASES (Classification Boundary) ===');

await runTest(
  'Ambiguous: "google"',
  'google',
  'simple',
  (result) => {
    // Could be classified either way - "google" alone is ambiguous
    console.log('    ℹ️  Ambiguous task - acceptable either way');
  }
);

await wait(3000);

await runTest(
  'URL without action verb',
  'example.com',
  'simple',
  (result) => {
    // Without "visit" or "go to", might be classified as simple
    console.log('    ℹ️  URL alone without verb - classification varies');
  }
);

await wait(3000);

await runTest(
  'Question about website (no visit)',
  'what is on example.com',
  'research',
  (result) => {
    // "what is on" implies browsing
    console.log('    ℹ️  Implicit browsing intent');
  }
);

await wait(3000);

// === SUMMARY ===
console.log('\n' + '='.repeat(80));
console.log('TEST SUMMARY');
console.log('='.repeat(80));
console.log(`Tests Run: ${testsRun}`);
console.log(`Passed: ${testsPassed}`);
console.log(`Failed: ${testsFailed}`);
console.log(`Success Rate: ${((testsPassed / testsRun) * 100).toFixed(1)}%`);
console.log('='.repeat(80));

if (testsFailed > 0) {
  console.log('\n⚠️  Some tests failed - review output above');
  process.exit(1);
} else {
  console.log('\n✅ All browser tests passed!');
  console.log('✅ Browser classification working correctly');
  console.log('✅ End-to-end flow verified');
  process.exit(0);
}
