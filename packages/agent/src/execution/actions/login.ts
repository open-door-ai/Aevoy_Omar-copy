/**
 * Login Actions — 10+ Fallback Methods
 *
 * Never gives up on login. If one method fails, tries the next.
 * Includes OAuth, magic link, API+CSRF, and vision-guided methods.
 */

import type { Page } from "playwright";
import { generateVisionResponse } from "../../services/ai.js";

export interface LoginParams {
  url: string;
  username: string;
  password: string;
  savedCookies?: string;
  oauthCookies?: string; // Stored Google/OAuth cookies
}

export interface LoginResult {
  success: boolean;
  method?: string;
  error?: string;
  redirectUrl?: string;
  magicLinkSent?: boolean;
}

/**
 * Attempt login with fallback chain.
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
    { name: "generic_oauth", fn: () => genericOAuthLogin(page, params) },
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
      if (result.magicLinkSent) {
        return { ...result, method: method.name };
      }
      console.log(`[LOGIN] Method ${method.name} failed: ${result.error}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      console.log(`[LOGIN] Method ${method.name} threw: ${msg}`);
    }
  }

  return { success: false, error: "All login methods failed" };
}

// ---- Method 1: Standard Form Login ----

async function standardFormLogin(page: Page, params: LoginParams): Promise<LoginResult> {
  await page.goto(params.url, { waitUntil: "domcontentloaded", timeout: 15000 });
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
      await page.waitForLoadState("networkidle").catch(() => {});
      return await checkLoginSuccess(page, urlBefore);
    }
  }

  return { success: false, error: "Could not find submit button" };
}

// ---- Method 2: Two-Step Login ----

async function twoStepLogin(page: Page, params: LoginParams): Promise<LoginResult> {
  await page.goto(params.url, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(1000);

  const emailField = page.locator('input[type="email"], input[name="email"], input[name="username"]');
  if ((await emailField.count()) === 0) {
    return { success: false, error: "No email field for two-step" };
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
    return { success: false, error: "Could not find Next button" };
  }

  await page.waitForTimeout(2000);

  const passwordField = page.locator('input[type="password"]');
  if ((await passwordField.count()) === 0) {
    return { success: false, error: "Password field not found after step 1" };
  }

  await passwordField.first().fill(params.password);

  const urlBefore = page.url();
  const submitBtn = page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")');
  if ((await submitBtn.count()) > 0) {
    await submitBtn.first().click();
    await page.waitForLoadState("networkidle").catch(() => {});
    return await checkLoginSuccess(page, urlBefore);
  }

  return { success: false, error: "Could not submit password in step 2" };
}

// ---- Method 3: Google OAuth ----

async function googleOAuthLogin(page: Page, params: LoginParams): Promise<LoginResult> {
  // If we have stored OAuth cookies, inject them first
  if (params.oauthCookies) {
    try {
      const cookies = JSON.parse(params.oauthCookies);
      await page.context().addCookies(cookies);
    } catch {
      // Invalid cookies, continue without
    }
  }

  const googleSelectors = [
    'a[href*="accounts.google.com"]',
    'button:has-text("Sign in with Google")',
    'button:has-text("Continue with Google")',
    '[class*="google"] button',
    'div[id="g_id_signin"]',
    '[data-provider="google"]',
  ];

  let googleBtn = null;
  for (const sel of googleSelectors) {
    const el = page.locator(sel);
    if ((await el.count()) > 0) {
      googleBtn = el.first();
      break;
    }
  }

  if (!googleBtn) {
    return { success: false, error: "No Google OAuth option found" };
  }

  const urlBefore = page.url();
  await googleBtn.click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2000);

  // Check if we're on Google's login page
  const currentUrl = page.url();
  if (currentUrl.includes("accounts.google.com")) {
    // Fill Google email
    const emailInput = page.locator('input[type="email"], input[name="identifier"]');
    if ((await emailInput.count()) > 0) {
      await emailInput.first().fill(params.username);
      const nextBtn = page.locator('#identifierNext, button:has-text("Next")');
      if ((await nextBtn.count()) > 0) {
        await nextBtn.first().click();
        await page.waitForTimeout(2000);
      }
    }

    // Fill Google password
    const passInput = page.locator('input[type="password"], input[name="Passwd"]');
    if ((await passInput.count()) > 0) {
      await passInput.first().fill(params.password);
      const passNext = page.locator('#passwordNext, button:has-text("Next")');
      if ((await passNext.count()) > 0) {
        await passNext.first().click();
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.waitForTimeout(3000);
      }
    }

    // Handle consent screen if present
    const allowBtn = page.locator('button:has-text("Allow"), button:has-text("Continue"), button[id="submit_approve_access"]');
    if ((await allowBtn.count()) > 0) {
      await allowBtn.first().click();
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(2000);
    }

    return await checkLoginSuccess(page, urlBefore);
  }

  // If cookies worked, we might have been redirected directly
  return await checkLoginSuccess(page, urlBefore);
}

// ---- Method 4: Generic OAuth (Apple, GitHub, Microsoft, Facebook) ----

async function genericOAuthLogin(page: Page, params: LoginParams): Promise<LoginResult> {
  const oauthProviders = [
    {
      name: 'GitHub',
      selectors: ['a[href*="github.com/login/oauth"]', 'button:has-text("Sign in with GitHub")', 'button:has-text("Continue with GitHub")'],
      emailSel: 'input[name="login"]',
      passSel: 'input[name="password"]',
      submitSel: 'input[type="submit"]',
    },
    {
      name: 'Microsoft',
      selectors: ['a[href*="login.microsoftonline.com"]', 'button:has-text("Sign in with Microsoft")', 'button:has-text("Continue with Microsoft")'],
      emailSel: 'input[type="email"], input[name="loginfmt"]',
      passSel: 'input[type="password"], input[name="passwd"]',
      submitSel: 'input[type="submit"], button:has-text("Sign in")',
    },
    {
      name: 'Facebook',
      selectors: ['a[href*="facebook.com/dialog"]', 'button:has-text("Continue with Facebook")', '[data-provider="facebook"]'],
      emailSel: 'input[name="email"]',
      passSel: 'input[name="pass"]',
      submitSel: 'button[name="login"]',
    },
    {
      name: 'Apple',
      selectors: ['a[href*="appleid.apple.com"]', 'button:has-text("Sign in with Apple")', 'button:has-text("Continue with Apple")'],
      emailSel: 'input[type="text"]#account_name_text_field',
      passSel: 'input[type="password"]',
      submitSel: 'button#sign-in',
    },
  ];

  for (const provider of oauthProviders) {
    let oauthBtn = null;
    for (const sel of provider.selectors) {
      const el = page.locator(sel);
      if ((await el.count()) > 0) {
        oauthBtn = el.first();
        break;
      }
    }

    if (!oauthBtn) continue;

    console.log(`[LOGIN] Found ${provider.name} OAuth, attempting...`);
    const urlBefore = page.url();
    await oauthBtn.click();
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2000);

    // Fill credentials on provider's page
    const emailInput = page.locator(provider.emailSel);
    if ((await emailInput.count()) > 0) {
      await emailInput.first().fill(params.username);

      // Submit email (some providers have separate steps)
      const nextBtn = page.locator('button:has-text("Next"), button:has-text("Continue"), input[type="submit"]');
      if ((await nextBtn.count()) > 0) {
        await nextBtn.first().click();
        await page.waitForTimeout(2000);
      }
    }

    const passInput = page.locator(provider.passSel);
    if ((await passInput.count()) > 0) {
      await passInput.first().fill(params.password);

      const submitBtn = page.locator(provider.submitSel);
      if ((await submitBtn.count()) > 0) {
        await submitBtn.first().click();
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.waitForTimeout(3000);
      }
    }

    // Handle consent/authorize screen
    const authorizeBtn = page.locator('button:has-text("Authorize"), button:has-text("Allow"), button:has-text("Continue"), button:has-text("Accept")');
    if ((await authorizeBtn.count()) > 0) {
      await authorizeBtn.first().click();
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(2000);
    }

    const result = await checkLoginSuccess(page, urlBefore);
    if (result.success) return result;
  }

  return { success: false, error: "No supported OAuth provider found" };
}

// ---- Method 5: Magic Link ----

async function magicLinkLogin(page: Page, params: LoginParams): Promise<LoginResult> {
  const magicSelectors = [
    'button:has-text("Email me a link")',
    'button:has-text("Magic link")',
    'button:has-text("Send login link")',
    'button:has-text("Passwordless")',
    'button:has-text("Sign in with email")',
    'a:has-text("Email me a link")',
    'a:has-text("Magic link")',
  ];

  for (const sel of magicSelectors) {
    const el = page.locator(sel);
    if ((await el.count()) > 0) {
      const emailField = page.locator('input[type="email"], input[name="email"]');
      if ((await emailField.count()) > 0) {
        await emailField.first().fill(params.username);
      }
      await el.first().click();
      await page.waitForTimeout(2000);

      // Magic link sent — the email router will forward it to /task/magic-link
      return {
        success: false,
        magicLinkSent: true,
        error: "Magic link sent — waiting for email to be forwarded by Cloudflare worker",
      };
    }
  }

  return { success: false, error: "No magic link option found" };
}

// ---- Method 6: Mobile Site Login ----

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

// ---- Method 7: API-Based Login with CSRF ----

async function apiBasedLogin(page: Page, params: LoginParams): Promise<LoginResult> {
  const url = new URL(params.url);

  // First, GET the login page to extract CSRF token
  await page.goto(params.url, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});

  const csrfToken = await page.evaluate(() => {
    // Check meta tags
    const metaCsrf = document.querySelector(
      'meta[name="csrf-token"], meta[name="_csrf"], meta[name="csrf"], meta[name="X-CSRF-Token"]'
    );
    if (metaCsrf) return metaCsrf.getAttribute('content');

    // Check hidden form fields
    const hiddenCsrf = document.querySelector(
      'input[name="_csrf"], input[name="csrf_token"], input[name="_token"], input[name="authenticity_token"]'
    );
    if (hiddenCsrf) return (hiddenCsrf as HTMLInputElement).value;

    return null;
  }).catch(() => null);

  const loginEndpoints = [
    `${url.origin}/api/login`,
    `${url.origin}/api/auth/login`,
    `${url.origin}/api/v1/login`,
    `${url.origin}/api/v1/auth/login`,
    `${url.origin}/auth/login`,
    `${url.origin}/login`,
    `${url.origin}/api/session`,
    `${url.origin}/api/v1/session`,
  ];

  for (const endpoint of loginEndpoints) {
    try {
      const response = await page.evaluate(
        async ({ ep, user, pass, csrf }) => {
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (csrf) {
            headers["X-CSRF-Token"] = csrf;
            headers["X-XSRF-TOKEN"] = csrf;
          }

          const body: Record<string, string> = { email: user, password: pass };
          if (csrf) body._csrf = csrf;

          const res = await fetch(ep, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            credentials: "include",
          });
          return { ok: res.ok, status: res.status };
        },
        { ep: endpoint, user: params.username, pass: params.password, csrf: csrfToken }
      );

      if (response.ok) {
        const urlBefore = page.url();
        await page.reload();
        return await checkLoginSuccess(page, urlBefore);
      }
    } catch {
      // Endpoint doesn't exist, try next
    }
  }

  return { success: false, error: "No API login endpoints found" };
}

// ---- Method 8: Cookie Injection ----

async function cookieInjectionLogin(page: Page, params: LoginParams): Promise<LoginResult> {
  if (!params.savedCookies) {
    return { success: false, error: "No saved cookies available" };
  }

  try {
    const cookies = JSON.parse(params.savedCookies);
    await page.context().addCookies(cookies);
    const urlBefore = page.url();
    await page.reload();
    return await checkLoginSuccess(page, urlBefore);
  } catch {
    return { success: false, error: "Cookie injection failed" };
  }
}

// ---- Method 9: Enter Key Submission ----

async function enterKeyLogin(page: Page, params: LoginParams): Promise<LoginResult> {
  await page.goto(params.url, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(1000);

  const emailField = page.locator('input[type="email"], input[name="email"], input[name="username"]');
  if ((await emailField.count()) === 0) {
    return { success: false, error: "No email field found" };
  }
  await emailField.first().fill(params.username);

  const passwordField = page.locator('input[type="password"]');
  if ((await passwordField.count()) === 0) {
    return { success: false, error: "No password field found" };
  }
  await passwordField.first().fill(params.password);

  const urlBefore = page.url();
  await passwordField.first().press("Enter");
  await page.waitForLoadState("networkidle").catch(() => {});

  return await checkLoginSuccess(page, urlBefore);
}

// ---- Method 10: Tab Navigation Login ----

async function tabNavigationLogin(page: Page, params: LoginParams): Promise<LoginResult> {
  await page.goto(params.url, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(1000);

  const firstInput = page.locator("input:visible").first();
  if ((await firstInput.count()) === 0) {
    return { success: false, error: "No visible inputs" };
  }

  await firstInput.click();
  await page.keyboard.type(params.username);
  await page.keyboard.press("Tab");
  await page.waitForTimeout(300);
  await page.keyboard.type(params.password);

  const urlBefore = page.url();
  await page.keyboard.press("Enter");

  await page.waitForLoadState("networkidle").catch(() => {});
  return await checkLoginSuccess(page, urlBefore);
}

// ---- Method 11: Vision-Guided Login ----

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

    const urlBefore = page.url();
    if (selectors.submitSelector) {
      await page.locator(selectors.submitSelector).first().click();
    }

    await page.waitForLoadState("networkidle").catch(() => {});
    return await checkLoginSuccess(page, urlBefore);
  } catch {
    return { success: false, error: "Vision could not identify login fields" };
  }
}

// ---- Success Check (improved with scoped matching + URL change detection) ----

async function checkLoginSuccess(page: Page, urlBefore?: string): Promise<LoginResult> {
  await page.waitForTimeout(2000);

  const url = page.url();
  const urlLower = url.toLowerCase();

  // Strong negative: still on login/signin page
  if (urlLower.includes("/login") || urlLower.includes("/signin") || urlLower.includes("/sign-in")) {
    // Only fail if URL didn't change at all
    if (!urlBefore || url === urlBefore) {
      // Check for error indicators
      const text = (await page.textContent("body"))?.toLowerCase() || "";
      const errorIndicators = [
        "invalid password", "incorrect password", "wrong password",
        "login failed", "authentication failed", "invalid credentials",
        "try again", "account not found",
      ];
      for (const indicator of errorIndicators) {
        if (text.includes(indicator)) {
          return { success: false, error: `Login error: "${indicator}" detected` };
        }
      }
      return { success: false, error: "Still on login page" };
    }
  }

  // Scope success matching to title, h1/h2, and main content (not footer)
  const scopedText = await page.evaluate(() => {
    const parts: string[] = [];
    parts.push(document.title);
    document.querySelectorAll('h1, h2').forEach(el => {
      parts.push(el.textContent || '');
    });
    const main = document.querySelector('main, [role="main"], .main-content, #main');
    if (main) {
      parts.push((main.textContent || '').substring(0, 500));
    }
    return parts.join(' ').toLowerCase();
  }).catch(() => '');

  // Check for error indicators in scoped text
  const errorIndicators = [
    "invalid password", "incorrect password", "wrong password",
    "login failed", "authentication failed", "invalid credentials",
    "try again", "account not found",
  ];

  for (const indicator of errorIndicators) {
    if (scopedText.includes(indicator)) {
      return { success: false, error: `Login error: "${indicator}" detected` };
    }
  }

  // Check for success indicators in scoped text
  const successIndicators = [
    "dashboard", "welcome", "account", "profile",
    "home", "inbox", "feed", "settings", "my ",
  ];

  for (const indicator of successIndicators) {
    if (scopedText.includes(indicator)) {
      return { success: true, redirectUrl: url };
    }
  }

  // URL change detection: if we navigated away from login, likely success
  if (urlBefore && url !== urlBefore) {
    if (!urlLower.includes("login") && !urlLower.includes("signin") && !urlLower.includes("auth")) {
      return { success: true, redirectUrl: url };
    }
  }

  // Check URL for success patterns
  const successUrlPatterns = ["dashboard", "home", "account", "profile", "inbox", "feed", "welcome"];
  for (const pattern of successUrlPatterns) {
    if (urlLower.includes(pattern)) {
      return { success: true, redirectUrl: url };
    }
  }

  return { success: false, error: "Could not confirm login success" };
}
