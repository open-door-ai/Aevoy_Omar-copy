import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const { data: task } = await supabase
  .from('tasks')
  .select('id')
  .eq('user_id', '11684ec6-80cd-4bb6-9aed-8f0947afd06a')
  .eq('email_subject', 'CONCURRENCY FIX TEST')
  .order('created_at', { ascending: false})
  .limit(1)
  .single();

const { data: logs } = await supabase
  .from('task_logs')
  .select('*')
  .eq('task_id', task.id)
  .order('created_at', { ascending: true});

console.log(`\n=== TASK LOGS (${logs.length} total) ===\n`);

for (const log of logs) {
  console.log(`[${log.status}] ${log.step}`);
  if (log.details) {
    const d = log.details;
    console.log(`  Success: ${d.success}, Duration: ${d.durationMs}ms, Method: ${d.methodUsed}`);
  }
}

// Check current task status
const { data: currentTask } = await supabase
  .from('tasks')
  .select('status, iteration_count, action_count')
  .eq('id', task.id)
  .single();

console.log(`\n=== CURRENT STATUS ===`);
console.log(`Status: ${currentTask.status}`);
console.log(`Iterations: ${currentTask.iteration_count}`);
console.log(`Actions: ${currentTask.action_count}`);
