#!/usr/bin/env node
/**
 * EXTREME COMPLEXITY TEST SUITE
 * Target: 99% success on AGI-level tasks
 *
 * Tests:
 * - 10+ step workflows
 * - Conditional logic (if X then Y else Z)
 * - Cross-site data synthesis
 * - Error recovery chains
 * - Ambiguous instructions
 * - Multi-domain research
 */

import { createClient } from '@supabase/supabase-js';

const AGENT_URL = 'https://agent-production-1339.up.railway.app';
const TEST_USER_ID = '11684ec6-80cd-4bb6-9aed-8f0947afd06a';
const WEBHOOK_SECRET = process.env.AGENT_WEBHOOK_SECRET || 'a2915dbe03bba7e47a7ed82ffaed474b1f5cde98406d8033bede1832270464d7';
const TIMESTAMP = Date.now();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

console.log('\n╔════════════════════════════════════════════════════════════════╗');
console.log('║       EXTREME COMPLEXITY TEST SUITE (AGI-LEVEL)                ║');
console.log('║  Target: 99% autonomous success on multi-step logic            ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

const extremeTests = [
  // Conditional Logic
  {
    category: 'Conditional Logic',
    complexity: 'EXTREME',
    task: 'Go to example.com. If you see a "More information" link, click it and tell me the page title. If not, just tell me "No link found"',
    expectedSteps: 3
  },
  {
    category: 'Conditional Logic',
    complexity: 'EXTREME',
    task: 'Search for "JavaScript" on DuckDuckGo. If there are results, click the first one and summarize it. If no results, search for "TypeScript" instead',
    expectedSteps: 4
  },

  // Cross-Site Synthesis
  {
    category: 'Cross-Site Synthesis',
    complexity: 'EXTREME',
    task: 'Search for "React framework" and "Vue framework" separately, then compare them in 2 sentences based on what you find',
    expectedSteps: 4
  },
  {
    category: 'Cross-Site Synthesis',
    complexity: 'EXTREME',
    task: 'Go to wikipedia.org and github.com, then tell me which one loads faster and what the main content is on each',
    expectedSteps: 4
  },

  // Multi-Step Workflows
  {
    category: 'Multi-Step Workflow',
    complexity: 'EXTREME',
    task: 'Search for "Python tutorial", click the first result, extract the page title, then search for that title on Wikipedia and tell me if it exists',
    expectedSteps: 6
  },
  {
    category: 'Multi-Step Workflow',
    complexity: 'EXTREME',
    task: 'Go to example.com, take a screenshot, then go to wikipedia.org, take another screenshot, and tell me which page has more text content',
    expectedSteps: 5
  },

  // Ambiguous Instructions
  {
    category: 'Ambiguous Task',
    complexity: 'EXTREME',
    task: 'Find information about the most popular programming language and tell me 3 key facts',
    expectedSteps: 3
  },
  {
    category: 'Ambiguous Task',
    complexity: 'EXTREME',
    task: 'Research the best way to learn web development and give me a roadmap',
    expectedSteps: 3
  },

  // Error Recovery Chains
  {
    category: 'Error Recovery',
    complexity: 'EXTREME',
    task: 'Try to visit https://nonexistentsite9999.com. If it fails, try https://example.com instead. If that also fails, just tell me "All sites failed"',
    expectedSteps: 3
  },
  {
    category: 'Error Recovery',
    complexity: 'EXTREME',
    task: 'Search for "asdfghjklqwertyuiop" (nonsense). If no meaningful results, search for "web development" instead and summarize the top result',
    expectedSteps: 4
  },

  // Data Validation
  {
    category: 'Data Validation',
    complexity: 'EXTREME',
    task: 'Go to github.com and verify it actually loaded (check the page title). If it did, tell me "Verified: [title]". If not, tell me "Load failed"',
    expectedSteps: 2
  },
  {
    category: 'Data Validation',
    complexity: 'EXTREME',
    task: 'Calculate 157 * 89, then verify your answer by calculating it again a different way',
    expectedSteps: 2
  },

  // Complex Memory Tasks
  {
    category: 'Complex Memory',
    complexity: 'EXTREME',
    task: 'Remember that my favorite colors are blue and green, my favorite number is 42, and my favorite food is pizza',
    expectedSteps: 1
  },
  {
    category: 'Complex Memory',
    complexity: 'EXTREME',
    task: 'What are my favorite colors, number, and food?',
    expectedSteps: 1
  },

  // Sequential Dependencies
  {
    category: 'Sequential Dependencies',
    complexity: 'EXTREME',
    task: 'Search for "Node.js", extract the URL of the first result, then search for that exact URL and tell me how many results mention it',
    expectedSteps: 5
  },
];

// Submit all tasks
const submissions = [];
console.log('📤 Submitting tasks...\n');

for (const test of extremeTests) {
  const subject = `EXTREME-${TIMESTAMP}: [${test.category}] ${test.task.substring(0, 40)}`;

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
        from: 'teste2e@aevoy.com',
        subject,
        body: test.task,
        inputChannel: 'email'
      })
    });

    if (response.ok) {
      console.log(`  ✓ [${test.category}] ${test.task.substring(0, 60)}...`);
      submissions.push({ ...test, subject });
    } else {
      console.log(`  ✗ Failed to submit: ${test.task.substring(0, 60)}`);
    }
  } catch (error) {
    console.log(`  ✗ Error: ${error.message}`);
  }
}

console.log(`\n📊 Submitted ${submissions.length}/${extremeTests.length} tasks`);
console.log('\n⏳ Waiting 180 seconds for complex task processing...\n');

// Wait for completion (longer timeout for complex tasks)
for (let i = 0; i < 18; i++) {
  await new Promise(r => setTimeout(r, 10000));
  process.stdout.write(`  ${(i + 1) * 10}s...`);
}
console.log(' ✓\n');

// Retrieve results
console.log('📥 Retrieving results...\n');

const { data: results } = await supabase
  .from('tasks')
  .select('email_subject, status, iteration_count, action_count, action_success_count, verification_status, verification_data, error_message, cost_usd')
  .eq('user_id', TEST_USER_ID)
  .like('email_subject', `EXTREME-${TIMESTAMP}:%`)
  .order('created_at', { ascending: true });

// Analyze by category
const categoryStats = {};
let totalCompleted = 0;
let totalNeedsReview = 0;
let totalFailed = 0;
let totalProcessing = 0;
let totalCost = 0;

console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║  DETAILED RESULTS                                              ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

for (const result of results || []) {
  const submission = submissions.find(s => result.email_subject.includes(s.task.substring(0, 30)));
  if (!submission) continue;

  if (!categoryStats[submission.category]) {
    categoryStats[submission.category] = { total: 0, completed: 0, needsReview: 0, failed: 0, processing: 0 };
  }

  const cat = categoryStats[submission.category];
  cat.total++;

  const confidence = result.verification_data?.confidence || 0;
  const cost = result.cost_usd || 0;
  totalCost += cost;

  const statusEmoji = result.status === 'completed' ? '✅' :
                       result.status === 'needs_review' ? '⚠️' :
                       result.status === 'failed' ? '❌' : '⏳';

  console.log(`${statusEmoji} [${submission.category}]`);
  console.log(`   ${submission.task.substring(0, 80)}`);
  console.log(`   Status: ${result.status} | Iters: ${result.iteration_count || 0} | Actions: ${result.action_success_count || 0}/${result.action_count || 0} | Conf: ${confidence}% | Cost: $${cost.toFixed(4)}`);
  if (result.error_message) {
    console.log(`   ⚠️  Error: ${result.error_message.substring(0, 100)}`);
  }
  console.log('');

  if (result.status === 'completed') {
    cat.completed++;
    totalCompleted++;
  } else if (result.status === 'needs_review') {
    cat.needsReview++;
    totalNeedsReview++;
  } else if (result.status === 'failed') {
    cat.failed++;
    totalFailed++;
  } else {
    cat.processing++;
    totalProcessing++;
  }
}

// Category summary
console.log('\n╔════════════════════════════════════════════════════════════════╗');
console.log('║  CATEGORY PERFORMANCE                                          ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

for (const [category, stats] of Object.entries(categoryStats)) {
  const successRate = stats.total > 0 ? ((stats.completed / stats.total) * 100).toFixed(1) : 0;
  console.log(`📁 ${category}`);
  console.log(`   Success: ${stats.completed}/${stats.total} (${successRate}%)`);
  console.log(`   Needs Review: ${stats.needsReview} | Failed: ${stats.failed} | Processing: ${stats.processing}`);
  console.log('');
}

// Overall results
const totalTasks = submissions.length;
const overallSuccess = totalTasks > 0 ? ((totalCompleted / totalTasks) * 100).toFixed(1) : 0;
const target = 99.0;

console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║  FINAL RESULTS                                                 ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');
console.log(`  Total Tasks: ${totalTasks}`);
console.log(`  ✅ Completed: ${totalCompleted} (${overallSuccess}%)`);
console.log(`  ⚠️  Needs Review: ${totalNeedsReview}`);
console.log(`  ❌ Failed: ${totalFailed}`);
console.log(`  ⏳ Processing: ${totalProcessing}`);
console.log(`  💰 Total Cost: $${totalCost.toFixed(4)}`);
console.log(`  📊 Avg Cost: $${totalTasks > 0 ? (totalCost / totalTasks).toFixed(4) : '0.0000'}`);
console.log('');
console.log(`  🎯 Target: ${target}%`);
console.log(`  📊 Actual: ${overallSuccess}%`);
console.log(`  📈 Gap: ${(parseFloat(overallSuccess) - target).toFixed(1)}%`);
console.log('');

if (parseFloat(overallSuccess) >= target) {
  console.log('  ✅ ✅ ✅  AGI-LEVEL SUCCESS ACHIEVED  ✅ ✅ ✅');
  console.log('\n  System demonstrates autonomous handling of:');
  console.log('    - Conditional logic (if/then/else)');
  console.log('    - Cross-site data synthesis');
  console.log('    - Multi-step workflows (6+ steps)');
  console.log('    - Ambiguous instructions');
  console.log('    - Error recovery chains');
  console.log('    - Sequential dependencies');
} else {
  console.log(`  ❌ Need ${(target - parseFloat(overallSuccess)).toFixed(1)}% improvement for AGI-level`);

  if (totalProcessing > 0) {
    console.log(`\n  🔍 ${totalProcessing} tasks stuck in processing`);
  }
  if (totalNeedsReview > 0) {
    console.log(`  🔍 ${totalNeedsReview} tasks flagged for review`);
  }
  if (totalFailed > 0) {
    console.log(`  🔍 ${totalFailed} tasks failed execution`);
  }
}

console.log('\n═══════════════════════════════════════════════════════════════\n');
