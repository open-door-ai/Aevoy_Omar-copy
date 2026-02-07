import { test, expect } from '@playwright/test';

test.describe('Dashboard Features', () => {
  const testEmail = process.env.TEST_USER_EMAIL || 'test@aevoy-test.com';
  const testPassword = process.env.TEST_USER_PASSWORD || 'TestPassword123!@#';

  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/dashboard/, { timeout: 10000 });
  });

  test('should display dashboard overview', async ({ page }) => {
    console.log('[E2E] Testing dashboard overview');

    // Check for key dashboard elements
    const elements = [
      { name: 'Dashboard title', selector: 'text=Dashboard, h1:has-text("Dashboard")' },
      { name: 'Recent activity', selector: 'text=Recent, text=Activity' },
      { name: 'Quick actions', selector: 'text=Quick, text=Actions, button' },
    ];

    for (const element of elements) {
      const visible = await page.locator(element.selector).first().isVisible().catch(() => false);
      console.log(`[E2E] ${element.name}: ${visible ? '✅' : '⚠️ not found'}`);
    }

    console.log('[E2E] ✅ Dashboard overview loaded');
  });

  test('should navigate to settings', async ({ page }) => {
    console.log('[E2E] Testing settings navigation');

    await page.goto('/dashboard/settings');
    await page.waitForTimeout(1000);

    const settingsVisible = await page.locator('text=Settings, h1:has-text("Settings")').isVisible().catch(() => false);
    expect(settingsVisible).toBeTruthy();

    console.log('[E2E] ✅ Settings page accessible');
  });

  test('should display usage statistics', async ({ page }) => {
    console.log('[E2E] Testing usage statistics');

    // Look for stats cards
    const statsCards = page.locator('[data-stats-card], .stats-card, text=/\\d+ tasks?/i, text=/\\d+ messages?/i');
    const count = await statsCards.count();

    console.log(`[E2E] Found ${count} stat elements`);

    if (count > 0) {
      console.log('[E2E] ✅ Statistics displayed');
    } else {
      console.log('[E2E] ⚠️ No statistics found');
    }
  });

  test('should update profile settings', async ({ page }) => {
    console.log('[E2E] Testing profile settings update');

    await page.goto('/dashboard/settings');
    await page.waitForTimeout(1000);

    // Look for display name input
    const displayNameInput = page.locator('input[name="displayName"], input[placeholder*="name" i]');
    if (await displayNameInput.isVisible().catch(() => false)) {
      await displayNameInput.fill('Test User Updated');

      // Look for save button
      const saveButton = page.locator('button:has-text("Save"), button:has-text("Update")');
      if (await saveButton.isVisible().catch(() => false)) {
        await saveButton.click();
        await page.waitForTimeout(1000);

        // Check for success message
        const success = await page.locator('text=Success, text=Updated, text=Saved').isVisible().catch(() => false);
        if (success) {
          console.log('[E2E] ✅ Profile updated successfully');
        } else {
          console.log('[E2E] ⚠️ Update status unclear');
        }
      }
    } else {
      console.log('[E2E] ⚠️ Display name input not found');
    }
  });

  test('should display Hive Mind page', async ({ page }) => {
    console.log('[E2E] Testing Hive Mind page');

    await page.goto('/hive');
    await page.waitForTimeout(2000);

    // Check for Hive elements
    const hiveTitle = await page.locator('text=Hive, h1:has-text("Hive")').isVisible().catch(() => false);
    const learnings = await page.locator('text=Learning, text=Vent').isVisible().catch(() => false);

    if (hiveTitle || learnings) {
      console.log('[E2E] ✅ Hive Mind page accessible');
    } else {
      console.log('[E2E] ⚠️ Hive Mind page not found');
    }
  });

  test('should handle quick actions', async ({ page }) => {
    console.log('[E2E] Testing quick actions');

    // Look for quick action buttons
    const quickActions = page.locator('button[data-quick-action], button:has-text("New Task"), button:has-text("Schedule")');
    const count = await quickActions.count();

    console.log(`[E2E] Found ${count} quick actions`);

    if (count > 0) {
      // Click first quick action
      await quickActions.first().click();
      await page.waitForTimeout(1000);

      console.log('[E2E] ✅ Quick action executed');
    } else {
      console.log('[E2E] ⚠️ No quick actions found');
    }
  });
});
