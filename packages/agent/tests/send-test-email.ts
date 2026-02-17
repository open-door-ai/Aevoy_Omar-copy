#!/usr/bin/env node
/**
 * Manual Test: Send Real Email Through Complete Chain
 *
 * This script sends a test email directly to the agent's /task/incoming endpoint
 * to simulate the Cloudflare Worker forwarding behavior.
 *
 * Usage:
 *   npx tsx tests/send-test-email.ts
 *   npx tsx tests/send-test-email.ts "Custom task description"
 *   npx tsx tests/send-test-email.ts --browser "Go to example.com"
 *
 * Environment:
 *   AGENT_URL - Agent endpoint (default: http://localhost:3001)
 *   AGENT_WEBHOOK_SECRET - Required
 */

import crypto from 'crypto';

const AGENT_URL = process.env.AGENT_URL || 'http://localhost:3001';
const AGENT_WEBHOOK_SECRET = process.env.AGENT_WEBHOOK_SECRET;

const TEST_USER_ID = '11684ec6-80cd-4bb6-9aed-8f0947afd06a';
const TEST_USERNAME = 'teste2e';
const TEST_EMAIL = 'teste2e@aevoy.com';

interface TestOptions {
  body: string;
  subject?: string;
  requireBrowser?: boolean;
  attachments?: Array<{ filename: string; mimeType: string; size: number }>;
}

async function sendTestEmail(options: TestOptions) {
  if (!AGENT_WEBHOOK_SECRET) {
    console.error('❌ AGENT_WEBHOOK_SECRET not set');
    process.exit(1);
  }

  const subject = options.subject || (options.requireBrowser ? 'Browser Test Task' : 'AI Test Task');

  console.log('=====================================');
  console.log('Sending Test Email to Agent');
  console.log('=====================================');
  console.log(`Agent URL: ${AGENT_URL}`);
  console.log(`User: ${TEST_USERNAME} (${TEST_EMAIL})`);
  console.log(`Subject: ${subject}`);
  console.log(`Body: ${options.body.substring(0, 100)}${options.body.length > 100 ? '...' : ''}`);
  console.log(`Browser: ${options.requireBrowser ? 'YES' : 'NO (AI-only)'}`);
  if (options.attachments) {
    console.log(`Attachments: ${options.attachments.length}`);
  }
  console.log('');

  // Check health first
  console.log('Checking agent health...');
  try {
    const healthResponse = await fetch(`${AGENT_URL}/health`);
    const health = await healthResponse.json();

    console.log(`✓ Agent status: ${health.status}`);
    console.log(`  Active tasks: ${health.activeTasks}`);
    console.log(`  Active browser tasks: ${health.activeBrowserTasks}`);
    console.log(`  Queued tasks: ${health.queuedTasks}`);
    console.log('');
  } catch (error) {
    console.error('⚠️  Health check failed:', error);
    console.log('Continuing anyway...');
    console.log('');
  }

  // Send task
  console.log('Sending task to /task/incoming...');
  const startTime = Date.now();

  try {
    const response = await fetch(`${AGENT_URL}/task/incoming`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': AGENT_WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        userId: TEST_USER_ID,
        username: TEST_USERNAME,
        from: TEST_EMAIL,
        subject,
        body: options.body,
        bodyHtml: `<p>${options.body}</p>`,
        attachments: options.attachments,
        inputChannel: 'email',
      }),
    });

    const responseTime = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Request failed (${response.status})`);
      console.error(`Response: ${errorText}`);
      process.exit(1);
    }

    const result = await response.json();

    console.log(`✅ Request successful (${responseTime}ms)`);
    console.log(`Status: ${result.status}`);
    console.log(`Message: ${result.message || 'Task queued for processing'}`);
    console.log('');

    // Instructions
    console.log('=====================================');
    console.log('Task Submitted Successfully');
    console.log('=====================================');
    console.log('');
    console.log('The agent is now processing your task asynchronously.');
    console.log('');
    console.log('To monitor progress:');
    console.log('');
    console.log('1. Check Supabase tasks table:');
    console.log(`   SELECT * FROM tasks WHERE user_id='${TEST_USER_ID}' ORDER BY created_at DESC LIMIT 5;`);
    console.log('');
    console.log('2. Watch agent logs (if running locally):');
    console.log('   docker logs -f agent');
    console.log('');
    console.log('3. Check for completion (wait 10-60s):');
    console.log(`   curl ${AGENT_URL}/health`);
    console.log('');
    console.log('4. View response in database:');
    console.log('   Check the "response" column in the tasks table');
    console.log('');
    console.log('Expected timeline:');
    console.log(`  - AI-only task: ~10s`);
    console.log(`  - Browser task: ~60s`);
    console.log(`  - Complex task: up to 20 minutes`);
    console.log('');

    // If on VPS, show SSH command
    if (AGENT_URL.includes('77.42.31.185')) {
      console.log('To check VPS browser:');
      console.log('  ssh -i ~/.ssh/vps_key root@77.42.31.185');
      console.log('  docker ps | grep chrome');
      console.log('');
    }

  } catch (error) {
    console.error('❌ Request error:', error);
    process.exit(1);
  }
}

// Parse command-line args
const args = process.argv.slice(2);
const isBrowser = args.includes('--browser');
const customBody = args.filter(arg => !arg.startsWith('--')).join(' ');

// Default test tasks
const defaultTasks = {
  ai: 'What is 2+2? Please give me a brief answer.',
  browser: 'Go to example.com and tell me what you see on the page.',
};

const body = customBody || (isBrowser ? defaultTasks.browser : defaultTasks.ai);

// Run test
sendTestEmail({
  body,
  requireBrowser: isBrowser,
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
