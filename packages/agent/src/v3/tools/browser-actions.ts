/**
 * V3 Individual Browser Action Tools
 *
 * Phase 2: Instead of one monolithic browser_session that runs the entire
 * vision agent, these tools let the V3 AI loop drive the browser directly:
 *   browser_navigate → browser_snapshot → browser_click → browser_fill → repeat
 *
 * This is how Playwright MCP works — snapshot, decide, act, repeat.
 * No intermediate dumb model, no regex parsing, no action cascade.
 * The V3 AI (Gemini Flash) sees the page and calls tools directly.
 */

import { registerTool } from '../tool-registry.js';
import { ExecutionEngine } from '../../execution/engine.js';
import { createLockedIntent, getTaskTypeFromClassification } from '../../security/intent-lock.js';
import { getSupabaseClient } from '../../utils/supabase.js';
import type { ToolCallResult, TaskContext } from '../types.js';
import type { Page } from 'patchright';

// ── Shared selector list for consistent ref numbering across snapshot/click/fill ──
const INTERACTIVE_SELECTORS = [
  'a', 'button', 'input', 'select', 'textarea',
  '[role="button"]', '[role="link"]', '[role="textbox"]', '[role="checkbox"]',
  '[role="tab"]', '[role="menuitem"]', '[role="combobox"]', '[role="option"]',
  '[role="listbox"]', '[role="radio"]', '[role="switch"]', '[role="slider"]',
  '[contenteditable="true"]', '[tabindex]', '[onclick]',
  'li[class*="option"]', 'div[class*="option"]', 'span[class*="option"]',
];

// ── Per-task page cache (shared with browser.ts via engine cache) ──
const taskPages = new Map<string, { page: Page; engine: ExecutionEngine }>();

async function getOrCreatePage(ctx: TaskContext, url?: string): Promise<{ page: Page; isNew: boolean }> {
  const existing = taskPages.get(ctx.taskId);
  if (existing) {
    try {
      if (!existing.page.isClosed()) return { page: existing.page, isNew: false };
    } catch { /* page dead */ }
    try { await existing.engine.cleanup(); } catch {}
    taskPages.delete(ctx.taskId);
  }

  // Note: stale pages are cleaned by VPS cron (every 5min).
  // Don't clean other task pages here — they might still be running.

  // Create new engine + page
  const domain = url ? (() => { try { return new URL(url).hostname; } catch { return 'unknown'; } })() : 'unknown';
  const lockedIntent = createLockedIntent({
    userId: ctx.userId,
    taskType: getTaskTypeFromClassification('browser_action'),
    goal: 'Browser automation',
    allowedDomains: [domain],
    allowedActions: ['browse', 'fill_form', 'click', 'screenshot', 'extract'],
  });

  const engine = new ExecutionEngine(lockedIntent);
  await engine.initialize(ctx.userId, domain, ctx.taskId);
  const page = engine.getPage();
  if (!page) throw new Error('Failed to create browser page');

  // Force consistent viewport so vision coordinates match click coordinates
  try { await page.setViewportSize({ width: 1280, height: 720 }); } catch { /* ignore */ }

  taskPages.set(ctx.taskId, { page, engine });
  return { page, isNew: true };
}

/**
 * Auto-detect and solve CAPTCHAs on the current page.
 * Called after navigation and clicks — transparent to the AI.
 *
 * Optimizations:
 * - Only checks pages that look like CAPTCHA challenges (few elements, challenge URLs)
 * - 15-second hard timeout (prevents hanging on false positives)
 * - Skips if page URL hasn't changed since last solve
 */
const recentCaptchaSolves = new Set<string>(); // Track solved URLs to avoid re-checking

async function autoSolveCaptcha(page: Page, ctx: TaskContext): Promise<{ solved: boolean; note: string; cost: number }> {
  try {
    const url = page.url();
    // Skip if we already solved a CAPTCHA on this exact URL
    if (recentCaptchaSolves.has(url)) return { solved: false, note: '', cost: 0 };

    // Quick check: only run full detection on pages that look like CAPTCHA challenges
    const quickCheck = await Promise.race([
      page.evaluate(() => {
        const body = document.body?.innerText || '';
        const hasChallenge = /captcha|verify|human|robot|challenge|security check/i.test(body);
        const hasCaptchaElement = !!document.querySelector('.g-recaptcha, [data-sitekey], .h-captcha, .cf-turnstile, iframe[src*="recaptcha"], iframe[src*="hcaptcha"]');
        return hasChallenge || hasCaptchaElement;
      }),
      new Promise<boolean>(r => setTimeout(() => r(false), 3000)), // 3s timeout for quick check
    ]);

    if (!quickCheck) return { solved: false, note: '', cost: 0 };

    // Full detection + solving with 15-second timeout
    const result = await Promise.race([
      (async () => {
        const { detectCaptcha, solveCaptcha } = await import('../../execution/captcha.js');
        const detection = await detectCaptcha(page);
        if (detection.type === 'none') return { solved: false, note: '', cost: 0 };

        console.log(`[V3-CAPTCHA] Detected ${detection.type} on ${url}`);
        const solveResult = await solveCaptcha(page, detection, ctx.userId, ctx.taskId);

        if (solveResult.success) {
          console.log(`[V3-CAPTCHA] Solved ${detection.type} via ${solveResult.service}`);
          recentCaptchaSolves.add(url);
          await page.waitForTimeout(2000);
          return {
            solved: true,
            note: `[CAPTCHA auto-solved: ${detection.type} via ${solveResult.service}]`,
            cost: solveResult.cost || 0,
          };
        }
        return { solved: false, note: `[CAPTCHA detected but solve failed: ${solveResult.error}]`, cost: 0 };
      })(),
      new Promise<{ solved: boolean; note: string; cost: number }>(r =>
        setTimeout(() => r({ solved: false, note: '', cost: 0 }), 15000) // 15s hard timeout
      ),
    ]);

    return result;
  } catch {
    return { solved: false, note: '', cost: 0 };
  }
}

/** Cleanup page for a task */
export async function cleanupTaskPage(taskId: string): Promise<void> {
  const entry = taskPages.get(taskId);
  if (entry) {
    try { await entry.engine.cleanup(); } catch {}
    taskPages.delete(taskId);
  }
}

/**
 * Adaptive page snapshot — DOM-first with vision hints for complex pages.
 * ≤50 elements: full text list (fast, free)
 * 51-150: text list + hint to use browser_screenshot()
 * 150+: summary only + instruction to use browser_screenshot()
 * 0: auto-take screenshot (SPA loading)
 */
async function getPageSnapshot(page: Page): Promise<string> {
  try {
    const result = await Promise.race([
      page.evaluate((selectors: string[]) => {
        // CRITICAL: Stamp each element with data-aevoy-ref attribute.
        // Click/fill/select use this attribute to find the EXACT element,
        // eliminating race conditions from DOM mutations between calls.
        // Clear old refs first
        document.querySelectorAll('[data-aevoy-ref]').forEach(el => el.removeAttribute('data-aevoy-ref'));

        const seen = new Set<Element>();
        const items: string[] = [];
        let totalCount = 0;
        let ref = 1;
        const MAX_DISPLAY = 80;

        for (const sel of selectors) {
          document.querySelectorAll(sel).forEach(el => {
            if (seen.has(el)) return;
            seen.add(el);
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            totalCount++;
            // Stamp element with stable ref
            (el as HTMLElement).setAttribute('data-aevoy-ref', String(ref));
            if (items.length < MAX_DISPLAY) {
              const tag = el.tagName.toLowerCase();
              const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'button' ? 'button' :
                tag === 'input' ? (el.getAttribute('type') || 'textbox') : tag === 'select' ? 'combobox' :
                tag === 'textarea' ? 'textbox' : tag);
              const name = el.getAttribute('aria-label') ||
                el.getAttribute('placeholder') ||
                (el.textContent || '').trim().substring(0, 60) ||
                el.getAttribute('name') || '';
              const value = (el as HTMLInputElement).value || '';
              items.push(`[${ref}] ${role} "${name}"${value ? ` value="${value}"` : ''}`);
            }
            ref++;
          });
        }

        const title = document.title;
        const h1 = document.querySelector('h1')?.textContent?.trim() || '';
        const alerts = Array.from(document.querySelectorAll('[role="alert"], .error, .alert'))
          .map(el => el.textContent?.trim()).filter(Boolean).slice(0, 3);
        return { elements: items, totalCount, title, h1, alerts, url: location.href };
      }, INTERACTIVE_SELECTORS),
      new Promise<any>(r => setTimeout(() => r({ elements: [], totalCount: 0, title: '', h1: '', alerts: [], url: '' }), 5000))
    ]);

    const lines: string[] = [];
    lines.push(`URL: ${result.url}`);
    if (result.title) lines.push(`Title: ${result.title}`);
    if (result.h1) lines.push(`Heading: ${result.h1}`);
    if (result.alerts?.length) lines.push(`Alerts: ${result.alerts.join('; ')}`);
    lines.push(`Interactive elements: ${result.totalCount} found`);
    lines.push('');

    if (result.totalCount === 0) {
      lines.push('No interactive elements found. The page may still be loading. Try browser_wait(3) then browser_snapshot() again.');
    } else if (result.totalCount <= 80) {
      // Simple/medium page — full list
      lines.push(...result.elements);
    } else {
      // Complex page — show what we have + overflow notice
      const shown = result.elements.length;
      lines.push(`Showing ${shown} of ${result.totalCount} visible elements:`);
      lines.push(...result.elements);
      if (result.totalCount > shown) {
        lines.push(`\n... ${result.totalCount - shown} more elements not shown. Try scrolling to see more, or use browser_screenshot() for a visual overview.`);
      }
    }

    return lines.join('\n');
  } catch (err) {
    return `Error getting page snapshot: ${err instanceof Error ? err.message : 'unknown'}`;
  }
}

/** Take a PNG screenshot of the current page */
async function takePageScreenshot(page: Page): Promise<string> {
  const buf = await page.screenshot({ type: 'png', fullPage: false });
  return buf.toString('base64');
}

// ── Tools ──

registerTool({
  name: 'browser_go',
  description: 'Navigate to a URL in the browser. Use this to open a website. Returns a snapshot of the page after navigation.',
  category: 'browser',
  parameters: {
    url: { type: 'string', description: 'URL to navigate to' },
  },
  required: ['url'],
  async execute(params, ctx): Promise<ToolCallResult> {
    const url = String(params.url);
    if (!url || !/^https?:\/\//i.test(url)) {
      return { success: false, error: 'Invalid URL. Must start with http:// or https://', cost: 0 };
    }
    try {
      const { page } = await getOrCreatePage(ctx, url);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1000);

      // Detect proxy-blocked pages — BrightData blocks many sites
      // Check for: chrome errors, blank pages, proxy error pages, residential blocks
      const currentUrl = page.url();
      const bodyText = await page.evaluate(() => (document.body?.innerText || '').substring(0, 500)).catch(() => '');
      const isErrorPage = currentUrl.startsWith('chrome-error://') || currentUrl === 'about:blank';
      const isProxyBlock = isErrorPage
        || /can't be reached|not available|ERR_|connection refused|dns|access denied|blocked|residential/i.test(bodyText)
        || (bodyText.length < 50 && !currentUrl.includes(new URL(url).hostname)); // Page loaded but wrong domain
      if (isProxyBlock) {
          console.log(`[V3-BROWSER] Blocked page detected for ${url}: "${bodyText.substring(0, 100)}"`);

          // Try BrightData fallback (residential IP) if available
          const bdWs = process.env.BRIGHT_DATA_BROWSER_WS;
          if (bdWs && !taskPages.get(ctx.taskId)?.engine?.['useBrightData']) {
            console.log(`[V3-BROWSER] Attempting BrightData fallback for ${url}`);
            try {
              // Cleanup current engine and create BrightData one
              await cleanupTaskPage(ctx.taskId);
              // Temporarily set force BrightData by removing REMOTE_BROWSER_CDP for this task's engine
              const savedCdp = process.env.REMOTE_BROWSER_CDP;
              delete process.env.REMOTE_BROWSER_CDP;
              try {
                const { page: bdPage } = await getOrCreatePage(ctx, url);
                await bdPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
                await bdPage.waitForTimeout(2000);
                const bdUrl = bdPage.url();
                const bdBody = await bdPage.evaluate(() => (document.body?.innerText || '').substring(0, 200)).catch(() => '');
                const bdBlocked = bdUrl.startsWith('chrome-error://') || /access denied|blocked|forbidden/i.test(bdBody);
                if (bdBlocked) {
                  console.log(`[V3-BROWSER] BrightData also blocked for ${url}`);
                  await cleanupTaskPage(ctx.taskId);
                  // Restore and report failure
                  process.env.REMOTE_BROWSER_CDP = savedCdp;
                } else {
                  // BrightData worked! Keep using it for this task
                  console.log(`[V3-BROWSER] BrightData SUCCESS for ${url}`);
                  process.env.REMOTE_BROWSER_CDP = savedCdp; // Restore for other tasks
                  const captcha = await autoSolveCaptcha(bdPage, ctx);
                  const snapshot = await getPageSnapshot(bdPage);
                  return { success: true, data: `(Used residential proxy for anti-bot bypass)\n\n${captcha.note ? captcha.note + '\n\n' : ''}${snapshot}`, cost: captcha.cost + 0.003 };
                }
              } catch (bdErr) {
                console.warn(`[V3-BROWSER] BrightData fallback failed:`, bdErr instanceof Error ? bdErr.message : bdErr);
                process.env.REMOTE_BROWSER_CDP = savedCdp;
                await cleanupTaskPage(ctx.taskId);
              }
            } catch { /* ignore BrightData errors */ }
          }

          return {
            success: false,
            error: `Page blocked or unreachable: ${url}. The site blocks datacenter IPs. Try Google search: browser_go("https://www.google.com/search?q=${encodeURIComponent(url.replace(/https?:\/\//, ''))}")`,
            cost: 0,
          };
      }

      // Auto-solve any CAPTCHAs that appeared after navigation
      const captcha = await autoSolveCaptcha(page, ctx);
      const snapshot = await getPageSnapshot(page);
      return { success: true, data: `${captcha.note ? captcha.note + '\n\n' : ''}${snapshot}`, cost: captcha.cost };
    } catch (err) {
      return { success: false, error: `Navigation failed: ${err instanceof Error ? err.message : 'unknown'}`, cost: 0 };
    }
  },
});

registerTool({
  name: 'browser_snapshot',
  description: 'Get a snapshot of the current browser page showing all interactive elements with their ref numbers. Use this to see what\'s on the page before clicking or filling.',
  category: 'browser',
  parameters: {},
  async execute(params, ctx): Promise<ToolCallResult> {
    const existing = taskPages.get(ctx.taskId);
    if (!existing || existing.page.isClosed()) {
      return { success: false, error: 'No browser page open. Use browser_go first.', cost: 0 };
    }
    try {
      const snapshot = await getPageSnapshot(existing.page);
      return { success: true, data: snapshot, cost: 0 };
    } catch (err) {
      return { success: false, error: `Snapshot failed: ${err instanceof Error ? err.message : 'unknown'}`, cost: 0 };
    }
  },
});

registerTool({
  name: 'browser_click',
  description: 'Click an element on the page by its ref number from the snapshot.',
  category: 'browser',
  parameters: {
    ref: { type: 'number', description: 'The [ref] number from the page snapshot' },
  },
  required: ['ref'],
  async execute(params, ctx): Promise<ToolCallResult> {
    const existing = taskPages.get(ctx.taskId);
    if (!existing || existing.page.isClosed()) {
      return { success: false, error: 'No browser page open. Use browser_go first.', cost: 0 };
    }
    const ref = Number(params.ref);
    try {
      // Use Playwright's native click for better reliability (waits for actionability, handles overlays)
      const locator = existing.page.locator(`[data-aevoy-ref="${ref}"]`);
      const count = await locator.count();
      if (count === 0) {
        return { success: false, error: `Element [${ref}] not found. The page may have changed — call browser_snapshot() to get fresh refs.`, cost: 0 };
      }
      const info = await locator.evaluate((el: HTMLElement) => ({
        tag: el.tagName,
        text: (el.textContent || '').trim().substring(0, 50),
      }));
      await locator.click({ timeout: 5000 }).catch(async () => {
        // Fallback: JS click for elements obscured by overlays
        await locator.evaluate((el: HTMLElement) => el.click());
      });

      await existing.page.waitForTimeout(1000);
      // Auto-solve CAPTCHAs triggered by the click (signup/submit buttons often trigger them)
      const captcha = await autoSolveCaptcha(existing.page, ctx);
      const snapshot = await getPageSnapshot(existing.page);
      return { success: true, data: `Clicked [${ref}] (${info.tag} "${info.text}")${captcha.note ? '\n' + captcha.note : ''}\n\n${snapshot}`, cost: captcha.cost };
    } catch (err) {
      return { success: false, error: `Click failed: ${err instanceof Error ? err.message : 'unknown'}`, cost: 0 };
    }
  },
});

registerTool({
  name: 'browser_fill',
  description: 'Fill a text input field on the page by its ref number. Use this for forms — fill one field at a time.',
  category: 'browser',
  parameters: {
    ref: { type: 'number', description: 'The [ref] number of the input field from the snapshot' },
    value: { type: 'string', description: 'The text to type into the field' },
  },
  required: ['ref', 'value'],
  async execute(params, ctx): Promise<ToolCallResult> {
    const existing = taskPages.get(ctx.taskId);
    if (!existing || existing.page.isClosed()) {
      return { success: false, error: 'No browser page open. Use browser_go first.', cost: 0 };
    }
    const ref = Number(params.ref);
    const value = String(params.value);
    try {
      // Use Playwright's native fill() for React/Vue/Angular compatibility
      // el.value = x doesn't trigger React state updates, but Playwright's fill() does
      const locator = existing.page.locator(`[data-aevoy-ref="${ref}"]`);
      const count = await locator.count();
      if (count === 0) {
        return { success: false, error: `Input [${ref}] not found. The page may have changed — call browser_snapshot() to get fresh refs.`, cost: 0 };
      }
      await locator.scrollIntoViewIfNeeded().catch(() => {});
      // Clear existing value first, then type the new value
      await locator.fill(value).catch(async () => {
        // Fallback: some inputs (date pickers, custom widgets) don't support fill()
        await locator.click();
        await locator.evaluate((el: any) => { el.value = ''; });
        await locator.pressSequentially(value, { delay: 30 });
      });
      const name = await locator.evaluate((el: HTMLInputElement) =>
        el.getAttribute('name') || el.getAttribute('placeholder') || el.getAttribute('aria-label') || ''
      ).catch(() => '');

      return { success: true, data: `Filled [${ref}] "${name}" with "${value}"`, cost: 0 };
    } catch (err) {
      return { success: false, error: `Fill failed: ${err instanceof Error ? err.message : 'unknown'}`, cost: 0 };
    }
  },
});

registerTool({
  name: 'browser_scroll',
  description: 'Scroll the page up or down to see more content.',
  category: 'browser',
  parameters: {
    direction: { type: 'string', description: 'Scroll direction: "down" or "up"', enum: ['down', 'up'] },
  },
  required: ['direction'],
  async execute(params, ctx): Promise<ToolCallResult> {
    const existing = taskPages.get(ctx.taskId);
    if (!existing || existing.page.isClosed()) {
      return { success: false, error: 'No browser page open.', cost: 0 };
    }
    try {
      const delta = params.direction === 'up' ? -500 : 500;
      await existing.page.mouse.wheel(0, delta);
      await existing.page.waitForTimeout(500);
      const snapshot = await getPageSnapshot(existing.page);
      return { success: true, data: `Scrolled ${params.direction}\n\n${snapshot}`, cost: 0 };
    } catch (err) {
      return { success: false, error: `Scroll failed: ${err instanceof Error ? err.message : 'unknown'}`, cost: 0 };
    }
  },
});

registerTool({
  name: 'browser_type',
  description: 'Type text character by character into the currently focused element. Use this for fields that need real keystrokes (like search boxes with autocomplete).',
  category: 'browser',
  parameters: {
    text: { type: 'string', description: 'Text to type' },
  },
  required: ['text'],
  async execute(params, ctx): Promise<ToolCallResult> {
    const existing = taskPages.get(ctx.taskId);
    if (!existing || existing.page.isClosed()) {
      return { success: false, error: 'No browser page open.', cost: 0 };
    }
    try {
      await existing.page.keyboard.type(String(params.text), { delay: 50 });
      await existing.page.waitForTimeout(500);
      return { success: true, data: `Typed "${params.text}"`, cost: 0 };
    } catch (err) {
      return { success: false, error: `Type failed: ${err instanceof Error ? err.message : 'unknown'}`, cost: 0 };
    }
  },
});

registerTool({
  name: 'browser_press',
  description: 'Press a keyboard key (Enter, Tab, Escape, etc.).',
  category: 'browser',
  parameters: {
    key: { type: 'string', description: 'Key to press: Enter, Tab, Escape, Backspace, ArrowDown, ArrowUp' },
  },
  required: ['key'],
  async execute(params, ctx): Promise<ToolCallResult> {
    const existing = taskPages.get(ctx.taskId);
    if (!existing || existing.page.isClosed()) {
      return { success: false, error: 'No browser page open.', cost: 0 };
    }
    try {
      await existing.page.keyboard.press(String(params.key));
      await existing.page.waitForTimeout(500);
      return { success: true, data: `Pressed ${params.key}`, cost: 0 };
    } catch (err) {
      return { success: false, error: `Key press failed: ${err instanceof Error ? err.message : 'unknown'}`, cost: 0 };
    }
  },
});

registerTool({
  name: 'browser_read',
  description: 'Read the visible text content of the current page. Use this to extract information like prices, titles, descriptions.',
  category: 'browser',
  parameters: {},
  async execute(params, ctx): Promise<ToolCallResult> {
    const existing = taskPages.get(ctx.taskId);
    if (!existing || existing.page.isClosed()) {
      return { success: false, error: 'No browser page open.', cost: 0 };
    }
    try {
      const text = await existing.page.evaluate(() => {
        return document.body.innerText.substring(0, 3000);
      });
      return { success: true, data: text || 'Page has no visible text', cost: 0 };
    } catch (err) {
      return { success: false, error: `Read failed: ${err instanceof Error ? err.message : 'unknown'}`, cost: 0 };
    }
  },
});

// ── Vision Tools (Phase 3: Hybrid DOM+Vision) ──

registerTool({
  name: 'browser_screenshot',
  description: 'Take a screenshot of the current page and get a visual description of what is on screen. Use this when the page has too many elements (150+), or when you need to understand visual layout (date pickers, time grids, calendars). Returns a text description of what is visible and key clickable areas with approximate coordinates.',
  category: 'browser',
  parameters: {},
  async execute(params, ctx): Promise<ToolCallResult> {
    const existing = taskPages.get(ctx.taskId);
    if (!existing || existing.page.isClosed()) {
      return { success: false, error: 'No browser page open.', cost: 0 };
    }
    try {
      // Get actual viewport size for accurate coordinate mapping
      const vpSize = existing.page.viewportSize() || { width: 1280, height: 720 };
      const screenshot = await takePageScreenshot(existing.page);
      let url = 'unknown';
      try { url = existing.page.url(); } catch { /* ignore */ }
      // Use Gemini Vision to describe the page
      const { generateVisionResponse } = await import('../../services/ai.js');
      const visionResult = await generateVisionResponse(
        `Analyze this screenshot of ${url}. The viewport is exactly ${vpSize.width}x${vpSize.height} pixels.

List ALL visible interactive elements in this exact format (one per line):
ELEMENT: [description] | TYPE: [button/link/input/dropdown/tab/time-slot/date/checkbox] | COORDS: (x, y)

Where (x, y) is the CENTER of the element in pixels from top-left.
Be precise — a few pixels off means clicking the wrong element.

Also describe:
- PAGE LAYOUT: What is the page structure (header, sidebar, main content)?
- CURRENT STATE: What is selected/active (e.g., "2 guests selected", "March 15 selected")?
- KEY ACTION NEEDED: What should be clicked next to progress?`,
        screenshot,
        'You are a precise UI element coordinate mapper. Your coordinates must be accurate to within 10 pixels. When listing elements, focus on interactive ones that can be clicked.',
        ctx.userId,
        ctx.taskId
      );
      return {
        success: true,
        data: `Page: ${url} (${vpSize.width}x${vpSize.height})\n\n${visionResult.content}\n\nUse browser_click_xy(x, y) to click at the coordinates listed above.`,
        cost: visionResult.cost,
      };
    } catch (err) {
      return { success: false, error: `Screenshot analysis failed: ${err instanceof Error ? err.message : 'unknown'}`, cost: 0 };
    }
  },
});

registerTool({
  name: 'browser_click_xy',
  description: 'Click at specific pixel coordinates on the page. Use this after browser_screenshot() when you can see where to click. Coordinates are relative to the top-left corner of the viewport. Use human-like mouse movement.',
  category: 'browser',
  parameters: {
    x: { type: 'number', description: 'X coordinate in pixels from left edge of viewport' },
    y: { type: 'number', description: 'Y coordinate in pixels from top edge of viewport' },
  },
  required: ['x', 'y'],
  async execute(params, ctx): Promise<ToolCallResult> {
    const existing = taskPages.get(ctx.taskId);
    if (!existing || existing.page.isClosed()) {
      return { success: false, error: 'No browser page open.', cost: 0 };
    }
    const vpSize = existing.page.viewportSize() || { width: 1280, height: 720 };
    const x = Math.max(5, Math.min(vpSize.width - 5, Number(params.x)));
    const y = Math.max(5, Math.min(vpSize.height - 5, Number(params.y)));
    try {
      // Use ghost cursor for human-like movement if available
      try {
        const { createCursor } = await import('ghost-cursor-patchright-core');
        const cursor = createCursor(existing.page);
        await cursor.moveTo({ x, y });
      } catch {
        // Ghost cursor not available, use direct mouse move
        await existing.page.mouse.move(x, y, { steps: 5 });
      }
      await existing.page.mouse.click(x, y);
      await existing.page.waitForTimeout(1000);
      const captcha = await autoSolveCaptcha(existing.page, ctx);
      const snapshot = await getPageSnapshot(existing.page);
      return { success: true, data: `Clicked at (${x}, ${y})${captcha.note ? '\n' + captcha.note : ''}\n\n${snapshot}`, cost: captcha.cost };
    } catch (err) {
      return { success: false, error: `Click at (${x}, ${y}) failed: ${err instanceof Error ? err.message : 'unknown'}`, cost: 0 };
    }
  },
});

registerTool({
  name: 'browser_locate',
  description: 'Find an element on the page by visual description and return its coordinates. Use when you know WHAT to click but not WHERE. Takes a screenshot and uses AI vision to find the element. Returns x, y coordinates for browser_click_xy.',
  category: 'browser',
  parameters: {
    description: { type: 'string', description: 'Visual description of what to find (e.g. "7:30 PM time slot", "Add to Cart button", "search icon")' },
  },
  required: ['description'],
  async execute(params, ctx): Promise<ToolCallResult> {
    const existing = taskPages.get(ctx.taskId);
    if (!existing || existing.page.isClosed()) {
      return { success: false, error: 'No browser page open.', cost: 0 };
    }
    try {
      const { predictClickCoordinates } = await import('../../execution/vigorl.js');
      const result = await predictClickCoordinates(existing.page, String(params.description));
      if (result && result.x !== undefined && result.y !== undefined) {
        return {
          success: true,
          data: `Found "${params.description}" at coordinates (${result.x}, ${result.y}). Confidence: ${result.confidence || 'medium'}. Use browser_click_xy(${result.x}, ${result.y}) to click it.`,
          cost: 0.001,
        };
      }
      return { success: false, error: `Could not find "${params.description}" on the page. Try browser_screenshot() to see the page and identify coordinates manually.`, cost: 0 };
    } catch (err) {
      return { success: false, error: `Locate failed: ${err instanceof Error ? err.message : 'unknown'}`, cost: 0 };
    }
  },
});

registerTool({
  name: 'browser_select',
  description: 'Select an option from a <select> dropdown by its ref number. Use when the snapshot shows a "combobox" element.',
  category: 'browser',
  parameters: {
    ref: { type: 'number', description: 'The [ref] number of the select/combobox element' },
    value: { type: 'string', description: 'The value or visible text of the option to select' },
  },
  required: ['ref', 'value'],
  async execute(params, ctx): Promise<ToolCallResult> {
    const existing = taskPages.get(ctx.taskId);
    if (!existing || existing.page.isClosed()) {
      return { success: false, error: 'No browser page open.', cost: 0 };
    }
    const ref = Number(params.ref);
    const value = String(params.value);
    try {
      const locator = existing.page.locator(`[data-aevoy-ref="${ref}"]`);
      const count = await locator.count();
      if (count === 0) {
        return { success: false, error: `Dropdown [${ref}] not found. Call browser_snapshot() for fresh refs.`, cost: 0 };
      }
      // Try Playwright's native selectOption (works with React/Vue)
      try {
        await locator.selectOption({ label: value }, { timeout: 3000 }).catch(async () => {
          // Fallback: try by value attribute
          await locator.selectOption(value, { timeout: 3000 });
        });
        return { success: true, data: `Selected "${value}" in dropdown [${ref}]`, cost: 0 };
      } catch {
        // Show available options if selection failed
        const options = await locator.evaluate((el: HTMLSelectElement) => {
          if (el.tagName !== 'SELECT') return [];
          return Array.from(el.options).map(o => `"${o.text}" (value="${o.value}")`);
        }).catch(() => [] as string[]);
        return {
          success: false,
          error: `Could not select "${value}" in dropdown [${ref}]. Available options: ${options.join(', ')}`,
          cost: 0,
        };
      }
    } catch (err) {
      return { success: false, error: `Select failed: ${err instanceof Error ? err.message : 'unknown'}`, cost: 0 };
    }
  },
});

registerTool({
  name: 'browser_wait',
  description: 'Wait for a specified number of seconds. Use when a page is loading or after a click triggers a navigation.',
  category: 'browser',
  parameters: {
    seconds: { type: 'number', description: 'Number of seconds to wait (1-10)' },
  },
  required: ['seconds'],
  async execute(params, ctx): Promise<ToolCallResult> {
    const existing = taskPages.get(ctx.taskId);
    if (!existing) {
      return { success: false, error: 'No browser page open.', cost: 0 };
    }
    const seconds = Math.max(1, Math.min(10, Number(params.seconds) || 2));
    await existing.page.waitForTimeout(seconds * 1000);
    const snapshot = await getPageSnapshot(existing.page);
    return { success: true, data: `Waited ${seconds}s\n\n${snapshot}`, cost: 0 };
  },
});
