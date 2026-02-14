import { createClient } from '@supabase/supabase-js';

const AGENT_URL = 'https://agent-production-1339.up.railway.app';
const TEST_USER_ID = '11684ec6-80cd-4bb6-9aed-8f0947afd06a';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

console.log('\n=== SINGLE DEBUG TEST ===');
console.log('Submitting simple browser task...\n');

// Submit simple task
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
    subject: 'DEBUG TEST - Simple browser',
    body: 'Go to example.com',
    inputChannel: 'email'
  })
});

const data = await res.json();
console.log('Task submitted:', data.status);

// Poll status every 5 seconds for 2 minutes
console.log('\nPolling task status every 5s...\n');
let taskId = null;

for (let i = 0; i < 24; i++) { // 24 * 5s = 2 minutes
  await new Promise(r => setTimeout(r, 5000));
  
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, status, iteration_count, action_count, cost_usd')
    .eq('user_id', TEST_USER_ID)
    .eq('email_subject', 'DEBUG TEST - Simple browser')
    .order('created_at', { ascending: false})
    .limit(1);

  if (tasks && tasks.length > 0) {
    const task = tasks[0];
    if (!taskId) taskId = task.id;
    
    console.log(`[${i * 5}s] Status: ${task.status}, Iter: ${task.iteration_count || 0}, Actions: ${task.action_count || 0}, Cost: $${(task.cost_usd || 0).toFixed(4)}`);
    
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'needs_review') {
      console.log(`\n✅ Task finished with status: ${task.status}`);
      break;
    }
  }
}

console.log('\nTest complete. Check Railway logs for [DEBUG-ITER] messages to see where it hung.');
