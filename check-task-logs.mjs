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

if (!task) {
  console.log('Task not found');
  process.exit(1);
}

const { data: logs } = await supabase
  .from('task_logs')
  .select('*')
  .eq('task_id', task.id)
  .order('created_at', { ascending: true});

console.log(`\nTask ID: ${task.id}`);
console.log(`Logs: ${logs?.length || 0}\n`);

if (logs && logs.length > 0) {
  for (const log of logs) {
    console.log(`[${log.level}] ${log.message}`);
  }
} else {
  console.log('❌ NO LOGS - Task logging broken!');
}
