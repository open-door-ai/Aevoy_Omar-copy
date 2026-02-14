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
  .limit(1);

if (logs && logs.length > 0) {
  console.log('\nTask log columns:');
  console.log(JSON.stringify(logs[0], null, 2));
}
