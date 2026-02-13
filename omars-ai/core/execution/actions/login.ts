/**
 * Login Actions - 10 Fallback Methods
 *
 * Never gives up on login. If one method fails, tries the next.
 * Simplified version for Omar's Personal AI Assistant.
 */

import type { Page } from 'playwright';

export interface LoginParams {
  url: string;
  username: string;
  password: string;
}

export interface LoginResult {
  success: boolean;
  method?: string;
  error?: string;
  redirectUrl?: string;
}

export async function executeLogin(page: Page, params: LoginParams): Promise<LoginResult> {
  const methods: Array<{
    name: string;
    fn: () => Promise<LoginResult>;
  }> = [
    { name: 'standard_form', fn: () => standardFormLogin(page, params) },
    { name: 'two_step', fn: () => twoStepLogin(page, params) },
    { name: 'enter_key', fn: () => enterKeyLogin(page, params) },
    { name: 'tab_navigation', fn: () => tabNavigationLogin(page, params) },
  ];

  for (const method of methods) {
    try {
      console.log(`[LOGIN] Trying method: ${method.name}`);
      const result = await method.fn();
      if (result.success) {
        console.log(`[LOGIN] Success with method: ${method.name}`);
        return { ...result, method: method.name };
      }
      console.log(`[LOGIN] Method ${method.name} failed: ${result.error}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.log(`[LOGIN] Method ${method.name} threw: ${msg}`);
    }
  }

  return { success: false, error: 'All login methods failed' };
}

// Method 1: Standard Form Login
async function standardFormLogin(page: Page, params: LoginParams): Promise<LoginResult> {
  await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1000);

  const usernameSelectors = [
    'input[type="email"]',
    'input[name="email"]',
    'input[name="username"]',
    'input[name="login"]',
    'input[id="email"]',
    'input[id="username"]',
    'input[autocomplete="email"]',
    'input[autocomplete="username"]',
    'input[placeholder*="email" i]',
    'input[placeholder*="username" i]',
  ];

  const passwordSelectors = [
    'input[type="password"]',
    'input[name="password"]',
    'input[id="password"]',
    'input[autocomplete="current-password"]',
  ];

  let filledUsername = false;
  for (const sel of usernameSelectors) {
    const el = page.locator(sel);
    if ((await el.count()) > 0) {
      await el.first().fill(params.username);
      filledUsername = true;
      break;
    }
  }

  if (!filledUsername) {
    return { success: false, error: 'Could not find username field' };
  }

  let filledPassword = false;
  for (const sel of passwordSelectors) {
    const el = page.locator(sel);
    if ((await el.count()) > 0) {
      await el.first().fill(params.password);
      filledPassword = true;
      break;
    }
  }

  if (!filledPassword) {
    return { success: false, error: 'Could not find password field' };
  }

  const submitSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Log in")',
    'button:has-text("Sign in")',
    'button:has-text("Login")',
    'button:has-text("Submit")',
  ];

  for (const sel of submitSelectors) {
    const el = page.locator(sel);
    if ((await el.count()) > 0) {
      const urlBefore = page.url();
      await el.first().click();
      await page.waitForLoadState('networkidle').catch(() => {});
      return await checkLoginSuccess(page, urlBefore);
    }
  }

  return { success: false, error: 'Could not find submit button' };
}

// Method 2: Two-Step Login
async function twoStepLogin(page: Page, params: LoginParams): Promise<LoginResult> {
  await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1000);

  const emailField = page.locator('input[type="email"], input[name="email"], input[name="username"]');
  if ((await emailField.count()) === 0) {
    return { success: false, error: 'No email field for two-step' };
  }

  await emailField.first().fill(params.username);

  const nextSelectors = [
    'button:has-text("Next")',
    'button:has-text("Continue")',
    'button[type="submit"]',
    'input[type="submit"]',
  ];

  let clicked = false;
  for (const sel of nextSelectors) {
    const el = page.locator(sel);
    if ((await el.count()) > 0) {
      await el.first().click();
      clicked = true;
      break;
    }
  }

  if (!clicked) {
    return { success: false, error: 'Could not find Next button' };
  }

  await page.waitForTimeout(2000);

  const passwordField = page.locator('input[type="password"]');
  if ((await passwordField.count()) === 0) {
    return { success: false, error: 'Password field not found after step 1' };
  }

  await passwordField.first().fill(params.password);

  const urlBefore = page.url();
  const submitBtn = page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")');
  if ((await submitBtn.count()) > 0) {
    await submitBtn.first().click();
    await page.waitForLoadState('networkidle').catch(() => {});
    return await checkLoginSuccess(page, urlBefore);
  }

  return { success: false, error: 'Could not submit password in step 2' };
}

// Method 3: Enter Key Submission
async function enterKeyLogin(page: Page, params: LoginParams): Promise<LoginResult> {
  await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1000);

  const emailField = page.locator('input[type="email"], input[name="email"], input[name="username"]');
  if ((await emailField.count()) === 0) {
    return { success: false, error: 'No email field found' };
  }
  await emailField.first().fill(params.username);

  const passwordField = page.locator('input[type="password"]');
  if ((await passwordField.count()) === 0) {
    return { success: false, error: 'No password field found' };
  }
  await passwordField.first().fill(params.password);

  const urlBefore = page.url();
  await passwordField.first().press('Enter');
  await page.waitForLoadState('networkidle').catch(() => {});

  return await checkLoginSuccess(page, urlBefore);
}

// Method 4: Tab Navigation Login
async function tabNavigationLogin(page: Page, params: LoginParams): Promise<LoginResult> {
  await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1000);

  const firstInput = page.locator('input:visible').first();
  if ((await firstInput.count()) === 0) {
    return { success: false, error: 'No visible inputs' };
  }

  await firstInput.click();
  await page.keyboard.type(params.username);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  await page.keyboard.type(params.password);

  const urlBefore = page.url();
  await page.keyboard.press('Enter');

  await page.waitForLoadState('networkidle').catch(() => {});
  return await checkLoginSuccess(page, urlBefore);
}

// Success Check
async function checkLoginSuccess(page: Page, urlBefore?: string): Promise<LoginResult> {
  await page.waitForTimeout(2000);

  const url = page.url();
  const urlLower = url.toLowerCase();

  // Still on login page?
  if (urlLower.includes('/login') || urlLower.includes('/signin') || urlLower.includes('/sign-in')) {
    if (!urlBefore || url === urlBefore) {
      const text = (await page.textContent('body'))?.toLowerCase() || '';
      const errorIndicators = [
        'invalid password', 'incorrect password', 'wrong password',
        'login failed', 'authentication failed', 'invalid credentials',
        'try again', 'account not found',
      ];
      for (const indicator of errorIndicators) {
        if (text.includes(indicator)) {
          return { success: false, error: `Login error: "${indicator}" detected` };
        }
      }
      return { success: false, error: 'Still on login page' };
    }
  }

  // Check for success indicators
  const pageText = (await page.textContent('body'))?.toLowerCase() || '';
  const successIndicators = [
    'dashboard', 'welcome', 'account', 'profile',
    'home', 'inbox', 'feed', 'settings',
  ];

  for (const indicator of successIndicators) {
    if (pageText.includes(indicator)) {
      return { success: true, redirectUrl: url };
    }
  }

  // URL changed away from login
  if (urlBefore && url !== urlBefore) {
    if (!urlLower.includes('login') && !urlLower.includes('signin')) {
      return { success: true, redirectUrl: url };
    }
  }

  return { success: false, error: 'Could not confirm login success' };
}
