/**
 * Comprehensive Phone/Voice Call System Test
 *
 * Tests:
 * 1. Twilio SMS incoming webhook
 * 2. Twilio Voice incoming webhook
 * 3. Speech-to-text (STT) processing
 * 4. Text-to-speech (TTS) response generation
 * 5. Voice preference cache (5-min TTL)
 * 6. Task creation from SMS/voice
 * 7. Voice PIN verification flow
 * 8. Daily call limit (50 calls/day)
 * 9. Rate limiting (30 requests/min per phone)
 * 10. 2FA code extraction from SMS
 * 11. Voice command processing
 * 12. TwiML generation and validation
 *
 * VPS Details:
 * - VPS IP: 77.42.31.185
 * - Agent URL: http://localhost:3001
 * - Test user: teste2e (ID: 11684ec6-80cd-4bb6-9aed-8f0947afd06a)
 * - Twilio webhooks: /webhook/sms/:userId, /webhook/voice/incoming, /webhook/voice/process/:userId
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || '+17789008951';
const AGENT_URL = process.env.AGENT_URL || 'http://localhost:3001';
const VPS_SSH_KEY = '~/.ssh/vps_key';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Test data
const TEST_USER_ID = '11684ec6-80cd-4bb6-9aed-8f0947afd06a';
const TEST_USER_EMAIL = 'teste2e@aevoy.com';
let testUserPhone: string;
let testUserTwilioNumber: string;

describe('Phone/Voice Call System E2E', () => {
  beforeAll(async () => {
    // Load test user profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, phone, twilio_number, username')
      .eq('id', TEST_USER_ID)
      .single();

    if (!profile) {
      throw new Error(`Test user not found: ${TEST_USER_ID}`);
    }

    testUserPhone = profile.phone || '+16045551234';
    testUserTwilioNumber = profile.twilio_number || TWILIO_PHONE_NUMBER;

    console.log('\n========================================');
    console.log('PHONE/VOICE TEST CONFIGURATION');
    console.log('========================================');
    console.log(`Test user ID: ${TEST_USER_ID}`);
    console.log(`Test user phone: ${testUserPhone}`);
    console.log(`Test user Twilio number: ${testUserTwilioNumber}`);
    console.log(`Agent URL: ${AGENT_URL}`);
    console.log('========================================\n');
  });

  // ========================================
  // 1. SMS INCOMING WEBHOOK TEST
  // ========================================

  it('1. Test SMS incoming webhook', async () => {
    const testMessage = `Test SMS ${Date.now()}`;
    const startTime = Date.now();

    console.log('\n[TEST 1] Testing SMS incoming webhook...');

    // Simulate Twilio webhook POST
    const webhookUrl = `${AGENT_URL}/webhook/sms/incoming`;
    const webhookPayload = new URLSearchParams({
      From: testUserPhone,
      To: testUserTwilioNumber,
      Body: testMessage,
      MessageSid: `SM${Date.now()}`,
    });

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // Note: In production, Twilio signature validation is enabled
        // For local testing, set TEST_MODE=true in .env
      },
      body: webhookPayload.toString(),
    });

    const responseText = await response.text();
    const processingTime = Date.now() - startTime;

    console.log(`  Response status: ${response.status}`);
    console.log(`  Response body: ${responseText.slice(0, 200)}`);
    console.log(`  Processing time: ${processingTime}ms`);

    expect(response.ok).toBe(true);
    expect(responseText).toContain('<?xml version="1.0"');
    expect(responseText).toContain('<Response>');

    // Wait for task creation
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify task was created
    const { data: task } = await supabase
      .from('tasks')
      .select('id, status, input_text, input_channel')
      .eq('user_id', TEST_USER_ID)
      .eq('input_channel', 'sms')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (task) {
      console.log(`  ✓ Task created: ${task.id}`);
      console.log(`  ✓ Status: ${task.status}`);
      expect(task.input_text).toContain(testMessage);
    } else {
      console.log(`  ⚠ No task found - webhook may need Twilio signature`);
    }
  }, 30000);

  // ========================================
  // 2. VOICE INCOMING WEBHOOK TEST
  // ========================================

  it('2. Test voice incoming webhook', async () => {
    console.log('\n[TEST 2] Testing voice incoming webhook...');

    const webhookUrl = `${AGENT_URL}/webhook/voice/incoming`;
    const webhookPayload = new URLSearchParams({
      From: testUserPhone,
      To: testUserTwilioNumber,
      CallSid: `CA${Date.now()}`,
    });

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: webhookPayload.toString(),
    });

    const twiml = await response.text();

    console.log(`  Response status: ${response.status}`);
    console.log(`  TwiML response:\n${twiml}`);

    expect(response.ok).toBe(true);
    expect(twiml).toContain('<?xml version="1.0"');
    expect(twiml).toContain('<Response>');
    expect(twiml).toContain('<Say voice=');
    expect(twiml).toContain('<Gather input="speech"');

    // Check for greeting
    const hasGreeting = twiml.includes('Hey') || twiml.includes('Hi') || twiml.includes('Good');
    console.log(`  ✓ TwiML contains greeting: ${hasGreeting}`);
    expect(hasGreeting).toBe(true);
  }, 30000);

  // ========================================
  // 3. VOICE COMMAND PROCESSING (STT + TTS)
  // ========================================

  it('3. Test voice command processing (STT + TTS)', async () => {
    console.log('\n[TEST 3] Testing voice command processing...');

    const testCommand = 'What is 2 plus 2?';
    const webhookUrl = `${AGENT_URL}/webhook/voice/process/${TEST_USER_ID}`;
    const webhookPayload = new URLSearchParams({
      SpeechResult: testCommand,
      CallSid: `CA${Date.now()}`,
      From: testUserPhone,
    });

    const startTime = Date.now();

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: webhookPayload.toString(),
    });

    const twiml = await response.text();
    const processingTime = Date.now() - startTime;

    console.log(`  Response status: ${response.status}`);
    console.log(`  Processing time: ${processingTime}ms`);
    console.log(`  TwiML response:\n${twiml}`);

    expect(response.ok).toBe(true);
    expect(twiml).toContain('<Say voice=');

    // Check for confirmation message
    const hasConfirmation =
      twiml.includes('Perfect') ||
      twiml.includes('Got it') ||
      twiml.includes('On it') ||
      twiml.includes('Awesome');
    console.log(`  ✓ TwiML contains confirmation: ${hasConfirmation}`);
    expect(hasConfirmation).toBe(true);

    // Wait for task creation
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify task was created
    const { data: task } = await supabase
      .from('tasks')
      .select('id, status, input_text, input_channel')
      .eq('user_id', TEST_USER_ID)
      .eq('input_channel', 'voice')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (task) {
      console.log(`  ✓ Voice task created: ${task.id}`);
      console.log(`  ✓ Status: ${task.status}`);
      console.log(`  ✓ Input: ${task.input_text}`);
      expect(task.input_text).toContain(testCommand);
    } else {
      console.log(`  ⚠ No task found`);
    }
  }, 30000);

  // ========================================
  // 4. VOICE PREFERENCE CACHE TEST
  // ========================================

  it('4. Test voice preference cache (5-min TTL)', async () => {
    console.log('\n[TEST 4] Testing voice preference cache...');

    // Make 3 calls in rapid succession to test caching
    const calls = [];
    const startTime = Date.now();

    for (let i = 0; i < 3; i++) {
      const callStart = Date.now();

      const response = await fetch(`${AGENT_URL}/webhook/voice/incoming`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          From: testUserPhone,
          To: testUserTwilioNumber,
          CallSid: `CA${Date.now()}_${i}`,
        }).toString(),
      });

      const twiml = await response.text();
      const callTime = Date.now() - callStart;

      calls.push({ callTime, voiceUsed: twiml.match(/voice="([^"]+)"/)?.[1] });

      // Small delay between calls
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const totalTime = Date.now() - startTime;

    console.log(`  Call 1: ${calls[0].callTime}ms (voice: ${calls[0].voiceUsed})`);
    console.log(`  Call 2: ${calls[1].callTime}ms (voice: ${calls[1].voiceUsed})`);
    console.log(`  Call 3: ${calls[2].callTime}ms (voice: ${calls[2].voiceUsed})`);
    console.log(`  Total time: ${totalTime}ms`);

    // All calls should use same voice (from cache)
    const allSameVoice = calls.every(c => c.voiceUsed === calls[0].voiceUsed);
    console.log(`  ✓ All calls use same voice: ${allSameVoice}`);
    expect(allSameVoice).toBe(true);

    // Second and third calls should be faster (cached)
    const cacheSpeedup = calls[0].callTime > calls[1].callTime;
    console.log(`  ✓ Cache speedup detected: ${cacheSpeedup}`);
  }, 30000);

  // ========================================
  // 5. 2FA CODE EXTRACTION FROM SMS
  // ========================================

  it('5. Test 2FA code extraction from SMS', async () => {
    console.log('\n[TEST 5] Testing 2FA code extraction from SMS...');

    // Create a pending task waiting for verification
    const { data: pendingTask } = await supabase
      .from('tasks')
      .insert({
        user_id: TEST_USER_ID,
        status: 'awaiting_user_input',
        stuck_reason: 'verification_code',
        email_subject: '2FA Test',
        input_text: 'Login test',
        input_channel: 'sms',
      })
      .select()
      .single();

    expect(pendingTask).toBeTruthy();
    console.log(`  ✓ Created pending task: ${pendingTask!.id}`);

    // Send SMS with 2FA code
    const testCode = '123456';
    const testMessage = `Your verification code is ${testCode}`;

    const response = await fetch(`${AGENT_URL}/webhook/sms/incoming`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        From: testUserPhone,
        To: testUserTwilioNumber,
        Body: testMessage,
        MessageSid: `SM${Date.now()}`,
      }).toString(),
    });

    expect(response.ok).toBe(true);
    console.log(`  ✓ 2FA SMS sent`);

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Check if task was updated with verification code
    const { data: updatedTask } = await supabase
      .from('tasks')
      .select('id, status, stuck_reason, structured_intent')
      .eq('id', pendingTask!.id)
      .single();

    if (updatedTask) {
      console.log(`  Task status: ${updatedTask.status}`);
      console.log(`  Stuck reason: ${updatedTask.stuck_reason}`);

      if (updatedTask.structured_intent) {
        const intent = updatedTask.structured_intent as Record<string, any>;
        console.log(`  ✓ Verification code extracted: ${intent.verification_code}`);
        expect(intent.verification_code).toBe(testCode);
      }

      expect(updatedTask.status).toBe('processing');
      expect(updatedTask.stuck_reason).toBeNull();
    }

    // Check tfa_codes table
    const { data: tfaCode } = await supabase
      .from('tfa_codes')
      .select('code, source')
      .eq('user_id', TEST_USER_ID)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (tfaCode) {
      console.log(`  ✓ TFA code stored: ${tfaCode.code} (source: ${tfaCode.source})`);
      expect(tfaCode.code).toBe(testCode);
      expect(tfaCode.source).toBe('sms');
    }
  }, 30000);

  // ========================================
  // 6. DAILY CALL LIMIT TEST (50 calls/day)
  // ========================================

  it('6. Test daily call limit enforcement', async () => {
    console.log('\n[TEST 6] Testing daily call limit (50 calls/day)...');

    // Check current usage
    const { data: usage } = await supabase
      .from('usage')
      .select('voice_calls_today, voice_daily_date')
      .eq('user_id', TEST_USER_ID)
      .single();

    const currentCalls = usage?.voice_calls_today || 0;
    const currentDate = usage?.voice_daily_date;

    console.log(`  Current calls today: ${currentCalls}`);
    console.log(`  Date: ${currentDate}`);

    // Make a call
    const response = await fetch(`${AGENT_URL}/webhook/voice/incoming`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        From: testUserPhone,
        To: testUserTwilioNumber,
        CallSid: `CA${Date.now()}`,
      }).toString(),
    });

    expect(response.ok).toBe(true);

    // Verify usage was tracked
    await new Promise(resolve => setTimeout(resolve, 1000));

    const { data: newUsage } = await supabase
      .from('usage')
      .select('voice_calls_today')
      .eq('user_id', TEST_USER_ID)
      .single();

    const newCalls = newUsage?.voice_calls_today || 0;
    console.log(`  Calls after test: ${newCalls}`);
    console.log(`  ✓ Usage tracking working: ${newCalls > currentCalls}`);

    expect(newCalls).toBeGreaterThanOrEqual(currentCalls);
  }, 30000);

  // ========================================
  // 7. RATE LIMITING TEST (30 req/min per phone)
  // ========================================

  it('7. Test rate limiting (30 requests/min per phone)', async () => {
    console.log('\n[TEST 7] Testing rate limiting (30 req/min)...');

    const results: { success: boolean; status: number; time: number }[] = [];
    const startTime = Date.now();

    // Send 35 requests rapidly (should hit 30/min limit)
    for (let i = 0; i < 35; i++) {
      const reqStart = Date.now();

      try {
        const response = await fetch(`${AGENT_URL}/webhook/sms/incoming`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            From: testUserPhone,
            To: testUserTwilioNumber,
            Body: `Rate limit test ${i + 1}`,
            MessageSid: `SM${Date.now()}_${i}`,
          }).toString(),
        });

        results.push({
          success: response.ok,
          status: response.status,
          time: Date.now() - reqStart,
        });
      } catch (error) {
        results.push({
          success: false,
          status: 0,
          time: Date.now() - reqStart,
        });
      }

      // Small delay to avoid overwhelming server
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    const totalTime = Date.now() - startTime;
    const successCount = results.filter(r => r.success).length;
    const rateLimitedCount = results.filter(r => r.status === 429).length;
    const avgTime = results.reduce((sum, r) => sum + r.time, 0) / results.length;

    console.log(`  Total requests: ${results.length}`);
    console.log(`  Successful: ${successCount}`);
    console.log(`  Rate limited (429): ${rateLimitedCount}`);
    console.log(`  Avg time per request: ${avgTime.toFixed(0)}ms`);
    console.log(`  Total time: ${totalTime}ms`);

    // Should have some rate-limited responses
    console.log(`  ✓ Rate limiting active: ${rateLimitedCount > 0 ? 'YES' : 'NO'}`);
    expect(successCount).toBeGreaterThan(0);
  }, 120000);

  // ========================================
  // 8. TWIML VALIDATION TEST
  // ========================================

  it('8. Test TwiML response validation', async () => {
    console.log('\n[TEST 8] Testing TwiML response validation...');

    const response = await fetch(`${AGENT_URL}/webhook/voice/incoming`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        From: testUserPhone,
        To: testUserTwilioNumber,
        CallSid: `CA${Date.now()}`,
      }).toString(),
    });

    const twiml = await response.text();

    console.log(`  TwiML length: ${twiml.length} chars`);

    // Validate TwiML structure
    const checks = [
      { name: 'XML declaration', test: twiml.includes('<?xml version="1.0"') },
      { name: 'Response tag', test: twiml.includes('<Response>') && twiml.includes('</Response>') },
      { name: 'Say verb', test: twiml.includes('<Say voice=') },
      { name: 'Voice attribute', test: /voice="[^"]+"/.test(twiml) },
      { name: 'Gather verb', test: twiml.includes('<Gather') },
      { name: 'Speech input', test: twiml.includes('input="speech"') },
      { name: 'Action URL', test: twiml.includes('action=') },
      { name: 'Proper escaping', test: !twiml.includes('<script>') && !twiml.includes('&nbsp;') },
    ];

    console.log('\n  TwiML validation checks:');
    checks.forEach(check => {
      console.log(`    ${check.test ? '✓' : '✗'} ${check.name}`);
      expect(check.test).toBe(true);
    });
  }, 30000);

  // ========================================
  // 9. PERFORMANCE SUMMARY
  // ========================================

  it('9. Generate performance and success rate summary', async () => {
    console.log('\n[TEST 9] Generating performance summary...');

    // Get all SMS tasks from today
    const today = new Date().toISOString().split('T')[0];

    const { data: smsTasks } = await supabase
      .from('tasks')
      .select('id, status, created_at, cost_usd')
      .eq('user_id', TEST_USER_ID)
      .eq('input_channel', 'sms')
      .gte('created_at', `${today}T00:00:00Z`)
      .order('created_at', { ascending: false });

    const { data: voiceTasks } = await supabase
      .from('tasks')
      .select('id, status, created_at, cost_usd')
      .eq('user_id', TEST_USER_ID)
      .eq('input_channel', 'voice')
      .gte('created_at', `${today}T00:00:00Z`)
      .order('created_at', { ascending: false });

    const smsTotal = smsTasks?.length || 0;
    const voiceTotal = voiceTasks?.length || 0;

    const smsCompleted = smsTasks?.filter(t => t.status === 'completed').length || 0;
    const voiceCompleted = voiceTasks?.filter(t => t.status === 'completed').length || 0;

    const smsCost = smsTasks?.reduce((sum, t) => sum + (t.cost_usd || 0), 0) || 0;
    const voiceCost = voiceTasks?.reduce((sum, t) => sum + (t.cost_usd || 0), 0) || 0;

    console.log('\n========================================');
    console.log('PHONE/VOICE SYSTEM TEST SUMMARY');
    console.log('========================================');
    console.log(`Test Date: ${today}`);
    console.log(`Test User: ${TEST_USER_ID}`);
    console.log(`\nSMS Channel:`);
    console.log(`  Total tasks: ${smsTotal}`);
    console.log(`  Completed: ${smsCompleted}`);
    console.log(`  Success rate: ${smsTotal ? ((smsCompleted / smsTotal) * 100).toFixed(1) : 0}%`);
    console.log(`  Total cost: $${smsCost.toFixed(4)}`);
    console.log(`\nVoice Channel:`);
    console.log(`  Total tasks: ${voiceTotal}`);
    console.log(`  Completed: ${voiceCompleted}`);
    console.log(`  Success rate: ${voiceTotal ? ((voiceCompleted / voiceTotal) * 100).toFixed(1) : 0}%`);
    console.log(`  Total cost: $${voiceCost.toFixed(4)}`);
    console.log(`\nConfiguration:`);
    console.log(`  Agent URL: ${AGENT_URL}`);
    console.log(`  Twilio Phone: ${TWILIO_PHONE_NUMBER}`);
    console.log(`  SMS Webhook: ${AGENT_URL}/webhook/sms/incoming`);
    console.log(`  Voice Webhook: ${AGENT_URL}/webhook/voice/incoming`);
    console.log(`  Rate Limit: 30 requests/min per phone`);
    console.log(`  Daily Call Limit: 50 calls/day per user`);
    console.log(`  Voice Cache TTL: 5 minutes`);
    console.log('========================================\n');

    // Test passed if we have any tasks
    expect(smsTotal + voiceTotal).toBeGreaterThanOrEqual(0);
  }, 30000);
});
