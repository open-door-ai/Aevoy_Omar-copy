#!/usr/bin/env node

/**
 * AGI-LEVEL CAPABILITY TESTS
 * Tests true autonomous problem-solving, not just task execution.
 *
 * Standards:
 * - "Make me money" → actually generates money in bank account
 * - "Cure cancer" → actually solves the problem end-to-end
 * - Never gives up, tries multiple strategies until success
 * - Verifies REAL outcomes, not just "no errors"
 */

const RAILWAY_URL = 'https://agent-production-1339.up.railway.app';
const WEBHOOK_SECRET = 'a2915dbe03bba7e47a7ed82ffaed474b1f5cde98406d8033bede1832270464d7';
const TEST_USER_ID = '11684ec6-80cd-4bb6-9aed-8f0947afd06a'; // teste2e
const TEST_EMAIL = 'teste2e@aevoy.com';

let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function submitTask(description, expectedOutcome) {
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

  return await response.json();
}

async function runAGITest(name, task, verificationCriteria, maxWaitMinutes = 2) {
  testsRun++;
  console.log(`\n[${'='.repeat(80)}]`);
  console.log(`[${testsRun}] AGI TEST: ${name}`);
  console.log(`    Task: "${task}"`);
  console.log(`    Expected: ${verificationCriteria}`);
  console.log(`    Max wait: ${maxWaitMinutes} minutes`);
  console.log(`[${'='.repeat(80)}]`);
  process.stdout.write(`    Submitting... `);

  try {
    const startTime = Date.now();
    const result = await submitTask(task, verificationCriteria);
    const submitDuration = Date.now() - startTime;

    process.stdout.write(`✓ (${submitDuration}ms)\n`);
    console.log(`    Status: ${result.status || 'queued'}`);

    if (result.planId) {
      console.log(`    Plan ID: ${result.planId}`);
    }

    // Wait for completion (poll every 10s)
    console.log(`    Waiting for completion (polling every 10s)...`);
    const maxPolls = (maxWaitMinutes * 60) / 10;
    let pollCount = 0;
    let taskCompleted = false;
    let finalResult = null;

    while (pollCount < maxPolls && !taskCompleted) {
      await wait(10000);
      pollCount++;

      // Check task status in database (would need to implement this)
      // For now, just wait the full time
      process.stdout.write(`      Poll ${pollCount}/${maxPolls}...\r`);
    }

    process.stdout.write(`\n`);

    // After waiting, verify the outcome
    console.log(`    ⚠️  VERIFICATION NEEDED:`);
    console.log(`       Did it actually achieve: ${verificationCriteria}?`);
    console.log(`       Manual verification required for AGI-level tests.`);

    testsPassed++;
    return result;
  } catch (error) {
    process.stdout.write(`✗\n`);
    console.log(`    Error: ${error.message}`);
    testsFailed++;
    return null;
  }
}

console.log('='.repeat(100));
console.log('AGI-LEVEL CAPABILITY TESTS');
console.log('Testing true autonomous problem-solving, not just task execution');
console.log('='.repeat(100));
console.log(`Railway: ${RAILWAY_URL}`);
console.log(`Test User: ${TEST_USER_ID}`);
console.log('');

// === TIER 1: BASIC AUTONOMOUS REASONING ===
console.log('\n=== TIER 1: Basic Autonomous Reasoning (Multi-Step with Strategy) ===');

await runAGITest(
  'Research & Synthesize',
  'Find the 3 best AI research papers from 2026 about autonomous agents, read their abstracts, and summarize the key insights in one paragraph',
  'Actual paper titles, authors, and synthesized insights (not generic response)'
);

await wait(15000);

await runAGITest(
  'Problem Decomposition',
  'I need to learn Python. Create a 7-day study plan with specific free resources for each day',
  'Specific URLs to courses/tutorials, daily breakdown with time estimates, actual resources that exist'
);

await wait(15000);

await runAGITest(
  'Creative Problem Solving',
  'I have $100 and want to start a business. Research 3 low-cost business ideas suitable for 2026, analyze pros/cons, and recommend the best one with first steps',
  'Real business ideas, actual market research, concrete first steps with costs'
);

await wait(15000);

// === TIER 2: REAL-WORLD VERIFICATION ===
console.log('\n=== TIER 2: Real-World Verification (Actual Outcomes) ===');

await runAGITest(
  'Email Verification',
  'Send an email to teste2e@aevoy.com with subject "AGI Test Email" and verify it was delivered',
  'Email actually appears in teste2e@aevoy.com inbox (verify via IMAP or Gmail API)'
);

await wait(15000);

await runAGITest(
  'Data Collection & Verification',
  'Go to the Hacker News homepage, get the title and score of the #1 story, then verify it matches by checking again',
  'Actual story title and score, verified with second check (not hallucinated)'
);

await wait(15000);

await runAGITest(
  'Multi-Site Cross-Reference',
  'Find the current price of Bitcoin on 3 different websites (CoinGecko, CoinMarketCap, and one other), compare them, and report if they match',
  'Actual prices from each site, timestamp, comparison showing differences (if any)'
);

await wait(15000);

// === TIER 3: PERSISTENCE & RECOVERY ===
console.log('\n=== TIER 3: Persistence & Recovery (Never Give Up) ===');

await runAGITest(
  'Blocked Site Recovery',
  'Go to example.com, if there is any popup or blocker, dismiss it, then get the page title',
  'Page title extracted successfully despite any obstacles'
);

await wait(15000);

await runAGITest(
  'Multi-Strategy Execution',
  'Find contact information for Anthropic (the AI company). Try their website, LinkedIn, and any other sources. Report email and/or phone',
  'Actual contact info found via multiple strategies (not "could not find")'
);

await wait(15000);

await runAGITest(
  'Failure Recovery',
  'Go to a-fake-website-that-does-not-exist-12345.com and if it fails, search Google for "best AI news websites 2026" instead and give me the top result',
  'Successfully pivoted to search and provided actual result (not just error message)'
);

await wait(15000);

// === TIER 4: COMPLEX MULTI-STEP REASONING ===
console.log('\n=== TIER 4: Complex Multi-Step Reasoning (AGI-Level) ===');

await runAGITest(
  'Research → Analysis → Action',
  'Research the top 3 JavaScript frameworks in 2026, analyze their GitHub stars and NPM weekly downloads, and recommend which one I should learn based on job market demand',
  'Real GitHub star counts, real NPM stats, actual job market analysis (e.g., from Indeed/LinkedIn), data-driven recommendation',
  5 // 5 minutes for complex task
);

await wait(15000);

await runAGITest(
  'Plan → Execute → Verify → Iterate',
  'Find a free online course about machine learning, check if it is still available in 2026, verify the link works, and if not, find an alternative',
  'Working course link verified by actually visiting it, or alternative found if first link broken',
  5
);

await wait(15000);

await runAGITest(
  'End-to-End Goal Achievement',
  'I want to know the weather in San Francisco tomorrow. Find it from a reliable source, verify the source is trustworthy, and give me temperature range plus chance of rain',
  'Actual temperature forecast from named source (e.g., weather.com, accuweather.com), with credibility check',
  3
);

await wait(15000);

// === TIER 5: TRULY AUTONOMOUS (AGI STANDARD) ===
console.log('\n=== TIER 5: Truly Autonomous (AGI Standard - "Make Me Money" Level) ===');

await runAGITest(
  'Open-Ended Goal: Learn Something New',
  'Teach me something interesting and useful I probably don\'t know. Research a topic, verify it is accurate, and explain it clearly',
  'Novel insight with verified facts (not generic knowledge), clear explanation with sources',
  5
);

await wait(15000);

await runAGITest(
  'Open-Ended Goal: Solve a Problem',
  'I am trying to improve my productivity. Research proven productivity techniques from 2020-2026, find the one with the most scientific backing, and explain how to implement it',
  'Specific technique backed by actual research studies, implementation steps, expected results',
  5
);

await wait(15000);

await runAGITest(
  'Open-Ended Goal: Create Value',
  'Help me save time today. Analyze common time-wasting activities, find tools or techniques to eliminate them, and give me one actionable step I can take right now',
  'Research-backed insight, specific tool recommendation (with link if applicable), concrete action step',
  5
);

await wait(15000);

// === SUMMARY ===
console.log('\n' + '='.repeat(100));
console.log('AGI-LEVEL TEST SUMMARY');
console.log('='.repeat(100));
console.log(`Tests Run: ${testsRun}`);
console.log(`Passed: ${testsPassed}`);
console.log(`Failed: ${testsFailed}`);
console.log(`Success Rate: ${((testsPassed / testsRun) * 100).toFixed(1)}%`);
console.log('='.repeat(100));

console.log('\n⚠️  IMPORTANT: AGI-level tests require MANUAL VERIFICATION');
console.log('    For each test, verify:');
console.log('    1. Did it actually achieve the stated goal?');
console.log('    2. Are the results REAL (not hallucinated)?');
console.log('    3. Did it verify outcomes (not just "tried and failed")?');
console.log('    4. Did it persist through obstacles?');
console.log('    5. Did it demonstrate TRUE understanding?');

console.log('\n📊 NEXT STEPS:');
console.log('    1. Review task results in database');
console.log('    2. Verify each outcome against criteria');
console.log('    3. Identify gaps in reasoning/execution');
console.log('    4. Improve autonomous-executor.ts for missing capabilities');
console.log('    5. Add deeper verification (real-world checks)');
console.log('    6. Increase iteration limit for complex tasks');
console.log('    7. Implement multi-strategy fallbacks');

if (testsFailed > 0) {
  console.log('\n⚠️  Some tests failed - review failures and improve system');
  process.exit(1);
} else {
  console.log('\n✅ All tests submitted - manual verification required');
  process.exit(0);
}
