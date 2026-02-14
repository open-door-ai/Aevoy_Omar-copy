import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Count tasks in processing state
const { count: processingCount } = await supabase
  .from('tasks')
  .select('*', { count: 'exact', head: true })
  .eq('user_id', '11684ec6-80cd-4bb6-9aed-8f0947afd06a')
  .eq('status', 'processing')
  .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

// Count completed
const { count: completedCount } = await supabase
  .from('tasks')
  .select('*', { count: 'exact', head: true })
  .eq('user_id', '11684ec6-80cd-4bb6-9aed-8f0947afd06a')
  .eq('status', 'completed')
  .gte('created_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());

// Count needs_review
const { count: reviewCount } = await supabase
  .from('tasks')
  .select('*', { count: 'exact', head: true })
  .eq('user_id', '11684ec6-80cd-4bb6-9aed-8f0947afd06a')
  .eq('status', 'needs_review')
  .gte('created_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());

console.log('\n=== TASK STATUS (Last 2 hours) ===');
console.log(`⏳ Processing (stuck): ${processingCount}`);
console.log(`✅ Completed: ${completedCount}`);
console.log(`⚠️  Needs Review: ${reviewCount}`);
console.log(`\nSuccess Rate: ${completedCount}/${completedCount + reviewCount + processingCount} = ${((completedCount / (completedCount + reviewCount + processingCount)) * 100).toFixed(1)}%`);
