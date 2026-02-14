import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Get processing tasks older than 2 minutes
const { data, error } = await supabase
  .from('tasks')
  .select('id, email_subject, status, iteration_count, action_count, created_at')
  .eq('user_id', '11684ec6-80cd-4bb6-9aed-8f0947afd06a')
  .eq('status', 'processing')
  .lte('created_at', new Date(Date.now() - 2 * 60 * 1000).toISOString())
  .order('created_at', { ascending: false })
  .limit(5);

if (error) {
  console.error('Error:', error);
  process.exit(1);
}

console.log(`\nFound ${data.length} stuck tasks (>2 min old)\n`);

for (const task of data) {
  console.log(`${task.email_subject}`);
  console.log(`  ID: ${task.id}`);
  console.log(`  Iterations: ${task.iteration_count}`);
  console.log(`  Actions: ${task.action_count}`);
  console.log(`  Age: ${Math.round((Date.now() - new Date(task.created_at)) / 1000)}s`);
  
  // Get last 10 logs
  const { data: logs } = await supabase
    .from('task_logs')
    .select('level, message, created_at')
    .eq('task_id', task.id)
    .order('created_at', { ascending: false })
    .limit(10);
  
  if (logs && logs.length > 0) {
    console.log('  Last 10 logs:');
    for (const log of logs) {
      const age = Math.round((Date.now() - new Date(log.created_at)) / 1000);
      const msg = log.message.length > 80 ? log.message.substring(0, 80) + '...' : log.message;
      console.log(`    ${age}s ago [${log.level}] ${msg}`);
    }
  }
  console.log('');
}
