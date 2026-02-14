import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const { data } = await supabase
  .from('tasks')
  .select('id, status, iteration_count, action_count, verification_status, cost_usd')
  .eq('user_id', '11684ec6-80cd-4bb6-9aed-8f0947afd06a')
  .eq('email_subject', 'CONCURRENCY FIX TEST')
  .order('created_at', { ascending: false })
  .limit(1)
  .single();

console.log('\n=== FINAL RESULT ===');
console.log(`Status: ${data.status}`);
console.log(`Iterations: ${data.iteration_count || 0}`);
console.log(`Actions: ${data.action_count || 0}`);
console.log(`Verification: ${data.verification_status || 'none'}`);
console.log(`Cost: $${(data.cost_usd || 0).toFixed(4)}`);
console.log(`\nResult: ${data.status === 'completed' ? '✅ PASSED' : data.status === 'needs_review' ? '⚠️ NEEDS REVIEW' : '❌ FAILED'}`);
