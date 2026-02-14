import { createClient } from '@supabase/supabase-js';

const AGENT_URL = 'https://agent-production-1339.up.railway.app';
const TEST_USER_ID = '11684ec6-80cd-4bb6-9aed-8f0947afd06a';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

console.log('\n=== SINGLE BROWSER TEST (Concurrency Fix Verification) ===\n');

// Submit one simple browser task
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
    subject: 'CONCURRENCY FIX TEST',
    body: 'Go to example.com and tell me the page title',
    inputChannel: 'email'
  })
});

const data = await res.json();
console.log('Task submitted:', data.status);

// Wait 30 seconds
console.log('\nWaiting 30s for task to execute...');
await new Promise(r => setTimeout(r, 30000));

// Check result
const { data: tasks } = await supabase
  .from('tasks')
  .select('id, status, iteration_count, action_count, verification_status')
  .eq('user_id', TEST_USER_ID)
  .eq('email_subject', 'CONCURRENCY FIX TEST')
  .order('created_at', { ascending: false })
  .limit(1);

if (tasks && tasks.length > 0) {
  const task = tasks[0];
  console.log('\n=== RESULT ===');
  console.log(`Status: ${task.status}`);
  console.log(`Iterations: ${task.iteration_count || 0}`);
  console.log(`Actions: ${task.action_count || 0}`);
  console.log(`Verification: ${task.verification_status || 'none'}`);

  // Check health to see if browser task was tracked
  const health = await fetch(`${AGENT_URL}/health`).then(r => r.json());
  console.log(`\nBrowser tasks active during execution: ${health.activeBrowserTasks > 0 ? 'YES ✓' : 'NO ✗'}`);
  console.log(`Current active: ${health.activeTasks} tasks, ${health.activeBrowserTasks} browser`);

  if (task.status === 'completed' && task.action_count > 0) {
    console.log('\n✅ TEST PASSED: Browser task executed and completed');
  } else if (task.status === 'processing') {
    console.log('\n⚠️ TEST INCOMPLETE: Still processing after 30s');
  } else {
    console.log(`\n❌ TEST FAILED: Status=${task.status}, Actions=${task.action_count}`);
  }
} else {
  console.log('\n❌ Task not found in database');
}
