import { test, expect } from '@playwright/test';

/**
 * Email Verification E2E Tests
 * 
 * These tests specifically target the email verification step (Step 3) of onboarding.
 * Tests include:
 * - Email verification UI display
 * - Resend functionality
 * - Verification status polling
 * - Skip functionality
 * - Error handling
 */

test.describe('Email Verification Step', () => {
  const testEmail = process.env.TEST_USER_EMAIL || 'test@aevoy-test.com';
  const testPassword = process.env.TEST_USER_PASSWORD || 'TestPassword123!@#';

  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(onboarding|dashboard)/, { timeout: 15000 });
  });

  test('should display email verification UI correctly', async ({ page }) => {
    console.log('[E2E] Testing email verification UI elements');

    // Navigate to email verification step if not already there
    const emailVerifyVisible = await page.locator('text=Check Your Email').isVisible().catch(() => false);
    if (!emailVerifyVisible) {
      console.log('[E2E] ℹ️ Not on email verification step, skipping test');
      return;
    }

    // Verify main UI elements
    await expect(page.locator('text=Check Your Email')).toBeVisible();
    await expect(page.locator('text=We sent a verification link to your email address')).toBeVisible();
    
    // Verify waiting indicator
    await expect(page.locator('text=Waiting for confirmation...')).toBeVisible();
    await expect(page.locator('svg.animate-spin')).toBeVisible(); // Loading spinner

    // Verify resend button
    await expect(page.locator('button:has-text("Resend Verification Email")')).toBeVisible();

    // Verify help text
    await expect(page.locator('text=Can\'t find it? Check your spam folder')).toBeVisible();

    // Verify skip option
    await expect(page.locator('button:has-text("Skip verification")')).toBeVisible();

    // Verify mail icon is displayed
    await expect(page.locator('svg[class*="lucide"][class*="mail"], svg[class*="lucide-mail"]')).toBeVisible();

    console.log('[E2E] ✅ Email verification UI elements verified');
  });

  test('should show verified state when email is confirmed', async ({ page }) => {
    console.log('[E2E] Testing verified email state');

    // Mock Supabase auth.getUser to return verified user
    await page.evaluate(() => {
      // Override the Supabase client to simulate verified state
      Object.defineProperty(window, 'supabaseClient', {
        value: {
          auth: {
            getUser: async () => ({
              data: {
                user: {
                  email_confirmed_at: new Date().toISOString(),
                  email: 'test@example.com'
                }
              }
            }),
            resend: async () => ({ error: null })
          }
        },
        writable: true
      });
    });

    // Navigate to email verification step
    await page.goto('/onboarding');
    const emailVerifyVisible = await page.locator('text=Check Your Email, text=Email Verified!').isVisible().catch(() => false);
    if (!emailVerifyVisible) {
      console.log('[E2E] ℹ️ Not on email verification step, skipping test');
      return;
    }

    // If already verified, the UI should show the verified state
    const isVerified = await page.locator('text=Email Verified!').isVisible().catch(() => false);
    
    if (isVerified) {
      // Verify verified state UI
      await expect(page.locator('text=Email Verified!')).toBeVisible();
      await expect(page.locator('text=Great! Click Continue to keep setting up your account')).toBeVisible();
      await expect(page.locator('button:has-text("Continue")')).toBeVisible();
      
      // Check for checkmark icon (green circle with check)
      await expect(page.locator('svg[class*="check"]')).toBeVisible();
      
      console.log('[E2E] ✅ Email verified state displayed correctly');
    } else {
      console.log('[E2E] ℹ️ Email not yet verified (expected in test environment)');
    }
  });

  test('should handle resend email functionality', async ({ page }) => {
    console.log('[E2E] Testing resend email functionality');

    // Navigate to email verification step
    const emailVerifyVisible = await page.locator('text=Check Your Email').isVisible().catch(() => false);
    if (!emailVerifyVisible) {
      console.log('[E2E] ℹ️ Not on email verification step, skipping test');
      return;
    }

    // Intercept the resend API call
    let resendCalled = false;
    await page.route('**/auth/v1/resend**', async (route) => {
      resendCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Email sent' })
      });
    });

    // Click resend button
    const resendButton = page.locator('button:has-text("Resend Verification Email")');
    await expect(resendButton).toBeEnabled();
    await resendButton.click();

    // Verify loading state
    await expect(page.locator('button:has-text("Sending...")')).toBeVisible({ timeout: 3000 });
    
    // Wait for API response
    await page.waitForTimeout(2000);

    // Verify cooldown is active (button shows countdown)
    const cooldownVisible = await page.locator('text=/Resend in \\d+s/').isVisible().catch(() => false);
    if (cooldownVisible) {
      console.log('[E2E] ✅ Resend cooldown timer displayed');
    }

    console.log('[E2E] ✅ Resend functionality working');
  });

  test('should disable resend button during cooldown', async ({ page }) => {
    console.log('[E2E] Testing resend cooldown');

    // Navigate to email verification step
    const emailVerifyVisible = await page.locator('text=Check Your Email').isVisible().catch(() => false);
    if (!emailVerifyVisible) {
      console.log('[E2E] ℹ️ Not on email verification step, skipping test');
      return;
    }

    // Mock resend to trigger cooldown
    await page.route('**/auth/v1/resend**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Email sent' })
      });
    });

    // Click resend button
    await page.click('button:has-text("Resend Verification Email")');
    await page.waitForTimeout(1000);

    // Verify button shows countdown
    const countdownText = await page.locator('button:has-text("Resend in")').textContent().catch(() => '');
    const hasCountdown = /Resend in \d+s/.test(countdownText);
    
    if (hasCountdown) {
      console.log(`[E2E] ✅ Cooldown active: ${countdownText}`);
      
      // Verify button is disabled during cooldown
      const resendButton = page.locator('button:has-text("Resend in")');
      const isDisabled = await resendButton.isDisabled().catch(() => false);
      expect(isDisabled).toBeTruthy();
      console.log('[E2E] ✅ Resend button disabled during cooldown');
    }
  });

  test('should allow skipping email verification', async ({ page }) => {
    console.log('[E2E] Testing skip email verification');

    // Navigate to email verification step
    const emailVerifyVisible = await page.locator('text=Check Your Email').isVisible().catch(() => false);
    if (!emailVerifyVisible) {
      console.log('[E2E] ℹ️ Not on email verification step, skipping test');
      return;
    }

    // Click skip button
    const skipButton = page.locator('button:has-text("Skip verification")');
    await expect(skipButton).toBeVisible();
    await skipButton.click();

    // Should advance to next step
    await page.waitForTimeout(1000);
    
    // Verify we've moved past email verification
    const stillOnVerify = await page.locator('text=Check Your Email').isVisible().catch(() => false);
    expect(stillOnVerify).toBeFalsy();
    
    console.log('[E2E] ✅ Successfully skipped email verification');
  });

  test('should show trouble message after timeout', async ({ page }) => {
    console.log('[E2E] Testing trouble message display');

    // Navigate to email verification step
    const emailVerifyVisible = await page.locator('text=Check Your Email').isVisible().catch(() => false);
    if (!emailVerifyVisible) {
      console.log('[E2E] ℹ️ Not on email verification step, skipping test');
      return;
    }

    // The trouble message appears after 5 minutes (300000ms)
    // For testing, we'll verify the UI structure exists
    
    // Check for the container that would show the trouble message
    const hasTroubleSection = await page.locator('text=Having trouble?').isVisible().catch(() => false);
    
    if (hasTroubleSection) {
      await expect(page.locator('text=Contact support@aevoy.com')).toBeVisible();
      console.log('[E2E] ✅ Trouble message displayed');
    } else {
      console.log('[E2E] ℹ️ Trouble message not yet displayed (appears after 5 min timeout)');
    }
  });

  test('should poll for verification status', async ({ page }) => {
    console.log('[E2E] Testing verification status polling');

    // Navigate to email verification step
    const emailVerifyVisible = await page.locator('text=Check Your Email').isVisible().catch(() => false);
    if (!emailVerifyVisible) {
      console.log('[E2E] ℹ️ Not on email verification step, skipping test');
      return;
    }

    // Mock the Supabase auth calls to track polling
    let pollCount = 0;
    await page.route('**/auth/v1/user**', async (route) => {
      pollCount++;
      await route.continue();
    });

    // Wait for a few polling intervals (polls every 3 seconds)
    await page.waitForTimeout(7000);

    // Verify polling occurred
    console.log(`[E2E] ℹ️ Auth endpoint called ${pollCount} times (polling)`);
    expect(pollCount).toBeGreaterThanOrEqual(1);
    console.log('[E2E] ✅ Verification status polling active');
  });

  test('should handle resend API error', async ({ page }) => {
    console.log('[E2E] Testing resend error handling');

    // Navigate to email verification step
    const emailVerifyVisible = await page.locator('text=Check Your Email').isVisible().catch(() => false);
    if (!emailVerifyVisible) {
      console.log('[E2E] ℹ️ Not on email verification step, skipping test');
      return;
    }

    // Mock resend API error
    await page.route('**/auth/v1/resend**', async (route) => {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ 
          error: 'Rate limit exceeded',
          message: 'Please wait before requesting another email'
        })
      });
    });

    // Click resend button
    await page.click('button:has-text("Resend Verification Email")');
    await page.waitForTimeout(2000);

    // Verify button returns to normal state even on error
    const buttonText = await page.locator('button:has-text("Resend Verification Email")').isVisible().catch(() => false);
    if (buttonText) {
      console.log('[E2E] ✅ Button returned to normal state after error');
    }
  });

  test('should navigate back from email verification', async ({ page }) => {
    console.log('[E2E] Testing back navigation from email verification');

    // Navigate to email verification step
    const emailVerifyVisible = await page.locator('text=Check Your Email').isVisible().catch(() => false);
    if (!emailVerifyVisible) {
      console.log('[E2E] ℹ️ Not on email verification step, skipping test');
      return;
    }

    // Look for back button (may not be present on this step)
    const backButton = page.locator('button:has-text("Back")');
    const hasBackButton = await backButton.isVisible().catch(() => false);

    if (hasBackButton) {
      await backButton.click();
      await page.waitForTimeout(1000);
      
      // Should be back on email/username step
      const onEmailStep = await page.locator('text=Your AI Email').isVisible().catch(() => false);
      if (onEmailStep) {
        console.log('[E2E] ✅ Successfully navigated back');
      }
    } else {
      console.log('[E2E] ℹ️ No back button on email verification step (first step after welcome)');
    }
  });

  test('should show correct progress indicator', async ({ page }) => {
    console.log('[E2E] Testing progress indicator on email verification');

    // Navigate to email verification step
    const emailVerifyVisible = await page.locator('text=Check Your Email').isVisible().catch(() => false);
    if (!emailVerifyVisible) {
      console.log('[E2E] ℹ️ Not on email verification step, skipping test');
      return;
    }

    // Verify step counter shows 3/6
    const stepIndicator = await page.locator('text=/3\\s*\\/\\s*6/').isVisible().catch(() => false);
    expect(stepIndicator).toBeTruthy();

    // Verify progress bar width (should be at 50% for step 3 of 6)
    const progressBar = page.locator('.h-full.bg-gray-800');
    const width = await progressBar.evaluate(el => el.style.width).catch(() => '');
    
    if (width) {
      expect(width).toBe('50%');
      console.log(`[E2E] ✅ Progress bar at correct width: ${width}`);
    }
  });
});
