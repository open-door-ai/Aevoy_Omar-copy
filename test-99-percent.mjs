#!/usr/bin/env node
/**
 * Comprehensive Production Test: 99.99% Success Rate Validation
 * Tests VPS Playwright + verification fix until 99.99% autonomous completion
 */

import { createClient } from '@supabase/supabase-js';

const AGENT_URL = 'https://agent-production-1339.up.railway.app';
const TEST_USER_ID = '11684ec6-80cd-4bb6-9aed-8f0947afd06a'; // teste2e
const TARGET_SUCCESS_RATE = 99.9; // 99.9% target

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const testTasks = [
  // Simple AI tasks (should be 100% success)
  { subject: 'AI Test 1', body: 'What is 2+2?', expectedTime: 10 },
  { subject: 'AI Test 2', body: 'List 3 colors', expectedTime: 10 },

  // Browser research tasks (should be 95%+ success after verification fix)
  { subject: 'Browser Test 1', body: 'Go to example.com and tell me the page title', expectedTime: 60 },
  { subject: 'Browser Test 2', body: 'Visit wikipedia.org and tell me the main headline', expectedTime: 60 },
  { subject: 'Browser Test 3', body: 'Go to github.com and tell me what you see', expectedTime: 60 },

  // Search tasks (should be 95%+ success)
  { subject: 'Search Test 1', body: 'Search for "weather forecast" and tell me the first result', expectedTime: 60 },
  { subject: 'Search Test 2', body: 'Find information about the Eiffel Tower', expectedTime: 60 },

  // Memory tasks
  { subject: 'Memory Test 1', body: 'Remember that my favorite color is blue', expectedTime: 10 },
  { subject: 'Memory Test 2', body: 'What is my favorite color?', expectedTime: 10 },

  // Screenshot tasks
  { subject: 'Screenshot Test 1', body: 'Take a screenshot of google.com', expectedTime: 60 },
];

async function submitTask(task) {
  try {
    const res = await fetch(`${AGENT_URL}/task/incoming`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': process.env.AGENT_WEBHOOK_SECRET
      },
      body: JSON.stringify({
        userId: TEST_USER_ID,
        username: 'teste2e',
        from: 'teste2e@aevoy.com',
        subject: task.subject,
        body: task.body,
        inputChannel: 'email'
      })
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function getResults(since) {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, email_subject, status, verification_status, iteration_count, action_count, cost_usd')
    .eq('user_id', TEST_USER_ID)
    .gte('created_at', since)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

async function runTestBatch() {
  const startTime = new Date().toISOString();
  const batchStart = Date.now();

  console.log(`\n${'='.repeat(80)}`);
  console.log(`TEST BATCH START: ${new Date().toLocaleString()}`);
  console.log(`${'='.repeat(80)}\n`);

  // Submit all tasks
  console.log('Submitting tasks...');
  const submissions = [];
  for (const task of testTasks) {
    const result = await submitTask(task);
    submissions.push({ task, result });
    console.log(`  ${result.success ? '✓' : '✗'} ${task.subject}: ${result.success ? 'submitted' : result.error}`);
  }

  const submitted = submissions.filter(s => s.success).length;
  console.log(`\nSubmitted: ${submitted}/${testTasks.length} tasks\n`);

  // Wait for completion (max expected time + buffer)
  const maxWait = Math.max(...testTasks.map(t => t.expectedTime)) + 30;
  console.log(`Waiting ${maxWait}s for completion...`);

  for (let i = 0; i < maxWait; i += 10) {
    process.stdout.write(`  ${i}s...`);
    await new Promise(r => setTimeout(r, 10000));
  }
  console.log(`  ${maxWait}s ✓\n`);

  // Get results
  const results = await getResults(startTime);
  console.log(`Retrieved ${results.length} results\n`);

  // Analyze results
  const stats = {
    total: results.length,
    completed: 0,
    needs_review: 0,
    failed: 0,
    awaiting_input: 0,
    other: 0,
    autonomous: 0, // completed without needs_review
    cost: 0
  };

  console.log('Results:\n');
  for (const task of results) {
    const status = task.status;
    const verif = task.verification_status || 'none';
    const iters = task.iteration_count || 0;
    const actions = task.action_count || 0;
    const cost = task.cost_usd || 0;

    stats.cost += cost;

    if (status === 'completed') {
      stats.completed++;
      stats.autonomous++;
    } else if (status === 'needs_review') {
      stats.needs_review++;
    } else if (status === 'failed') {
      stats.failed++;
    } else if (status === 'awaiting_input') {
      stats.awaiting_input++;
    } else {
      stats.other++;
    }

    const emoji = status === 'completed' ? '✅' :
                  status === 'needs_review' ? '⚠️' :
                  status === 'failed' ? '❌' : '⏳';

    console.log(`  ${emoji} ${task.email_subject}`);
    console.log(`     Status: ${status} | Verif: ${verif} | Iters: ${iters} | Actions: ${actions} | Cost: $${cost.toFixed(4)}`);
  }

  const successRate = stats.total > 0 ? (stats.autonomous / stats.total * 100) : 0;
  const completionRate = stats.total > 0 ? (stats.completed / stats.total * 100) : 0;

  console.log(`\n${'-'.repeat(80)}`);
  console.log('STATISTICS:');
  console.log(`  Total: ${stats.total}`);
  console.log(`  ✅ Completed: ${stats.completed} (${completionRate.toFixed(1)}%)`);
  console.log(`  ⚠️  Needs Review: ${stats.needs_review}`);
  console.log(`  ❌ Failed: ${stats.failed}`);
  console.log(`  ⏳ Awaiting Input: ${stats.awaiting_input}`);
  console.log(`  Autonomous Success Rate: ${successRate.toFixed(2)}% (target: ${TARGET_SUCCESS_RATE}%)`);
  console.log(`  Total Cost: $${stats.cost.toFixed(4)}`);
  console.log(`  Avg Cost: $${stats.total > 0 ? (stats.cost / stats.total).toFixed(4) : '0.0000'}`);
  console.log(`${'-'.repeat(80)}`);

  const batchTime = ((Date.now() - batchStart) / 1000).toFixed(1);
  console.log(`Batch completed in ${batchTime}s\n`);

  return {
    successRate,
    stats,
    passed: successRate >= TARGET_SUCCESS_RATE,
    batchTime
  };
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║   99.99% SUCCESS RATE VALIDATION - VPS PLAYWRIGHT SWITCH   ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  console.log(`Agent: ${AGENT_URL}`);
  console.log(`Test User: teste2e (${TEST_USER_ID})`);
  console.log(`Target: ${TARGET_SUCCESS_RATE}% autonomous completion`);
  console.log(`Tasks per batch: ${testTasks.length}\n`);

  let batchNum = 1;
  let totalTests = 0;
  let totalSuccess = 0;

  while (true) {
    console.log(`\n${'#'.repeat(80)}`);
    console.log(`# BATCH ${batchNum}`);
    console.log(`${'#'.repeat(80)}`);

    const result = await runTestBatch();
    totalTests += result.stats.total;
    totalSuccess += result.stats.autonomous;

    const overallRate = totalTests > 0 ? (totalSuccess / totalTests * 100) : 0;

    console.log(`\nOVERALL (${batchNum} batches, ${totalTests} tests):`);
    console.log(`  Success Rate: ${overallRate.toFixed(2)}%`);
    console.log(`  Target: ${TARGET_SUCCESS_RATE}%`);
    console.log(`  Result: ${result.passed ? '✅ BATCH PASSED' : '❌ BATCH FAILED'}`);

    if (result.passed && overallRate >= TARGET_SUCCESS_RATE) {
      console.log(`\n${'🎉'.repeat(40)}`);
      console.log(`✅ TARGET ACHIEVED! ${overallRate.toFixed(2)}% >= ${TARGET_SUCCESS_RATE}%`);
      console.log(`Total batches: ${batchNum}`);
      console.log(`Total tests: ${totalTests}`);
      console.log(`${'🎉'.repeat(40)}\n`);
      break;
    }

    console.log(`\n⏭️  Running next batch in 30s...\n`);
    await new Promise(r => setTimeout(r, 30000));
    batchNum++;

    // Safety limit: max 10 batches
    if (batchNum > 10) {
      console.log('\n⚠️  Reached 10 batch limit. Stopping tests.');
      console.log(`Final success rate: ${overallRate.toFixed(2)}%`);
      break;
    }
  }
}

main().catch(err => {
  console.error('\n❌ ERROR:', err);
  process.exit(1);
});
