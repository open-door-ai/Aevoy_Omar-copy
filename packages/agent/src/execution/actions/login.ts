/**
 * Login Actions — 10 Fallback Methods
 *
 * Never gives up on login. If one method fails, tries the next.
 * Methods:
 * 1. Standard form login (username + password fields)
 * 2. Two-step login (email page → password page)
 * 3. Google OAuth flow
 * 4. Magic link detection (check email)
 * 5. Mobile site login (m.site.com)
 * 6. API-based login (direct POST)
 * 7. Cookie injection (from saved session)
 * 8. Enter key submission
 * 9. Tab navigation login (Tab between fields + Enter)
 * 10. Claude Vision-guided login (screenshot analysis)
 */

import type { Page } from "playwright";
import { generateVisionResponse } from "../../services/ai.js";

export interface LoginParams {
  url: string;
  username: string;
  password: string;
  savedCookies?: string; // JSON stringified cookies
}

export interface LoginResult {
  success: boolean;
  method?: string;
  error?: string;
  redirectUrl?: string;
}

/**
 * Attempt login with fallback chain.
 * Tries each method in order until one succeeds.
 */
export async function executeLogin(page: Page, params: LoginParams): Promise<LoginResult> {
  const methods: Array<{
    name: string;
    fn: () => Promise<LoginResult>;
  }> = [
    { name: "standard_form", fn: () => standardFormLogin(page, params) },
    { name: "two_step", fn: () => twoStepLogin(page, params) },
    { name: "enter_key", fn: () => enterKeyLogin(page, params) },
    { name: "tab_navigation", fn: () => tabNavigationLogin(page, params) },
    { name: "mobile_site", fn: () => mobileSiteLogin(page, params) },
    { name: "api_login", fn: () => apiBasedLogin(page, params) },
    { name: "cookie_injection", fn: () => cookieInjectionLogin(page, params) },
    { name: "google_oauth", fn: () => googleOAuthLogin(page, params) },
    { name: "magic_link", fn: () => magicLinkLogin(page, params) },
    { name: "vision_guided", fn: () => visionGuidedLogin(page, params) },
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
      const msg = error instanceof Error ? error.message : "Unknown error";
      console.log(`[LOGIN] Method ${method.name} threw: ${msg}`);
    }
  }

  return { success: false, error: "All 10 login methods failed" };
}

// ---- Method 1: Standard Form Login ----

async function standardFormLogin(page: Page, params: LoginParams): Promise<LoginResult> {
  await page.goto(params.url, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(1000);

  // Common username/email field selectors
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
    return { success: false, error: "Could not find username field" };
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
    return { success: false, error: "Could not find password field" };
  }

  // Find and click submit button
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
      await el.first().click();
      await page.waitForLoadState("networkidle").catch(() => {});
      return await checkLoginSuccess(page);
    }
  }

  return { success: false, error: "Could not find submit button" };
}

// ---- Method 2: Two-Step Login ----

async function twoStepLogin(page: Page, params: LoginParams): Promise<LoginResult> {
  await page.goto(params.url, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(1000);

  // Step 1: Enter email/username
  const emailField = page.locator('input[type="email"], input[name="email"], input[name="username"]');
  if ((await emailField.count()) === 0) {
    return { success: false, error: "No email field for two-step" };
  }

  await emailField.first().fill(params.username);

  // Click next/continue
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
    return { success: false, error: "Could not find Next button" };
  }

  // Wait for password page
  await page.waitForTimeout(2000);

  // Step 2: Enter password
  const passwordField = page.locator('input[type="password"]');
  if ((await passwordField.count()) === 0) {
    return { success: false, error: "Password field not found after step 1" };
  }

  await passwordField.first().fill(params.password);

  // Submit
  const submitBtn = page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")');
  if ((await submitBtn.count()) > 0) {
    await submitBtn.first().click();
    await page.waitForLoadState("networkidle").catch(() => {});
    return await checkLoginSuccess(page);
  }

  return { success: false, error: "Could not submit password in step 2" };
}

// ---- Method 3: Google OAuth ----

async function googleOAuthLogin(page: Page, _params: LoginParams): Promise<LoginResult> {
  // Look for Google sign-in button on the page
  const googleSelectors = [
    'a[href*="accounts.google.com"]',
    'button:has-text("Sign in with Google")',
    'button:has-text("Continue with Google")',
    '[class*="google"] button',
    'div[id="g_id_signin"]',
  ];

  for (const sel of googleSelectors) {
    const el = page.locator(sel);
    if ((await el.count()) > 0) {
      // OAuth requires user interaction — we can detect but not fully automate
      return { success: false, error: "Google OAuth detected but requires user interaction" };
    }
  }

  return { success: false, error: "No Google OAuth option found" };
}

// ---- Method 4: Magic Link ----

async function magicLinkLogin(page: Page, params: LoginParams): Promise<LoginResult> {
  const magicSelectors = [
    'button:has-text("Email me a link")',
    'button:has-text("Magic link")',
    'button:has-text("Send login link")',
    'a:has-text("Email me a link")',
  ];

  for (const sel of magicSelectors) {
    const el = page.locator(sel);
    if ((await el.count()) > 0) {
      // Fill email first
      const emailField = page.locator('input[type="email"], input[name="email"]');
      if ((await emailField.count()) > 0) {
        await emailField.first().fill(params.username);
      }
      await el.first().click();
      return {
        success: false,
        error: "Magic link sent — check email for login link",
      };
    }
  }

  return { success: false, error: "No magic link option found" };
}

// ---- Method 5: Mobile Site Login ----

async function mobileSiteLogin(page: Page, params: LoginParams): Promise<LoginResult> {
  const url = new URL(params.url);
  const mobileUrl = `${url.protocol}//m.${url.hostname}${url.pathname}`;

  try {
    await page.goto(mobileUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
    return await standardFormLogin(page, { ...params, url: mobileUrl });
  } catch {
    return { success: false, error: "Mobile site not available" };
  }
}

// ---- Method 6: API-Based Login ----

async function apiBasedLogin(page: Page, params: LoginParams): Promise<LoginResult> {
  const url = new URL(params.url);
  const loginEndpoints = [
    `${url.origin}/api/login`,
    `${url.origin}/api/auth/login`,
    `${url.origin}/api/v1/login`,
    `${url.origin}/auth/login`,
  ];

  for (const endpoint of loginEndpoints) {
    try {
      const response = await page.evaluate(
        async ({ ep, user, pass }) => {
          const res = await fetch(ep, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: user, password: pass }),
            credentials: "include",
          });
          return { ok: res.ok, status: res.status };
        },
        { ep: endpoint, user: params.username, pass: params.password }
      );

      if (response.ok) {
        // Reload page to apply session
        await page.reload();
        return await checkLoginSuccess(page);
      }
    } catch {
      // Endpoint doesn't exist, try next
    }
  }

  return { success: false, error: "No API login endpoints found" };
}

// ---- Method 7: Cookie Injection ----

async function cookieInjectionLogin(page: Page, params: LoginParams): Promise<LoginResult> {
  if (!params.savedCookies) {
    return { success: false, error: "No saved cookies available" };
  }

  try {
    const cookies = JSON.parse(params.savedCookies);
    await page.context().addCookies(cookies);
    await page.reload();
    return await checkLoginSuccess(page);
  } catch {
    return { success: false, error: "Cookie injection failed" };
  }
}

// ---- Method 8: Enter Key Submission ----

async function enterKeyLogin(page: Page, params: LoginParams): Promise<LoginResult> {
  await page.goto(params.url, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(1000);

  // Fill username
  const emailField = page.locator('input[type="email"], input[name="email"], input[name="username"]');
  if ((await emailField.count()) === 0) {
    return { success: false, error: "No email field found" };
  }
  await emailField.first().fill(params.username);

  // Fill password
  const passwordField = page.locator('input[type="password"]');
  if ((await passwordField.count()) === 0) {
    return { success: false, error: "No password field found" };
  }
  await passwordField.first().fill(params.password);

  // Press Enter instead of clicking submit
  await passwordField.first().press("Enter");
  await page.waitForLoadState("networkidle").catch(() => {});

  return await checkLoginSuccess(page);
}

// ---- Method 9: Tab Navigation Login ----

async function tabNavigationLogin(page: Page, params: LoginParams): Promise<LoginResult> {
  await page.goto(params.url, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(1000);

  // Find first visible input and start tabbing
  const firstInput = page.locator("input:visible").first();
  if ((await firstInput.count()) === 0) {
    return { success: false, error: "No visible inputs" };
  }

  await firstInput.click();
  await page.keyboard.type(params.username);
  await page.keyboard.press("Tab");
  await page.waitForTimeout(300);
  await page.keyboard.type(params.password);
  await page.keyboard.press("Enter");

  await page.waitForLoadState("networkidle").catch(() => {});
  return await checkLoginSuccess(page);
}

// ---- Method 10: Vision-Guided Login ----

async function visionGuidedLogin(page: Page, params: LoginParams): Promise<LoginResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { success: false, error: "Vision requires Anthropic API key" };
  }

  await page.goto(params.url, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(2000);

  const screenshot = await page.screenshot({ type: "png" });
  const base64 = screenshot.toString("base64");

  const { content } = await generateVisionResponse(
    'Analyze this login page. Return JSON with: { "usernameSelector": "css selector for email/username field", "passwordSelector": "css selector for password field", "submitSelector": "css selector for submit button" }. Return ONLY the JSON.',
    base64,
    "You are analyzing a login page to identify form fields."
  );

  try {
    const selectors = JSON.parse(content);

    if (selectors.usernameSelector) {
      await page.locator(selectors.usernameSelector).first().fill(params.username);
    }
    if (selectors.passwordSelector) {
      await page.locator(selectors.passwordSelector).first().fill(params.password);
    }
    if (selectors.submitSelector) {
      await page.locator(selectors.submitSelector).first().click();
    }

    await page.waitForLoadState("networkidle").catch(() => {});
    return await checkLoginSuccess(page);
  } catch {
    return { success: false, error: "Vision could not identify login fields" };
  }
}

// ---- Success Check ----

async function checkLoginSuccess(page: Page): Promise<LoginResult> {
  await page.waitForTimeout(2000);

  const url = page.url();
  const text = (await page.textContent("body"))?.toLowerCase() || "";

  // Check for error indicators
  const errorIndicators = [
    "invalid password",
    "incorrect password",
    "wrong password",
    "login failed",
    "authentication failed",
    "invalid credentials",
    "try again",
    "account not found",
  ];

  for (const indicator of errorIndicators) {
    if (text.includes(indicator)) {
      return { success: false, error: `Login error: "${indicator}" detected` };
    }
  }

  // Check for success indicators
  const successIndicators = [
    "dashboard",
    "welcome",
    "account",
    "profile",
    "home",
    "inbox",
    "feed",
    "settings",
  ];

  const urlLower = url.toLowerCase();
  for (const indicator of successIndicators) {
    if (urlLower.includes(indicator) || text.includes(`welcome`)) {
      return { success: true, redirectUrl: url };
    }
  }

  // If we navigated away from the login page, likely success
  if (!urlLower.includes("login") && !urlLower.includes("signin") && !urlLower.includes("auth")) {
    return { success: true, redirectUrl: url };
  }

  return { success: false, error: "Could not confirm login success" };
}
