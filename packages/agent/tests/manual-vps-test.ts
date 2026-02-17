/**
 * Manual VPS Browser Test
 *
 * Quick manual test script to verify VPS browser works
 * Run with: pnpm tsx packages/agent/tests/manual-vps-test.ts
 */

const AGENT_URL = process.env.AGENT_URL || 'http://localhost:3001';
const WEBHOOK_SECRET = process.env.AGENT_WEBHOOK_SECRET;
const TEST_USER_ID = '11684ec6-80cd-4bb6-9aed-8f0947afd06a';

interface TaskResponse {
  success: boolean;
  taskId?: string;
  message?: string;
  error?: string;
}

interface TaskStatus {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: string;
  error?: string;
  cost_usd?: number;
  cascade_level?: string;
}

async function sendTask(description: string): Promise<string> {
  console.log(`\n📝 Sending task: ${description}\n`);

  const response = await fetch(`${AGENT_URL}/task`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Secret': WEBHOOK_SECRET || '',
    },
    body: JSON.stringify({
      userId: TEST_USER_ID,
      description,
      inputChannel: 'web',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to submit task: ${response.status} ${text}`);
  }

  const data: TaskResponse = await response.json();

  if (!data.success || !data.taskId) {
    throw new Error(`Task submission failed: ${JSON.stringify(data)}`);
  }

  console.log(`✓ Task submitted: ${data.taskId}\n`);
  return data.taskId;
}

async function pollTaskStatus(taskId: string): Promise<TaskStatus> {
  const maxAttempts = 60; // 2 minutes max
  const pollInterval = 2000; // 2 seconds

  for (let i = 0; i < maxAttempts; i++) {
    const response = await fetch(`${AGENT_URL}/task/${taskId}/status`, {
      headers: {
        'X-Webhook-Secret': WEBHOOK_SECRET || '',
      },
    });

    if (response.ok) {
      const status: TaskStatus = await response.json();

      process.stdout.write(`\r⏳ Status: ${status.status}... (${i * 2}s)`);

      if (status.status === 'completed' || status.status === 'failed') {
        console.log('\n');
        return status;
      }
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error('Task timed out');
}

async function runTest(description: string) {
  try {
    const taskId = await sendTask(description);
    const status = await pollTaskStatus(taskId);

    console.log('═══════════════════════════════════════════════════');
    console.log(`Status: ${status.status}`);
    console.log(`Cascade Level: ${status.cascade_level}`);
    console.log(`Cost: $${status.cost_usd?.toFixed(4) || 'N/A'}`);
    console.log('───────────────────────────────────────────────────');

    if (status.status === 'completed') {
      console.log(`✅ Result:\n${status.result}\n`);
    } else {
      console.log(`❌ Error:\n${status.error}\n`);
    }

    console.log('═══════════════════════════════════════════════════\n');

    return status;
  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  }
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║         VPS Browser Manual Test Suite            ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  console.log(`Agent URL: ${AGENT_URL}`);
  console.log(`User ID: ${TEST_USER_ID}\n`);

  if (!WEBHOOK_SECRET) {
    console.error('❌ AGENT_WEBHOOK_SECRET not set');
    process.exit(1);
  }

  const tests = [
    {
      name: 'Test 1: Simple Navigation (Google)',
      task: 'Navigate to google.com and tell me what you see',
    },
    {
      name: 'Test 2: Wikipedia Lookup',
      task: 'Go to wikipedia.org and tell me what the main heading says',
    },
    {
      name: 'Test 3: GitHub Visit',
      task: 'Visit github.com and tell me if you can see the search bar',
    },
    {
      name: 'Test 4: Screenshot Test',
      task: 'Go to example.com and take a screenshot',
    },
    {
      name: 'Test 5: Search Test',
      task: 'Search Google for "VPS browser testing" and tell me if you see results',
    },
  ];

  const results: { name: string; success: boolean; duration: number }[] = [];

  for (const test of tests) {
    console.log(`\n🧪 ${test.name}`);
    console.log('═══════════════════════════════════════════════════\n');

    const startTime = Date.now();

    try {
      const status = await runTest(test.task);
      const duration = Date.now() - startTime;

      results.push({
        name: test.name,
        success: status.status === 'completed',
        duration,
      });

      console.log(`⏱️  Duration: ${(duration / 1000).toFixed(2)}s\n`);
    } catch (error) {
      const duration = Date.now() - startTime;
      results.push({
        name: test.name,
        success: false,
        duration,
      });
      console.error(error);
    }
  }

  // Summary
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║                  Test Summary                     ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  results.forEach(result => {
    const status = result.success ? '✅ PASS' : '❌ FAIL';
    const duration = `${(result.duration / 1000).toFixed(2)}s`;
    console.log(`${status} - ${result.name} (${duration})`);
  });

  const passCount = results.filter(r => r.success).length;
  const totalCount = results.length;

  console.log(`\n${passCount}/${totalCount} tests passed\n`);

  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║            VPS Verification Steps                 ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  console.log('To verify VPS browser was used:');
  console.log('1. SSH to VPS: ssh -i ~/.ssh/vps_key root@77.42.31.185');
  console.log('2. Check logs: pm2 logs agent --lines 100');
  console.log('3. Look for: [ENGINE] Will use VPS Browser (localhost:9000)');
  console.log('4. Should NOT see: [ENGINE] Will use Browserbase\n');

  if (passCount < totalCount) {
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
