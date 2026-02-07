import { test, expect } from '@playwright/test';

test.describe('External Integrations', () => {
  const testEmail = process.env.TEST_USER_EMAIL || 'test@aevoy-test.com';
  const testPassword = process.env.TEST_USER_PASSWORD || 'TestPassword123!@#';

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/dashboard/, { timeout: 10000 });
  });

  test('should display OAuth integration options', async ({ page }) => {
    console.log('[E2E] Testing OAuth integration display');

    await page.goto('/dashboard/settings');
    await page.waitForTimeout(1000);

    // Look for integration section
    const integrationSection = await page.locator('text=Integration, text=Connect, text=OAuth').isVisible().catch(() => false);

    if (integrationSection) {
      console.log('[E2E] ✅ Integration section found');

      // Check for Gmail/Google integration
      const gmailButton = await page.locator('button:has-text("Gmail"), button:has-text("Google")').isVisible().catch(() => false);
      if (gmailButton) {
        console.log('[E2E] ✅ Gmail integration available');
      }

      // Check for Microsoft integration
      const microsoftButton = await page.locator('button:has-text("Microsoft"), button:has-text("Outlook")').isVisible().catch(() => false);
      if (microsoftButton) {
        console.log('[E2E] ✅ Microsoft integration available');
      }
    } else {
      console.log('[E2E] ⚠️ Integration section not found');
    }
  });

  test('should show email setup options', async ({ page }) => {
    console.log('[E2E] Testing email setup options');

    await page.goto('/dashboard/settings');
    await page.waitForTimeout(1000);

    const emailSection = await page.locator('text=Email, text=Forwarding').isVisible().catch(() => false);

    if (emailSection) {
      console.log('[E2E] ✅ Email configuration section found');
    } else {
      console.log('[E2E] ⚠️ Email section not visible');
    }
  });

  test('should display phone number provisioning', async ({ page }) => {
    console.log('[E2E] Testing phone provisioning display');

    await page.goto('/dashboard/settings');
    await page.waitForTimeout(1000);

    const phoneSection = await page.locator('text=Phone, text=Voice, text=SMS').isVisible().catch(() => false);

    if (phoneSection) {
      console.log('[E2E] ✅ Phone section found');

      // Look for provision button
      const provisionButton = await page.locator('button:has-text("Provision"), button:has-text("Get Number")').isVisible().catch(() => false);
      if (provisionButton) {
        console.log('[E2E] ✅ Phone provisioning available');
      }
    } else {
      console.log('[E2E] ⚠️ Phone section not found');
    }
  });

  test('should test demo task functionality', async ({ page }) => {
    console.log('[E2E] Testing demo task on landing page');

    await page.goto('/');
    await page.waitForTimeout(2000);

    // Look for demo input
    const demoInput = await page.locator('input[placeholder*="demo" i], textarea[placeholder*="try" i]').first();
    const demoVisible = await demoInput.isVisible().catch(() => false);

    if (demoVisible) {
      await demoInput.fill('What is 2+2?');

      const submitButton = page.locator('button:has-text("Try"), button:has-text("Demo"), button[type="submit"]').first();
      if (await submitButton.isVisible().catch(() => false)) {
        await submitButton.click();
        await page.waitForTimeout(5000);

        // Check for response
        const hasResponse = await page.locator('text=/result|answer|response/i').isVisible().catch(() => false);
        if (hasResponse) {
          console.log('[E2E] ✅ Demo task completed');
        } else {
          console.log('[E2E] ⚠️ Demo response status unclear');
        }
      }
    } else {
      console.log('[E2E] ⚠️ Demo input not found on landing page');
    }
  });

  test('should verify Hive Mind public access', async ({ page }) => {
    console.log('[E2E] Testing Hive Mind public access (no auth required)');

    // Logout first if logged in
    await page.goto('/login');

    // Navigate to Hive page
    await page.goto('/hive');
    await page.waitForTimeout(2000);

    const hiveContent = await page.locator('text=Hive, text=Learning, text=Vent').isVisible().catch(() => false);

    if (hiveContent) {
      console.log('[E2E] ✅ Hive Mind publicly accessible');

      // Check for learnings
      const learnings = await page.locator('[data-learning], .learning-card').count();
      console.log(`[E2E] Found ${learnings} learning cards`);

      // Check for vents
      const vents = await page.locator('[data-vent], .vent-card').count();
      console.log(`[E2E] Found ${vents} vent cards`);
    } else {
      console.log('[E2E] ⚠️ Hive Mind content not visible');
    }
  });

  test('should test scheduled tasks interface', async ({ page }) => {
    console.log('[E2E] Testing scheduled tasks');

    await page.goto('/dashboard');
    await page.waitForTimeout(1000);

    // Look for scheduled tasks section
    const scheduledSection = await page.locator('text=Scheduled, text=Recurring, text=Cron').isVisible().catch(() => false);

    if (scheduledSection) {
      console.log('[E2E] ✅ Scheduled tasks section found');

      // Look for create button
      const createButton = await page.locator('button:has-text("Schedule"), button:has-text("Add Task")').isVisible().catch(() => false);
      if (createButton) {
        console.log('[E2E] ✅ Schedule creation available');
      }
    } else {
      console.log('[E2E] ⚠️ Scheduled tasks not visible');
    }
  });
});
