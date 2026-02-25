const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const VIEWPORT = { width: 390, height: 844 };
const BASE_URL = 'http://localhost:3000';
const OUTPUT_DIR = '/tmp/mobile-audit';

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

async function screenshot(page, filename, description) {
  const filepath = path.join(OUTPUT_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: false });
  console.log(`SCREENSHOT: ${filename} — ${description}`);
  return filepath;
}

async function screenshotFull(page, filename, description) {
  const filepath = path.join(OUTPUT_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: true });
  console.log(`SCREENSHOT_FULL: ${filename} — ${description}`);
  return filepath;
}

(async () => {
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    headless: true
  });

  const context = await browser.newContext({
    viewport: VIEWPORT,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });

  const page = await context.newPage();
  page.setDefaultTimeout(15000);

  // Capture console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // =========================================================
  // 1. LANDING PAGE
  // =========================================================
  console.log('\n=== 1. LANDING PAGE ===');
  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);
    await screenshot(page, '01-landing-top.png', 'Landing page — top viewport');

    // Scroll through sections
    await page.evaluate(() => window.scrollTo(0, 800));
    await page.waitForTimeout(500);
    await screenshot(page, '01-landing-scroll1.png', 'Landing page — scroll 800px');

    await page.evaluate(() => window.scrollTo(0, 1600));
    await page.waitForTimeout(500);
    await screenshot(page, '01-landing-scroll2.png', 'Landing page — scroll 1600px');

    await page.evaluate(() => window.scrollTo(0, 2400));
    await page.waitForTimeout(500);
    await screenshot(page, '01-landing-scroll3.png', 'Landing page — scroll 2400px');

    await page.evaluate(() => window.scrollTo(0, 3200));
    await page.waitForTimeout(500);
    await screenshot(page, '01-landing-scroll4.png', 'Landing page — scroll 3200px');

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    await screenshot(page, '01-landing-bottom.png', 'Landing page — bottom');

    // Check for horizontal overflow
    const hasHorizOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    console.log(`Landing page horizontal overflow: ${hasHorizOverflow}`);
    console.log(`Landing page scrollWidth: ${await page.evaluate(() => document.documentElement.scrollWidth)}`);
    console.log(`Landing page clientWidth: ${await page.evaluate(() => document.documentElement.clientWidth)}`);

    // Check navbar
    const navbarInfo = await page.evaluate(() => {
      const nav = document.querySelector('nav') || document.querySelector('header');
      if (!nav) return 'no nav found';
      const rect = nav.getBoundingClientRect();
      return { width: rect.width, height: rect.height, overflow: window.getComputedStyle(nav).overflow };
    });
    console.log('Navbar info:', JSON.stringify(navbarInfo));

    // Check hamburger menu
    const hamburger = await page.evaluate(() => {
      const selectors = ['[data-hamburger]', '.hamburger', '[aria-label*="menu"]', 'button[aria-label*="Menu"]', '.mobile-menu-btn'];
      for (const s of selectors) {
        const el = document.querySelector(s);
        if (el) return { found: true, selector: s, visible: window.getComputedStyle(el).display !== 'none' };
      }
      return { found: false };
    });
    console.log('Hamburger:', JSON.stringify(hamburger));
  } catch (e) {
    console.log('Landing page error:', e.message);
  }

  // =========================================================
  // 2. LOGIN PAGE
  // =========================================================
  console.log('\n=== 2. LOGIN PAGE ===');
  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1500);
    await screenshot(page, '02-login.png', 'Login page');
    await screenshotFull(page, '02-login-full.png', 'Login page full');

    const loginInfo = await page.evaluate(() => {
      const form = document.querySelector('form');
      const inputs = document.querySelectorAll('input');
      const buttons = document.querySelectorAll('button');
      const hasHorizOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;
      return {
        hasForm: !!form,
        inputCount: inputs.length,
        buttonCount: buttons.length,
        hasHorizOverflow,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        inputSizes: Array.from(inputs).map(i => ({ type: i.type, width: i.getBoundingClientRect().width, fontSize: window.getComputedStyle(i).fontSize })),
        buttonSizes: Array.from(buttons).map(b => ({ text: b.textContent?.trim().slice(0,30), width: b.getBoundingClientRect().width, height: b.getBoundingClientRect().height }))
      };
    });
    console.log('Login info:', JSON.stringify(loginInfo, null, 2));
  } catch (e) {
    console.log('Login page error:', e.message);
  }

  // =========================================================
  // 3. SIGNUP PAGE
  // =========================================================
  console.log('\n=== 3. SIGNUP PAGE ===');
  try {
    await page.goto(`${BASE_URL}/signup`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1500);
    await screenshot(page, '03-signup.png', 'Signup page');
    await screenshotFull(page, '03-signup-full.png', 'Signup page full');

    const signupInfo = await page.evaluate(() => {
      const hasHorizOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;
      const inputs = document.querySelectorAll('input');
      return {
        hasHorizOverflow,
        scrollWidth: document.documentElement.scrollWidth,
        inputCount: inputs.length,
        inputDetails: Array.from(inputs).map(i => ({ type: i.type, placeholder: i.placeholder, width: i.getBoundingClientRect().width }))
      };
    });
    console.log('Signup info:', JSON.stringify(signupInfo, null, 2));
  } catch (e) {
    console.log('Signup page error:', e.message);
  }

  // =========================================================
  // LOGIN to get session for authenticated pages
  // =========================================================
  console.log('\n=== LOGGING IN ===');
  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1000);

    // Fill login form
    const emailInput = await page.$('input[type="email"], input[name="email"], input[placeholder*="email" i], input[placeholder*="Email" i]');
    const passwordInput = await page.$('input[type="password"]');

    if (emailInput && passwordInput) {
      await emailInput.click();
      await emailInput.fill('test-e2e@aevoy.com');
      await passwordInput.click();
      await passwordInput.fill('VisualTest2026');
      await passwordInput.press('Enter');
      console.log('Login form submitted');
      await page.waitForTimeout(5000);
      console.log('Current URL after login:', page.url());
    } else {
      console.log('Could not find email/password inputs');
      // Try clicking the login button
      const loginBtn = await page.$('button[type="submit"], button:has-text("Log in"), button:has-text("Sign in")');
      if (loginBtn) {
        console.log('Found submit button');
      }
    }
  } catch (e) {
    console.log('Login error:', e.message);
  }

  // =========================================================
  // 4. DASHBOARD
  // =========================================================
  console.log('\n=== 4. DASHBOARD ===');
  try {
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(3000);
    console.log('Dashboard URL:', page.url());
    await screenshot(page, '04-dashboard.png', 'Dashboard main view');
    await screenshotFull(page, '04-dashboard-full.png', 'Dashboard full page');

    const dashInfo = await page.evaluate(() => {
      const hasHorizOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;
      // Check sidebar
      const sidebar = document.querySelector('aside, [data-sidebar], .sidebar, nav[class*="sidebar"]');
      const sidebarRect = sidebar ? sidebar.getBoundingClientRect() : null;
      // Check main content
      const main = document.querySelector('main');
      const mainRect = main ? main.getBoundingClientRect() : null;

      return {
        hasHorizOverflow,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        sidebarVisible: !!sidebar,
        sidebarRect: sidebarRect ? { x: sidebarRect.x, y: sidebarRect.y, width: sidebarRect.width, height: sidebarRect.height } : null,
        mainRect: mainRect ? { x: mainRect.x, y: mainRect.y, width: mainRect.width } : null,
        currentURL: window.location.href
      };
    });
    console.log('Dashboard info:', JSON.stringify(dashInfo, null, 2));

    // Check for Customize button
    const customizeBtn = await page.$('button:has-text("Customize"), button:has-text("customize"), [aria-label*="customize" i]');
    console.log('Customize button found:', !!customizeBtn);
  } catch (e) {
    console.log('Dashboard error:', e.message);
  }

  // =========================================================
  // 5. DASHBOARD EDIT MODE + ADD WIDGET
  // =========================================================
  console.log('\n=== 5. DASHBOARD CUSTOMIZE ===');
  try {
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);

    // Look for Customize button
    const customizeSelectors = [
      'button:has-text("Customize")',
      'button:has-text("Edit")',
      '[aria-label*="customize" i]',
      '[data-testid*="customize"]',
    ];

    let customizeBtn = null;
    for (const sel of customizeSelectors) {
      customizeBtn = await page.$(sel);
      if (customizeBtn) { console.log('Found customize with:', sel); break; }
    }

    if (customizeBtn) {
      await customizeBtn.click();
      await page.waitForTimeout(2000);
      await screenshot(page, '05-dashboard-edit-mode.png', 'Dashboard edit mode');

      // Look for Add Widget button
      const addWidgetBtn = await page.$('button:has-text("Add Widget"), button:has-text("Add widget"), button:has-text("+ Add")');
      if (addWidgetBtn) {
        await addWidgetBtn.click();
        await page.waitForTimeout(1500);
        await screenshot(page, '05-dashboard-add-widget.png', 'Dashboard add widget panel');
      } else {
        console.log('No Add Widget button found');
        await screenshotFull(page, '05-dashboard-edit-full.png', 'Dashboard edit mode full');
      }
    } else {
      console.log('No Customize button found, taking screenshot of current state');
      await screenshot(page, '05-dashboard-no-customize.png', 'Dashboard no customize button found');
    }
  } catch (e) {
    console.log('Dashboard customize error:', e.message);
  }

  // =========================================================
  // 6. ACTIVITY PAGE
  // =========================================================
  console.log('\n=== 6. ACTIVITY PAGE ===');
  try {
    await page.goto(`${BASE_URL}/dashboard/activity`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);
    await screenshot(page, '06-activity.png', 'Activity page');
    await screenshotFull(page, '06-activity-full.png', 'Activity page full');

    const activityInfo = await page.evaluate(() => ({
      hasHorizOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      url: window.location.href
    }));
    console.log('Activity info:', JSON.stringify(activityInfo));
  } catch (e) {
    console.log('Activity page error:', e.message);
  }

  // =========================================================
  // 7. QUEUE PAGE
  // =========================================================
  console.log('\n=== 7. QUEUE PAGE ===');
  try {
    await page.goto(`${BASE_URL}/dashboard/queue`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);
    await screenshot(page, '07-queue.png', 'Queue page');
    await screenshotFull(page, '07-queue-full.png', 'Queue page full');

    const queueInfo = await page.evaluate(() => ({
      hasHorizOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      url: window.location.href
    }));
    console.log('Queue info:', JSON.stringify(queueInfo));
  } catch (e) {
    console.log('Queue page error:', e.message);
  }

  // =========================================================
  // 8. HEALTH PAGE
  // =========================================================
  console.log('\n=== 8. HEALTH PAGE ===');
  try {
    await page.goto(`${BASE_URL}/dashboard/health`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);
    await screenshot(page, '08-health.png', 'Health page');
    await screenshotFull(page, '08-health-full.png', 'Health page full');

    const healthInfo = await page.evaluate(() => ({
      hasHorizOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      url: window.location.href
    }));
    console.log('Health info:', JSON.stringify(healthInfo));
  } catch (e) {
    console.log('Health page error:', e.message);
  }

  // =========================================================
  // 9. INBOX PAGE
  // =========================================================
  console.log('\n=== 9. INBOX PAGE ===');
  try {
    await page.goto(`${BASE_URL}/dashboard/inbox`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);
    await screenshot(page, '09-inbox.png', 'Inbox page');
    await screenshotFull(page, '09-inbox-full.png', 'Inbox page full');

    const inboxInfo = await page.evaluate(() => ({
      hasHorizOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      url: window.location.href
    }));
    console.log('Inbox info:', JSON.stringify(inboxInfo));
  } catch (e) {
    console.log('Inbox page error:', e.message);
  }

  // =========================================================
  // 10. SETTINGS PAGE
  // =========================================================
  console.log('\n=== 10. SETTINGS PAGE ===');
  try {
    await page.goto(`${BASE_URL}/dashboard/settings`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);
    await screenshot(page, '10-settings.png', 'Settings page');
    await screenshotFull(page, '10-settings-full.png', 'Settings page full');

    const settingsInfo = await page.evaluate(() => {
      const tabs = document.querySelectorAll('[role="tab"]');
      const hasHorizOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;
      return {
        hasHorizOverflow,
        scrollWidth: document.documentElement.scrollWidth,
        tabCount: tabs.length,
        tabs: Array.from(tabs).map(t => t.textContent?.trim()),
        url: window.location.href
      };
    });
    console.log('Settings info:', JSON.stringify(settingsInfo, null, 2));
  } catch (e) {
    console.log('Settings page error:', e.message);
  }

  // =========================================================
  // 11. STORE PAGE (PUBLIC)
  // =========================================================
  console.log('\n=== 11. STORE PAGE ===');
  try {
    await page.goto(`${BASE_URL}/store`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);
    await screenshot(page, '11-store.png', 'Store page');
    await screenshotFull(page, '11-store-full.png', 'Store page full');

    const storeInfo = await page.evaluate(() => ({
      hasHorizOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      url: window.location.href
    }));
    console.log('Store info:', JSON.stringify(storeInfo));
  } catch (e) {
    console.log('Store page error:', e.message);
  }

  // =========================================================
  // 12. DEVELOPER PORTAL
  // =========================================================
  console.log('\n=== 12. DEVELOPER PORTAL ===');
  try {
    await page.goto(`${BASE_URL}/developer`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);
    await screenshot(page, '12-developer.png', 'Developer portal');
    await screenshotFull(page, '12-developer-full.png', 'Developer portal full');

    const devInfo = await page.evaluate(() => ({
      hasHorizOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      url: window.location.href
    }));
    console.log('Developer info:', JSON.stringify(devInfo));
  } catch (e) {
    console.log('Developer portal error:', e.message);
  }

  // =========================================================
  // DETAILED SIDEBAR / LAYOUT ANALYSIS on Dashboard
  // =========================================================
  console.log('\n=== LAYOUT ANALYSIS ===');
  try {
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);

    const layoutAnalysis = await page.evaluate(() => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Find all major layout containers
      const results = {
        viewport: { width: vw, height: vh },
        bodyScrollWidth: document.body.scrollWidth,
        docScrollWidth: document.documentElement.scrollWidth,
        overflowingElements: []
      };

      // Find elements that overflow
      const all = document.querySelectorAll('*');
      for (const el of all) {
        const rect = el.getBoundingClientRect();
        if (rect.right > vw + 5 || rect.left < -5) {
          results.overflowingElements.push({
            tag: el.tagName,
            id: el.id,
            classes: el.className?.toString().slice(0, 60),
            rect: { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) }
          });
        }
      }

      // Sidebar specific
      const sidebarCandidates = document.querySelectorAll('aside, [class*="sidebar"], [class*="Sidebar"], nav');
      const sidebarInfo = Array.from(sidebarCandidates).slice(0, 5).map(el => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return {
          tag: el.tagName,
          classes: el.className?.toString().slice(0, 80),
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
          display: style.display,
          position: style.position,
          transform: style.transform,
          visibility: style.visibility
        };
      });
      results.sidebarCandidates = sidebarInfo;

      return results;
    });

    console.log('Layout analysis:');
    console.log(JSON.stringify(layoutAnalysis, null, 2));
  } catch (e) {
    console.log('Layout analysis error:', e.message);
  }

  // =========================================================
  // FONT SIZE ANALYSIS
  // =========================================================
  console.log('\n=== FONT SIZE ANALYSIS on Dashboard ===');
  try {
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1500);

    const fontAnalysis = await page.evaluate(() => {
      const textEls = document.querySelectorAll('p, span, h1, h2, h3, h4, h5, h6, a, button, label, li');
      const smallTextEls = [];
      for (const el of textEls) {
        const style = window.getComputedStyle(el);
        const fontSize = parseFloat(style.fontSize);
        if (fontSize < 12 && el.textContent?.trim().length > 0) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            smallTextEls.push({
              tag: el.tagName,
              text: el.textContent?.trim().slice(0, 40),
              fontSize: style.fontSize,
              classes: el.className?.toString().slice(0, 40)
            });
          }
        }
      }
      return { smallTextElements: smallTextEls.slice(0, 20) };
    });
    console.log('Font analysis:', JSON.stringify(fontAnalysis, null, 2));
  } catch (e) {
    console.log('Font analysis error:', e.message);
  }

  await browser.close();
  console.log('\nAll screenshots saved to /tmp/mobile-audit/');
  console.log('Console errors captured:', consoleErrors.length);
  if (consoleErrors.length > 0) {
    console.log('Errors:', consoleErrors.slice(0, 10));
  }
})();
