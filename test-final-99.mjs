#!/usr/bin/env node
/**
 * FINAL 99% SUCCESS VERIFICATION TEST
 * Mix of all complexity levels for statistically significant results
 */

import { createClient } from '@supabase/supabase-js';

const AGENT_URL = 'https://agent-production-1339.up.railway.app';
const TEST_USER_ID = '11684ec6-80cd-4bb6-9aed-8f0947afd06a';
const WEBHOOK_SECRET = 'a2915dbe03bba7e47a7ed82ffaed474b1f5cde98406d8033bede1832270464d7';
const TIMESTAMP = Date.now();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

console.log('\n╔════════════════════════════════════════════════════════════════╗');
console.log('║  FINAL 99% SUCCESS VERIFICATION TEST                           ║');
console.log('║  30 tasks across all complexity levels                         ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

const testTasks = [
  // Simple tasks (should be 100%)
  { task: 'What is 15 * 23?', tier: 'simple', expected: 100 },
  { task: 'Tell me 3 programming languages', tier: 'simple', expected: 100 },
  { task: 'What does HTML stand for?', tier: 'simple', expected: 100 },
  { task: 'Name 2 popular web browsers', tier: 'simple', expected: 100 },
  { task: 'What is the capital of France?', tier: 'simple', expected: 100 },

  // Research tasks (should be 95%+)
  { task: 'Search for "Python tutorial" and summarize the top result', tier: 'research', expected: 95 },
  { task: 'Find information about React framework', tier: 'research', expected: 95 },
  { task: 'Search for "TypeScript" and tell me what it is', tier: 'research', expected: 95 },
  { task: 'Look up information about Node.js', tier: 'research', expected: 95 },
  { task: 'Research what Docker is used for', tier: 'research', expected: 95 },
  { task: 'Search for "machine learning" and give me a brief summary', tier: 'research', expected: 95 },
  { task: 'Find information about Git version control', tier: 'research', expected: 95 },
  { task: 'Search for "REST API" and explain it in 2 sentences', tier: 'research', expected: 95 },

  // Multi-step tasks (should be 90%+)
  { task: 'Go to example.com and tell me the page title', tier: 'browser', expected: 90 },
  { task: 'Search for "JavaScript" and click the first result', tier: 'browser', expected: 90 },
  { task: 'Visit wikipedia.org and tell me the main headline', tier: 'browser', expected: 90 },
  { task: 'Go to github.com and tell me what you see', tier: 'browser', expected: 90 },
  { task: 'Search for "CSS tutorial" on DuckDuckGo', tier: 'browser', expected: 90 },

  // Error recovery (should be 85%+)
  { task: 'Try to visit https://nonexistent99999.com and tell me what happens', tier: 'recovery', expected: 85 },
  { task: 'Search for "qwertyasdfzxcv" and handle no results gracefully', tier: 'recovery', expected: 85 },

  // Memory tasks (should be 95%+)
  { task: 'Remember that my favorite color is blue', tier: 'memory', expected: 95 },
  { task: 'Remember I prefer dark mode', tier: 'memory', expected: 95 },
  { task: 'Remember my name is Alex', tier: 'memory', expected: 95 },

  // Complex conditional (should be 70%+)
  { task: 'Search for "Vue.js". If you find results, summarize the first one. If not, just say no results', tier: 'conditional', expected: 70 },
  { task: 'Go to example.com. If it loads, tell me the title. If not, say it failed', tier: 'conditional', expected: 70 },

  // Synthesis tasks (should be 75%+)
  { task: 'Compare React and Vue in one sentence based on what you know', tier: 'synthesis', expected: 75 },
  { task: 'Tell me the difference between Python and JavaScript', tier: 'synthesis', expected: 75 },
  { task: 'Explain why TypeScript is useful for large projects', tier: 'synthesis', expected: 75 },

  // Ambiguous tasks (should be 80%+)
  { task: 'Help me learn web development', tier: 'ambiguous', expected: 80 },
  { task: 'Find the best programming language for beginners', tier: 'ambiguous', expected: 80 },
];

// Submit all tasks
console.log('📤 Submitting 30 tasks...\n');

const submitted = [];
for (let i = 0; i < testTasks.length; i++) {
  const test = testTasks[i];
  const subject = `FINAL99-${TIMESTAMP}-${i+1}: [${test.tier}] ${test.task.substring(0, 40)}`;

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
      console.log(`  ✓ [${test.tier}] ${test.task.substring(0, 60)}...`);
      submitted.push({ ...test, subject });
    } else {
      console.log(`  ✗ Failed: ${test.task.substring(0, 60)}`);
    }
  } catch (error) {
    console.log(`  ✗ Error: ${error.message}`);
  }
}

console.log(`\n📊 Submitted ${submitted.length}/30 tasks`);
console.log('\n⏳ Waiting 180 seconds for processing...\n');

// Wait for completion
for (let i = 0; i < 18; i++) {
  await new Promise(resolve => setTimeout(resolve, 10000));
  process.stdout.write(`  ${(i+1)*10}s...`);
  if ((i+1) % 6 === 0) process.stdout.write('\n');
}
console.log(' ✓\n');

// Get results
console.log('📥 Retrieving results...\n');

const { data: tasks } = await supabase
  .from('tasks')
  .select('email_subject, status, iteration_count, action_count, action_success_count, verification_data')
  .eq('user_id', TEST_USER_ID)
  .like('email_subject', `FINAL99-${TIMESTAMP}%`)
  .order('created_at', { ascending: true });

// Analyze by tier
const tierStats = {};
let totalCompleted = 0;
let total = 0;

for (const task of tasks || []) {
  const tierMatch = task.email_subject.match(/\[(.*?)\]/);
  const tier = tierMatch ? tierMatch[1] : 'unknown';

  if (!tierStats[tier]) {
    tierStats[tier] = { completed: 0, needsReview: 0, failed: 0, processing: 0, total: 0 };
  }

  tierStats[tier].total++;
  total++;

  if (task.status === 'completed') {
    tierStats[tier].completed++;
    totalCompleted++;
  } else if (task.status === 'needs_review') {
    tierStats[tier].needsReview++;
  } else if (task.status === 'failed') {
    tierStats[tier].failed++;
  } else {
    tierStats[tier].processing++;
  }
}

console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║  RESULTS BY TIER                                               ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

for (const [tier, stats] of Object.entries(tierStats)) {
  const rate = stats.total > 0 ? ((stats.completed / stats.total) * 100).toFixed(1) : 0;
  console.log(`📁 ${tier}`);
  console.log(`   ✅ ${stats.completed}/${stats.total} (${rate}%)`);
  if (stats.needsReview > 0) console.log(`   ⚠️  Needs Review: ${stats.needsReview}`);
  if (stats.failed > 0) console.log(`   ❌ Failed: ${stats.failed}`);
  if (stats.processing > 0) console.log(`   ⏳ Processing: ${stats.processing}`);
  console.log('');
}

const overallRate = total > 0 ? ((totalCompleted / total) * 100).toFixed(1) : 0;

console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║  FINAL RESULTS                                                 ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');
console.log(`  Total Tasks: ${total}`);
console.log(`  ✅ Completed: ${totalCompleted} (${overallRate}%)`);
console.log(`\n  🎯 Target: 99%`);
console.log(`  📊 Actual: ${overallRate}%`);
console.log(`  📈 Gap: ${(99 - parseFloat(overallRate)).toFixed(1)}%`);

if (parseFloat(overallRate) >= 99) {
  console.log(`\n  🎉 🎉 🎉 SUCCESS! 99% TARGET ACHIEVED! 🎉 🎉 🎉`);
} else if (parseFloat(overallRate) >= 95) {
  console.log(`\n  ✅ EXCELLENT! Very close to 99% target`);
} else if (parseFloat(overallRate) >= 90) {
  console.log(`\n  ⚠️  GOOD! Need ${(99 - parseFloat(overallRate)).toFixed(1)}% more for 99%`);
} else {
  console.log(`\n  ❌ Need ${(99 - parseFloat(overallRate)).toFixed(1)}% improvement`);
}

console.log('\n═══════════════════════════════════════════════════════════════\n');
