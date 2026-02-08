/**
 * Database Verification Script
 * Run after migrations to verify everything is set up correctly
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://eawoquqgfndmphogwjeu.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

const requiredTables = [
  'profiles',
  'user_settings',
  'user_sessions',
  'browser_contexts',
  'vps_instances',
  'user_vps_assignments',
  'execution_plans',
  'task_queue',
  'captcha_solves',
  'quality_checks',
  'tasks',
  'credential_vault',
];

const requiredColumns = {
  'user_settings': ['confirm_spending', 'confirm_canceling', 'confirm_deleting', 'confirm_sharing', 'max_autonomous_spend', 'response_timeout_minutes', 'quality_threshold'],
  'user_sessions': ['expires_at'],
  'execution_plans': ['high_stakes', 'rejected_at', 'rejection_reason', 'approved_at'],
};

async function verifyDatabase() {
  console.log('🔍 Verifying database setup...\n');
  
  const results = {
    tables: {},
    columns: {},
    errors: []
  };

  // Check tables
  for (const table of requiredTables) {
    try {
      const { data, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });
      
      if (error) {
        if (error.code === 'PGRST205') {
          results.tables[table] = { exists: false, error: error.message };
          results.errors.push(`❌ Table '${table}' does not exist`);
        } else {
          results.tables[table] = { exists: true, error: error.message };
        }
      } else {
        results.tables[table] = { exists: true, count: data?.length ?? 0 };
        console.log(`✅ Table '${table}' exists`);
      }
    } catch (err) {
      results.tables[table] = { exists: false, error: err.message };
      results.errors.push(`❌ Table '${table}': ${err.message}`);
    }
  }

  // Check specific columns
  console.log('\n🔍 Checking required columns...\n');
  
  for (const [table, columns] of Object.entries(requiredColumns)) {
    results.columns[table] = {};
    
    for (const column of columns) {
      try {
        // Try to select specific column
        const { error } = await supabase
          .from(table)
          .select(column)
          .limit(1);
        
        if (error && error.message.includes(column)) {
          results.columns[table][column] = { exists: false };
          results.errors.push(`❌ Column '${table}.${column}' does not exist`);
        } else {
          results.columns[table][column] = { exists: true };
          console.log(`✅ Column '${table}.${column}' exists`);
        }
      } catch (err) {
        results.columns[table][column] = { exists: false, error: err.message };
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 VERIFICATION SUMMARY');
  console.log('='.repeat(50));
  
  const tableCount = Object.values(results.tables).filter(t => t.exists).length;
  console.log(`Tables: ${tableCount}/${requiredTables.length} ready`);
  
  let columnCount = 0;
  let totalColumns = 0;
  for (const cols of Object.values(results.columns)) {
    for (const col of Object.values(cols)) {
      totalColumns++;
      if (col.exists) columnCount++;
    }
  }
  console.log(`Columns: ${columnCount}/${totalColumns} ready`);
  
  if (results.errors.length > 0) {
    console.log('\n❌ ERRORS:');
    results.errors.forEach(e => console.log(`  ${e}`));
    console.log('\n⚠️  Run the migration file in Supabase SQL Editor:');
    console.log('  apps/web/supabase/RUN_ALL_MIGRATIONS.sql');
    process.exit(1);
  } else {
    console.log('\n✅ All database checks passed!');
    process.exit(0);
  }
}

verifyDatabase().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
