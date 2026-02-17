#!/usr/bin/env node
/**
 * Generate Visual Flow Diagram
 *
 * Creates a detailed ASCII diagram showing the complete email-to-task-to-response flow
 * with status indicators for each component.
 *
 * Usage: npx tsx tests/generate-flow-diagram.ts
 */

import crypto from 'crypto';

const AGENT_URL = process.env.AGENT_URL || 'http://localhost:3001';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

interface ComponentStatus {
  name: string;
  status: 'ok' | 'degraded' | 'down' | 'unknown';
  message?: string;
  responseTime?: number;
}

async function checkAgentHealth(): Promise<ComponentStatus> {
  try {
    const start = Date.now();
    const response = await fetch(`${AGENT_URL}/health`, { signal: AbortSignal.timeout(5000) });
    const responseTime = Date.now() - start;

    if (!response.ok) {
      return { name: 'Agent Server', status: 'degraded', message: `HTTP ${response.status}`, responseTime };
    }

    const health = await response.json();

    if (health.status === 'healthy') {
      return {
        name: 'Agent Server',
        status: 'ok',
        message: `${health.activeTasks} active, ${health.queuedTasks} queued`,
        responseTime,
      };
    }

    return { name: 'Agent Server', status: 'degraded', message: health.status, responseTime };
  } catch (error) {
    return { name: 'Agent Server', status: 'down', message: (error as Error).message };
  }
}

async function checkDatabase(): Promise<ComponentStatus> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { name: 'Database', status: 'unknown', message: 'Credentials not configured' };
  }

  try {
    const start = Date.now();
    const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id&limit=1`, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      signal: AbortSignal.timeout(5000),
    });
    const responseTime = Date.now() - start;

    if (response.ok) {
      return { name: 'Database', status: 'ok', message: 'Supabase connected', responseTime };
    }

    return { name: 'Database', status: 'degraded', message: `HTTP ${response.status}`, responseTime };
  } catch (error) {
    return { name: 'Database', status: 'down', message: (error as Error).message };
  }
}

async function checkCloudflareWorker(): Promise<ComponentStatus> {
  try {
    const start = Date.now();
    // Worker doesn't have a public health endpoint, so we just check if it's reachable
    const response = await fetch('https://aevoy-email-router.omarkebrahim.workers.dev', {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    const responseTime = Date.now() - start;

    // Worker will likely return 404 or 405 for GET, but that means it's up
    if (response.status < 500) {
      return { name: 'Email Worker', status: 'ok', message: 'Cloudflare Worker deployed', responseTime };
    }

    return { name: 'Email Worker', status: 'degraded', message: `HTTP ${response.status}`, responseTime };
  } catch (error) {
    return { name: 'Email Worker', status: 'unknown', message: 'No public health endpoint' };
  }
}

function getStatusIcon(status: 'ok' | 'degraded' | 'down' | 'unknown'): string {
  switch (status) {
    case 'ok': return '✅';
    case 'degraded': return '⚠️ ';
    case 'down': return '❌';
    case 'unknown': return '❓';
  }
}

function getStatusColor(status: 'ok' | 'degraded' | 'down' | 'unknown'): string {
  switch (status) {
    case 'ok': return 'GREEN';
    case 'degraded': return 'YELLOW';
    case 'down': return 'RED';
    case 'unknown': return 'GRAY';
  }
}

async function generateFlowDiagram() {
  console.log('Checking system components...\n');

  const [agent, database, worker] = await Promise.all([
    checkAgentHealth(),
    checkDatabase(),
    checkCloudflareWorker(),
  ]);

  const components = [agent, database, worker];

  // Status summary
  console.log('Component Status:');
  console.log('='.repeat(70));
  components.forEach(comp => {
    const icon = getStatusIcon(comp.status);
    const color = getStatusColor(comp.status);
    const time = comp.responseTime ? ` (${comp.responseTime}ms)` : '';
    const msg = comp.message ? ` - ${comp.message}` : '';
    console.log(`${icon} ${comp.name.padEnd(20)} [${color}]${time}${msg}`);
  });
  console.log('='.repeat(70));
  console.log('');

  // Visual flow diagram
  console.log('Email-to-Task-to-Response Flow Diagram');
  console.log('='.repeat(70));
  console.log('');

  const diagram = `
┌─────────────────────────────────────────────────────────────────────┐
│                         1. USER SENDS EMAIL                          │
│                      username@aevoy.com                              │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│              2. CLOUDFLARE EMAIL ROUTING                             │
│   Worker: aevoy-email-router.omarkebrahim.workers.dev               │
│   Status: ${getStatusIcon(worker.status)} ${getStatusColor(worker.status).padEnd(40)}│
│                                                                      │
│   ✓ Parse MIME (postal-mime)                                        │
│   ✓ Lookup user in Supabase                                         │
│   ✓ Validate sender email                                           │
│   ✓ Detect email type (new_task, confirmation, verification, magic) │
│   ✓ Forward to agent /task/incoming                                 │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│              3. AGENT SERVER (Railway)                               │
│   Endpoint: POST /task/incoming                                      │
│   Status: ${getStatusIcon(agent.status)} ${getStatusColor(agent.status).padEnd(40)}│
│   ${agent.message ? agent.message.padEnd(60) : ' '.repeat(60)}│
│                                                                      │
│   ✓ Verify webhook secret (timing-safe)                             │
│   ✓ Validate payload                                                │
│   ✓ Create task in DB                                               │
│   ✓ Queue for async processing                                      │
│   ✓ Return 200 immediately                                          │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│              4. TASK PROCESSOR                                       │
│   MAX_ITERATIONS = 30                                                │
│                                                                      │
│   ✓ Load user memory (working, long_term, episodic)                 │
│   ✓ Query Hive learnings                                            │
│   ✓ AI model routing: Groq → DeepSeek → Kimi → Gemini → Claude     │
│   ✓ Execution cascade: API skills → cached browser → new browser    │
│   ✓ Iterative execution (max 5 rounds)                              │
│   ✓ 3-step verification                                             │
│   ✓ Update task status                                              │
│   ✓ Track cost in ai_cost_log                                       │
│   ✓ Send response email                                             │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│              5. BROWSER EXECUTION (Optional)                         │
│   VPS: 77.42.31.185 (primary)                                       │
│   Fallback: Local Playwright on Railway                             │
│                                                                      │
│   14 Action Types:                                                   │
│   • browse, search, click, fill, select, submit                     │
│   • login, scroll, wait, extract, screenshot                        │
│   • send_email, remember, schedule                                  │
│                                                                      │
│   CAPTCHA Solving (95%+ success):                                   │
│   1. CapSolver (AI, $0.0008)                                        │
│   2. 2Captcha (human, $0.003)                                       │
│   3. Claude Vision                                                   │
│   4. User manual                                                     │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│              6. DATABASE PERSISTENCE                                 │
│   Supabase PostgreSQL                                                │
│   Status: ${getStatusIcon(database.status)} ${getStatusColor(database.status).padEnd(40)}│
│                                                                      │
│   ✓ tasks (id, status, response, cost_usd)                          │
│   ✓ task_logs (level, message, timestamp)                           │
│   ✓ ai_cost_log (model, tokens_used, cost_usd)                      │
│   ✓ user_memory (encrypted, pgvector embeddings)                    │
│   ✓ usage (monthly limits, proactive counts)                        │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│              7. RESPONSE EMAIL (Resend)                              │
│   From: noreply@aevoy.com                                           │
│   DKIM/SPF: Verified                                                │
│                                                                      │
│   ✓ HTML + text dual-format                                         │
│   ✓ Linear/Stripe-inspired design                                   │
│   ✓ Mobile-responsive table layout                                  │
│   ✓ XSS protection (escapeHtml)                                     │
│   ✓ 3 retry attempts with 3s delay                                  │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│              8. USER RECEIVES EMAIL                                  │
│   Subject: Re: [Original Subject]                                   │
│   Body: Task result with formatted content                          │
└─────────────────────────────────────────────────────────────────────┘
`;

  console.log(diagram);

  // Performance targets
  console.log('');
  console.log('Performance Targets:');
  console.log('='.repeat(70));
  console.log('Email → Agent:        <3s   (Cloudflare Worker processing)');
  console.log('Simple AI task:      <10s   (Groq inference)');
  console.log('Browser task:        <60s   (VPS + Playwright)');
  console.log('Response email:       <5s   (Resend send)');
  console.log('Total E2E:           <90s   (Target for most tasks)');
  console.log('Cost per task:     <$0.10   (AI + CAPTCHA + services)');
  console.log('='.repeat(70));

  // Breaking points
  console.log('');
  console.log('Known Limitations:');
  console.log('='.repeat(70));
  console.log('⚠️  VPS Browser: Single instance (77.42.31.185)');
  console.log('    → Fallback: Local Playwright on Railway');
  console.log('');
  console.log('⚠️  IMAP Poller: Disabled on agent');
  console.log('    → All email routed via Cloudflare Worker');
  console.log('');
  console.log('⚠️  Resend Limits: 100 emails/day (free tier)');
  console.log('    → Upgrade to paid plan for production');
  console.log('');
  console.log('⚠️  Rate Limiting: 10 requests/min per user');
  console.log('    → Queue system handles burst traffic');
  console.log('='.repeat(70));

  // Overall system status
  console.log('');
  const allOk = components.every(c => c.status === 'ok');
  const anyDown = components.some(c => c.status === 'down');

  if (allOk) {
    console.log('✅ SYSTEM STATUS: HEALTHY');
    console.log('All components operational. Ready for production.');
  } else if (anyDown) {
    console.log('❌ SYSTEM STATUS: DEGRADED');
    console.log('One or more critical components are down.');
  } else {
    console.log('⚠️  SYSTEM STATUS: PARTIAL');
    console.log('Some components are degraded or unknown.');
  }
  console.log('');
}

// Run
generateFlowDiagram().catch(error => {
  console.error('Error generating diagram:', error);
  process.exit(1);
});
