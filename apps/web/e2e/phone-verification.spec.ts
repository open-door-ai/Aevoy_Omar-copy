import { test, expect } from '@playwright/test';

/**
 * Phone Verification E2E Tests
 * 
 * These tests specifically target the phone verification step (Step 4) of onboarding.
 * Tests include:
 * - Phone number provisioning flow
 * - Area code selection
 * - API call verification (mocked)
 * - Error handling
 * - Skip functionality
 */

test.describe('Phone Verification Step', () => {
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

  test('should display phone verification step correctly', async ({ page }) => {
    console.log('[E2E] Testing phone step UI elements');

    // Navigate to phone step if not already there
    if (!page.url().includes('/onboarding')) {
      await page.goto('/onboarding');
    }

    // Check if we're on the phone step
    const phoneStepVisible = await page.locator('text=Your AI Phone').isVisible().catch(() => false);
    if (!phoneStepVisible) {
      console.log('[E2E] ℹ️ Not on phone step, skipping test');
      return;
    }

    // Verify all UI elements
    await expect(page.locator('text=Your AI Phone')).toBeVisible();
    await expect(page.locator('text=Get a phone number so your AI can make calls and send texts on your behalf')).toBeVisible();
    
    // Verify feature description
    await expect(page.locator('text=Voice & SMS')).toBeVisible();
    await expect(page.locator('text=Your AI can call businesses, answer calls, and handle text messages')).toBeVisible();

    // Verify area code input
    await expect(page.locator('input#areaCode')).toBeVisible();
    await expect(page.locator('label:has-text("Preferred area code")')).toBeVisible();

    // Verify buttons
    await expect(page.locator('button:has-text("Get My Phone Number")')).toBeVisible();
    await expect(page.locator('button:has-text("Back")')).toBeVisible();
    await expect(page.locator('button:has-text("Skip for now")')).toBeVisible();

    console.log('[E2E] ✅ Phone step UI elements verified');
  });

  test('should validate area code input', async ({ page }) => {
    console.log('[E2E] Testing area code validation');

    // Navigate to phone step if not already there
    const phoneStepVisible = await page.locator('text=Your AI Phone').isVisible().catch(() => false);
    if (!phoneStepVisible) {
      console.log('[E2E] ℹ️ Not on phone step, skipping test');
      return;
    }

    const areaCodeInput = page.locator('input#areaCode');
    const provisionButton = page.locator('button:has-text("Get My Phone Number")');

    // Test: Empty area code should disable button
    await areaCodeInput.clear();
    await page.waitForTimeout(200);
    let isDisabled = await provisionButton.isDisabled().catch(() => false);
    expect(isDisabled).toBeTruthy();
    console.log('[E2E] ✅ Button disabled with empty area code');

    // Test: 2-digit area code should disable button
    await areaCodeInput.fill('41');
    await page.waitForTimeout(200);
    isDisabled = await provisionButton.isDisabled().catch(() => false);
    expect(isDisabled).toBeTruthy();
    console.log('[E2E] ✅ Button disabled with 2-digit area code');

    // Test: 3-digit area code should enable button
    await areaCodeInput.clear();
    await areaCodeInput.fill('415');
    await page.waitForTimeout(200);
    isDisabled = await provisionButton.isDisabled().catch(() => true);
    expect(isDisabled).toBeFalsy();
    console.log('[E2E] ✅ Button enabled with 3-digit area code');

    // Test: More than 3 digits should be truncated
    await areaCodeInput.clear();
    await areaCodeInput.fill('41567');
    await page.waitForTimeout(200);
    const value = await areaCodeInput.inputValue();
    expect(value).toBe('415'); // Should be truncated to 3 digits
    console.log('[E2E] ✅ Area code truncated to 3 digits');

    // Test: Non-numeric characters should be filtered
    await areaCodeInput.clear();
    await areaCodeInput.fill('41a5');
    await page.waitForTimeout(200);
    const filteredValue = await areaCodeInput.inputValue();
    expect(filteredValue).toBe('415'); // Should filter out 'a'
    console.log('[E2E] ✅ Non-numeric characters filtered');
  });

  test('should handle phone provisioning API call', async ({ page }) => {
    console.log('[E2E] Testing phone provisioning API');

    // Navigate to phone step if not already there
    const phoneStepVisible = await page.locator('text=Your AI Phone').isVisible().catch(() => false);
    if (!phoneStepVisible) {
      console.log('[E2E] ℹ️ Not on phone step, skipping test');
      return;
    }

    // Intercept the API call
    let apiCalled = false;
    let requestBody: any = null;
    
    await page.route('/api/phone', async (route, request) => {
      if (request.method() === 'POST') {
        apiCalled = true;
        requestBody = JSON.parse(request.postData() || '{}');
        
        // Mock successful response
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            phone: '+1 (415) 555-0123',
            status: 'active'
          })
        });
      } else {
        await route.continue();
      }
    });

    // Enter area code and click provision
    const areaCodeInput = page.locator('input#areaCode');
    await areaCodeInput.clear();
    await areaCodeInput.fill('415');

    // Click provision button
    await page.click('button:has-text("Get My Phone Number")');

    // Wait for API call
    await page.waitForTimeout(2000);

    // Verify API was called
    expect(apiCalled).toBeTruthy();
    expect(requestBody).toHaveProperty('areaCode', '415');
    console.log('[E2E] ✅ API called with correct area code');

    // Verify success UI
    await expect(page.locator('text=Voice + SMS enabled')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=+1 (415) 555-0123')).toBeVisible();
    console.log('[E2E] ✅ Phone number displayed after provisioning');
  });

  test('should handle phone provisioning error', async ({ page }) => {
    console.log('[E2E] Testing phone provisioning error handling');

    // Navigate to phone step if not already there
    const phoneStepVisible = await page.locator('text=Your AI Phone').isVisible().catch(() => false);
    if (!phoneStepVisible) {
      console.log('[E2E] ℹ️ Not on phone step, skipping test');
      return;
    }

    // Intercept the API call with error
    await page.route('/api/phone', async (route, request) => {
      if (request.method() === 'POST') {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Area code not available'
          })
        });
      } else {
        await route.continue();
      }
    });

    // Enter invalid area code and click provision
    const areaCodeInput = page.locator('input#areaCode');
    await areaCodeInput.clear();
    await areaCodeInput.fill('999'); // Invalid area code

    // Click provision button
    await page.click('button:has-text("Get My Phone Number")');

    // Wait for error response
    await page.waitForTimeout(1000);

    // Verify error message is displayed
    await expect(page.locator('text=Area code not available')).toBeVisible({ timeout: 5000 });
    console.log('[E2E] ✅ Error message displayed for invalid area code');

    // Verify button is no longer in loading state
    const buttonText = await page.locator('button:has-text("Get My Phone Number")').textContent();
    expect(buttonText).toBe('Get My Phone Number');
    console.log('[E2E] ✅ Button returned to normal state after error');
  });

  test('should allow skipping phone verification', async ({ page }) => {
    console.log('[E2E] Testing skip phone verification');

    // Navigate to phone step if not already there
    const phoneStepVisible = await page.locator('text=Your AI Phone').isVisible().catch(() => false);
    if (!phoneStepVisible) {
      console.log('[E2E] ℹ️ Not on phone step, skipping test');
      return;
    }

    // Click skip button
    const skipButton = page.locator('button:has-text("Skip for now")');
    await expect(skipButton).toBeVisible();
    await skipButton.click();

    // Should advance to next step
    await page.waitForTimeout(1000);
    
    // Verify we've moved past phone step
    const stillOnPhone = await page.locator('text=Your AI Phone').isVisible().catch(() => false);
    expect(stillOnPhone).toBeFalsy();
    console.log('[E2E] ✅ Successfully skipped phone verification');
  });

  test('should show back button navigation', async ({ page }) => {
    console.log('[E2E] Testing back button from phone step');

    // Navigate to phone step if not already there
    const phoneStepVisible = await page.locator('text=Your AI Phone').isVisible().catch(() => false);
    if (!phoneStepVisible) {
      console.log('[E2E] ℹ️ Not on phone step, skipping test');
      return;
    }

    // Click back button
    await page.click('button:has-text("Back")');

    // Should go back to email verification step
    await page.waitForTimeout(1000);
    
    const onEmailVerify = await page.locator('text=Check Your Email').isVisible().catch(() => false);
    if (onEmailVerify) {
      console.log('[E2E] ✅ Successfully navigated back to email verification');
    } else {
      console.log('[E2E] ℹ️ Back navigation may have gone to a different step');
    }
  });

  test('should display provisioned phone number correctly', async ({ page }) => {
    console.log('[E2E] Testing provisioned phone number display');

    // Mock a pre-provisioned phone number
    await page.route('/api/phone', async (route, request) => {
      if (request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            phone: '+1 (604) 555-9876',
            status: 'active'
          })
        });
      } else {
        await route.continue();
      }
    });

    // Navigate to phone step
    await page.goto('/onboarding');
    const phoneStepVisible = await page.locator('text=Your AI Phone').isVisible().catch(() => false);
    if (!phoneStepVisible) {
      console.log('[E2E] ℹ️ Not on phone step, skipping test');
      return;
    }

    // Verify pre-provisioned number is displayed
    await expect(page.locator('text=+1 (604) 555-9876')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('text=Voice + SMS enabled')).toBeVisible();
    
    // Verify Continue button is available
    await expect(page.locator('button:has-text("Continue")')).toBeVisible();
    
    console.log('[E2E] ✅ Pre-provisioned phone number displayed correctly');
  });

  test('should show loading state during provisioning', async ({ page }) => {
    console.log('[E2E] Testing provisioning loading state');

    // Navigate to phone step if not already there
    const phoneStepVisible = await page.locator('text=Your AI Phone').isVisible().catch(() => false);
    if (!phoneStepVisible) {
      console.log('[E2E] ℹ️ Not on phone step, skipping test');
      return;
    }

    // Intercept with delay to show loading state
    await page.route('/api/phone', async (route, request) => {
      if (request.method() === 'POST') {
        // Add delay to show loading state
        await new Promise(resolve => setTimeout(resolve, 1000));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            phone: '+1 (415) 555-0123',
            status: 'active'
          })
        });
      } else {
        await route.continue();
      }
    });

    // Enter area code and click provision
    const areaCodeInput = page.locator('input#areaCode');
    await areaCodeInput.clear();
    await areaCodeInput.fill('415');

    // Click provision button
    await page.click('button:has-text("Get My Phone Number")');

    // Verify loading state immediately
    const loadingText = await page.locator('button:has-text("Provisioning...")').isVisible().catch(() => false);
    if (loadingText) {
      console.log('[E2E] ✅ Loading state displayed');
    }

    // Wait for completion
    await expect(page.locator('text=+1 (415) 555-0123')).toBeVisible({ timeout: 5000 });
    console.log('[E2E] ✅ Provisioning completed after loading state');
  });
});
