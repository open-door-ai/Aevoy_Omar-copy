import { createClient } from '@supabase/supabase-js';

const AGENT_URL = 'https://agent-production-1339.up.railway.app';
const TEST_USER_ID = '11684ec6-80cd-4bb6-9aed-8f0947afd06a';
const TIMESTAMP = Date.now();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

console.log(`\n=== FRESH BATCH TEST (${TIMESTAMP}) ===\n`);

const tasks = [
  'AI: What is 5+5?',
  'AI: Name a fruit',
  'Browser: example.com title',
  'Browser: wikipedia.org',
  'Browser: github.com',
  'Search: Python tutorial',
  'Search: JavaScript guide',
  'Memory: favorite food pizza',
  'Memory: What is favorite food?',
  'Screenshot: google.com',
];

console.log('Submitting 10 tasks...\n');
const startTime = new Date().toISOString();

for (const task of tasks) {
  await fetch(`${AGENT_URL}/task/incoming`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-secret': process.env.AGENT_WEBHOOK_SECRET
    },
    body: JSON.stringify({
      userId: TEST_USER_ID,
      username: 'teste2e',
      from: 'teste2e@aevoy.com',
      subject: `T${TIMESTAMP}: ${task}`,
      body: task,
      inputChannel: 'email'
    })
  });
}

console.log('✓ All submitted, waiting 90s...\n');
await new Promise(r => setTimeout(r, 90000));

const { data: results } = await supabase
  .from('tasks')
  .select('email_subject, status, iteration_count, action_count, cost_usd')
  .eq('user_id', TEST_USER_ID)
  .gte('created_at', startTime)
  .order('created_at', { ascending: false});

console.log('=== RESULTS ===\n');
let completed = 0, needsReview = 0, stuck = 0, maxIter = 0;

for (const task of results || []) {
  const emoji = task.status === 'completed' ? '✅' : 
                task.status === 'needs_review' ? '⚠️' : '⏳';
  console.log(`${emoji} ${task.email_subject.split(': ')[1]}`);
  console.log(`   ${task.status}, iter=${task.iteration_count || 0}, actions=${task.action_count || 0}`);
  
  maxIter = Math.max(maxIter, task.iteration_count || 0);
  if (task.status === 'completed') completed++;
  else if (task.status === 'needs_review') needsReview++;
  else if (task.status === 'processing') stuck++;
}

const total = results?.length || 0;
const successRate = total > 0 ? ((completed / total) * 100).toFixed(1) : 0;

console.log(`\n=== SUMMARY ===`);
console.log(`Total: ${total}`);
console.log(`✅ Completed: ${completed} (${successRate}%)`);
console.log(`⚠️  Needs Review: ${needsReview}`);
console.log(`⏳ Stuck: ${stuck}`);
console.log(`📊 Max iterations seen: ${maxIter} (should be ≤5)`);
console.log(`\n${completed >= 9 ? '✅ PASS' : '❌ FAIL'} (target: 90%+)`);
