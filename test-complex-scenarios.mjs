#!/usr/bin/env node
/**
 * COMPREHENSIVE COMPLEXITY TEST SUITE
 * Target: 99% autonomous success rate on real-world scenarios
 *
 * Categories:
 * 1. Multi-step logic (5+ actions, conditional branching)
 * 2. Error recovery (network failures, retries, adaptation)
 * 3. Edge cases (timeouts, rate limits, CAPTCHAs)
 * 4. Real-world tasks (booking, research with synthesis, data extraction)
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
console.log('║  COMPREHENSIVE COMPLEXITY TEST SUITE                           ║');
console.log('║  Target: 99% success on real-world complex tasks              ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

// Define test categories
const testCategories = {
  'Multi-Step Logic': [
    {
      task: 'Go to example.com, find the "More information" link, click it, then extract the page title',
      expectedActions: 3,
      complexity: 'medium'
    },
    {
      task: 'Search for "TypeScript tutorial" on DuckDuckGo, click the first result, then tell me what website it took you to',
      expectedActions: 3,
      complexity: 'medium'
    },
    {
      task: 'Visit GitHub.com, search for "react", and tell me how many stars the top result has',
      expectedActions: 4,
      complexity: 'high'
    },
  ],

  'Data Extraction': [
    {
      task: 'Go to wikipedia.org and tell me the main headline on the homepage',
      expectedActions: 2,
      complexity: 'low'
    },
    {
      task: 'Search for "Python programming language" and summarize the top 3 search results',
      expectedActions: 2,
      complexity: 'medium'
    },
  ],

  'Error Recovery': [
    {
      task: 'Try to go to https://thiswebsitedoesnotexist12345.com and tell me what happened',
      expectedActions: 1,
      complexity: 'low',
      expectsFailure: true
    },
    {
      task: 'Search for "test" but if it fails, try a different search engine',
      expectedActions: 2,
      complexity: 'medium'
    },
  ],

  'Knowledge Tasks': [
    {
      task: 'What is 25 * 16?',
      expectedActions: 0,
      complexity: 'trivial'
    },
    {
      task: 'Explain what TypeScript is in one sentence',
      expectedActions: 0,
      complexity: 'trivial'
    },
  ],

  'Memory & Context': [
    {
      task: 'Remember that my favorite programming language is Python',
      expectedActions: 1,
      complexity: 'low'
    },
    {
      task: 'What is my favorite programming language?',
      expectedActions: 1,
      complexity: 'low'
    },
  ],
};

// Submit all tasks
const submissions = [];
let taskCount = 0;

console.log('📤 Submitting tasks...\n');

for (const [category, tasks] of Object.entries(testCategories)) {
  console.log(`\n═══ ${category} (${tasks.length} tasks) ═══`);

  for (const test of tasks) {
    taskCount++;
    const subject = `COMPLEX-${TIMESTAMP}-${taskCount}: ${test.task.substring(0, 50)}`;

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
        console.log(`  ✓ ${test.complexity.toUpperCase()}: ${test.task.substring(0, 60)}...`);
        submissions.push({ ...test, subject, category });
      } else {
        console.log(`  ✗ Failed to submit: ${test.task.substring(0, 60)}`);
      }
    } catch (error) {
      console.log(`  ✗ Error submitting: ${error.message}`);
    }
  }
}

console.log(`\n📊 Submitted ${submissions.length}/${taskCount} tasks`);
console.log('\n⏳ Waiting 120 seconds for processing...\n');

// Wait for completion
const startTime = Date.now();
for (let i = 0; i < 12; i++) {
  await new Promise(r => setTimeout(r, 10000));
  process.stdout.write(`  ${(i + 1) * 10}s...`);
}
console.log(' ✓\n');

// Retrieve results
console.log('📥 Retrieving results...\n');

const { data: results } = await supabase
  .from('tasks')
  .select('email_subject, status, iteration_count, action_count, action_success_count, verification_status, verification_data, error_message')
  .eq('user_id', TEST_USER_ID)
  .like('email_subject', `COMPLEX-${TIMESTAMP}-%`)
  .order('created_at', { ascending: true });

// Analyze results by category
const analysis = {};
let totalCompleted = 0;
let totalNeedsReview = 0;
let totalFailed = 0;
let totalProcessing = 0;

for (const [category, tasks] of Object.entries(testCategories)) {
  analysis[category] = {
    total: tasks.length,
    completed: 0,
    needsReview: 0,
    failed: 0,
    processing: 0,
    avgIterations: 0,
    avgActions: 0
  };
}

console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║  DETAILED RESULTS BY CATEGORY                                  ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

for (const result of results || []) {
  const submission = submissions.find(s => result.email_subject.includes(s.task.substring(0, 30)));
  if (!submission) continue;

  const cat = analysis[submission.category];
  const confidence = result.verification_data?.confidence || 0;

  // Status
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

  cat.avgIterations += result.iteration_count || 0;
  cat.avgActions += result.action_count || 0;

  // Print result
  const statusEmoji = result.status === 'completed' ? '✅' :
                       result.status === 'needs_review' ? '⚠️' :
                       result.status === 'failed' ? '❌' : '⏳';

  console.log(`${statusEmoji} [${submission.category}] ${submission.complexity.toUpperCase()}`);
  console.log(`   Task: ${submission.task.substring(0, 70)}`);
  console.log(`   Status: ${result.status} | Iters: ${result.iteration_count || 0} | Actions: ${result.action_success_count || 0}/${result.action_count || 0} | Confidence: ${confidence}%`);
  if (result.error_message) {
    console.log(`   Error: ${result.error_message.substring(0, 80)}`);
  }
  console.log('');
}

// Calculate averages
for (const cat of Object.values(analysis)) {
  if (cat.total > 0) {
    cat.avgIterations = (cat.avgIterations / cat.total).toFixed(1);
    cat.avgActions = (cat.avgActions / cat.total).toFixed(1);
  }
}

// Print summary
console.log('\n╔════════════════════════════════════════════════════════════════╗');
console.log('║  CATEGORY BREAKDOWN                                            ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

for (const [category, stats] of Object.entries(analysis)) {
  const successRate = stats.total > 0 ? ((stats.completed / stats.total) * 100).toFixed(1) : 0;
  console.log(`📁 ${category}`);
  console.log(`   ✅ Completed: ${stats.completed}/${stats.total} (${successRate}%)`);
  console.log(`   ⚠️  Needs Review: ${stats.needsReview}`);
  console.log(`   ❌ Failed: ${stats.failed}`);
  console.log(`   ⏳ Processing: ${stats.processing}`);
  console.log(`   📊 Avg: ${stats.avgIterations} iterations, ${stats.avgActions} actions`);
  console.log('');
}

// Overall summary
const totalTasks = submissions.length;
const overallSuccess = totalTasks > 0 ? ((totalCompleted / totalTasks) * 100).toFixed(1) : 0;
const target = 99.0;

console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║  OVERALL RESULTS                                               ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');
console.log(`  Total Tasks: ${totalTasks}`);
console.log(`  ✅ Completed: ${totalCompleted} (${overallSuccess}%)`);
console.log(`  ⚠️  Needs Review: ${totalNeedsReview}`);
console.log(`  ❌ Failed: ${totalFailed}`);
console.log(`  ⏳ Processing: ${totalProcessing}`);
console.log('');
console.log(`  🎯 Target: ${target}%`);
console.log(`  📊 Actual: ${overallSuccess}%`);
console.log(`  📈 Gap: ${(target - parseFloat(overallSuccess)).toFixed(1)}%`);
console.log('');

if (parseFloat(overallSuccess) >= target) {
  console.log('  ✅ SUCCESS: Target achieved!');
} else {
  console.log(`  ❌ FAILED: Need ${(target - parseFloat(overallSuccess)).toFixed(1)}% improvement`);
  console.log('\n  📋 Issues to address:');
  if (totalProcessing > 0) console.log(`     - ${totalProcessing} tasks stuck in processing (timeout issue)`);
  if (totalNeedsReview > 0) console.log(`     - ${totalNeedsReview} tasks need review (verification threshold issue)`);
  if (totalFailed > 0) console.log(`     - ${totalFailed} tasks failed (execution error)`);
}

console.log('\n═══════════════════════════════════════════════════════════════\n');
