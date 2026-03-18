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
  // Calendar/picker widgets — standard ARIA roles for date pickers, grids, dialogs
  '[role="gridcell"]', '[role="cell"]', '[role="dialog"]', '[role="menu"]',
  '[role="navigation"]', '[role="spinbutton"]', '[role="treeitem"]',
  // Generic interactivity signals
  '[contenteditable="true"]', '[tabindex]', '[onclick]',
  '[aria-haspopup]', '[aria-expanded]',
  'li[class*="option"]', 'div[class*="option"]', 'span[class*="option"]',
];

// ── Per-task page cache (shared with browser.ts via engine cache) ──
// refMap: stores ref→{text,role,tag} from last snapshot for auto-fallback when refs break
// failCount: consecutive interaction failures — triggers escalation hint after 3+
const taskPages = new Map<string, {
  page: Page;
  engine: ExecutionEngine;
  refMap: Map<number, { text: string; role: string; tag: string }>;
  failCount: number;
}>();

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

  // Use VPS Chrome (fast, reliable) as primary. BrightData used as fallback
  // when VPS Chrome gets blocked (detected by browser_go connection failure check).
  // The engine handles the priority chain: VPS Chrome → BrightData → Local.
  const engine = new ExecutionEngine(lockedIntent);
  await engine.initialize(ctx.userId, domain, ctx.taskId);
  const page = engine.getPage();
  if (!page) throw new Error('Failed to create browser page');

  // Force consistent viewport so vision coordinates match click coordinates
  try { await page.setViewportSize({ width: 1280, height: 720 }); } catch { /* ignore */ }

  taskPages.set(ctx.taskId, { page, engine, refMap: new Map(), failCount: 0 });
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
        return {
          solved: false,
          note: `⚠️ CAPTCHA BLOCKING THIS PAGE (${detection.type}). Auto-solve FAILED: ${solveResult.error}. YOU MUST CHANGE STRATEGY:\n` +
            `1. Look for "Sign in with Google" or social login button — bypasses CAPTCHA\n` +
            `2. Try a DIFFERENT site that offers the same service\n` +
            `3. Use Google search to find the info without visiting this site\n` +
            `DO NOT keep clicking on this page — the CAPTCHA will not go away.`,
          cost: 0,
        };
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
async function getPageSnapshot(page: Page, _taskId?: string): Promise<string> {
  try {
    const url = page.url();
    const title = await page.title().catch(() => '');

    // PRIMARY: Use Playwright's built-in _snapshotForAI() — same method Playwright MCP uses.
    // Returns the COMPLETE accessibility tree with aria-ref numbers for every interactive element.
    // Handles shadow DOM, iframes, custom widgets, date pickers — everything.
    // 8-second timeout: if it hangs on remote CDP, fall back to DOM-based snapshot.
    try {
      const snapshot = await Promise.race([
        (page as any)._snapshotForAI(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('snapshotForAI timeout')), 8000)),
      ]);
      const ariaTree = snapshot.full || snapshot;
      if (ariaTree && typeof ariaTree === 'string' && ariaTree.length > 20) {
        // Truncate if too large (save tokens)
        const truncated = ariaTree.length > 6000 ? ariaTree.substring(0, 6000) + '\n\n... [truncated — use browser_click with ref numbers shown above]' : ariaTree;
        return `URL: ${url}\nTitle: ${title}\n\n${truncated}`;
      }
    } catch (e) {
      // _snapshotForAI timed out or not available — fall through to DOM snapshot
      console.log(`[V3-SNAPSHOT] _snapshotForAI failed (${e instanceof Error ? e.message : 'unknown'}), using DOM fallback`);
    }

    // FALLBACK: DOM-based snapshot for when _snapshotForAI hangs (remote CDP)
    const result = await Promise.race([
      page.evaluate((selectors: string[]) => {
        document.querySelectorAll('[data-aevoy-ref]').forEach(el => el.removeAttribute('data-aevoy-ref'));
        const seen = new Set<Element>();
        const items: string[] = [];
        let totalCount = 0;
        let ref = 1;
        for (const sel of selectors) {
          document.querySelectorAll(sel).forEach(el => {
            if (seen.has(el)) return;
            seen.add(el);
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            totalCount++;
            (el as HTMLElement).setAttribute('data-aevoy-ref', String(ref));
            if (items.length < 50) {
              const tag = el.tagName.toLowerCase();
              const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'button' ? 'button' :
                tag === 'input' ? (el.getAttribute('type') || 'textbox') : tag === 'select' ? 'combobox' :
                tag === 'textarea' ? 'textbox' : tag);
              const name = el.getAttribute('aria-label') || el.getAttribute('placeholder') ||
                (el.textContent || '').trim().substring(0, 60) || el.getAttribute('name') || '';
              const value = (el as HTMLInputElement).value || '';
              items.push(`[${ref}] ${role} "${name}"${value ? ` value="${value}"` : ''}`);
            }
            ref++;
          });
        }
        return { elements: items, totalCount, url: location.href };
      }, INTERACTIVE_SELECTORS),
      new Promise<any>(r => setTimeout(() => r({ elements: [], totalCount: 0, url: '' }), 5000)),
    ]);

    const lines = [`URL: ${result.url || url}`, `Title: ${title}`, `Interactive elements: ${result.totalCount} (DOM fallback)`, ''];
    if (result.totalCount === 0) {
      lines.push('No interactive elements found. Try browser_wait(3) then browser_snapshot().');
    } else {
      lines.push(...result.elements);
      if (result.totalCount > 50) lines.push(`\n... ${result.totalCount - 50} more elements not shown.`);
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
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(1500);
      // Reset failure counter on successful navigation
      const entry = taskPages.get(ctx.taskId);
      if (entry) entry.failCount = 0;

      // Detect ACTUAL connection failures — NOT content-level blocks
      // Only flag chrome-error:// and truly empty pages. Let the AI handle 403s and CAPTCHAs.
      const currentUrl = page.url();
      const bodyText = await page.evaluate(() => (document.body?.innerText || '').substring(0, 500)).catch(() => '');
      const isErrorPage = currentUrl.startsWith('chrome-error://') || currentUrl === 'about:blank';
      const isConnectionFailure = isErrorPage
        || /ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|ERR_CERT|ERR_SSL|ERR_TIMED_OUT|ERR_INTERNET|ERR_HTTP2|ERR_BLOCKED|ERR_ABORTED|ERR_FAILED/i.test(bodyText)
        || (bodyText.length === 0 && currentUrl === 'about:blank');
      if (isConnectionFailure) {
          console.log(`[V3-BROWSER] Connection failure for ${url}: "${bodyText.substring(0, 100)}"`);

          // Escalate to BrightData (residential IP + CAPTCHA solving) if available
          const bdWs = process.env.BRIGHT_DATA_BROWSER_WS;
          if (bdWs && !taskPages.get(ctx.taskId)?.engine?.useBrightData) {
            console.log(`[V3-BROWSER] Escalating to BrightData for ${url}`);
            await cleanupTaskPage(ctx.taskId);
            // Force BrightData by temporarily hiding VPS CDP
            const savedCdp = process.env.REMOTE_BROWSER_CDP;
            delete process.env.REMOTE_BROWSER_CDP;
            try {
              const { page: bdPage } = await getOrCreatePage(ctx, url);
              process.env.REMOTE_BROWSER_CDP = savedCdp;
              await bdPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
              await bdPage.waitForTimeout(2000);
              const bdUrl = bdPage.url();
              if (!bdUrl.startsWith('chrome-error://') && bdUrl !== 'about:blank') {
                console.log(`[V3-BROWSER] BrightData SUCCESS for ${url}`);
                const captcha = await autoSolveCaptcha(bdPage, ctx);
                const snapshot = await getPageSnapshot(bdPage, ctx.taskId);
                return { success: true, data: `${captcha.note ? captcha.note + '\n\n' : ''}${snapshot}`, cost: 0.055 + (captcha.cost || 0) };
              }
              // BrightData also failed
              await cleanupTaskPage(ctx.taskId);
            } catch (bdErr) {
              process.env.REMOTE_BROWSER_CDP = savedCdp;
              console.warn(`[V3-BROWSER] BrightData escalation failed:`, bdErr instanceof Error ? bdErr.message : bdErr);
              try { await cleanupTaskPage(ctx.taskId); } catch {}
            }
          }

          return {
            success: false,
            error: `Connection failed: ${url}. Try: browser_go("https://www.google.com/search?q=${encodeURIComponent(url.replace(/https?:\/\//, ''))}")`,
            cost: 0,
          };
      }

      // Detect CAPTCHA/block pages that loaded but need BrightData to bypass
      const isCaptchaPage = /captcha|verify.*human|security check|access denied|403 forbidden|just a moment|checking your browser|cloudflare|please wait|ray id|enable javascript|enable cookies|bot detection|imperva|incapsula|datadome|akamai/i.test(bodyText);
      if (isCaptchaPage && process.env.BRIGHT_DATA_BROWSER_WS && !taskPages.get(ctx.taskId)?.engine?.useBrightData) {
        console.log(`[V3-BROWSER] CAPTCHA/block page on VPS Chrome for ${url} — escalating to BrightData`);
        await cleanupTaskPage(ctx.taskId);
        const savedCdp = process.env.REMOTE_BROWSER_CDP;
        delete process.env.REMOTE_BROWSER_CDP;
        try {
          const { page: bdPage } = await getOrCreatePage(ctx, url);
          process.env.REMOTE_BROWSER_CDP = savedCdp;
          await bdPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          await bdPage.waitForTimeout(2000);
          const captcha = await autoSolveCaptcha(bdPage, ctx);
          const snapshot = await getPageSnapshot(bdPage, ctx.taskId);
          return { success: true, data: `(Switched to residential proxy to bypass block)\n\n${captcha.note ? captcha.note + '\n\n' : ''}${snapshot}`, cost: 0.055 + (captcha.cost || 0) };
        } catch (bdErr) {
          process.env.REMOTE_BROWSER_CDP = savedCdp;
          console.warn(`[V3-BROWSER] BrightData CAPTCHA bypass failed:`, bdErr instanceof Error ? bdErr.message : bdErr);
          try { await cleanupTaskPage(ctx.taskId); } catch {}
          // Fall through to show the CAPTCHA page to the AI
        }
      }

      // Auto-dismiss cookie banners and overlays that block interaction
      await page.evaluate(() => {
        const bannerSelectors = [
          '[class*="cookie"] button', '[id*="cookie"] button',
          '[class*="consent"] button', '[id*="consent"] button',
          'button[class*="accept"]', 'button[id*="accept"]',
          '[class*="gdpr"] button', '[aria-label*="cookie"]',
          '[data-testid*="cookie"] button', '[class*="banner"] button[class*="close"]',
          '.onetrust-accept-btn-handler', '#onetrust-accept-btn-handler',
          '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
        ];
        for (const sel of bannerSelectors) {
          const btn = document.querySelector(sel) as HTMLElement;
          if (btn && btn.offsetHeight > 0) { btn.click(); break; }
        }
      }).catch(() => {});

      // Auto-solve any CAPTCHAs that appeared after navigation
      const captcha = await autoSolveCaptcha(page, ctx);
      const snapshot = await getPageSnapshot(page, ctx.taskId);
      return { success: true, data: `${captcha.note ? captcha.note + '\n\n' : ''}${snapshot}`, cost: captcha.cost };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'unknown';
      // Protocol/network errors (ERR_HTTP2, ERR_CONNECTION, etc.) — try BrightData
      const isNetworkError = /ERR_|net::|Protocol|PROTOCOL|timeout|crashed|closed/i.test(errMsg);
      if (isNetworkError && process.env.BRIGHT_DATA_BROWSER_WS && !taskPages.get(ctx.taskId)?.engine?.useBrightData) {
        console.log(`[V3-BROWSER] Navigation threw ${errMsg} — escalating to BrightData`);
        try { await cleanupTaskPage(ctx.taskId); } catch {}
        const savedCdp = process.env.REMOTE_BROWSER_CDP;
        delete process.env.REMOTE_BROWSER_CDP;
        try {
          const { page: bdPage } = await getOrCreatePage(ctx, url);
          process.env.REMOTE_BROWSER_CDP = savedCdp;
          await bdPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          await bdPage.waitForTimeout(2000);
          const captcha = await autoSolveCaptcha(bdPage, ctx);
          const snapshot = await getPageSnapshot(bdPage, ctx.taskId);
          return { success: true, data: `(Escalated to residential browser)\n\n${captcha.note ? captcha.note + '\n\n' : ''}${snapshot}`, cost: 0.055 + (captcha.cost || 0) };
        } catch (bdErr) {
          process.env.REMOTE_BROWSER_CDP = savedCdp;
          try { await cleanupTaskPage(ctx.taskId); } catch {}
          return { success: false, error: `Site blocks automated browsers. Even residential proxy failed. Try Google search: browser_go("https://www.google.com/search?q=${encodeURIComponent(url.replace(/https?:\/\//, ''))}")`, cost: 0 };
        }
      }
      return { success: false, error: `Navigation failed: ${errMsg}. Try a different site or Google search.`, cost: 0 };
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
      const snapshot = await getPageSnapshot(existing.page, ctx.taskId);
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
      // PRIMARY: Try aria-ref (Playwright MCP native — works with _snapshotForAI)
      let locator = existing.page.locator(`aria-ref=${ref}`);
      let count = 0;
      try { count = await locator.count(); } catch { count = 0; }
      // FALLBACK: Try data-aevoy-ref (our DOM-stamped refs from DOM fallback snapshot)
      if (count === 0) {
        locator = existing.page.locator(`[data-aevoy-ref="${ref}"]`);
        count = await locator.count();
      }
      // If not in main frame, check iframes
      if (count === 0) {
        for (const frame of existing.page.frames()) {
          if (frame === existing.page.mainFrame()) continue;
          try {
            const fLoc = frame.locator(`[data-aevoy-ref="${ref}"]`);
            if (await fLoc.count() > 0) { locator = fLoc; count = 1; break; }
          } catch { /* skip */ }
        }
      }
      // AUTO-FALLBACK: if ref attribute lost (SPA re-render), use saved text/role from last snapshot
      if (count === 0) {
        const savedRef = existing.refMap.get(ref);
        if (savedRef?.text) {
          // Try to find the element by its original text and role
          const roles = savedRef.role === 'link' ? ['link'] : savedRef.role === 'button' ? ['button'] :
            ['button', 'link', 'tab', 'menuitem', 'option'] as const;
          let fallbackLoc = null;
          for (const r of roles) {
            const loc = existing.page.getByRole(r as any, { name: savedRef.text, exact: false });
            if (await loc.count() > 0) { fallbackLoc = loc; break; }
          }
          if (!fallbackLoc) {
            const textLoc = existing.page.getByText(savedRef.text, { exact: false });
            if (await textLoc.count() > 0) fallbackLoc = textLoc;
          }
          if (fallbackLoc) {
            await fallbackLoc.first().click({ timeout: 5000 });
            existing.failCount = 0;
            await existing.page.waitForTimeout(1000);
            const captcha = await autoSolveCaptcha(existing.page, ctx);
            const snapshot = await getPageSnapshot(existing.page, ctx.taskId);
            return { success: true, data: `Clicked "${savedRef.text}" (auto-resolved from [${ref}] — page re-rendered)${captcha.note ? '\n' + captcha.note : ''}\n\n${snapshot}`, cost: captcha.cost };
          }
        }
        existing.failCount++;
        const hint = existing.failCount >= 3
          ? ' HINT: Multiple clicks failing — the site may have bot detection. Try browser_go to the same URL to re-establish the session (system auto-escalates to residential proxy when blocked).'
          : '';
        return { success: false, error: `Element [${ref}] not found (page may have re-rendered). Try browser_click_text("element text") instead.${hint}`, cost: 0 };
      }
      const info = await locator.evaluate((el: HTMLElement) => ({
        tag: el.tagName,
        text: (el.textContent || '').trim().substring(0, 50),
      }));
      await locator.click({ timeout: 5000 }).catch(async () => {
        // Fallback: JS click for elements obscured by overlays
        await locator.evaluate((el: HTMLElement) => el.click());
      });
      existing.failCount = 0; // Reset on success

      await existing.page.waitForTimeout(1000);

      // Check if click opened a new tab/popup (booking widgets, OAuth, payment)
      // Uses context().pages() — instant check, no 3s wait penalty
      try {
        const allPages = existing.page.context().pages();
        const newPage = allPages.find(p => p !== existing.page && !p.isClosed());
        if (newPage) {
          console.log(`[V3-BROWSER] Click opened popup: ${newPage.url()}`);
          taskPages.set(ctx.taskId, { ...existing, page: newPage });
          await newPage.waitForTimeout(1500);
          const captcha = await autoSolveCaptcha(newPage, ctx);
          const snapshot = await getPageSnapshot(newPage, ctx.taskId);
          return { success: true, data: `Clicked [${ref}] (${info.tag} "${info.text}") → opened new page\n${captcha.note ? captcha.note + '\n' : ''}${snapshot}`, cost: captcha.cost };
        }
      } catch { /* context might be closed */ }
      // Auto-solve CAPTCHAs triggered by the click (signup/submit buttons often trigger them)
      const captcha = await autoSolveCaptcha(existing.page, ctx);
      const snapshot = await getPageSnapshot(existing.page, ctx.taskId);
      return { success: true, data: `Clicked [${ref}] (${info.tag} "${info.text}")${captcha.note ? '\n' + captcha.note : ''}\n\n${snapshot}`, cost: captcha.cost };
    } catch (err) {
      return { success: false, error: `Click failed: ${err instanceof Error ? err.message : 'unknown'}`, cost: 0 };
    }
  },
});

registerTool({
  name: 'browser_click_text',
  description: 'Click an element by its visible text or role. Use this when ref-based clicking fails, or for elements inside iframes/widgets that refs cannot reach (like date pickers, booking widgets, calendar days).',
  category: 'browser',
  parameters: {
    text: { type: 'string', description: 'The visible text of the element to click (e.g. "Book Now", "March 22", "7:00 PM", "Submit")' },
    role: { type: 'string', description: 'Optional: element role — button, link, tab, option, menuitem, checkbox, radio' },
  },
  required: ['text'],
  async execute(params, ctx): Promise<ToolCallResult> {
    const existing = taskPages.get(ctx.taskId);
    if (!existing || existing.page.isClosed()) {
      return { success: false, error: 'No browser page open. Use browser_go first.', cost: 0 };
    }
    const text = String(params.text);
    const role = params.role ? String(params.role) : '';
    try {
      // Strategy: try main frame first, then pierce iframes
      const findLocator = async () => {
        // 1. Main frame — role-based search
        if (role) {
          const loc = existing.page.getByRole(role as any, { name: text, exact: false });
          if (await loc.count() > 0) return loc;
        } else {
          for (const r of ['button', 'link', 'tab', 'menuitem', 'option'] as const) {
            const loc = existing.page.getByRole(r, { name: text, exact: false });
            if (await loc.count() > 0) return loc;
          }
        }
        // 2. Main frame — text search
        const textLoc = existing.page.getByText(text, { exact: false });
        if (await textLoc.count() > 0) return textLoc;

        // 3. IFRAME PIERCING — search inside all iframes
        // This is critical for booking widgets, date pickers, payment forms
        const frames = existing.page.frames();
        for (const frame of frames) {
          if (frame === existing.page.mainFrame()) continue;
          try {
            if (role) {
              const fLoc = frame.getByRole(role as any, { name: text, exact: false });
              if (await fLoc.count() > 0) return fLoc;
            } else {
              for (const r of ['button', 'link', 'tab', 'option'] as const) {
                const fLoc = frame.getByRole(r, { name: text, exact: false });
                if (await fLoc.count() > 0) return fLoc;
              }
            }
            const fText = frame.getByText(text, { exact: false });
            if (await fText.count() > 0) return fText;
          } catch { /* skip inaccessible frames */ }
        }
        return null;
      };

      const locator = await findLocator();
      if (!locator) {
        return { success: false, error: `No element found with text "${text}"${role ? ` (${role})` : ''} in main page or iframes. Try browser_snapshot() to see available elements.`, cost: 0 };
      }

      await locator.first().click({ timeout: 5000 });
      await existing.page.waitForTimeout(1000);

      // Check if click opened a new tab/popup — instant check via context().pages()
      try {
        const allPages = existing.page.context().pages();
        const newPage = allPages.find(p => p !== existing.page && !p.isClosed());
        if (newPage) {
          console.log(`[V3-BROWSER] Click text "${text}" opened popup: ${newPage.url()}`);
          taskPages.set(ctx.taskId, { ...existing, page: newPage });
          await newPage.waitForTimeout(1500);
          const captcha = await autoSolveCaptcha(newPage, ctx);
          const snapshot = await getPageSnapshot(newPage, ctx.taskId);
          return { success: true, data: `Clicked "${text}" → opened new page\n${captcha.note ? captcha.note + '\n' : ''}${snapshot}`, cost: captcha.cost };
        }
      } catch { /* context might be closed */ }
      const captcha = await autoSolveCaptcha(existing.page, ctx);
      const snapshot = await getPageSnapshot(existing.page, ctx.taskId);
      return { success: true, data: `Clicked "${text}"${role ? ` (${role})` : ''}${captcha.note ? '\n' + captcha.note : ''}\n\n${snapshot}`, cost: captcha.cost };
    } catch (err) {
      return { success: false, error: `Click by text failed: ${err instanceof Error ? err.message : 'unknown'}`, cost: 0 };
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
      // PRIMARY: aria-ref (Playwright native from _snapshotForAI)
      // FALLBACK: data-aevoy-ref (DOM-stamped from fallback snapshot)
      let locator = existing.page.locator(`aria-ref=${ref}`);
      let ariaCount = 0;
      try { ariaCount = await locator.count(); } catch { ariaCount = 0; }
      if (ariaCount === 0) locator = existing.page.locator(`[data-aevoy-ref="${ref}"]`);
      let count = await locator.count();
      // If not found in main frame, search iframes
      if (count === 0) {
        for (const frame of existing.page.frames()) {
          if (frame === existing.page.mainFrame()) continue;
          try {
            const frameLoc = frame.locator(`[data-aevoy-ref="${ref}"]`);
            if (await frameLoc.count() > 0) { locator = frameLoc; count = 1; break; }
          } catch { /* skip */ }
        }
      }
      // AUTO-FALLBACK: if ref lost (SPA re-render), find input by saved label/placeholder
      if (count === 0) {
        const savedRef = existing.refMap.get(ref);
        if (savedRef?.text) {
          // Try getByLabel, getByPlaceholder — common for input fields
          let fallbackLoc = existing.page.getByLabel(savedRef.text, { exact: false });
          if (await fallbackLoc.count() === 0) {
            fallbackLoc = existing.page.getByPlaceholder(savedRef.text, { exact: false });
          }
          if (await fallbackLoc.count() > 0) {
            await fallbackLoc.first().scrollIntoViewIfNeeded().catch(() => {});
            await fallbackLoc.first().fill(value).catch(async () => {
              await fallbackLoc.first().click();
              await fallbackLoc.first().pressSequentially(value, { delay: 30 });
            });
            existing.failCount = 0;
            return { success: true, data: `Filled "${savedRef.text}" with "${value}" (auto-resolved from [${ref}])`, cost: 0 };
          }
        }
        existing.failCount++;
        const hint = existing.failCount >= 3
          ? ' HINT: Multiple interactions failing — try browser_go to the same URL to refresh the session.'
          : '';
        return { success: false, error: `Input [${ref}] not found (page may have re-rendered). Call browser_snapshot() for fresh refs.${hint}`, cost: 0 };
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
      const snapshot = await getPageSnapshot(existing.page, ctx.taskId);
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
      const snapshot = await getPageSnapshot(existing.page, ctx.taskId);
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
    const snapshot = await getPageSnapshot(existing.page, ctx.taskId);
    return { success: true, data: `Waited ${seconds}s\n\n${snapshot}`, cost: 0 };
  },
});
