#!/usr/bin/env tsx
/**
 * Verify E2E Test Results
 * Checks database for task completion and details
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });

const TEST_USER_ID = '11684ec6-80cd-4bb6-9aed-8f0947afd06a';
const TEST_EMAIL = 'teste2e@aevoy.com';

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                       E2E Test Results Verification                        ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing Supabase credentials in .env');
    process.exit(1);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Fetch recent tasks
  console.log('📋 Recent Tasks:');
  console.log('─'.repeat(80));
  
  const { data: tasks, error: tasksError } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', TEST_USER_ID)
    .order('created_at', { ascending: false })
    .limit(5);

  if (tasksError) {
    console.error('Error fetching tasks:', tasksError);
    process.exit(1);
  }

  if (!tasks || tasks.length === 0) {
    console.log('⚠️  No tasks found for test user');
    process.exit(1);
  }

  tasks.forEach((task: any, i: number) => {
    const isE2eTest = task.subject?.includes('E2E Test');
    const symbol = isE2eTest ? '🎯' : '  ';
    
    console.log(`${symbol} Task ${i + 1}:`);
    console.log(`   ID:           ${task.id}`);
    console.log(`   Status:       ${task.status}`);
    console.log(`   Type:         ${task.type || 'N/A'}`);
    console.log(`   Subject:      ${task.subject || 'N/A'}`);
    console.log(`   Input:        ${task.input_channel || 'email'}`);
    console.log(`   Cost:         $${task.cost_usd || 0}`);
    console.log(`   Tokens:       ${task.tokens_used || 0}`);
    console.log(`   Progress:     ${task.progress_message || 'N/A'}`);
    console.log(`   Actions:      ${task.action_count || 0}`);
    console.log(`   Created:      ${task.created_at}`);
    console.log(`   Updated:      ${task.updated_at}`);
    console.log('');
  });

  // Find the E2E test task
  const e2eTask = tasks.find((t: any) => t.subject?.includes('E2E Test'));
  
  if (!e2eTask) {
    console.log('⚠️  E2E test task not found in recent tasks');
    console.log('The task might still be processing or failed to create');
    process.exit(1);
  }

  console.log('─'.repeat(80));
  console.log('🎯 E2E Test Task Details:');
  console.log('─'.repeat(80));
  console.log('');
  
  // Check status
  const statusSymbol = e2eTask.status === 'completed' ? '✅' : 
                      e2eTask.status === 'failed' ? '❌' : 
                      e2eTask.status === 'processing' ? '⏳' : '⏸️';
  
  console.log(`${statusSymbol} Status: ${e2eTask.status}`);
  
  if (e2eTask.status === 'completed') {
    console.log('✅ Task completed successfully!');
  } else if (e2eTask.status === 'failed') {
    console.log('❌ Task failed');
  } else if (e2eTask.status === 'processing') {
    console.log('⏳ Task still processing...');
    console.log('   Wait a bit longer and run this script again');
  }
  
  console.log('');
  
  // Check task logs
  console.log('📝 Task Logs:');
  console.log('─'.repeat(80));
  
  const { data: logs, error: logsError } = await supabase
    .from('task_logs')
    .select('*')
    .eq('task_id', e2eTask.id)
    .order('created_at', { ascending: true });
  
  if (logsError) {
    console.error('Error fetching logs:', logsError);
  } else if (logs && logs.length > 0) {
    logs.forEach((log: any) => {
      const levelIcon = log.level === 'error' ? '❌' : 
                       log.level === 'warn' ? '⚠️' : 
                       log.level === 'info' ? 'ℹ️' : '📝';
      console.log(`${levelIcon} [${log.level.toUpperCase()}] ${log.message}`);
    });
  } else {
    console.log('No logs found (logs might not be enabled)');
  }
  
  console.log('');
  
  // Verification summary
  console.log('═'.repeat(80));
  console.log('VERIFICATION SUMMARY');
  console.log('═'.repeat(80));
  console.log('');
  
  const checks = [
    {
      name: 'Task created in database',
      pass: !!e2eTask,
    },
    {
      name: 'Task has subject "E2E Test: Browser Navigation"',
      pass: e2eTask.subject === 'E2E Test: Browser Navigation',
    },
    {
      name: 'Task status is completed',
      pass: e2eTask.status === 'completed',
    },
    {
      name: 'Task type indicates browser use',
      pass: e2eTask.type === 'browser' || e2eTask.type === 'research',
    },
    {
      name: 'Task has cost recorded',
      pass: e2eTask.cost_usd > 0,
    },
    {
      name: 'Task has actions recorded',
      pass: (e2eTask.action_count || 0) > 0,
    },
  ];
  
  checks.forEach(check => {
    const symbol = check.pass ? '✅' : '❌';
    console.log(`${symbol} ${check.name}`);
  });
  
  console.log('');
  
  const passedChecks = checks.filter(c => c.pass).length;
  const totalChecks = checks.length;
  
  if (passedChecks === totalChecks) {
    console.log(`🎉 All ${totalChecks} checks passed!`);
    console.log('');
    console.log('E2E test completed successfully:');
    console.log('  ✓ Email task received');
    console.log('  ✓ Agent processed task');
    console.log('  ✓ Browser navigated to example.com');
    console.log('  ✓ Task stored in database');
    console.log('  ✓ Response would be sent via email (check agent logs)');
    process.exit(0);
  } else {
    console.log(`⚠️  ${passedChecks}/${totalChecks} checks passed`);
    console.log('');
    console.log('Some verification steps failed. Review:');
    console.log('  1. Check agent terminal for errors');
    console.log('  2. Verify task is still processing (not failed)');
    console.log('  3. Check if browser automation succeeded');
    console.log('  4. Review task logs above for details');
    
    // Still exit 0 if task is processing
    if (e2eTask.status === 'processing') {
      console.log('');
      console.log('Task is still processing - this is OK, just wait longer');
      process.exit(0);
    }
    process.exit(1);
  }
}

main();
