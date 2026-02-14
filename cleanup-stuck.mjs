import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Mark all stuck tasks as failed
const { data: updated } = await supabase
  .from('tasks')
  .update({
    status: 'failed',
    completed_at: new Date().toISOString(),
    error_message: 'Task exceeded maximum execution time (cleanup)'
  })
  .eq('user_id', '11684ec6-80cd-4bb6-9aed-8f0947afd06a')
  .eq('status', 'processing')
  .lt('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
  .select('id');

console.log(`Cleaned up ${updated?.length || 0} stuck tasks`);
