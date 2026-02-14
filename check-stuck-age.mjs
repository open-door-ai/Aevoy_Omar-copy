import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const { data: stuck } = await supabase
  .from('tasks')
  .select('id, email_subject, created_at, started_at')
  .eq('user_id', '11684ec6-80cd-4bb6-9aed-8f0947afd06a')
  .eq('status', 'processing')
  .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
  .order('created_at', { ascending: true});

console.log(`\n=== ${stuck.length} STUCK TASKS ===\n`);

const now = Date.now();
for (const task of stuck) {
  const age = Math.round((now - new Date(task.created_at)) / 1000 / 60);
  console.log(`${task.email_subject}`);
  console.log(`  Created: ${age} min ago`);
  console.log(`  ID: ${task.id.slice(0, 8)}`);
}
