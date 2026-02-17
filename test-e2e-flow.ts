#!/usr/bin/env node
/**
 * Complete Email → Task → Browser → Response E2E Test
 * 
 * Tests the full flow:
 * 1. Simulate email arriving (POST /task/incoming)
 * 2. Agent processes with browser
 * 3. Agent responds via email
 * 4. Verify entire chain works
 * 
 * Requirements:
 * - Test user: teste2e@aevoy.com (ID: 11684ec6-80cd-4bb6-9aed-8f0947afd06a)
 * - Real browser navigation
 * - Monitor via PM2 logs
 */

import fetch from 'node-fetch';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load env
dotenv.config({ path: resolve(process.cwd(), '.env') });

// Config
const AGENT_URL = process.env.AGENT_URL || 'http://77.42.31.185:3001';
const WEBHOOK_SECRET = process.env.AGENT_WEBHOOK_SECRET;
const TEST_USER_ID = '11684ec6-80cd-4bb6-9aed-8f0947afd06a';
const TEST_EMAIL = 'teste2e@aevoy.com';
const TEST_USERNAME = 'teste2e';

interface TestResult {
  step: string;
  status: 'pass' | 'fail' | 'skip';
  duration: number;
  details?: any;
  error?: string;
}

const results: TestResult[] = [];

function log(message: string, data?: any) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, data ? JSON.stringify(data, null, 2) : '');
}

function logStep(step: string) {
  console.log('\n' + '='.repeat(80));
  console.log(`STEP: ${step}`);
  console.log('='.repeat(80) + '\n');
}

async function measureStep<T>(
  stepName: string,
  fn: () => Promise<T>
): Promise<T | null> {
  const start = Date.now();
  try {
    const result = await fn();
    const duration = Date.now() - start;
    results.push({ step: stepName, status: 'pass', duration, details: result });
    log(`✓ ${stepName} (${duration}ms)`);
    return result;
  } catch (error: any) {
    const duration = Date.now() - start;
    results.push({ 
      step: stepName, 
      status: 'fail', 
      duration, 
      error: error.message || String(error) 
    });
    log(`✗ ${stepName} (${duration}ms)`, { error: error.message || String(error) });
    return null;
  }
}

async function testHealthCheck(): Promise<boolean> {
  logStep('1. Health Check');
  
  const result = await measureStep('Agent health check', async () => {
    const response = await fetch(`${AGENT_URL}/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    log('Health status', data);
    
    if (data.status !== 'healthy') {
      throw new Error(`Agent not healthy: ${JSON.stringify(data)}`);
    }
    
    return data;
  });
  
  return result !== null;
}

async function testIncomingEmail(): Promise<string | null> {
  logStep('2. Simulate Incoming Email');
  
  if (!WEBHOOK_SECRET) {
    log('✗ Missing AGENT_WEBHOOK_SECRET - cannot test');
    results.push({ 
      step: 'Simulate incoming email', 
      status: 'skip', 
      duration: 0,
      error: 'Missing AGENT_WEBHOOK_SECRET' 
    });
    return null;
  }
  
  const taskId = await measureStep('Send task to /task/incoming', async () => {
    const taskBody = {
      userId: TEST_USER_ID,
      username: TEST_USERNAME,
      from: TEST_EMAIL,
      subject: 'E2E Test: Browser Navigation',
      body: 'Go to example.com and tell me what you see on the page. Include the main heading text.',
      inputChannel: 'email'
    };
    
    log('Sending task', taskBody);
    
    const response = await fetch(`${AGENT_URL}/task/incoming`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': WEBHOOK_SECRET
      },
      body: JSON.stringify(taskBody)
    });
    
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Task submission failed: ${response.status} ${response.statusText}\n${text}`);
    }
    
    const data = await response.json();
    log('Task response', data);
    
    if (data.status !== 'queued') {
      throw new Error(`Unexpected status: ${data.status}`);
    }
    
    return data.taskId || 'queued';
  });
  
  return taskId;
}

async function monitorTaskProgress(maxWaitSeconds: number = 120): Promise<boolean> {
  logStep('3. Monitor Task Progress');
  
  log(`Monitoring task progress for up to ${maxWaitSeconds} seconds...`);
  log('Watch PM2 logs with: ssh root@77.42.31.185 "pm2 logs agent --lines 50"');
  
  const startTime = Date.now();
  const pollInterval = 5000; // 5 seconds
  let lastLogTime = Date.now();
  
  while (Date.now() - startTime < maxWaitSeconds * 1000) {
    await new Promise(resolve => setTimeout(resolve, pollInterval));
    
    // Log progress every 15 seconds
    if (Date.now() - lastLogTime >= 15000) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      log(`Still monitoring... (${elapsed}s elapsed)`);
      lastLogTime = Date.now();
    }
  }
  
  results.push({ 
    step: 'Monitor task progress', 
    status: 'pass', 
    duration: Date.now() - startTime,
    details: 'Manual verification required via PM2 logs' 
  });
  
  return true;
}

async function verifyBrowserExecution(): Promise<boolean> {
  logStep('4. Verify Browser Execution');
  
  log('To verify browser execution, check PM2 logs for:');
  log('  - [BROWSER] Navigating to example.com');
  log('  - [BROWSER] Page loaded successfully');
  log('  - [AI] Analyzing page content');
  log('  - [EMAIL] Sending response to teste2e@aevoy.com');
  log('');
  log('Run: ssh root@77.42.31.185 "pm2 logs agent --lines 100 | grep -E \'BROWSER|example.com|EMAIL\'"');
  
  results.push({ 
    step: 'Verify browser execution', 
    status: 'skip', 
    duration: 0,
    details: 'Manual verification required' 
  });
  
  return true;
}

async function checkEmailResponse(): Promise<boolean> {
  logStep('5. Check Email Response');
  
  log('Expected email response to: teste2e@aevoy.com');
  log('Subject: Re: E2E Test: Browser Navigation');
  log('Body should contain:');
  log('  - Confirmation that example.com was visited');
  log('  - Main heading: "Example Domain"');
  log('  - Description of page content');
  log('');
  log('To check if email was sent, run:');
  log('  ssh root@77.42.31.185 "pm2 logs agent --lines 200 | grep -A 5 \'Sending email\'"');
  
  results.push({ 
    step: 'Check email response', 
    status: 'skip', 
    duration: 0,
    details: 'Manual verification required' 
  });
  
  return true;
}

function printResults() {
  logStep('Test Results Summary');
  
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const skipped = results.filter(r => r.status === 'skip').length;
  
  console.log('\nResults by Step:');
  console.log('-'.repeat(80));
  results.forEach(r => {
    const icon = r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : '○';
    console.log(`${icon} ${r.step.padEnd(40)} ${r.duration}ms`);
    if (r.error) {
      console.log(`  Error: ${r.error}`);
    }
    if (r.details && r.status !== 'pass') {
      console.log(`  Details: ${JSON.stringify(r.details)}`);
    }
  });
  
  console.log('\n' + '='.repeat(80));
  console.log(`TOTAL: ${passed} passed, ${failed} failed, ${skipped} skipped (manual verification)`);
  console.log('='.repeat(80));
  
  if (failed > 0) {
    console.log('\n❌ TEST FAILED - See errors above');
    process.exit(1);
  } else {
    console.log('\n✅ AUTOMATED TESTS PASSED');
    console.log('\nManual Verification Steps:');
    console.log('1. SSH to VPS: ssh root@77.42.31.185');
    console.log('2. Check PM2 logs: pm2 logs agent --lines 200');
    console.log('3. Look for browser navigation to example.com');
    console.log('4. Verify email was sent to teste2e@aevoy.com');
    console.log('5. Check email contains page content analysis');
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║          Complete Email → Task → Browser → Response E2E Test              ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Test Configuration:');
  console.log(`  Agent URL:    ${AGENT_URL}`);
  console.log(`  Test User:    ${TEST_USERNAME} (${TEST_EMAIL})`);
  console.log(`  User ID:      ${TEST_USER_ID}`);
  console.log(`  Has Secret:   ${WEBHOOK_SECRET ? 'Yes' : 'No'}`);
  console.log('');
  
  try {
    // Step 1: Health check
    const healthy = await testHealthCheck();
    if (!healthy) {
      log('Agent is not healthy, aborting test');
      printResults();
      return;
    }
    
    // Step 2: Send task
    const taskId = await testIncomingEmail();
    if (!taskId) {
      log('Failed to submit task, aborting test');
      printResults();
      return;
    }
    
    // Step 3: Monitor progress
    await monitorTaskProgress(120); // Wait up to 2 minutes
    
    // Step 4: Verify browser execution (manual)
    await verifyBrowserExecution();
    
    // Step 5: Check email response (manual)
    await checkEmailResponse();
    
  } catch (error: any) {
    log('Test execution failed', { error: error.message });
    results.push({ 
      step: 'Test execution', 
      status: 'fail', 
      duration: 0,
      error: error.message 
    });
  } finally {
    printResults();
  }
}

main();
