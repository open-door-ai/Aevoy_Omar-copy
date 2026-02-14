import { createClient } from '@supabase/supabase-js';

const AGENT_URL = 'https://agent-production-1339.up.railway.app';
const TEST_USER_ID = '11684ec6-80cd-4bb6-9aed-8f0947afd06a';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

console.log('\n=== 10 CONCURRENT TASKS TEST ===\n');

// Submit 10 tasks simultaneously
const tasks = [
  'AI Test 1: What is 2+2?',
  'AI Test 2: List 3 colors',
  'Browser Test 1: Go to example.com',
  'Browser Test 2: Visit wikipedia.org',
  'Browser Test 3: Go to github.com',
  'Search Test 1: Search for weather',
  'Search Test 2: Find Eiffel Tower info',
  'Memory Test 1: Remember my favorite color is blue',
  'Memory Test 2: What is my favorite color?',
  'Screenshot Test: Screenshot google.com',
];

console.log('Submitting 10 tasks simultaneously...\n');

const promises = tasks.map(task => 
  fetch(`${AGENT_URL}/task/incoming`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-secret': process.env.AGENT_WEBHOOK_SECRET
    },
    body: JSON.stringify({
      userId: TEST_USER_ID,
      username: 'teste2e',
      from: 'teste2e@aevoy.com',
      subject: `CONCURRENT-10: ${task}`,
      body: task,
      inputChannel: 'email'
    })
  }).then(r => r.json())
);

await Promise.all(promises);
console.log('✓ All 10 tasks submitted\n');

// Wait 90 seconds
console.log('Waiting 90s for execution...\n');
await new Promise(r => setTimeout(r, 90000));

// Check results
const { data: results } = await supabase
  .from('tasks')
  .select('id, email_subject, status, iteration_count, action_count, cost_usd')
  .eq('user_id', TEST_USER_ID)
  .like('email_subject', 'CONCURRENT-10:%')
  .order('created_at', { ascending: false});

console.log('=== RESULTS ===\n');

let completed = 0, stuck = 0;
const stuckPattern = {};

for (const task of results || []) {
  const emoji = task.status === 'completed' ? '✅' : '⏳';
  console.log(`${emoji} ${task.email_subject.replace('CONCURRENT-10: ', '')}`);
  console.log(`   Status: ${task.status}, Iter: ${task.iteration_count || 0}, Actions: ${task.action_count || 0}, Cost: $${(task.cost_usd || 0).toFixed(4)}`);
  
  if (task.status === 'completed') {
    completed++;
  } else if (task.status === 'processing') {
    stuck++;
    const key = `${task.iteration_count || 0},${task.action_count || 0}`;
    stuckPattern[key] = (stuckPattern[key] || 0) + 1;
  }
}

console.log(`\n=== SUMMARY ===`);
console.log(`Completed: ${completed}/10 (${(completed/10*100).toFixed(1)}%)`);
console.log(`Stuck in processing: ${stuck}/10`);

if (Object.keys(stuckPattern).length > 0) {
  console.log(`\nStuck pattern:`);
  for (const [pattern, count] of Object.entries(stuckPattern)) {
    console.log(`  ${count} tasks stuck at: iter=${pattern.split(',')[0]}, actions=${pattern.split(',')[1]}`);
  }
}

console.log(`\n${completed >= 9 ? '✅ PASS' : '❌ FAIL'} (target: 9+/10 = 90%+)`);
