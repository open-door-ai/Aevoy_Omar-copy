import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const { data } = await supabase
  .from('tasks')
  .select('id, status, iteration_count, action_count, verification_status, cost_usd, completed_at')
  .eq('user_id', '11684ec6-80cd-4bb6-9aed-8f0947afd06a')
  .eq('email_subject', 'CONCURRENCY FIX TEST')
  .order('created_at', { ascending: false})
  .limit(1)
  .single();

console.log('\n=== TASK AFTER 3 MINUTES ===');
console.log(`Status: ${data.status}`);
console.log(`Iterations: ${data.iteration_count || 0}`);
console.log(`Actions: ${data.action_count || 0}`);
console.log(`Verification: ${data.verification_status || 'none'}`);
console.log(`Completed: ${data.completed_at || 'still running'}`);
console.log(`Cost: $${(data.cost_usd || 0).toFixed(4)}`);

// Count actual logs
const { count } = await supabase
  .from('task_logs')
  .select('*', { count: 'exact', head: true })
  .eq('task_id', data.id);

console.log(`\nActual action logs in DB: ${count}`);
console.log(`Reported action_count: ${data.action_count || 0}`);
console.log(`Discrepancy: ${count - (data.action_count || 0)} actions`);
