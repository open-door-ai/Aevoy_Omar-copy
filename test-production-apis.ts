/**
 * Production API Endpoint Test Suite
 * Tests all 37 API routes documented in CLAUDE.md against https://www.aevoy.com
 */

interface TestResult {
  endpoint: string;
  method: string;
  status: number;
  responseTime: number;
  success: boolean;
  error?: string;
  requiresAuth: boolean;
  corsHeaders?: Record<string, string>;
  rateLimit?: {
    limit?: string;
    remaining?: string;
    reset?: string;
  };
}

const BASE_URL = 'https://www.aevoy.com';
const results: TestResult[] = [];

// Test configuration
let authToken: string | null = null;
let userId: string | null = null;

// Helper function to make API calls
async function testEndpoint(
  endpoint: string,
  method: string = 'GET',
  body?: any,
  headers: Record<string, string> = {},
  requiresAuth: boolean = false
): Promise<TestResult> {
  const startTime = Date.now();
  const url = `${BASE_URL}${endpoint}`;

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Origin': BASE_URL,
    ...headers
  };

  if (requiresAuth && authToken) {
    requestHeaders['Authorization'] = `Bearer ${authToken}`;
  }

  try {
    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include'
    });

    const responseTime = Date.now() - startTime;

    // Extract CORS headers
    const corsHeaders: Record<string, string> = {};
    const corsHeaderNames = [
      'access-control-allow-origin',
      'access-control-allow-credentials',
      'access-control-allow-methods',
      'access-control-allow-headers'
    ];

    corsHeaderNames.forEach(name => {
      const value = response.headers.get(name);
      if (value) corsHeaders[name] = value;
    });

    // Extract rate limit headers
    const rateLimit = {
      limit: response.headers.get('x-ratelimit-limit') || undefined,
      remaining: response.headers.get('x-ratelimit-remaining') || undefined,
      reset: response.headers.get('x-ratelimit-reset') || undefined
    };

    const result: TestResult = {
      endpoint,
      method,
      status: response.status,
      responseTime,
      success: response.ok,
      requiresAuth,
      corsHeaders: Object.keys(corsHeaders).length > 0 ? corsHeaders : undefined,
      rateLimit: (rateLimit.limit || rateLimit.remaining) ? rateLimit : undefined
    };

    if (!response.ok) {
      const text = await response.text();
      result.error = text.substring(0, 200);
    }

    return result;
  } catch (error) {
    return {
      endpoint,
      method,
      status: 0,
      responseTime: Date.now() - startTime,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      requiresAuth
    };
  }
}

// Test suite
async function runTests() {
  console.log('Starting Production API Test Suite');
  console.log('Target: https://www.aevoy.com');
  console.log('Time:', new Date().toISOString());
  console.log('='.repeat(80));

  // 1. PUBLIC ENDPOINTS (no auth required)
  console.log('\n[1/6] Testing Public Endpoints...');

  results.push(await testEndpoint('/api/demo/task', 'POST', {
    query: 'What is 2+2?'
  }));

  results.push(await testEndpoint('/api/demo/call', 'POST', {
    phone: '+17789008951'
  }));

  results.push(await testEndpoint('/api/hive/public/vents', 'GET'));
  results.push(await testEndpoint('/api/hive/public/learnings', 'GET'));
  results.push(await testEndpoint('/api/hive/public/stats', 'GET'));

  results.push(await testEndpoint('/api/onboarding/check-username', 'POST', {
    username: 'testuser123'
  }));

  // 2. AUTH ENDPOINTS (test without auth - should return 401)
  console.log('\n[2/6] Testing Auth Middleware (should return 401/403)...');

  const protectedEndpoints = [
    { path: '/api/tasks', method: 'GET' },
    { path: '/api/tasks', method: 'POST' },
    { path: '/api/user', method: 'GET' },
    { path: '/api/user', method: 'PATCH' },
    { path: '/api/user/export', method: 'GET' },
    { path: '/api/user/delete', method: 'DELETE' },
    { path: '/api/usage', method: 'GET' },
    { path: '/api/stats', method: 'GET' },
    { path: '/api/memory', method: 'GET' },
    { path: '/api/memory', method: 'POST' },
    { path: '/api/settings', method: 'GET' },
    { path: '/api/settings', method: 'PUT' },
    { path: '/api/onboarding/complete', method: 'POST' },
    { path: '/api/integrations/gmail', method: 'GET' },
    { path: '/api/integrations/gmail', method: 'POST' },
    { path: '/api/integrations/microsoft', method: 'POST' },
    { path: '/api/integrations/email', method: 'POST' },
    { path: '/api/phone', method: 'POST' },
    { path: '/api/agent-card', method: 'GET' },
    { path: '/api/scheduled-tasks', method: 'POST' },
    { path: '/api/workflows', method: 'POST' },
    { path: '/api/settings/email-pin', method: 'POST' },
    { path: '/api/profile/beta-status', method: 'POST' }
  ];

  for (const ep of protectedEndpoints) {
    results.push(await testEndpoint(ep.path, ep.method, {}, {}, true));
  }

  // 3. WEBHOOK ENDPOINTS (test secret validation)
  console.log('\n[3/6] Testing Webhook Endpoints (should reject without secret)...');

  results.push(await testEndpoint('/api/webhooks/stripe', 'POST', {}));
  results.push(await testEndpoint('/api/webhooks/task', 'POST', {}));
  results.push(await testEndpoint('/api/hive/learnings', 'POST', {}));
  results.push(await testEndpoint('/api/hive/vents', 'POST', {}));
  results.push(await testEndpoint('/api/hive/sync', 'POST', {}));

  // 4. OAUTH CALLBACK ENDPOINTS
  console.log('\n[4/6] Testing OAuth Callback Endpoints...');

  results.push(await testEndpoint('/api/integrations/gmail/callback', 'GET'));
  results.push(await testEndpoint('/api/integrations/microsoft/callback', 'GET'));

  // 5. CORS HEADERS
  console.log('\n[5/6] Testing CORS Headers (OPTIONS preflight)...');

  const corsTest = await testEndpoint('/api/tasks', 'OPTIONS');
  results.push(corsTest);

  // 6. RATE LIMITING
  console.log('\n[6/6] Testing Rate Limiting on /api/demo/task...');

  // Fire 15 rapid requests to test rate limit (limit is 10/day/IP)
  const rateLimitTests = [];
  for (let i = 0; i < 15; i++) {
    rateLimitTests.push(
      testEndpoint('/api/demo/task', 'POST', {
        query: `Test query ${i}`
      })
    );
  }

  const rateLimitResults = await Promise.all(rateLimitTests);
  results.push(...rateLimitResults);

  // Generate Report
  console.log('\n' + '='.repeat(80));
  console.log('TEST RESULTS SUMMARY');
  console.log('='.repeat(80));

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  const authProtected = results.filter(r => r.requiresAuth && r.status === 401);
  const avgResponseTime = results.reduce((sum, r) => sum + r.responseTime, 0) / results.length;

  console.log(`\nTotal Tests: ${results.length}`);
  console.log(`Successful: ${successful.length} (${(successful.length/results.length*100).toFixed(1)}%)`);
  console.log(`Failed: ${failed.length} (${(failed.length/results.length*100).toFixed(1)}%)`);
  console.log(`Auth Protected Working: ${authProtected.length}`);
  console.log(`Average Response Time: ${avgResponseTime.toFixed(0)}ms`);

  // Detailed results
  console.log('\n' + '='.repeat(80));
  console.log('DETAILED RESULTS');
  console.log('='.repeat(80));

  const groupedResults = {
    'Public Endpoints': results.slice(0, 6),
    'Auth Middleware Tests': results.slice(6, 6 + protectedEndpoints.length),
    'Webhook Endpoints': results.slice(6 + protectedEndpoints.length, 6 + protectedEndpoints.length + 5),
    'OAuth Callbacks': results.slice(6 + protectedEndpoints.length + 5, 6 + protectedEndpoints.length + 7),
    'CORS Test': [results[6 + protectedEndpoints.length + 7]],
    'Rate Limit Tests': results.slice(6 + protectedEndpoints.length + 8)
  };

  for (const [group, groupResults] of Object.entries(groupedResults)) {
    console.log(`\n${group}:`);
    console.log('-'.repeat(80));

    groupResults.forEach(r => {
      const statusEmoji = r.success ? '✓' : '✗';
      const authLabel = r.requiresAuth ? '[AUTH]' : '[PUBLIC]';
      console.log(`${statusEmoji} ${r.method} ${r.endpoint} ${authLabel}`);
      console.log(`  Status: ${r.status} | Time: ${r.responseTime}ms`);

      if (r.error) {
        console.log(`  Error: ${r.error}`);
      }

      if (r.corsHeaders) {
        console.log(`  CORS: ${Object.keys(r.corsHeaders).length} headers`);
      }

      if (r.rateLimit) {
        console.log(`  Rate Limit: ${r.rateLimit.remaining || '?'}/${r.rateLimit.limit || '?'}`);
      }
    });
  }

  // CORS Analysis
  console.log('\n' + '='.repeat(80));
  console.log('CORS HEADERS ANALYSIS');
  console.log('='.repeat(80));

  const corsResults = results.filter(r => r.corsHeaders && Object.keys(r.corsHeaders).length > 0);
  if (corsResults.length > 0) {
    const sample = corsResults[0];
    console.log('Sample CORS Headers:');
    Object.entries(sample.corsHeaders!).forEach(([key, value]) => {
      console.log(`  ${key}: ${value}`);
    });
  } else {
    console.log('No CORS headers detected');
  }

  // Rate Limit Analysis
  console.log('\n' + '='.repeat(80));
  console.log('RATE LIMITING ANALYSIS');
  console.log('='.repeat(80));

  const rateLimitingResults = results.filter(r => r.endpoint === '/api/demo/task' && r.method === 'POST');
  const rateLimited = rateLimitingResults.filter(r => r.status === 429);

  console.log(`Total /api/demo/task requests: ${rateLimitingResults.length}`);
  console.log(`Rate limited (429): ${rateLimited.length}`);
  console.log(`Success (200): ${rateLimitingResults.filter(r => r.status === 200).length}`);

  if (rateLimited.length > 0) {
    console.log('\nRate limiting is ACTIVE');
    console.log(`First rate limit at request #${rateLimitingResults.findIndex(r => r.status === 429) + 1}`);
  } else {
    console.log('\nNo rate limiting detected (may need more requests or different endpoint)');
  }

  // Response Time Distribution
  console.log('\n' + '='.repeat(80));
  console.log('RESPONSE TIME DISTRIBUTION');
  console.log('='.repeat(80));

  const sorted = [...results].sort((a, b) => a.responseTime - b.responseTime);
  console.log(`Min: ${sorted[0].responseTime}ms (${sorted[0].method} ${sorted[0].endpoint})`);
  console.log(`Max: ${sorted[sorted.length-1].responseTime}ms (${sorted[sorted.length-1].method} ${sorted[sorted.length-1].endpoint})`);
  console.log(`Median: ${sorted[Math.floor(sorted.length/2)].responseTime}ms`);
  console.log(`P95: ${sorted[Math.floor(sorted.length*0.95)].responseTime}ms`);
  console.log(`P99: ${sorted[Math.floor(sorted.length*0.99)].responseTime}ms`);

  // Error Rate by Category
  console.log('\n' + '='.repeat(80));
  console.log('ERROR RATES BY CATEGORY');
  console.log('='.repeat(80));

  for (const [group, groupResults] of Object.entries(groupedResults)) {
    const groupFailed = groupResults.filter(r => !r.success && r.status !== 401 && r.status !== 429);
    const errorRate = (groupFailed.length / groupResults.length * 100).toFixed(1);
    console.log(`${group}: ${groupFailed.length}/${groupResults.length} failed (${errorRate}%)`);
  }

  // Export JSON report
  console.log('\n' + '='.repeat(80));
  console.log('JSON REPORT');
  console.log('='.repeat(80));

  const report = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    summary: {
      totalTests: results.length,
      successful: successful.length,
      failed: failed.length,
      avgResponseTime: Math.round(avgResponseTime)
    },
    results
  };

  console.log(JSON.stringify(report, null, 2));
}

// Execute tests
runTests().catch(console.error);
