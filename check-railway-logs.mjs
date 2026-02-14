// Can't access Railway logs directly via API, but can check task_logs table
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Get one stuck task
const { data: task } = await supabase
  .from('tasks')
  .select('id, email_subject, created_at')
  .eq('user_id', '11684ec6-80cd-4bb6-9aed-8f0947afd06a')
  .eq('status', 'processing')
  .lte('created_at', new Date(Date.now() - 3 * 60 * 1000).toISOString())
  .order('created_at', { ascending: true })
  .limit(1)
  .single();

if (!task) {
  console.log('No stuck tasks found');
  process.exit(0);
}

console.log(`\nTask: ${task.email_subject}`);
console.log(`ID: ${task.id}`);
console.log(`Created: ${task.created_at}`);
console.log(`Age: ${Math.round((Date.now() - new Date(task.created_at)) / 1000)}s\n`);

// Check if task_logs table exists and has logs
const { data: logs, error } = await supabase
  .from('task_logs')
  .select('*')
  .eq('task_id', task.id)
  .order('created_at', { ascending: false })
  .limit(20);

if (error) {
  console.log('Error fetching logs:', error);
} else if (!logs || logs.length === 0) {
  console.log('✗ NO LOGS FOUND - Task logging is broken!');
} else {
  console.log(`✓ Found ${logs.length} logs`);
  for (const log of logs.slice(0, 10)) {
    console.log(`  [${log.level}] ${log.message}`);
  }
}
