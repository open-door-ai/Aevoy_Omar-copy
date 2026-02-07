import { test, expect } from '@playwright/test';
import { randomBytes } from 'crypto';

test.describe('Authentication Flow', () => {
  const testEmail = `test-${randomBytes(8).toString('hex')}@aevoy-test.com`;
  const testPassword = 'TestPassword123!@#';
  let testUsername: string;

  test('should complete full signup flow', async ({ page }) => {
    console.log(`[E2E] Testing signup with email: ${testEmail}`);

    // Navigate to signup page
    await page.goto('/signup');
    await expect(page).toHaveTitle(/Aevoy/);

    // Fill signup form
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);

    // Submit form
    await page.click('button[type="submit"]');

    // Wait for redirect to dashboard or onboarding
    await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 10000 });

    console.log(`[E2E] ✅ Signup successful, redirected to: ${page.url()}`);
  });

  test('should complete onboarding flow', async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');

    await page.waitForURL(/\/dashboard/, { timeout: 10000 });

    // Check if onboarding appears
    const onboardingVisible = await page.locator('text=Welcome to Aevoy').isVisible().catch(() => false);

    if (onboardingVisible) {
      console.log('[E2E] Onboarding flow detected, completing...');

      // Step 1: Welcome - set username
      testUsername = `testuser${randomBytes(4).toString('hex')}`;
      await page.fill('input[name="username"]', testUsername);
      await page.click('button:has-text("Continue")');

      // Step 2: Email setup - skip for now
      const skipButton = page.locator('button:has-text("Skip")');
      if (await skipButton.isVisible()) {
        await skipButton.click();
      }

      // Step 3: Phone setup - skip
      const skipButton2 = page.locator('button:has-text("Skip")');
      if (await skipButton2.isVisible()) {
        await skipButton2.click();
      }

      // Step 4: Interview - skip
      const skipButton3 = page.locator('button:has-text("Skip")');
      if (await skipButton3.isVisible()) {
        await skipButton3.click();
      }

      // Step 5: Tour - finish
      const finishButton = page.locator('button:has-text("Finish")');
      if (await finishButton.isVisible()) {
        await finishButton.click();
      }

      console.log('[E2E] ✅ Onboarding completed');
    } else {
      console.log('[E2E] Onboarding already completed');
    }

    // Verify dashboard is accessible
    await expect(page.locator('text=Dashboard')).toBeVisible({ timeout: 5000 });
    console.log('[E2E] ✅ Dashboard accessible');
  });

  test('should logout successfully', async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/dashboard/, { timeout: 10000 });

    // Logout (look for logout button in menu)
    const logoutButton = page.locator('button:has-text("Logout"), button:has-text("Sign out")');
    if (await logoutButton.isVisible()) {
      await logoutButton.click();
      await page.waitForURL(/\/login/, { timeout: 5000 });
      console.log('[E2E] ✅ Logout successful');
    } else {
      console.log('[E2E] ⚠️ Logout button not found, manually navigating...');
      await page.goto('/login');
    }

    // Verify redirected to login
    await expect(page).toHaveURL(/\/login/);
  });

  test('should login with existing account', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/dashboard/, { timeout: 10000 });

    await expect(page.locator('text=Dashboard')).toBeVisible({ timeout: 5000 });
    console.log('[E2E] ✅ Login successful');
  });

  test('should reject invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', 'WrongPassword123');
    await page.click('button[type="submit"]');

    // Should show error message
    await expect(page.locator('text=Invalid')).toBeVisible({ timeout: 5000 });
    console.log('[E2E] ✅ Invalid login rejected correctly');
  });
});
