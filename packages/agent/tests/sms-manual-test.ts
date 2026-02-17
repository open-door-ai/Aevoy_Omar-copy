/**
 * Manual SMS Channel E2E Test
 *
 * Run with: npx tsx tests/sms-manual-test.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
config({ path: resolve(__dirname, '../../../.env') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER!;
const AGENT_URL = 'https://agent-production-1339.up.railway.app';

console.log('\n========================================');
console.log('SMS CHANNEL E2E PRODUCTION TEST');
console.log('========================================\n');

console.log('Configuration:');
console.log(`  Twilio SID: ${TWILIO_ACCOUNT_SID.slice(0, 10)}...`);
console.log(`  Twilio Phone: ${TWILIO_PHONE_NUMBER}`);
console.log(`  Agent URL: ${AGENT_URL}`);
console.log(`  Supabase URL: ${SUPABASE_URL}`);
console.log('');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function testTwilioAuth() {
  console.log('[1] Testing Twilio API authentication...');

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}.json`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        },
      }
    );

    if (!res.ok) {
      const error = await res.text();
      console.log(`  ❌ Twilio auth failed: ${res.status}`);
      console.log(`  Error: ${error}`);
      return false;
    }

    const data = await res.json();
    console.log(`  ✅ Twilio authenticated: ${data.friendly_name}`);
    console.log(`  Status: ${data.status}`);
    return true;
  } catch (error) {
    console.log(`  ❌ Error: ${error}`);
    return false;
  }
}

async function testAgentHealth() {
  console.log('\n[2] Testing Railway agent health...');

  try {
    const res = await fetch(`${AGENT_URL}/health`);

    if (!res.ok) {
      console.log(`  ❌ Agent unhealthy: ${res.status}`);
      return false;
    }

    const health = await res.json();
    console.log(`  ✅ Agent healthy`);
    console.log(`  Active tasks: ${health.activeTasks}`);
    console.log(`  Active browser tasks: ${health.activeBrowserTasks}`);
    console.log(`  Queued tasks: ${health.queuedTasks}`);
    return true;
  } catch (error) {
    console.log(`  ❌ Error: ${error}`);
    return false;
  }
}

async function getTestUser() {
  console.log('\n[3] Finding test user...');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, phone, twilio_number')
    .eq('email', 'teste2e@aevoy.com')
    .single();

  if (!profile) {
    console.log('  ❌ Test user not found');
    return null;
  }

  console.log(`  ✅ Found user: ${profile.id.slice(0, 8)}...`);
  console.log(`  Email: ${profile.email}`);
  console.log(`  Phone: ${profile.phone || 'not set'}`);
  console.log(`  Twilio number: ${profile.twilio_number || 'not provisioned'}`);

  return profile;
}

async function checkWebhookConfig(userId: string) {
  console.log('\n[4] Checking Twilio webhook configuration...');

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers.json`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        },
      }
    );

    if (!res.ok) {
      console.log(`  ❌ Failed to get phone numbers: ${res.status}`);
      return;
    }

    const data = await res.json();
    const numbers = data.incoming_phone_numbers || [];

    console.log(`  Found ${numbers.length} Twilio phone numbers`);

    numbers.forEach((num: any) => {
      console.log(`\n  Number: ${num.phone_number}`);
      console.log(`    SMS webhook: ${num.sms_url || 'not set'}`);
      console.log(`    Voice webhook: ${num.voice_url || 'not set'}`);
      console.log(`    Friendly name: ${num.friendly_name}`);
    });

    const expectedWebhook = `${AGENT_URL}/webhook/sms/${userId}`;
    console.log(`\n  Expected webhook: ${expectedWebhook}`);

    const hasCorrectWebhook = numbers.some((num: any) =>
      num.sms_url?.includes('/webhook/sms/')
    );

    if (hasCorrectWebhook) {
      console.log('  ✅ Webhook configured');
    } else {
      console.log('  ⚠️  Webhook may need updating');
    }
  } catch (error) {
    console.log(`  ❌ Error: ${error}`);
  }
}

async function sendTestSMS(toNumber: string) {
  console.log(`\n[5] Sending test SMS to ${toNumber}...`);

  const testMessage = `Test SMS ${Date.now()}`;

  try {
    const params = new URLSearchParams({
      To: toNumber,
      From: TWILIO_PHONE_NUMBER,
      Body: testMessage,
    });

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      }
    );

    if (!res.ok) {
      const error = await res.text();
      console.log(`  ❌ SMS send failed: ${res.status}`);
      console.log(`  Error: ${error}`);
      return null;
    }

    const data = await res.json();
    console.log(`  ✅ SMS sent: ${data.sid}`);
    console.log(`  Status: ${data.status}`);
    console.log(`  Message: "${testMessage}"`);

    return data.sid;
  } catch (error) {
    console.log(`  ❌ Error: ${error}`);
    return null;
  }
}

async function checkRecentSMSTasks(userId: string) {
  console.log('\n[6] Checking recent SMS tasks...');

  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, status, input_text, input_channel, created_at')
    .eq('user_id', userId)
    .eq('input_channel', 'sms')
    .gte('created_at', new Date(Date.now() - 3600000).toISOString())
    .order('created_at', { ascending: false })
    .limit(10);

  if (!tasks || tasks.length === 0) {
    console.log('  ℹ️  No recent SMS tasks found');
    return;
  }

  console.log(`  Found ${tasks.length} SMS tasks in the last hour:`);
  tasks.forEach((task, idx) => {
    console.log(`\n  ${idx + 1}. Task ${task.id.slice(0, 8)}...`);
    console.log(`     Status: ${task.status}`);
    console.log(`     Input: ${task.input_text?.slice(0, 50)}...`);
    console.log(`     Created: ${task.created_at}`);
  });
}

async function checkUsageTracking(userId: string) {
  console.log('\n[7] Checking SMS usage tracking...');

  const currentMonth = new Date().toISOString().slice(0, 7);

  const { data: usage } = await supabase
    .from('usage')
    .select('sms_count, month, updated_at')
    .eq('user_id', userId)
    .eq('month', currentMonth)
    .single();

  if (!usage) {
    console.log(`  ℹ️  No usage record for ${currentMonth}`);
    return;
  }

  console.log(`  Month: ${usage.month}`);
  console.log(`  SMS count: ${usage.sms_count}`);
  console.log(`  Last updated: ${usage.updated_at}`);
}

async function checkRecentOutboundSMS() {
  console.log('\n[8] Checking recent outbound SMS...');

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json?From=${encodeURIComponent(TWILIO_PHONE_NUMBER)}&PageSize=5`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        },
      }
    );

    if (!res.ok) {
      console.log(`  ❌ Failed to get messages: ${res.status}`);
      return;
    }

    const data = await res.json();
    const messages = data.messages || [];

    if (messages.length === 0) {
      console.log('  ℹ️  No recent outbound messages');
      return;
    }

    console.log(`  Found ${messages.length} recent outbound SMS:`);
    messages.forEach((msg: any, idx: number) => {
      console.log(`\n  ${idx + 1}. ${msg.sid}`);
      console.log(`     To: ${msg.to}`);
      console.log(`     Status: ${msg.status}`);
      console.log(`     Body: ${msg.body?.slice(0, 50)}...`);
      console.log(`     Sent: ${msg.date_sent}`);
    });
  } catch (error) {
    console.log(`  ❌ Error: ${error}`);
  }
}

async function main() {
  try {
    // Run all tests
    const twilioOk = await testTwilioAuth();
    if (!twilioOk) {
      console.log('\n❌ Twilio authentication failed. Cannot continue.');
      process.exit(1);
    }

    const agentOk = await testAgentHealth();
    if (!agentOk) {
      console.log('\n⚠️  Agent is not healthy. Some tests may fail.');
    }

    const testUser = await getTestUser();
    if (!testUser) {
      console.log('\n❌ Test user not found. Cannot continue.');
      process.exit(1);
    }

    await checkWebhookConfig(testUser.id);
    await checkUsageTracking(testUser.id);
    await checkRecentSMSTasks(testUser.id);
    await checkRecentOutboundSMS();

    // Only send test SMS if user has a phone number
    if (testUser.phone) {
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl.question(`\nSend test SMS to ${testUser.phone}? (y/n): `, async (answer) => {
        if (answer.toLowerCase() === 'y') {
          await sendTestSMS(testUser.phone!);

          console.log('\nWaiting 10 seconds for webhook processing...');
          await new Promise(resolve => setTimeout(resolve, 10000));

          await checkRecentSMSTasks(testUser.id);
          await checkUsageTracking(testUser.id);
        }

        console.log('\n========================================');
        console.log('TEST COMPLETE');
        console.log('========================================\n');

        rl.close();
        process.exit(0);
      });
    } else {
      console.log('\n⚠️  Test user has no phone number. Skipping SMS send test.');
      console.log('\n========================================');
      console.log('TEST COMPLETE');
      console.log('========================================\n');
    }
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

main();
