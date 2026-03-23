#!/usr/bin/env node
/**
 * Run Integration Tests
 *
 * Run this script to verify all integrations work:
 * $ pnpm run test:integration
 *
 * Tests all 4 channels, verifies bug fixes, and runs load test.
 */

import { fakeEmailServer, enableTestMode } from './fake-email-server.js';
import { IntegrationRunner, runLoadTest } from './integration-runner.js';
import { processTaskV3 as processTask } from '../v3/processor-v3.js';

const TEST_USER = {
  id: 'test-user-integration',
  username: 'testuser',
  email: 'test@aevoy.com',
  phone: '+16047245161',
};

// Test helpers
async function sendTaskViaEmail(subject: string, body: string) {
  return processTask({
    userId: TEST_USER.id,
    username: TEST_USER.username,
    from: TEST_USER.email,
    subject,
    body,
    inputChannel: 'email',
  });
}

async function sendTaskViaSMS(body: string) {
  return processTask({
    userId: TEST_USER.id,
    username: TEST_USER.username,
    from: TEST_USER.phone,
    subject: 'SMS Task',
    body,
    inputChannel: 'sms',
  });
}

async function sendTaskViaVoice(body: string) {
  return processTask({
    userId: TEST_USER.id,
    username: TEST_USER.username,
    from: TEST_USER.phone,
    subject: 'Voice Task',
    body,
    inputChannel: 'voice',
  });
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// Test Suite 1: Email Channel
async function test_email_simple_task() {
  fakeEmailServer.reset();
  await sendTaskViaEmail('Simple question', 'What is 2+2?');

  const response = await fakeEmailServer.waitForEmail(TEST_USER.email, 10000);
  assert(response !== null, 'Email response not received');
  assert(response.body.includes('4'), 'Response does not contain answer');
  assert(response.to === TEST_USER.email, 'Email sent to wrong address');
}

async function test_email_make_money_task() {
  fakeEmailServer.reset();
  await sendTaskViaEmail('Make money', 'Make me money');

  const response = await fakeEmailServer.waitForEmail(TEST_USER.email, 15000);
  assert(response !== null, 'Email response not received for make money task');
  assert(response.body.length > 0, 'Empty response for make money task');
}

async function test_email_long_response() {
  fakeEmailServer.reset();
  await sendTaskViaEmail('Research', 'Research best laptops under $1500');

  const response = await fakeEmailServer.waitForEmail(TEST_USER.email, 15000);
  assert(response !== null, 'Email response not received');
  assert(response.body.length > 100, 'Response too short for research task');
}

// Test Suite 2: SMS Channel
async function test_sms_sends_sms_not_email() {
  fakeEmailServer.reset();
  await sendTaskViaSMS('What is the capital of France?');

  // Should receive SMS response
  const smsResponse = await fakeEmailServer.waitForSMS(TEST_USER.phone, 10000);
  assert(smsResponse !== null, 'SMS response not received');
  assert(smsResponse.body.toLowerCase().includes('paris'), 'SMS response incorrect');

  // Should NOT receive email (this was the bug!)
  const emailInbox = fakeEmailServer.getInbox(TEST_USER.email);
  assert(emailInbox.length === 0, 'Bug: SMS task sent email response!');
}

async function test_sms_long_response_sends_both() {
  fakeEmailServer.reset();
  await sendTaskViaSMS('Research all Nobel Prize winners in 2023 with details');

  // Should receive SMS summary
  const smsResponse = await fakeEmailServer.waitForSMS(TEST_USER.phone, 10000);
  assert(smsResponse !== null, 'SMS summary not received');
  assert(smsResponse.body.includes('emailed'), 'SMS should mention email for long response');

  // Should ALSO receive email with full results
  const emailResponse = await fakeEmailServer.waitForEmail(TEST_USER.email, 10000);
  assert(emailResponse !== null, 'Email with full results not received');
  assert(emailResponse.body.length > smsResponse.body.length, 'Email should be longer than SMS');
}

// Test Suite 3: Voice Channel
async function test_voice_sends_correct_channels() {
  fakeEmailServer.reset();
  await sendTaskViaVoice('Book me a flight to LA');

  // Should receive SMS summary
  const smsResponse = await fakeEmailServer.waitForSMS(TEST_USER.phone, 10000);
  assert(smsResponse !== null, 'Voice task did not send SMS summary');

  // Should receive email to CORRECT ADDRESS (not phone number!)
  const emailResponse = await fakeEmailServer.waitForEmail(TEST_USER.email, 10000);
  assert(emailResponse !== null, 'Voice task did not send email');
  assert(emailResponse.to === TEST_USER.email, 'Bug: Voice task sent email to wrong address!');
  assert(emailResponse.to !== TEST_USER.phone, 'Bug: Voice task sent email to phone number!');
}

async function test_voice_email_longer_than_sms() {
  fakeEmailServer.reset();
  await sendTaskViaVoice('Research best hotels in Vancouver');

  const smsResponse = await fakeEmailServer.waitForSMS(TEST_USER.phone, 10000);
  const emailResponse = await fakeEmailServer.waitForEmail(TEST_USER.email, 10000);

  assert(smsResponse !== null, 'SMS not received');
  assert(emailResponse !== null, 'Email not received');
  assert(emailResponse.body.length > smsResponse.body.length, 'Email should contain full results');
}

// Test Suite 4: Cross-Channel
async function test_email_triggers_sms_confirmation() {
  // This test would require implementing confirmation flow
  // For now, just verify email works
  fakeEmailServer.reset();
  await sendTaskViaEmail('Risky task', 'Delete all my emails');

  // Should receive SOME response
  const emailResponse = fakeEmailServer.getLatestEmail(TEST_USER.email);
  assert(emailResponse !== null, 'No response received for risky task');
}

// Load Test
async function runLoadTests() {
  console.log('\n========== Load Testing ==========\n');

  // Test 1: 50 concurrent email tasks
  console.log('Test 1: 50 email tasks, 10 concurrent');
  const result1 = await runLoadTest(10, 50, async (taskId) => {
    await sendTaskViaEmail(`Task ${taskId}`, `Simple question ${taskId}`);
  });

  assert(result1.successCount > 45, `Too many failures: ${result1.failureCount}/50`);
  assert(result1.avgLatency < 10000, `Avg latency too high: ${result1.avgLatency}ms`);

  // Test 2: 100 mixed channel tasks
  console.log('\nTest 2: 100 mixed tasks, 20 concurrent');
  const result2 = await runLoadTest(20, 100, async (taskId) => {
    const channel = taskId % 3;
    if (channel === 0) {
      await sendTaskViaEmail(`Load test ${taskId}`, 'Quick task');
    } else if (channel === 1) {
      await sendTaskViaSMS(`SMS load test ${taskId}`);
    } else {
      await sendTaskViaVoice(`Voice load test ${taskId}`);
    }
  });

  assert(result2.successCount > 90, `Too many failures: ${result2.failureCount}/100`);

  console.log('\n✅ Load tests passed!\n');
}

// Main test runner
async function main() {
  console.log('\n========================================');
  console.log('  Aurora Integration Tests');
  console.log('========================================\n');

  enableTestMode();

  const runner = new IntegrationRunner();

  // Run all test suites
  await runner.runSuite({
    name: 'Email Channel Tests',
    tests: [
      test_email_simple_task,
      test_email_make_money_task,
      test_email_long_response,
    ],
  });

  await runner.runSuite({
    name: 'SMS Channel Tests',
    tests: [
      test_sms_sends_sms_not_email,
      test_sms_long_response_sends_both,
    ],
  });

  await runner.runSuite({
    name: 'Voice Channel Tests',
    tests: [
      test_voice_sends_correct_channels,
      test_voice_email_longer_than_sms,
    ],
  });

  await runner.runSuite({
    name: 'Cross-Channel Tests',
    tests: [
      test_email_triggers_sms_confirmation,
    ],
  });

  // Run load tests
  await runLoadTests();

  // Final summary
  const results = runner.getResults();
  const totalPassed = results.filter(r => r.passed).length;
  const totalFailed = results.filter(r => !r.passed).length;
  const successRate = (totalPassed / results.length) * 100;

  console.log('\n========== Final Summary ==========');
  console.log(`Total Tests: ${results.length}`);
  console.log(`Passed: ${totalPassed} (${successRate.toFixed(1)}%)`);
  console.log(`Failed: ${totalFailed}`);

  if (totalFailed === 0) {
    console.log('\n🎉 All integration tests passed!');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed. See above for details.');
    process.exit(1);
  }
}

// Run tests
main().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
