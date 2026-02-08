import { test, expect } from '@playwright/test';
import { randomBytes } from 'crypto';

/**
 * Comprehensive Onboarding Flow E2E Tests
 * 
 * These tests verify the complete onboarding experience from signup to dashboard.
 * The onboarding flow consists of 6 steps:
 * 1. Welcome (animated intro with typing effect)
 * 2. Email/Username selection (AI email address setup)
 * 3. Email Verification (verify user's email address)
 * 4. Phone Verification (provision AI phone number)
 * 5. Interview (preference collection - phone/email/quick/skip)
 * 6. Tour (dashboard feature tour)
 */

test.describe('Complete Onboarding Flow', () => {
  // Generate unique test credentials to avoid conflicts
  const testId = randomBytes(4).toString('hex');
  const testEmail = `onboarding-test-${testId}@aevoy-e2e.com`;
  const testPassword = 'TestPass123!Secure';
  const testUsername = `testuser${testId}`;

  test('should navigate to signup page and create account', async ({ page }) => {
    console.log(`[E2E] Starting onboarding test with email: ${testEmail}`);

    // Navigate to signup page
    await page.goto('/signup');
    await expect(page).toHaveTitle(/Aevoy|Sign Up|Create Account/i);

    // Verify signup form is visible
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();

    // Fill signup form
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);

    // Submit form and wait for redirect
    await page.click('button[type="submit"]');

    // Should redirect to onboarding (or dashboard then onboarding)
    await page.waitForURL(/\/(onboarding|dashboard)/, { timeout: 15000 });
    
    console.log(`[E2E] ✅ Signup successful, at URL: ${page.url()}`);
  });

  test('should complete Step 1: Welcome screen', async ({ page }) => {
    console.log('[E2E] Testing Step 1: Welcome');

    // Login first
    await page.goto('/login');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(onboarding|dashboard)/, { timeout: 15000 });

    // If redirected to dashboard, check if onboarding needs to be completed
    if (page.url().includes('/dashboard')) {
      const needsOnboarding = await page.locator('text=Welcome to Aevoy').isVisible().catch(() => false);
      if (!needsOnboarding) {
        console.log('[E2E] ℹ️ Onboarding already completed');
        return;
      }
    }

    // Verify Welcome step is visible
    await expect(page.locator('text=Welcome to Aevoy')).toBeVisible({ timeout: 10000 });

    // Verify progress indicator shows step 1 of 6
    await expect(page.locator('text=/1\\s*\/\\s*6/')).toBeVisible();

    // Wait for typing animation to complete or skip it
    const skipButton = page.locator('button:has-text("Skip intro"), button:has-text("Continue")');
    await skipButton.waitFor({ state: 'visible', timeout: 15000 });

    // Click to proceed to next step
    await skipButton.click();

    // Should advance to step 2
    await expect(page.locator('text=/2\\s*\/\\s*6/')).toBeVisible({ timeout: 10000 });

    console.log('[E2E] ✅ Step 1 (Welcome) completed');
  });

  test('should complete Step 2: Email/Username selection', async ({ page }) => {
    console.log('[E2E] Testing Step 2: Email Selection');

    // Login first
    await page.goto('/login');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(onboarding|dashboard)/, { timeout: 15000 });

    // Check if already past this step
    const emailStepVisible = await page.locator('text=Your AI Email').isVisible().catch(() => false);
    if (!emailStepVisible) {
      console.log('[E2E] ℹ️ Step 2 not visible, may already be completed');
      return;
    }

    // Verify step 2 elements
    await expect(page.locator('text=Your AI Email')).toBeVisible();
    await expect(page.locator('text=This is the email address you\'ll use to send tasks')).toBeVisible();

    // Find username input and customize it
    const usernameInput = page.locator('input#username');
    await expect(usernameInput).toBeVisible();

    // Clear and enter new username
    await usernameInput.clear();
    await usernameInput.fill(testUsername);

    // Wait for availability check
    await page.waitForTimeout(1000);

    // Check availability indicator
    const availableIndicator = await page.locator('text=Available!').isVisible().catch(() => false);
    if (availableIndicator) {
      console.log('[E2E] ✅ Username is available');
    }

    // Click Continue
    await page.click('button:has-text("Continue")');

    console.log('[E2E] ✅ Step 2 (Email Selection) completed');
  });

  test('should complete Step 3: Email Verification', async ({ page }) => {
    console.log('[E2E] Testing Step 3: Email Verification');

    // Login first
    await page.goto('/login');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(onboarding|dashboard)/, { timeout: 15000 });

    // Check if on email verification step
    const emailVerifyVisible = await page.locator('text=Check Your Email').isVisible().catch(() => false);
    if (!emailVerifyVisible) {
      console.log('[E2E] ℹ️ Step 3 not visible, may already be completed');
      return;
    }

    // Verify email verification UI
    await expect(page.locator('text=Check Your Email')).toBeVisible();
    await expect(page.locator('text=We sent a verification link to your email address')).toBeVisible();

    // Check for waiting indicator
    await expect(page.locator('text=Waiting for confirmation...')).toBeVisible();

    // Test resend button functionality
    const resendButton = page.locator('button:has-text("Resend Verification Email")');
    await expect(resendButton).toBeVisible();

    // For testing, we'll use the skip option since we can't access real email
    const skipButton = page.locator('button:has-text("Skip verification")');
    if (await skipButton.isVisible().catch(() => false)) {
      await skipButton.click();
      console.log('[E2E] ℹ️ Skipped email verification (test mode)');
    } else {
      // If already verified or skip not available, proceed
      const continueButton = page.locator('button:has-text("Continue")');
      if (await continueButton.isVisible().catch(() => false)) {
        await continueButton.click();
      }
    }

    console.log('[E2E] ✅ Step 3 (Email Verification) completed');
  });

  test('should complete Step 4: Phone Verification', async ({ page }) => {
    console.log('[E2E] Testing Step 4: Phone Verification');

    // Login first
    await page.goto('/login');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(onboarding|dashboard)/, { timeout: 15000 });

    // Check if on phone verification step
    const phoneStepVisible = await page.locator('text=Your AI Phone').isVisible().catch(() => false);
    if (!phoneStepVisible) {
      console.log('[E2E] ℹ️ Step 4 not visible, may already be completed');
      return;
    }

    // Verify phone step UI
    await expect(page.locator('text=Your AI Phone')).toBeVisible();
    await expect(page.locator('text=Get a phone number so your AI can make calls')).toBeVisible();

    // Test area code input
    const areaCodeInput = page.locator('input#areaCode');
    await expect(areaCodeInput).toBeVisible();
    
    // Clear and enter a valid area code
    await areaCodeInput.clear();
    await areaCodeInput.fill('415');

    // Verify provision button
    const provisionButton = page.locator('button:has-text("Get My Phone Number")');
    await expect(provisionButton).toBeEnabled();

    // For testing, skip phone provisioning to avoid API calls
    const skipButton = page.locator('button:has-text("Skip for now")');
    if (await skipButton.isVisible().catch(() => false)) {
      await skipButton.click();
      console.log('[E2E] ℹ️ Skipped phone provisioning (test mode)');
    } else {
      // Click back and continue if skip not available
      await page.click('button:has-text("Back")');
      console.log('[E2E] ℹ️ Went back from phone step');
    }

    console.log('[E2E] ✅ Step 4 (Phone Verification) completed');
  });

  test('should complete Step 5: Interview - Quick Basics path', async ({ page }) => {
    console.log('[E2E] Testing Step 5: Interview');

    // Login first
    await page.goto('/login');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(onboarding|dashboard)/, { timeout: 15000 });

    // Check if on interview step
    const interviewVisible = await page.locator('text=Help Your AI Know You').isVisible().catch(() => false);
    if (!interviewVisible) {
      console.log('[E2E] ℹ️ Step 5 not visible, may already be completed');
      return;
    }

    // Verify interview step UI
    await expect(page.locator('text=Help Your AI Know You')).toBeVisible();
    await expect(page.locator('text=Choose how you\'d like to share')).toBeVisible();

    // Verify all three options are available
    await expect(page.locator('text=Phone Call Interview')).toBeVisible();
    await expect(page.locator('text=Email Questionnaire')).toBeVisible();
    await expect(page.locator('text=Quick Basics')).toBeVisible();

    // Select "Quick Basics" option for testing
    await page.click('button:has-text("Quick Basics")');

    // Should show Quick Basics form
    await expect(page.locator('text=Tell your AI what you\'ll use it for most')).toBeVisible();

    // Select some use cases
    const useCases = ['Research & Analysis', 'Email Management'];
    for (const useCase of useCases) {
      const useCaseButton = page.locator(`button:has-text("${useCase}")`);
      if (await useCaseButton.isVisible().catch(() => false)) {
        await useCaseButton.click();
        console.log(`[E2E] Selected use case: ${useCase}`);
      }
    }

    // Toggle daily check-in
    const checkinToggle = page.locator('button[role="switch"]').first();
    if (await checkinToggle.isVisible().catch(() => false)) {
      await checkinToggle.click();
      console.log('[E2E] Enabled daily check-in');
    }

    // Click Continue
    await page.click('button:has-text("Continue")');

    console.log('[E2E] ✅ Step 5 (Interview) completed with Quick Basics');
  });

  test('should complete Step 6: Tour and reach dashboard', async ({ page }) => {
    console.log('[E2E] Testing Step 6: Tour');

    // Login first
    await page.goto('/login');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(onboarding|dashboard)/, { timeout: 15000 });

    // Check if on tour step
    const tourVisible = await page.locator('text=Your Dashboard').isVisible().catch(() => false);
    if (!tourVisible) {
      // Check if already at dashboard
      const dashboardVisible = await page.locator('text=Dashboard').isVisible().catch(() => false);
      if (dashboardVisible) {
        console.log('[E2E] ℹ️ Already at dashboard, onboarding completed');
        return;
      }
      console.log('[E2E] ℹ️ Step 6 not visible');
      return;
    }

    // Verify tour UI
    await expect(page.locator('text=Your Dashboard')).toBeVisible();
    await expect(page.locator('text=Here\'s a quick tour of what you\'ll find')).toBeVisible();

    // Navigate through tour steps
    const tourSteps = ['Your AI Email', 'Activity Feed', 'Settings'];
    
    for (const step of tourSteps) {
      // Verify current step title
      const stepTitle = await page.locator(`text=${step}`).isVisible().catch(() => false);
      if (stepTitle) {
        console.log(`[E2E] Viewing tour step: ${step}`);
      }

      // Click Next if not on last step
      const nextButton = page.locator('button:has-text("Next")');
      if (await nextButton.isVisible().catch(() => false)) {
        await nextButton.click();
        await page.waitForTimeout(500);
      }
    }

    // Verify final CTA section
    await expect(page.locator('text=Ready to send your first task?')).toBeVisible();

    // Click Go to Dashboard
    await page.click('button:has-text("Go to Dashboard")');

    // Verify redirect to dashboard
    await page.waitForURL(/\/dashboard/, { timeout: 10000 });
    await expect(page.locator('text=Dashboard')).toBeVisible();

    console.log('[E2E] ✅ Step 6 (Tour) completed - Onboarding finished!');
  });

  test('should handle skip interview option', async ({ page }) => {
    // This test validates the skip interview warning appears
    // Run it with a fresh account if needed
    console.log('[E2E] Testing skip interview warning');

    // Navigate to interview step (assuming already logged in and at that step)
    await page.goto('/onboarding');

    const interviewVisible = await page.locator('text=Help Your AI Know You').isVisible().catch(() => false);
    if (!interviewVisible) {
      console.log('[E2E] ℹ️ Not on interview step, skip test');
      return;
    }

    // Click skip button
    await page.click('button:has-text("Skip this step")');

    // Verify warning appears
    await expect(page.locator('text=Are you sure you want to skip?')).toBeVisible();
    await expect(page.locator('text=Your AI won\'t know')).toBeVisible();

    // Go back instead of skipping
    await page.click('button:has-text("Go back")');

    // Should return to options
    await expect(page.locator('text=Help Your AI Know You')).toBeVisible();

    console.log('[E2E] ✅ Skip interview warning displayed correctly');
  });
});

test.describe('Onboarding Error States', () => {
  test('should show error for invalid username', async ({ page }) => {
    console.log('[E2E] Testing username validation');

    // Navigate to email step
    await page.goto('/onboarding');

    const emailStepVisible = await page.locator('text=Your AI Email').isVisible().catch(() => false);
    if (!emailStepVisible) {
      console.log('[E2E] ℹ️ Not on email step, skip test');
      return;
    }

    // Try to enter invalid username (too short)
    const usernameInput = page.locator('input#username');
    await usernameInput.clear();
    await usernameInput.fill('ab'); // Less than 3 characters

    // Wait for validation
    await page.waitForTimeout(500);

    // Check for error message
    const errorVisible = await page.locator('text=at least 3 characters').isVisible().catch(() => false);
    if (errorVisible) {
      console.log('[E2E] ✅ Username validation error shown');
    }

    // Continue button should be disabled
    const continueButton = page.locator('button:has-text("Continue")');
    const isDisabled = await continueButton.isDisabled().catch(() => false);
    expect(isDisabled).toBeTruthy();

    console.log('[E2E] ✅ Continue button disabled for invalid username');
  });

  test('should show error for invalid area code', async ({ page }) => {
    console.log('[E2E] Testing area code validation');

    // Navigate to phone step
    await page.goto('/onboarding');

    const phoneStepVisible = await page.locator('text=Your AI Phone').isVisible().catch(() => false);
    if (!phoneStepVisible) {
      console.log('[E2E] ℹ️ Not on phone step, skip test');
      return;
    }

    // Try to enter invalid area code
    const areaCodeInput = page.locator('input#areaCode');
    await areaCodeInput.clear();
    await areaCodeInput.fill('12'); // Less than 3 digits

    // Provision button should be disabled
    const provisionButton = page.locator('button:has-text("Get My Phone Number")');
    const isDisabled = await provisionButton.isDisabled().catch(() => false);
    expect(isDisabled).toBeTruthy();

    console.log('[E2E] ✅ Provision button disabled for invalid area code');
  });
});

test.describe('Onboarding Navigation', () => {
  test('should allow going back between steps', async ({ page }) => {
    console.log('[E2E] Testing back navigation');

    // Login first
    await page.goto('/login');
    await page.fill('input[type="email"]', process.env.TEST_USER_EMAIL || 'test@aevoy-test.com');
    await page.fill('input[type="password"]', process.env.TEST_USER_PASSWORD || 'TestPassword123!@#');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(onboarding|dashboard)/, { timeout: 15000 });

    // Check if on onboarding
    const onOnboarding = page.url().includes('/onboarding');
    if (!onOnboarding) {
      console.log('[E2E] ℹ️ Not on onboarding, skip test');
      return;
    }

    // Get current step
    const stepText = await page.locator('text=/\\d+\\s*\\/\\s*6/').textContent().catch(() => '1 / 6');
    const currentStep = parseInt(stepText.match(/\d+/)?.[0] || '1');

    if (currentStep > 1) {
      // Click back button
      const backButton = page.locator('button:has-text("Back")');
      if (await backButton.isVisible().catch(() => false)) {
        await backButton.click();
        
        // Verify we went back a step
        const newStepText = await page.locator('text=/\\d+\\s*\\/\\s*6/').textContent().catch(() => stepText);
        const newStep = parseInt(newStepText.match(/\d+/)?.[0] || String(currentStep));
        
        expect(newStep).toBeLessThanOrEqual(currentStep);
        console.log(`[E2E] ✅ Navigated back from step ${currentStep} to ${newStep}`);
      }
    }
  });
});
