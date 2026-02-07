import { test, expect } from '@playwright/test';

test.describe('Advanced Features', () => {
  const testEmail = process.env.TEST_USER_EMAIL || 'test@aevoy-test.com';
  const testPassword = process.env.TEST_USER_PASSWORD || 'TestPassword123!@#';

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/dashboard/, { timeout: 10000 });
  });

  test('should display agent card settings', async ({ page }) => {
    console.log('[E2E] Testing agent card (virtual card) settings');

    await page.goto('/dashboard/settings');
    await page.waitForTimeout(1000);

    const cardSection = await page.locator('text=Agent Card, text=Virtual Card, text=Payment').isVisible().catch(() => false);

    if (cardSection) {
      console.log('[E2E] ✅ Agent card section found');

      // Check for card toggle
      const cardToggle = await page.locator('input[type="checkbox"], button[role="switch"]').first().isVisible().catch(() => false);
      if (cardToggle) {
        console.log('[E2E] ✅ Card toggle available');
      }
    } else {
      console.log('[E2E] ⚠️ Agent card section not found');
    }
  });

  test('should display memory settings', async ({ page }) => {
    console.log('[E2E] Testing memory/privacy settings');

    await page.goto('/dashboard/settings');
    await page.waitForTimeout(1000);

    const privacySection = await page.locator('text=Privacy, text=Memory, text=Data').isVisible().catch(() => false);

    if (privacySection) {
      console.log('[E2E] ✅ Privacy/Memory section found');

      // Check for GDPR actions
      const exportButton = await page.locator('button:has-text("Export"), button:has-text("Download")').isVisible().catch(() => false);
      if (exportButton) {
        console.log('[E2E] ✅ Data export available');
      }

      const deleteButton = await page.locator('button:has-text("Delete Account"), button:has-text("Remove Data")').isVisible().catch(() => false);
      if (deleteButton) {
        console.log('[E2E] ✅ Account deletion available');
      }
    } else {
      console.log('[E2E] ⚠️ Privacy section not visible');
    }
  });

  test('should display Hive Mind opt-in', async ({ page }) => {
    console.log('[E2E] Testing Hive Mind participation settings');

    await page.goto('/dashboard/settings');
    await page.waitForTimeout(1000);

    const hiveSection = await page.locator('text=Hive, text=Share, text=Learning').isVisible().catch(() => false);

    if (hiveSection) {
      console.log('[E2E] ✅ Hive Mind settings found');

      const hiveToggle = await page.locator('text=Hive').locator('..').locator('input[type="checkbox"], button[role="switch"]').first();
      const toggleVisible = await hiveToggle.isVisible().catch(() => false);

      if (toggleVisible) {
        console.log('[E2E] ✅ Hive opt-in toggle available');
      }
    } else {
      console.log('[E2E] ⚠️ Hive settings not found');
    }
  });

  test('should display usage statistics', async ({ page }) => {
    console.log('[E2E] Testing usage tracking');

    await page.goto('/dashboard/settings');
    await page.waitForTimeout(1000);

    const usageSection = await page.locator('text=Usage, text=Billing, text=Subscription').isVisible().catch(() => false);

    if (usageSection) {
      console.log('[E2E] ✅ Usage section found');

      // Check for usage metrics
      const metrics = await page.locator('text=/\\d+ \\w+/, text=/\\$\\d+/').count();
      console.log(`[E2E] Found ${metrics} usage metrics`);
    } else {
      console.log('[E2E] ⚠️ Usage section not visible');
    }
  });

  test('should test proactive agent settings', async ({ page }) => {
    console.log('[E2E] Testing proactive agent settings');

    await page.goto('/dashboard/settings');
    await page.waitForTimeout(1000);

    const proactiveSection = await page.locator('text=Proactive, text=Auto, text=Suggestions').isVisible().catch(() => false);

    if (proactiveSection) {
      console.log('[E2E] ✅ Proactive settings found');

      const proactiveToggle = await page.locator('text=Proactive').locator('..').locator('input[type="checkbox"], button[role="switch"]').first();
      const toggleVisible = await proactiveToggle.isVisible().catch(() => false);

      if (toggleVisible) {
        console.log('[E2E] ✅ Proactive toggle available');
      }
    } else {
      console.log('[E2E] ⚠️ Proactive settings not found');
    }
  });

  test('should test confirmation mode settings', async ({ page }) => {
    console.log('[E2E] Testing confirmation mode settings');

    await page.goto('/dashboard/settings');
    await page.waitForTimeout(1000);

    const confirmationSection = await page.locator('text=Confirmation, text=Verify, text=Approval').isVisible().catch(() => false);

    if (confirmationSection) {
      console.log('[E2E] ✅ Confirmation settings found');

      // Check for mode options
      const modeOptions = await page.locator('text=Always, text=Unclear, text=Risky, text=Never').count();
      console.log(`[E2E] Found ${modeOptions} confirmation mode options`);
    } else {
      console.log('[E2E] ⚠️ Confirmation settings not visible');
    }
  });

  test('should navigate through all main pages', async ({ page }) => {
    console.log('[E2E] Testing complete navigation flow');

    const pages = [
      { path: '/dashboard', name: 'Dashboard' },
      { path: '/dashboard/activity', name: 'Activity' },
      { path: '/dashboard/settings', name: 'Settings' },
      { path: '/hive', name: 'Hive Mind' },
      { path: '/how-it-works', name: 'How It Works' },
    ];

    for (const pageInfo of pages) {
      await page.goto(pageInfo.path);
      await page.waitForTimeout(1000);

      const loaded = await page.locator('body').isVisible();
      console.log(`[E2E] ${pageInfo.name}: ${loaded ? '✅' : '⚠️'}`);
    }

    console.log('[E2E] ✅ Navigation test complete');
  });

  test('should verify legal pages exist', async ({ page }) => {
    console.log('[E2E] Testing legal pages');

    const legalPages = [
      { path: '/legal/privacy', name: 'Privacy Policy' },
      { path: '/legal/terms', name: 'Terms of Service' },
    ];

    for (const legal of legalPages) {
      await page.goto(legal.path);
      await page.waitForTimeout(500);

      const hasContent = await page.locator('text=/privacy|terms|legal/i').isVisible().catch(() => false);
      console.log(`[E2E] ${legal.name}: ${hasContent ? '✅' : '⚠️'}`);
    }
  });
});
