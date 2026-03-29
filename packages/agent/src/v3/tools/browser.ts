/**
 * V3 Browser Tools — Steel.dev Integration
 *
 * Navigate, click, fill forms, and close browser sessions via Steel.dev.
 * Each tool is designed for use in the multi_step tier's tool-calling loop.
 *
 * Session lifecycle:
 *   browser_go (auto-creates session) → browser_click / browser_fill → browser_close
 *   Sessions auto-close on task completion or timeout (5 min).
 */

import { registerTool } from '../tool-registry.js';
import type { ToolCallResult } from '../types.js';
import { createSession, destroySession, getPage, applyStealthMeasures, loadUserBrowserContext, saveUserBrowserContext } from '../../services/steel-browser.js';
import { detectAndSolve } from '../../services/captcha-solver.js';

// ── browser_go — Navigate to a URL ──

registerTool({
  name: 'browser_go',
  description: 'Navigate to a URL in the browser. Auto-creates a browser session if needed. Returns the page title, visible text content, and interactive elements (links, buttons, inputs) with index numbers you can use with browser_click.',
  category: 'browser',
  parameters: {
    url: { type: 'string', description: 'URL to navigate to (e.g. https://example.com)' },
  },
  required: ['url'],
  async execute(params, ctx): Promise<ToolCallResult> {
    try {
      let page = await getPage(ctx.taskId);
      if (!page) {
        const session = await createSession(ctx.taskId);
        page = session.page;
      }

      const url = String(params.url);

      // URL validation — block dangerous protocols and private IPs
      if (!/^https?:\/\//i.test(url)) {
        return { success: false, error: 'URL must start with http:// or https://', cost: 0 };
      }
      try {
        const parsed = new URL(url);
        const host = parsed.hostname;
        // Block private/internal IPs
        if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|localhost|::1)/i.test(host)) {
          return { success: false, error: 'Cannot navigate to private/internal addresses', cost: 0 };
        }
        // Block dangerous protocols that might slip through
        if (/^(javascript|data|file|ftp):/i.test(url)) {
          return { success: false, error: 'Protocol not allowed', cost: 0 };
        }
      } catch {
        return { success: false, error: 'Invalid URL format', cost: 0 };
      }

      // Restore saved cookies for this domain (if any exist for this user)
      try {
        const restored = await loadUserBrowserContext(page, ctx.userId, url);
        if (restored) {
          // Cookies loaded — navigation will use them automatically
        }
      } catch {
        // Non-critical: proceed without saved context
      }

      // Smart retry with escalating anti-blocking strategies
      let navigated = false;
      let lastError = '';
      let captchaCost = 0;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          if (attempt === 2) {
            // Retry 2: Strip automation headers via route interception
            await page.route('**/*', (route) => {
              const headers = route.request().headers();
              // Remove headers that signal automation
              delete headers['sec-ch-ua-platform'];
              // Override with cleaner headers
              route.continue({
                headers: {
                  ...headers,
                  'Cache-Control': 'max-age=0',
                  'DNT': '1',
                },
              });
            });
          } else if (attempt === 3) {
            // Retry 3: Switch to mobile user agent
            await page.unrouteAll({ behavior: 'wait' }).catch(() => {});
            await applyStealthMeasures(page, true); // mobile mode
          }

          // Add human-like delay between retries
          if (attempt > 1) {
            await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));
          }

          await page.goto(url, { waitUntil: 'networkidle', timeout: 25000 }).catch(async () => {
            // networkidle may timeout on heavy sites — fall back to domcontentloaded
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
          });
          navigated = true;
          break;
        } catch (err) {
          lastError = err instanceof Error ? err.message : 'unknown';
          // Don't retry on non-blocking errors
          if (!lastError.includes('timeout') && !lastError.includes('ERR_') && !lastError.includes('net::')) {
            break;
          }
        }
      }

      if (!navigated) {
        return {
          success: false,
          error: `Site unreachable after 3 attempts: ${lastError}. Use web_search instead or try a different site.`,
          cost: 0,
        };
      }

      // Auto-detect and solve CAPTCHAs (transparent to the AI, 30s max)
      let captchaResult: { hadCaptcha: boolean; solved: boolean; note?: string } = { hadCaptcha: false, solved: true };
      try {
        captchaResult = await Promise.race([
          detectAndSolve(page),
          new Promise<{ hadCaptcha: boolean; solved: boolean; note?: string }>((resolve) =>
            setTimeout(() => resolve({ hadCaptcha: false, solved: false, note: 'CAPTCHA detection timed out' }), 30_000)
          ),
        ]);
        if (captchaResult.hadCaptcha && captchaResult.solved) {
          captchaCost = 0.002;
        }
      } catch {
        captchaResult = { hadCaptcha: false, solved: false, note: 'CAPTCHA solving error' };
      }

      const title = await page.title();

      // Get visible text content, stripping scripts/styles
      const text = await page.evaluate(() => {
        const body = document.body;
        if (!body) return '';
        const clone = body.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('script,style,noscript,svg,link,meta').forEach(el => el.remove());
        return clone.innerText?.substring(0, 3000) || '';
      });

      // Get interactive elements with index numbers
      const elements = await page.evaluate(() => {
        const items: string[] = [];
        const selector = 'a, button, input, select, textarea, [role="button"], [role="combobox"], [role="listbox"], [role="option"], [role="tab"], [onclick], [data-testid]';
        document.querySelectorAll(selector).forEach((el, i) => {
          if (i > 50) return; // Cap at 50 elements for complex booking pages
          const tag = el.tagName.toLowerCase();
          const text = (el as HTMLElement).innerText?.substring(0, 50)?.trim();
          const type = el.getAttribute('type') || '';
          const name = el.getAttribute('name') || el.getAttribute('id') || '';
          const placeholder = el.getAttribute('placeholder') || '';
          const href = el.getAttribute('href') || '';
          const ariaLabel = el.getAttribute('aria-label') || '';

          let desc = `[${i}] ${tag}`;
          if (type) desc += ` type="${type}"`;
          if (name) desc += ` name="${name}"`;
          if (placeholder) desc += ` placeholder="${placeholder}"`;
          if (ariaLabel) desc += ` aria-label="${ariaLabel}"`;
          if (text) desc += `: "${text}"`;
          if (href && tag === 'a') desc += ` -> ${href.substring(0, 80)}`;
          items.push(desc);
        });
        return items.join('\n');
      });

      // Detect bot blocking AFTER CAPTCHA solving
      const lowerText = text.toLowerCase();
      const blocked =
        lowerText.includes('access denied') ||
        lowerText.includes('403 forbidden') ||
        lowerText.includes('bot detection') ||
        lowerText.includes('automated access') ||
        (lowerText.includes('cloudflare') && lowerText.includes('checking'));

      // Build status notes
      let statusNote = '';
      if (captchaResult.hadCaptcha && captchaResult.solved) {
        statusNote = '\n\n[CAPTCHA was detected and solved automatically]';
      } else if (captchaResult.note) {
        statusNote = `\n\n${captchaResult.note}`;
      }

      const blockWarning = blocked
        ? '\n\nBOT DETECTION: This site is blocking automated access. Try: (1) a different URL or competitor site, (2) use web_search instead, (3) try a mobile version (m.site.com).'
        : '';

      return {
        success: true,
        data: `Page: ${title}\nURL: ${page.url()}\n\nContent:\n${text.substring(0, 2000)}\n\nInteractive elements:\n${elements}${statusNote}${blockWarning}`,
        cost: 0.001 + captchaCost,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      if (msg.includes('timeout') || msg.includes('ERR_CONNECTION') || msg.includes('net::ERR')) {
        return {
          success: false,
          error: `Site unreachable or blocking automated access: ${msg}. Try: a different site, web_search, or a mobile/cached version.`,
          cost: 0,
        };
      }
      return {
        success: false,
        error: `Navigation failed: ${msg}`,
        cost: 0,
      };
    }
  },
});

// ── browser_click — Click an element ──

registerTool({
  name: 'browser_click',
  description: 'Click an interactive element on the page. Use either the index number from browser_go results, or text content to find the element. Returns the new page title after clicking.',
  category: 'browser',
  parameters: {
    index: { type: 'number', description: 'Element index number from the interactive elements list returned by browser_go' },
    text: { type: 'string', description: 'Alternative: click the first element containing this text' },
  },
  required: [],
  async execute(params, ctx): Promise<ToolCallResult> {
    const page = await getPage(ctx.taskId);
    if (!page) {
      return { success: false, error: 'No browser session. Use browser_go first to navigate to a page.', cost: 0 };
    }

    try {
      if (params.text) {
        // Click by text content
        await page.getByText(String(params.text), { exact: false }).first().click({ timeout: 5000 });
      } else if (params.index !== undefined) {
        // Click by index from interactive elements list
        const idx = Number(params.index);
        const selector = 'a, button, input, select, textarea, [role="button"], [onclick]';
        const elements = await page.$$(selector);
        if (idx >= 0 && idx < elements.length) {
          await elements[idx].click({ timeout: 5000 });
        } else {
          return { success: false, error: `Element index ${idx} out of range (0-${elements.length - 1})`, cost: 0 };
        }
      } else {
        return { success: false, error: 'Provide either "index" (number) or "text" (string) to identify what to click', cost: 0 };
      }

      // Wait for potential navigation/content change
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});

      const title = await page.title();
      const url = page.url();
      return { success: true, data: `Clicked. Page now: ${title}\nURL: ${url}`, cost: 0 };
    } catch (err) {
      return {
        success: false,
        error: `Click failed: ${err instanceof Error ? err.message : 'unknown'}`,
        cost: 0,
      };
    }
  },
});

// ── browser_fill — Fill form fields ──

registerTool({
  name: 'browser_fill',
  description: 'Fill one or more form fields by name, placeholder, label, or id. Pass a fields object mapping identifiers to values. Example: {"email": "user@example.com", "password": "secret123"}',
  category: 'browser',
  parameters: {
    fields: {
      type: 'object',
      description: 'Object mapping field identifier (name, placeholder, label, or id) to the value to fill. Example: {"email": "user@example.com", "password": "pass123", "First Name": "John"}',
    },
  },
  required: ['fields'],
  async execute(params, ctx): Promise<ToolCallResult> {
    const page = await getPage(ctx.taskId);
    if (!page) {
      return { success: false, error: 'No browser session. Use browser_go first to navigate to a page.', cost: 0 };
    }

    try {
      const fields = params.fields as Record<string, string>;
      if (!fields || typeof fields !== 'object') {
        return { success: false, error: 'fields must be an object mapping field names to values', cost: 0 };
      }

      const results: string[] = [];

      for (const [selector, value] of Object.entries(fields)) {
        const val = String(value);
        let filled = false;

        try {
          // Strategy 1: Try by placeholder (case-insensitive partial match)
          const byPlaceholder = page.locator(
            `input[placeholder*="${selector}" i], textarea[placeholder*="${selector}" i]`
          );
          if (await byPlaceholder.count() > 0) {
            await byPlaceholder.first().fill(val);
            filled = true;
          }

          // Strategy 2: Try by name or id attribute
          if (!filled) {
            const byName = page.locator(
              `[name="${selector}"], [id="${selector}"], [name*="${selector}" i], [id*="${selector}" i]`
            );
            if (await byName.count() > 0) {
              await byName.first().fill(val);
              filled = true;
            }
          }

          // Strategy 3: Try by label text
          if (!filled) {
            const byLabel = page.getByLabel(selector, { exact: false });
            if (await byLabel.count() > 0) {
              await byLabel.first().fill(val);
              filled = true;
            }
          }

          // Strategy 4: Try by aria-label
          if (!filled) {
            const byAria = page.locator(`[aria-label*="${selector}" i]`);
            if (await byAria.count() > 0) {
              await byAria.first().fill(val);
              filled = true;
            }
          }

          results.push(filled ? `OK: ${selector}` : `MISS: ${selector} (not found)`);
        } catch (e) {
          results.push(`FAIL: ${selector} (${e instanceof Error ? e.message : 'error'})`);
        }
      }

      const allOk = results.every(r => r.startsWith('OK'));
      return {
        success: allOk,
        data: `Fill results:\n${results.join('\n')}`,
        error: allOk ? undefined : 'Some fields could not be filled — check the results above',
        cost: 0,
      };
    } catch (err) {
      return {
        success: false,
        error: `Fill failed: ${err instanceof Error ? err.message : 'unknown'}`,
        cost: 0,
      };
    }
  },
});

// ── browser_snapshot — Read current page state ──

registerTool({
  name: 'browser_snapshot',
  description: 'Get the current page content and interactive elements without navigating. Use this to re-read the page after clicking or filling forms.',
  category: 'browser',
  parameters: {},
  required: [],
  async execute(_params, ctx): Promise<ToolCallResult> {
    const page = await getPage(ctx.taskId);
    if (!page) {
      return { success: false, error: 'No browser session. Use browser_go first to navigate to a page.', cost: 0 };
    }

    try {
      const title = await page.title();
      const url = page.url();

      const text = await page.evaluate(() => {
        const body = document.body;
        if (!body) return '';
        const clone = body.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('script,style,noscript,svg,link,meta').forEach(el => el.remove());
        return clone.innerText?.substring(0, 3000) || '';
      });

      const elements = await page.evaluate(() => {
        const items: string[] = [];
        const selector = 'a, button, input, select, textarea, [role="button"], [onclick]';
        document.querySelectorAll(selector).forEach((el, i) => {
          if (i > 30) return;
          const tag = el.tagName.toLowerCase();
          const elText = (el as HTMLElement).innerText?.substring(0, 50)?.trim();
          const type = el.getAttribute('type') || '';
          const name = el.getAttribute('name') || el.getAttribute('id') || '';
          const placeholder = el.getAttribute('placeholder') || '';
          const ariaLabel = el.getAttribute('aria-label') || '';

          let desc = `[${i}] ${tag}`;
          if (type) desc += ` type="${type}"`;
          if (name) desc += ` name="${name}"`;
          if (placeholder) desc += ` placeholder="${placeholder}"`;
          if (ariaLabel) desc += ` aria-label="${ariaLabel}"`;
          if (elText) desc += `: "${elText}"`;
          items.push(desc);
        });
        return items.join('\n');
      });

      return {
        success: true,
        data: `Page: ${title}\nURL: ${url}\n\nContent:\n${text.substring(0, 2000)}\n\nInteractive elements:\n${elements}`,
        cost: 0,
      };
    } catch (err) {
      return {
        success: false,
        error: `Snapshot failed: ${err instanceof Error ? err.message : 'unknown'}`,
        cost: 0,
      };
    }
  },
});

// ── browser_screenshot — Take a screenshot for debugging ──

registerTool({
  name: 'browser_screenshot',
  description: 'Take a screenshot of the current browser page. Useful for debugging blocked pages, CAPTCHAs, or understanding what the page looks like when DOM content is insufficient.',
  category: 'browser',
  parameters: {},
  required: [],
  async execute(_params, ctx): Promise<ToolCallResult> {
    const page = await getPage(ctx.taskId);
    if (!page) {
      return { success: false, error: 'No browser session. Use browser_go first to navigate to a page.', cost: 0 };
    }

    try {
      const screenshot = await page.screenshot({ type: 'jpeg', quality: 50 });
      const base64 = screenshot.toString('base64');
      // Don't return the actual image data to the model (too large for text context)
      // Instead, analyze the page state and return a useful description
      const title = await page.title();
      const url = page.url();

      // Check for common blocking indicators in the page content
      const bodyText = await page.evaluate(() => {
        return document.body?.innerText?.substring(0, 1000) || '';
      });
      const lowerBody = bodyText.toLowerCase();

      let pageStatus = 'accessible';
      if (lowerBody.includes('captcha') || lowerBody.includes('verify you are human') || lowerBody.includes('robot')) {
        pageStatus = 'CAPTCHA DETECTED — this site is blocking automated access. Try a different site or use web_search instead.';
      } else if (lowerBody.includes('access denied') || lowerBody.includes('403') || lowerBody.includes('forbidden')) {
        pageStatus = 'ACCESS DENIED — this site is blocking you. Try: mobile version (m.site.com), a competitor, or web_search.';
      } else if (lowerBody.includes('cloudflare') && (lowerBody.includes('checking') || lowerBody.includes('ray id'))) {
        pageStatus = 'CLOUDFLARE BLOCK — anti-bot protection active. Do NOT retry this site. Use web_search or try a competitor.';
      } else if (!bodyText.trim() || bodyText.trim().length < 20) {
        pageStatus = 'PAGE APPEARS EMPTY — may be loading JavaScript content, or the site blocked rendering. Try browser_snapshot() after waiting, or navigate elsewhere.';
      }

      return {
        success: true,
        data: `Screenshot taken of "${title}" (${url}).\nPage status: ${pageStatus}\nVisible text preview: ${bodyText.substring(0, 500)}`,
        cost: 0,
      };
    } catch (err) {
      return {
        success: false,
        error: `Screenshot failed: ${err instanceof Error ? err.message : 'unknown'}`,
        cost: 0,
      };
    }
  },
});

// ── browser_close — Close the browser session ──

registerTool({
  name: 'browser_close',
  description: 'Close the browser session and release resources. Call this when done with all browser tasks. Sessions also auto-close on task completion.',
  category: 'browser',
  parameters: {},
  required: [],
  async execute(_params, ctx): Promise<ToolCallResult> {
    // Save cookies/session state before closing (for future tasks on same domain)
    try {
      const page = await getPage(ctx.taskId);
      if (page) {
        await saveUserBrowserContext(page, ctx.userId);
      }
    } catch {
      // Non-critical: proceed with session destruction
    }

    await destroySession(ctx.taskId);
    return { success: true, data: 'Browser session closed.', cost: 0 };
  },
});

// ── browser_agent — Stagehand v3 autonomous agent for complex multi-step tasks ──

registerTool({
  name: 'browser_agent',
  description: 'Use this for complex multi-step browser tasks: bookings, signups, form filling, purchases. Provide a natural language instruction and the agent handles navigation, clicking, filling, and verification autonomously. Much better than manual browser_go/click/fill for complex workflows.',
  category: 'browser',
  parameters: {
    instruction: { type: 'string', description: 'Natural language instruction for what to accomplish (e.g. "Book a table for 2 at 7pm on Saturday")' },
    start_url: { type: 'string', description: 'Starting URL to navigate to before executing the instruction' },
    max_steps: { type: 'number', description: 'Maximum steps (default 25)' },
  },
  required: ['instruction'],
  async execute(params, ctx): Promise<ToolCallResult> {
    const instruction = String(params.instruction);
    const startUrl = params.start_url ? String(params.start_url) : undefined;
    const maxSteps = Number(params.max_steps) || 25;

    try {
      const { Stagehand } = await import('@browserbasehq/stagehand');

      // Initialize Stagehand with local browser
      // headless: false + Xvfb display :99 on Railway for CUA screenshot support
      // executablePath: Chrome installed via Dockerfile on Railway
      const chromePath = process.env.CHROME_PATH || '/usr/bin/google-chrome-stable';
      const stagehand = new Stagehand({
        env: 'LOCAL' as const,
        localBrowserLaunchOptions: {
          headless: false,
          executablePath: chromePath,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        },
        model: 'google/gemini-2.5-flash' as any,
        verbose: 1,
      });

      await stagehand.init();
      const page = stagehand.context.pages()[0];

      // Navigate to start URL if provided
      if (startUrl) {
        await page.goto(startUrl, { waitUntil: 'networkidle' as any, timeoutMs: 20000 }).catch(async () => {
          await page.goto(startUrl!, { waitUntil: 'domcontentloaded' as any, timeoutMs: 15000 });
        });
      }

      // Run the agent in CUA mode — vision-based, coordinate clicking
      // Gemini computer use: cheapest CUA model, handles complex SPAs + date pickers
      const agent = stagehand.agent({
        mode: 'cua',
        model: {
          modelName: 'google/gemini-2.5-computer-use-preview-10-2025' as any,
          apiKey: process.env.GOOGLE_API_KEY,
        },
      });

      const result = await agent.execute({
        instruction,
        maxSteps,
      });

      // Extract the result
      const actions = (result as any).actions || [];
      const finalMessage = (result as any).message || (result as any).finalMessage || '';
      const pageUrl = page.url();
      const pageTitle = await page.title().catch(() => '');

      // Get final page text for context
      const pageText = await page.evaluate(() => {
        const body = document.body;
        if (!body) return '';
        const clone = body.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('script,style,noscript,svg').forEach(el => el.remove());
        return clone.innerText?.substring(0, 2000) || '';
      }).catch(() => '');

      await stagehand.close().catch(() => {});

      const actionSummary = actions.length > 0
        ? `\n\nActions taken (${actions.length} steps):\n${actions.map((a: any, i: number) => `${i + 1}. ${a.reasoning || a.type || 'action'}`).join('\n')}`
        : '';

      const costEstimate = actions.length * 0.003; // ~$0.003 per step average

      return {
        success: true,
        data: `${finalMessage}\n\nFinal page: ${pageTitle} (${pageUrl})\n\nPage content:\n${pageText.substring(0, 1000)}${actionSummary}`,
        cost: costEstimate,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack?.substring(0, 300) : '';
      const { logger: log } = await import('../../utils/logger.js');
      log.error({ err: msg, stack }, '[BROWSER_AGENT] Stagehand CUA failed');
      return {
        success: false,
        error: `Browser agent error: ${msg}${stack ? ` | Stack: ${stack.substring(0, 150)}` : ''}`,
        cost: 0,
      };
    }
  },
});
