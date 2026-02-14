#!/usr/bin/env node
/**
 * PRODUCTION EMAIL PIPELINE TEST
 * Tests the COMPLETE flow: Email Worker → Agent → Response
 * This simulates real user emails coming through Cloudflare → Railway
 */

import { createClient } from '@supabase/supabase-js';

const TEST_USER_ID = '11684ec6-80cd-4bb6-9aed-8f0947afd06a';
const TEST_USER_EMAIL = 'teste2e@aevoy.com';
const AGENT_URL = 'https://agent-production-1339.up.railway.app';
const WEBHOOK_SECRET = 'a2915dbe03bba7e47a7ed82ffaed474b1f5cde98406d8033bede1832270464d7';
const TIMESTAMP = Date.now();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

console.log('\n╔════════════════════════════════════════════════════════════════╗');
console.log('║  PRODUCTION PIPELINE TEST - CONDITIONAL LOGIC FOCUSED          ║');
console.log('║  Testing: Email Worker → Railway Agent → Response             ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

// Critical conditional logic tests
const conditionalTests = [
  {
    name: 'Simple conditional - search with fallback',
    task: 'Search for "React framework" on DuckDuckGo. If you find results, tell me about the first one. If no results, say "No results found".',
    expected: 'Should search, find results, describe first result'
  },
  {
    name: 'URL conditional - page load check',
    task: 'Go to example.com. If the page loads successfully, tell me the title. If it fails, say "Page failed to load".',
    expected: 'Should navigate, check success, report title'
  },
  {
    name: 'Conditional with alternative action',
    task: 'Search for "TypeScript tutorial". If there are results, click the first one and summarize it. If no results, search for "JavaScript tutorial" instead.',
    expected: 'Should search, observe results, then execute appropriate branch'
  },
  {
    name: 'Error recovery conditional',
    task: 'Try to visit https://thiswebsitedoesnotexist9999.com. If it fails (which it will), go to example.com instead and tell me what you see.',
    expected: 'Should try first URL, detect failure, try alternative'
  },
  {
    name: 'Multi-step conditional',
    task: 'Go to github.com. If you see a search box, search for "react". If no search box, just tell me the page title.',
    expected: 'Should navigate, check page state, branch accordingly'
  },
  {
    name: 'Business logic - make decision',
    task: 'Research the most popular JavaScript framework. If it\'s React, tell me why. If it\'s something else, tell me what it is and why.',
    expected: 'Should research, evaluate, make reasoned decision'
  },
  {
    name: 'AGI test - money making logic',
    task: 'If I wanted to make $100 today using web automation, what would be the fastest legal way? Give me one specific actionable idea.',
    expected: 'Should reason about value creation, market opportunities, and execution'
  }
];

console.log('📤 Submitting 7 conditional logic tests via /task/incoming endpoint...\n');

const submitted = [];
for (let i = 0; i < conditionalTests.length; i++) {
  const test = conditionalTests[i];
  const subject = `PROD-COND-${TIMESTAMP}-${i+1}: ${test.name}`;

  try {
    const response = await fetch(`${AGENT_URL}/task/incoming`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': WEBHOOK_SECRET
      },
      body: JSON.stringify({
        userId: TEST_USER_ID,
        username: 'teste2e',
        from: TEST_USER_EMAIL,
        subject,
        body: test.task,
        inputChannel: 'email'
      })
    });

    if (response.ok) {
      console.log(`  ✓ ${test.name}`);
      submitted.push({ ...test, subject });
    } else {
      const error = await response.text();
      console.log(`  ✗ Failed: ${test.name} (${response.status}: ${error})`);
    }
  } catch (error) {
    console.log(`  ✗ Error: ${test.name} - ${error.message}`);
  }
}

console.log(`\n📊 Submitted ${submitted.length}/${conditionalTests.length} tests`);
console.log('\n⏳ Waiting 240 seconds for conditional logic processing...\n');

// Wait longer for conditional logic tasks (they need time to reason and branch)
for (let i = 0; i < 24; i++) {
  await new Promise(resolve => setTimeout(resolve, 10000));
  process.stdout.write(`  ${(i+1)*10}s...`);
  if ((i+1) % 6 === 0) process.stdout.write('\n');
}
console.log(' ✓\n');

// Get results
console.log('📥 Retrieving results from production database...\n');

const { data: tasks } = await supabase
  .from('tasks')
  .select('email_subject, status, iteration_count, action_count, action_success_count, verification_data, response_text')
  .eq('user_id', TEST_USER_ID)
  .like('email_subject', `PROD-COND-${TIMESTAMP}%`)
  .order('created_at', { ascending: true });

console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║  CONDITIONAL LOGIC TEST RESULTS                                ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

let completed = 0, needsReview = 0, failed = 0, processing = 0;
let totalActions = 0, successfulActions = 0, totalIterations = 0;

for (const task of tasks || []) {
  const testIndex = parseInt(task.email_subject.match(/PROD-COND-\d+-(\d+):/)?.[1] || '0') - 1;
  const test = conditionalTests[testIndex];

  const statusEmoji = task.status === 'completed' ? '✅' :
                     task.status === 'needs_review' ? '⚠️' :
                     task.status === 'failed' ? '❌' : '⏳';

  console.log(`${statusEmoji} ${test?.name || 'Unknown'}`);
  console.log(`   Status: ${task.status}`);
  console.log(`   Iterations: ${task.iteration_count || 0} | Actions: ${task.action_success_count || 0}/${task.action_count || 0} (${task.action_count > 0 ? Math.round((task.action_success_count / task.action_count) * 100) : 0}%)`);
  console.log(`   Confidence: ${task.verification_data?.confidence || 0}%`);

  if (task.response_text) {
    console.log(`   Response: ${task.response_text.substring(0, 120)}...`);
  }

  console.log(`   Expected: ${test?.expected || 'N/A'}`);
  console.log('');

  if (task.status === 'completed') completed++;
  else if (task.status === 'needs_review') needsReview++;
  else if (task.status === 'failed') failed++;
  else processing++;

  totalActions += task.action_count || 0;
  successfulActions += task.action_success_count || 0;
  totalIterations += task.iteration_count || 0;
}

const total = tasks?.length || 0;
const successRate = total > 0 ? ((completed / total) * 100).toFixed(1) : 0;
const actionSuccessRate = totalActions > 0 ? ((successfulActions / totalActions) * 100).toFixed(1) : 0;
const avgIterations = total > 0 ? (totalIterations / total).toFixed(1) : 0;

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`✅ Completed: ${completed}/${total} (${successRate}%)`);
console.log(`⚠️  Needs Review: ${needsReview}`);
console.log(`❌ Failed: ${failed}`);
console.log(`⏳ Processing: ${processing}`);
console.log('');
console.log(`📊 Action Success Rate: ${actionSuccessRate}% (${successfulActions}/${totalActions})`);
console.log(`📊 Avg Iterations: ${avgIterations}`);
console.log('');
console.log(`🎯 Target: 99% completion on conditional logic`);
console.log(`📊 Actual: ${successRate}%`);
console.log(`📈 Gap: ${(99 - parseFloat(successRate)).toFixed(1)}%`);

if (parseFloat(successRate) >= 99) {
  console.log('\n🎉 🎉 🎉 AGI-LEVEL ACHIEVED! Conditional logic at 99%! 🎉 🎉 🎉');
} else if (parseFloat(successRate) >= 90) {
  console.log(`\n✅ EXCELLENT! ${successRate}% success on conditional logic`);
} else if (parseFloat(successRate) >= 80) {
  console.log(`\n⚠️  GOOD! ${successRate}% success, need ${(99 - parseFloat(successRate)).toFixed(1)}% more`);
} else if (parseFloat(successRate) >= 70) {
  console.log(`\n⚠️  Improving... ${successRate}% success, need ${(99 - parseFloat(successRate)).toFixed(1)}% more`);
} else {
  console.log(`\n❌ Need significant improvement: ${(99 - parseFloat(successRate)).toFixed(1)}% gap`);
}

console.log('\n═══════════════════════════════════════════════════════════════\n');
