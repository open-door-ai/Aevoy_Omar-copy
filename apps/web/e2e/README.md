# E2E Test Documentation

## Overview

This directory contains comprehensive Playwright E2E tests for the Aevoy onboarding flow and other features.

## Test Files

### 1. `onboarding.spec.ts`
**Main comprehensive onboarding flow tests**

Tests the complete 6-step onboarding journey:
- Step 1: Welcome (animated intro)
- Step 2: Email/Username selection
- Step 3: Email Verification
- Step 4: Phone Verification
- Step 5: Interview (preference collection)
- Step 6: Tour (dashboard walkthrough)

**Test Coverage:**
- Full signup flow
- Each onboarding step navigation
- Error states and validation
- Back navigation between steps

### 2. `phone-verification.spec.ts`
**Phone verification step specific tests**

Focused tests for the phone provisioning functionality:
- UI element verification
- Area code validation (3 digits required)
- API call verification (with mocking)
- Loading states during provisioning
- Error handling for invalid area codes
- Skip functionality
- Back navigation

### 3. `email-verification.spec.ts`
**Email verification step specific tests**

Focused tests for the email verification functionality:
- UI element verification
- Verified vs unverified states
- Resend email functionality
- Cooldown timer (60 seconds)
- Skip functionality
- Polling for verification status
- Error handling

### 4. `auth.spec.ts`
**Authentication flow tests**

Existing tests covering:
- Signup flow
- Login flow
- Logout functionality
- Invalid credentials handling
- Basic onboarding completion

### 5. Other Test Files
- `dashboard.spec.ts` - Dashboard features
- `integration.spec.ts` - External integrations
- `advanced.spec.ts` - Advanced settings
- `skills.spec.ts` - Skills library
- `tasks.spec.ts` - Task management
- `system.spec.ts` - System features

## Running Tests

### Run all E2E tests
```bash
pnpm --filter web e2e
```

### Run specific test file
```bash
pnpm --filter web e2e -- onboarding.spec.ts
```

### Run tests in headed mode (visible browser)
```bash
pnpm --filter web e2e:headed
```

### Run tests with UI mode (for debugging)
```bash
pnpm --filter web e2e:ui
```

### Run tests in debug mode
```bash
pnpm --filter web e2e:debug
```

### Show test report
```bash
pnpm --filter web e2e:report
```

## Environment Variables

Create a `.env` file in `/apps/web/` with:

```env
# Test credentials (optional - tests will use defaults if not set)
TEST_USER_EMAIL=test@aevoy-test.com
TEST_USER_PASSWORD=TestPassword123!@#

# Base URL (optional - defaults to production)
PLAYWRIGHT_BASE_URL=https://www.aevoy.com

# Run in headed mode (optional - defaults to headless)
HEADLESS=false
```

## Configuration

The Playwright configuration is in `/apps/web/playwright.config.ts`:

- **Base URL**: Production (https://www.aevoy.com)
- **Screenshots**: Captured on failure
- **Videos**: Recorded on failure
- **Trace**: Captured on first retry
- **Browsers**: Chromium (Desktop Chrome)
- **Viewport**: 1280x720

## Test Selectors

The tests use the following selector strategies:

### Preferred Selectors (in order)
1. `data-testid` attributes (when available)
2. Text content: `text=Button Label`
3. HTML attributes: `input[type="email"]`
4. CSS/ID selectors: `input#username`, `button:has-text("Continue")`

### Component-Specific Selectors

#### Onboarding Flow
```typescript
// Step 1: Welcome
'text=Welcome to Aevoy'
'button:has-text("Skip intro")'
'button:has-text("Continue")'

// Step 2: Email/Username
'text=Your AI Email'
'input#username'
'text=Available!'
'text=at least 3 characters' // Error message

// Step 3: Email Verification
'text=Check Your Email'
'text=Waiting for confirmation...'
'text=Email Verified!' // After verification
'button:has-text("Resend Verification Email")'
'text=/Resend in \\d+s/' // Cooldown timer
'button:has-text("Skip verification")'

// Step 4: Phone Verification
'text=Your AI Phone'
'input#areaCode'
'text=Voice + SMS enabled' // After provisioning
'button:has-text("Get My Phone Number")'
'text=Provisioning...' // Loading state
'button:has-text("Skip for now")'

// Step 5: Interview
'text=Help Your AI Know You'
'text=Phone Call Interview'
'text=Email Questionnaire'
'text=Quick Basics'
'text=Are you sure you want to skip?' // Warning modal
'button:has-text("Yes, skip anyway")'

// Step 6: Tour
'text=Your Dashboard'
'text=Ready to send your first task?'
'text=Go to Dashboard'

// Navigation
'button:has-text("Back")'
'button:has-text("Continue")'
'button:has-text("Next")'
'button:has-text("Finish")'

// Progress
'text=/\\d+\\s*\\/\\s*6/' // Step counter (e.g., "3 / 6")
'.h-full.bg-gray-800' // Progress bar
```

#### Authentication
```typescript
'input[type="email"]'
'input[type="password"]'
'button[type="submit"]'
'text=Invalid' // Error message
```

## Recommended Data-Testid Additions

For more robust tests, consider adding these `data-testid` attributes to components:

### `/components/onboarding/step-welcome.tsx`
```tsx
<button data-testid="skip-intro-button" onClick={onNext}>
<button data-testid="continue-welcome-button" onClick={onNext}>
```

### `/components/onboarding/step-email.tsx`
```tsx
<Input data-testid="username-input" id="username" ... />
<div data-testid="availability-indicator">
<Button data-testid="continue-email-button" ...>
```

### `/components/onboarding/step-email-verification.tsx`
```tsx
<div data-testid="email-verification-container">
<div data-testid="verification-status">
  {isVerified ? 'verified' : 'pending'}
</div>
<Button data-testid="resend-email-button" ...>
<Button data-testid="skip-verification-button" ...>
```

### `/components/onboarding/step-phone.tsx`
```tsx
<Input data-testid="area-code-input" id="areaCode" ... />
<Button data-testid="provision-phone-button" ...>
<Button data-testid="skip-phone-button" ...>
<div data-testid="phone-number-display">
```

### `/components/onboarding/step-interview.tsx`
```tsx
<button data-testid="phone-interview-option" ...>
<button data-testid="email-questionnaire-option" ...>
<button data-testid="quick-basics-option" ...>
<div data-testid="skip-warning-modal">
<Button data-testid="confirm-skip-button" ...>
<Button data-testid="cancel-skip-button" ...>
```

### `/components/onboarding/step-tour.tsx`
```tsx
<div data-testid="tour-step-indicator">
<Button data-testid="tour-previous-button" ...>
<Button data-testid="tour-next-button" ...>
<Button data-testid="tour-skip-button" ...>
<Button data-testid="go-to-dashboard-button" ...>
```

### `/components/onboarding/onboarding-flow.tsx`
```tsx
<div data-testid="onboarding-container">
<div data-testid="progress-bar">
<div data-testid="step-counter">
```

## Mocking External APIs

Tests mock the following APIs:

### Supabase Auth
```typescript
// Mock user verification status
await page.evaluate(() => {
  window.supabaseClient = {
    auth: {
      getUser: async () => ({
        data: { user: { email_confirmed_at: new Date().toISOString() } }
      }),
      resend: async () => ({ error: null })
    }
  };
});
```

### Phone Provisioning API
```typescript
await page.route('/api/phone', async (route, request) => {
  if (request.method() === 'POST') {
    await route.fulfill({
      status: 200,
      body: JSON.stringify({ phone: '+1 (415) 555-0123', status: 'active' })
    });
  }
});
```

## Best Practices

1. **Use unique test data**: Each test run generates unique usernames/emails to avoid conflicts
2. **Wait for animations**: Use `page.waitForTimeout()` for UI transitions
3. **Check visibility before interaction**: Use `isVisible().catch(() => false)` pattern
4. **Mock external APIs**: Prevent actual API calls during testing
5. **Clean up**: Tests should not leave test data in production

## Troubleshooting

### Tests timing out
- Increase `actionTimeout` and `navigationTimeout` in playwright.config.ts
- Check network connection to production
- Verify TEST_USER_EMAIL and TEST_USER_PASSWORD are correct

### Flaky tests
- Add more wait conditions
- Increase retry count in config
- Check for race conditions in UI animations

### Screenshots/videos not captured
- Ensure `screenshot: 'only-on-failure'` and `video: 'retain-on-failure'` are set
- Check output directory permissions
- Run tests with `--headed` flag to see what's happening

## CI/CD Integration

For CI environments, set:
```bash
CI=true
HEADLESS=true
```

This will:
- Run tests in parallel where possible
- Retry failed tests up to 2 times
- Capture traces on first retry
- Generate HTML reports
