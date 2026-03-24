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
import { createSession, destroySession, getPage } from '../../services/steel-browser.js';

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

      // Basic URL validation
      if (!/^https?:\/\//i.test(url)) {
        return { success: false, error: 'URL must start with http:// or https://', cost: 0 };
      }

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

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
        const selector = 'a, button, input, select, textarea, [role="button"], [onclick]';
        document.querySelectorAll(selector).forEach((el, i) => {
          if (i > 30) return; // Cap at 30 elements to keep context manageable
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

      return {
        success: true,
        data: `Page: ${title}\nURL: ${page.url()}\n\nContent:\n${text.substring(0, 2000)}\n\nInteractive elements:\n${elements}`,
        cost: 0.001,
      };
    } catch (err) {
      return {
        success: false,
        error: `Navigation failed: ${err instanceof Error ? err.message : 'unknown'}`,
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

// ── browser_close — Close the browser session ──

registerTool({
  name: 'browser_close',
  description: 'Close the browser session and release resources. Call this when done with all browser tasks. Sessions also auto-close on task completion.',
  category: 'browser',
  parameters: {},
  required: [],
  async execute(_params, ctx): Promise<ToolCallResult> {
    await destroySession(ctx.taskId);
    return { success: true, data: 'Browser session closed.', cost: 0 };
  },
});
