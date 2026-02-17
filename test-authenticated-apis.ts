/**
 * Authenticated API Endpoint Test Suite
 * Tests protected endpoints with real user session
 */

interface TestResult {
  endpoint: string;
  method: string;
  status: number;
  responseTime: number;
  success: boolean;
  error?: string;
  bodyPreview?: string;
}

const BASE_URL = 'https://www.aevoy.com';
const results: TestResult[] = [];

// Helper function to make API calls
async function testEndpoint(
  endpoint: string,
  method: string = 'GET',
  body?: any,
  cookies?: string
): Promise<TestResult> {
  const startTime = Date.now();
  const url = `${BASE_URL}${endpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (cookies) {
    headers['Cookie'] = cookies;
  }

  const options: RequestInit = {
    method,
    headers,
    credentials: 'include'
  };

  // Only add body for methods that support it
  if (body && method !== 'GET' && method !== 'HEAD') {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);
    const responseTime = Date.now() - startTime;

    let bodyPreview: string | undefined;
    const contentType = response.headers.get('content-type');

    try {
      if (contentType?.includes('application/json')) {
        const data = await response.json();
        bodyPreview = JSON.stringify(data).substring(0, 200);
      } else {
        const text = await response.text();
        bodyPreview = text.substring(0, 200);
      }
    } catch (e) {
      bodyPreview = 'Unable to parse response';
    }

    const result: TestResult = {
      endpoint,
      method,
      status: response.status,
      responseTime,
      success: response.ok,
      bodyPreview
    };

    if (!response.ok) {
      result.error = bodyPreview;
    }

    return result;
  } catch (error) {
    return {
      endpoint,
      method,
      status: 0,
      responseTime: Date.now() - startTime,
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function runAuthenticatedTests() {
  console.log('Authenticated API Test Suite');
  console.log('Target: https://www.aevoy.com');
  console.log('Time:', new Date().toISOString());
  console.log('='.repeat(80));

  // Step 1: Create test account or login
  console.log('\n[1/4] Attempting to authenticate...');

  const loginEmail = `test_${Date.now()}@aevoy.com`;
  const loginPassword = 'TestPassword123!';

  console.log(`Test credentials: ${loginEmail}`);

  // Try to sign up
  const signupResp = await fetch(`${BASE_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      email: loginEmail,
      password: loginPassword
    })
  });

  console.log(`Signup response: ${signupResp.status}`);

  // If signup fails, try login with existing test account
  let cookies = '';
  if (!signupResp.ok) {
    console.log('Trying to login with test account: teste2e@aevoy.com');
    const loginResp = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        email: 'teste2e@aevoy.com',
        password: 'TestPassword123!'
      })
    });

    console.log(`Login response: ${loginResp.status}`);

    if (loginResp.ok) {
      const setCookie = loginResp.headers.get('set-cookie');
      if (setCookie) {
        cookies = setCookie;
        console.log('Login successful, cookies obtained');
      }
    }
  } else {
    const setCookie = signupResp.headers.get('set-cookie');
    if (setCookie) {
      cookies = setCookie;
      console.log('Signup successful, cookies obtained');
    }
  }

  if (!cookies) {
    console.log('\nWARNING: No authentication cookies obtained');
    console.log('Will test endpoints without auth (expect 401s)');
  }

  // Step 2: Test GET endpoints
  console.log('\n[2/4] Testing GET endpoints...');

  results.push(await testEndpoint('/api/user', 'GET', undefined, cookies));
  results.push(await testEndpoint('/api/tasks', 'GET', undefined, cookies));
  results.push(await testEndpoint('/api/usage', 'GET', undefined, cookies));
  results.push(await testEndpoint('/api/stats', 'GET', undefined, cookies));
  results.push(await testEndpoint('/api/memory', 'GET', undefined, cookies));
  results.push(await testEndpoint('/api/settings', 'GET', undefined, cookies));
  results.push(await testEndpoint('/api/integrations/gmail', 'GET', undefined, cookies));
  results.push(await testEndpoint('/api/agent-card', 'GET', undefined, cookies));
  results.push(await testEndpoint('/api/user/export', 'GET', undefined, cookies));

  // Step 3: Test POST/PUT/PATCH/DELETE endpoints
  console.log('\n[3/4] Testing POST/PUT/PATCH/DELETE endpoints...');

  results.push(await testEndpoint('/api/tasks', 'POST', {
    description: 'Test task from API test suite',
    channel: 'web'
  }, cookies));

  results.push(await testEndpoint('/api/user', 'PATCH', {
    displayName: 'Test User'
  }, cookies));

  results.push(await testEndpoint('/api/memory', 'POST', {
    type: 'working',
    content: 'Test memory',
    importance: 0.5
  }, cookies));

  results.push(await testEndpoint('/api/settings', 'PUT', {
    confirmation_mode: 'unclear'
  }, cookies));

  results.push(await testEndpoint('/api/onboarding/complete', 'POST', {
    completed: true
  }, cookies));

  results.push(await testEndpoint('/api/scheduled-tasks', 'POST', {
    description: 'Daily standup reminder',
    cron: '0 9 * * *'
  }, cookies));

  results.push(await testEndpoint('/api/workflows', 'POST', {
    name: 'Test workflow',
    steps: []
  }, cookies));

  results.push(await testEndpoint('/api/phone', 'POST', {}, cookies));

  results.push(await testEndpoint('/api/integrations/gmail', 'POST', {
    action: 'connect'
  }, cookies));

  results.push(await testEndpoint('/api/integrations/microsoft', 'POST', {
    action: 'connect'
  }, cookies));

  results.push(await testEndpoint('/api/integrations/email', 'POST', {
    email: 'test@gmail.com',
    password: 'test'
  }, cookies));

  results.push(await testEndpoint('/api/settings/email-pin', 'POST', {
    pin: '123456'
  }, cookies));

  results.push(await testEndpoint('/api/profile/beta-status', 'POST', {}, cookies));

  // Step 4: Generate report
  console.log('\n[4/4] Generating report...');

  console.log('\n' + '='.repeat(80));
  console.log('AUTHENTICATED ENDPOINT TEST RESULTS');
  console.log('='.repeat(80));

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  const avgResponseTime = results.reduce((sum, r) => sum + r.responseTime, 0) / results.length;

  console.log(`\nTotal Tests: ${results.length}`);
  console.log(`Successful (2xx): ${successful.length} (${(successful.length/results.length*100).toFixed(1)}%)`);
  console.log(`Failed: ${failed.length} (${(failed.length/results.length*100).toFixed(1)}%)`);
  console.log(`Average Response Time: ${avgResponseTime.toFixed(0)}ms`);

  console.log('\n' + '='.repeat(80));
  console.log('DETAILED RESULTS');
  console.log('='.repeat(80));

  const groups = {
    'GET Endpoints': results.filter(r => r.method === 'GET'),
    'POST Endpoints': results.filter(r => r.method === 'POST'),
    'PUT/PATCH Endpoints': results.filter(r => r.method === 'PUT' || r.method === 'PATCH'),
    'DELETE Endpoints': results.filter(r => r.method === 'DELETE')
  };

  for (const [group, groupResults] of Object.entries(groups)) {
    if (groupResults.length === 0) continue;

    console.log(`\n${group}:`);
    console.log('-'.repeat(80));

    groupResults.forEach(r => {
      const icon = r.success ? '✓' : '✗';
      console.log(`${icon} ${r.method} ${r.endpoint}`);
      console.log(`  Status: ${r.status} | Time: ${r.responseTime}ms`);

      if (r.bodyPreview) {
        console.log(`  Response: ${r.bodyPreview}`);
      }

      if (r.error) {
        console.log(`  Error: ${r.error}`);
      }
    });
  }

  // Response time analysis
  console.log('\n' + '='.repeat(80));
  console.log('RESPONSE TIME ANALYSIS');
  console.log('='.repeat(80));

  const sorted = [...results].sort((a, b) => a.responseTime - b.responseTime);
  console.log(`Min: ${sorted[0].responseTime}ms (${sorted[0].method} ${sorted[0].endpoint})`);
  console.log(`Max: ${sorted[sorted.length-1].responseTime}ms (${sorted[sorted.length-1].method} ${sorted[sorted.length-1].endpoint})`);
  console.log(`Median: ${sorted[Math.floor(sorted.length/2)].responseTime}ms`);
  console.log(`P95: ${sorted[Math.floor(sorted.length*0.95)].responseTime}ms`);

  // Status code distribution
  console.log('\n' + '='.repeat(80));
  console.log('STATUS CODE DISTRIBUTION');
  console.log('='.repeat(80));

  const statusCodes = new Map<number, number>();
  results.forEach(r => {
    statusCodes.set(r.status, (statusCodes.get(r.status) || 0) + 1);
  });

  Array.from(statusCodes.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([status, count]) => {
      const pct = (count / results.length * 100).toFixed(1);
      console.log(`  ${status}: ${count} (${pct}%)`);
    });

  // JSON output
  console.log('\n' + '='.repeat(80));
  console.log('JSON REPORT');
  console.log('='.repeat(80));

  const report = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    authenticated: !!cookies,
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

runAuthenticatedTests().catch(console.error);
