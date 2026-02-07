import { test, expect } from '@playwright/test';

test.describe('Vercel Production Deployment Verification', () => {
  test('should verify Vercel deployment is live and working', async ({ page }) => {
    console.log('\n=== VERCEL DEPLOYMENT VERIFICATION ===\n');

    // Test 1: Landing page
    console.log('[TEST 1] Landing page...');
    await page.goto('https://www.aevoy.com', { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page).toHaveTitle(/Aevoy/);
    console.log('✅ Landing page loaded successfully');

    // Test 2: Skills Marketplace page (should redirect to login)
    console.log('\n[TEST 2] Skills Marketplace page...');
    await page.goto('https://www.aevoy.com/dashboard/skills', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    const currentUrl = page.url();
    console.log(`Current URL: ${currentUrl}`);

    if (currentUrl.includes('/login')) {
      console.log('✅ Skills page correctly redirects to login (auth protected)');
    } else {
      console.log('⚠️ Skills page did not redirect to login');
    }

    // Test 3: Task Queue page (should redirect to login)
    console.log('\n[TEST 3] Task Queue page...');
    await page.goto('https://www.aevoy.com/dashboard/queue', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    const queueUrl = page.url();
    console.log(`Current URL: ${queueUrl}`);

    if (queueUrl.includes('/login')) {
      console.log('✅ Queue page correctly redirects to login (auth protected)');
    } else {
      console.log('⚠️ Queue page did not redirect to login');
    }

    // Test 4: Check for any console errors
    console.log('\n[TEST 4] Checking for console errors...');
    const errors: string[] = [];

    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    page.on('pageerror', error => {
      errors.push(error.message);
    });

    await page.goto('https://www.aevoy.com', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    if (errors.length === 0) {
      console.log('✅ No console errors detected');
    } else {
      console.log(`⚠️ Found ${errors.length} console errors:`);
      errors.forEach((err, i) => console.log(`  ${i + 1}. ${err}`));
    }

    // Test 5: Check network requests
    console.log('\n[TEST 5] Checking network requests...');
    const failedRequests: string[] = [];

    page.on('requestfailed', request => {
      failedRequests.push(`${request.method()} ${request.url()} - ${request.failure()?.errorText}`);
    });

    await page.goto('https://www.aevoy.com', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    if (failedRequests.length === 0) {
      console.log('✅ All network requests successful');
    } else {
      console.log(`⚠️ Found ${failedRequests.length} failed requests:`);
      failedRequests.forEach((req, i) => console.log(`  ${i + 1}. ${req}`));
    }

    // Test 6: Take screenshot of landing page
    console.log('\n[TEST 6] Taking screenshot of landing page...');
    await page.goto('https://www.aevoy.com', { waitUntil: 'networkidle' });
    await page.screenshot({ path: 'vercel-landing-page.png', fullPage: true });
    console.log('✅ Screenshot saved to vercel-landing-page.png');

    // Test 7: Verify Skills API is accessible
    console.log('\n[TEST 7] Testing Skills API...');
    const apiResponse = await page.request.get(
      'https://hissing-verile-aevoy-e721b4a6.koyeb.app/skills/search?q=google&limit=3'
    );

    if (apiResponse.ok()) {
      const data = await apiResponse.json();
      console.log(`✅ Skills API working - Found ${data.totalCount} total skills`);
      console.log(`   First skill: ${data.skills[0]?.name || 'N/A'}`);
    } else {
      console.log(`❌ Skills API failed with status ${apiResponse.status()}`);
    }

    // Test 8: Verify agent health
    console.log('\n[TEST 8] Checking agent health...');
    const healthResponse = await page.request.get(
      'https://hissing-verile-aevoy-e721b4a6.koyeb.app/health'
    );

    if (healthResponse.ok()) {
      const health = await healthResponse.json();
      console.log(`✅ Agent is ${health.status}`);
      console.log(`   Version: ${health.version}`);
      console.log(`   Active tasks: ${health.activeTasks}`);
      console.log(`   Subsystems: ${Object.keys(health.subsystems).filter(k => health.subsystems[k] === 'ok' || health.subsystems[k] === 'configured').length}/${Object.keys(health.subsystems).length} operational`);
    } else {
      console.log(`❌ Agent health check failed with status ${healthResponse.status()}`);
    }

    console.log('\n=== VERIFICATION COMPLETE ===\n');
  });
});
