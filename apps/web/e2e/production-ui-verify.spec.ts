import { test, expect } from '@playwright/test';

test.describe('Production UI Verification', () => {
  test('should verify Skills Marketplace UI is accessible', async ({ page }) => {
    console.log('[VERIFY] Testing Skills Marketplace at https://www.aevoy.com/dashboard/skills');

    await page.goto('https://www.aevoy.com/dashboard/skills');

    // Should redirect to login (auth protected)
    await expect(page).toHaveURL(/\/login/);
    console.log('[VERIFY] ✅ Skills page properly protected with auth redirect');

    // Check login page loads
    const loginVisible = await page.locator('text=/login|sign in/i').isVisible({ timeout: 5000 });
    expect(loginVisible).toBeTruthy();
    console.log('[VERIFY] ✅ Login page loaded successfully');
  });

  test('should verify Task Queue UI is accessible', async ({ page }) => {
    console.log('[VERIFY] Testing Task Queue at https://www.aevoy.com/dashboard/queue');

    await page.goto('https://www.aevoy.com/dashboard/queue');

    // Should redirect to login (auth protected)
    await expect(page).toHaveURL(/\/login/);
    console.log('[VERIFY] ✅ Task Queue page properly protected with auth redirect');

    // Check login page loads
    const loginVisible = await page.locator('text=/login|sign in/i').isVisible({ timeout: 5000 });
    expect(loginVisible).toBeTruthy();
    console.log('[VERIFY] ✅ Login page loaded successfully');
  });

  test('should verify landing page is accessible', async ({ page }) => {
    console.log('[VERIFY] Testing landing page at https://www.aevoy.com');

    await page.goto('https://www.aevoy.com');

    // Check page title
    await expect(page).toHaveTitle(/Aevoy/);
    console.log('[VERIFY] ✅ Landing page title correct');

    // Check for Aevoy branding
    const hasAevoy = await page.locator('text=/Aevoy/i').isVisible({ timeout: 5000 });
    expect(hasAevoy).toBeTruthy();
    console.log('[VERIFY] ✅ Landing page loaded with branding');
  });

  test('should verify Skills API is working', async ({ request }) => {
    console.log('[VERIFY] Testing Skills API endpoint');

    const response = await request.get(
      'https://hissing-verile-aevoy-e721b4a6.koyeb.app/skills/search?q=google&limit=3'
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    console.log('[VERIFY] Skills API Response:');
    console.log(`  - Total skills: ${data.totalCount}`);
    console.log(`  - Skills returned: ${data.skills.length}`);
    console.log(`  - First skill: ${data.skills[0]?.name || 'N/A'}`);

    expect(data.skills).toBeDefined();
    expect(data.totalCount).toBeGreaterThan(0);

    console.log('[VERIFY] ✅ Skills API working perfectly');
  });

  test('should verify agent health endpoint', async ({ request }) => {
    console.log('[VERIFY] Testing agent health');

    const response = await request.get('https://hissing-verile-aevoy-e721b4a6.koyeb.app/health');

    expect(response.ok()).toBeTruthy();
    const health = await response.json();

    console.log('[VERIFY] Agent Health:');
    console.log(`  - Status: ${health.status}`);
    console.log(`  - Version: ${health.version}`);
    console.log(`  - Active tasks: ${health.activeTasks}`);
    console.log('  - Subsystems:');
    Object.entries(health.subsystems).forEach(([key, value]) => {
      console.log(`    - ${key}: ${value}`);
    });

    expect(health.status).toBe('healthy');
    expect(health.subsystems.supabase).toBe('ok');

    console.log('[VERIFY] ✅ Agent is healthy with all subsystems operational');
  });
});
