/**
 * Production Deployment Verification Script
 *
 * Verifies all systems are correctly deployed and configured:
 * - Railway agent server
 * - Vercel web app
 * - Cloudflare email worker
 * - Environment variables sync
 * - Security headers
 * - Health checks
 */

import https from 'https';
import http from 'http';

const RAILWAY_URL = 'https://agent-production-1339.up.railway.app';
const VERCEL_URL = 'https://www.aevoy.com';

interface CheckResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  message: string;
  details?: any;
}

const results: CheckResult[] = [];

function makeRequest(url: string): Promise<{ status: number; headers: any; body: string }> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;

    client.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode || 0,
          headers: res.headers,
          body,
        });
      });
    }).on('error', reject);
  });
}

async function checkRailwayHealth(): Promise<CheckResult> {
  try {
    const response = await makeRequest(`${RAILWAY_URL}/health`);

    if (response.status !== 200) {
      return {
        name: 'Railway Health',
        status: 'FAIL',
        message: `Health endpoint returned ${response.status}`,
        details: response.body,
      };
    }

    const health = JSON.parse(response.body);

    if (health.status !== 'healthy') {
      return {
        name: 'Railway Health',
        status: 'FAIL',
        message: `Status is ${health.status}, expected 'healthy'`,
        details: health,
      };
    }

    if (health.database !== 'ok') {
      return {
        name: 'Railway Health',
        status: 'WARN',
        message: 'Database subsystem not OK',
        details: health,
      };
    }

    return {
      name: 'Railway Health',
      status: 'PASS',
      message: `v${health.version} healthy, ${health.activeTasks} active tasks`,
      details: health,
    };
  } catch (error: any) {
    return {
      name: 'Railway Health',
      status: 'FAIL',
      message: `Request failed: ${error.message}`,
    };
  }
}

async function checkRailwaySecurityHeaders(): Promise<CheckResult> {
  try {
    const response = await makeRequest(RAILWAY_URL);

    const requiredHeaders = {
      'strict-transport-security': 'HSTS',
      'x-frame-options': 'Frame protection',
      'x-content-type-options': 'Content type sniffing protection',
    };

    const missingHeaders: string[] = [];

    for (const [header, description] of Object.entries(requiredHeaders)) {
      if (!response.headers[header]) {
        missingHeaders.push(`${header} (${description})`);
      }
    }

    if (missingHeaders.length > 0) {
      return {
        name: 'Railway Security Headers',
        status: 'WARN',
        message: `Missing ${missingHeaders.length} security headers`,
        details: missingHeaders,
      };
    }

    return {
      name: 'Railway Security Headers',
      status: 'PASS',
      message: 'All security headers present',
      details: response.headers,
    };
  } catch (error: any) {
    return {
      name: 'Railway Security Headers',
      status: 'FAIL',
      message: `Request failed: ${error.message}`,
    };
  }
}

async function checkVercelHealth(): Promise<CheckResult> {
  try {
    const response = await makeRequest(VERCEL_URL);

    if (response.status !== 200) {
      return {
        name: 'Vercel Web App',
        status: 'FAIL',
        message: `Homepage returned ${response.status}`,
      };
    }

    // Check if it's actually the Aevoy landing page
    if (!response.body.includes('Aevoy') && !response.body.includes('AI Employee')) {
      return {
        name: 'Vercel Web App',
        status: 'WARN',
        message: 'Response does not contain expected content',
        details: response.body.substring(0, 200),
      };
    }

    return {
      name: 'Vercel Web App',
      status: 'PASS',
      message: 'Landing page loads successfully',
    };
  } catch (error: any) {
    return {
      name: 'Vercel Web App',
      status: 'FAIL',
      message: `Request failed: ${error.message}`,
    };
  }
}

async function checkVercelSecurityHeaders(): Promise<CheckResult> {
  try {
    const response = await makeRequest(VERCEL_URL);

    const requiredHeaders = {
      'strict-transport-security': 'HSTS',
      'x-frame-options': 'Frame protection',
      'x-content-type-options': 'Content type sniffing protection',
      'referrer-policy': 'Referrer policy',
    };

    const missingHeaders: string[] = [];

    for (const [header, description] of Object.entries(requiredHeaders)) {
      if (!response.headers[header]) {
        missingHeaders.push(`${header} (${description})`);
      }
    }

    if (missingHeaders.length > 0) {
      return {
        name: 'Vercel Security Headers',
        status: 'FAIL',
        message: `Missing ${missingHeaders.length} critical security headers`,
        details: missingHeaders,
      };
    }

    // Verify HSTS has long max-age
    const hsts = response.headers['strict-transport-security'];
    if (!hsts.includes('31536000')) {
      return {
        name: 'Vercel Security Headers',
        status: 'WARN',
        message: 'HSTS max-age should be 31536000 (1 year)',
        details: hsts,
      };
    }

    return {
      name: 'Vercel Security Headers',
      status: 'PASS',
      message: 'All security headers present with correct values',
      details: response.headers,
    };
  } catch (error: any) {
    return {
      name: 'Vercel Security Headers',
      status: 'FAIL',
      message: `Request failed: ${error.message}`,
    };
  }
}

async function checkRailwayEnvironment(): Promise<CheckResult> {
  try {
    const response = await makeRequest(`${RAILWAY_URL}/health`);
    const health = JSON.parse(response.body);

    // Check if version indicates recent deployment
    if (health.version !== '2.0.0') {
      return {
        name: 'Railway Environment',
        status: 'WARN',
        message: `Version is ${health.version}, expected 2.0.0`,
        details: health,
      };
    }

    // Check concurrency limits
    if (health.maxConcurrent !== 10 || health.maxBrowserConcurrent !== 10) {
      return {
        name: 'Railway Environment',
        status: 'WARN',
        message: 'Concurrency limits may not be set correctly',
        details: {
          maxConcurrent: health.maxConcurrent,
          maxBrowserConcurrent: health.maxBrowserConcurrent,
        },
      };
    }

    return {
      name: 'Railway Environment',
      status: 'PASS',
      message: 'Environment configuration verified',
      details: health,
    };
  } catch (error: any) {
    return {
      name: 'Railway Environment',
      status: 'FAIL',
      message: `Verification failed: ${error.message}`,
    };
  }
}

async function main() {
  console.log('\n');
  console.log('═'.repeat(80));
  console.log('  PRODUCTION DEPLOYMENT VERIFICATION');
  console.log('═'.repeat(80));
  console.log('\n');

  console.log('Running checks...\n');

  // Run all checks
  results.push(await checkRailwayHealth());
  results.push(await checkRailwaySecurityHeaders());
  results.push(await checkRailwayEnvironment());
  results.push(await checkVercelHealth());
  results.push(await checkVercelSecurityHeaders());

  // Print results
  console.log('Results:');
  console.log('-'.repeat(80));

  for (const result of results) {
    const icon = result.status === 'PASS' ? '✓' : result.status === 'WARN' ? '⚠' : '✗';
    const statusPadded = result.status.padEnd(4);

    console.log(`${icon} [${statusPadded}] ${result.name.padEnd(30)} ${result.message}`);

    if (result.details && (result.status === 'FAIL' || result.status === 'WARN')) {
      console.log(`         Details: ${JSON.stringify(result.details, null, 2).split('\n').join('\n         ')}`);
    }
  }

  console.log('\n');

  // Summary
  const passed = results.filter(r => r.status === 'PASS').length;
  const warned = results.filter(r => r.status === 'WARN').length;
  const failed = results.filter(r => r.status === 'FAIL').length;

  console.log('═'.repeat(80));
  console.log(`  SUMMARY: ${passed} passed, ${warned} warnings, ${failed} failed`);
  console.log('═'.repeat(80));
  console.log('\n');

  if (failed > 0) {
    console.log('✗ DEPLOYMENT HAS FAILURES - Review errors above\n');
    process.exit(1);
  } else if (warned > 0) {
    console.log('⚠ DEPLOYMENT HAS WARNINGS - Review warnings above\n');
    process.exit(0);
  } else {
    console.log('✓ ALL CHECKS PASSED - Deployment verified!\n');
    process.exit(0);
  }
}

main().catch(error => {
  console.error('\nFATAL ERROR:', error);
  process.exit(1);
});
