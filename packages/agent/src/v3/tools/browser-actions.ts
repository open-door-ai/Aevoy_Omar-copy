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

  taskPages.set(ctx.taskId, { page, engine });
  return { page, isNew: true };
}

/** Cleanup page for a task */
export async function cleanupTaskPage(taskId: string): Promise<void> {
  const entry = taskPages.get(taskId);
  if (entry) {
    try { await entry.engine.cleanup(); } catch {}
    taskPages.delete(taskId);
  }
}

/** Get a compact accessibility snapshot of the current page */
async function getPageSnapshot(page: Page): Promise<string> {
  try {
    const elements = await Promise.race([
      page.evaluate(() => {
        const items: string[] = [];
        const selectors = ['a', 'button', 'input', 'select', 'textarea',
          '[role="button"]', '[role="link"]', '[role="textbox"]', '[role="checkbox"]',
          '[role="tab"]', '[role="menuitem"]', '[contenteditable="true"]'];
        const seen = new Set<Element>();
        let ref = 1;
        for (const sel of selectors) {
          document.querySelectorAll(sel).forEach(el => {
            if (seen.has(el) || items.length >= 200) return;
            seen.add(el);
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            const tag = el.tagName.toLowerCase();
            const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'button' ? 'button' :
              tag === 'input' ? (el.getAttribute('type') || 'textbox') : tag === 'select' ? 'combobox' :
              tag === 'textarea' ? 'textbox' : tag);
            const name = el.getAttribute('aria-label') ||
              el.getAttribute('placeholder') ||
              (tag === 'a' || tag === 'button' ? (el.textContent || '').trim().substring(0, 50) : '') ||
              el.getAttribute('name') || '';
            const value = (el as HTMLInputElement).value || '';
            items.push(`[${ref}] ${role} "${name}"${value ? ` value="${value}"` : ''}`);
            ref++;
          });
        }
        // Also get page title and visible text summary
        const title = document.title;
        const h1 = document.querySelector('h1')?.textContent?.trim() || '';
        const alerts = Array.from(document.querySelectorAll('[role="alert"], .error, .alert'))
          .map(el => el.textContent?.trim()).filter(Boolean).slice(0, 3);
        return { elements: items, title, h1, alerts, url: location.href };
      }),
      new Promise<any>(r => setTimeout(() => r({ elements: [], title: '', h1: '', alerts: [], url: '' }), 5000))
    ]);

    const lines: string[] = [];
    lines.push(`URL: ${elements.url}`);
    if (elements.title) lines.push(`Title: ${elements.title}`);
    if (elements.h1) lines.push(`Heading: ${elements.h1}`);
    if (elements.alerts?.length) lines.push(`Alerts: ${elements.alerts.join('; ')}`);
    lines.push('');
    lines.push('Interactive elements:');
    lines.push(...elements.elements);
    return lines.join('\n');
  } catch (err) {
    return `Error getting page snapshot: ${err instanceof Error ? err.message : 'unknown'}`;
  }
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
      const snapshot = await getPageSnapshot(page);
      return { success: true, data: snapshot, cost: 0 };
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
      // Find the element by re-querying the DOM with the same selector logic
      const clicked = await existing.page.evaluate((targetRef: number) => {
        const selectors = ['a', 'button', 'input', 'select', 'textarea',
          '[role="button"]', '[role="link"]', '[role="textbox"]', '[role="checkbox"]',
          '[role="tab"]', '[role="menuitem"]', '[contenteditable="true"]'];
        const seen = new Set<Element>();
        let currentRef = 1;
        let result = { clicked: false, tag: '', text: '' };
        for (const sel of selectors) {
          document.querySelectorAll(sel).forEach(el => {
            if (seen.has(el)) return;
            seen.add(el);
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            if (currentRef === targetRef) {
              (el as HTMLElement).click();
              result = { clicked: true, tag: el.tagName, text: (el.textContent || '').trim().substring(0, 50) };
            }
            currentRef++;
          });
        }
        return result;
      }, ref);

      if (!clicked.clicked) {
        return { success: false, error: `Element [${ref}] not found on page`, cost: 0 };
      }

      await existing.page.waitForTimeout(1000);
      const snapshot = await getPageSnapshot(existing.page);
      return { success: true, data: `Clicked [${ref}] (${clicked.tag} "${clicked.text}")\n\n${snapshot}`, cost: 0 };
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
      const filled = await existing.page.evaluate((args: { targetRef: number; value: string }) => {
        const selectors = ['a', 'button', 'input', 'select', 'textarea',
          '[role="button"]', '[role="link"]', '[role="textbox"]', '[role="checkbox"]',
          '[role="tab"]', '[role="menuitem"]', '[contenteditable="true"]'];
        const seen = new Set<Element>();
        let currentRef = 1;
        let result = { filled: false, tag: '', name: '' };
        for (const sel of selectors) {
          document.querySelectorAll(sel).forEach(el => {
            if (seen.has(el)) return;
            seen.add(el);
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            if (currentRef === args.targetRef) {
              const input = el as HTMLInputElement;
              input.focus();
              input.value = args.value;
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              result = { filled: true, tag: el.tagName, name: el.getAttribute('name') || el.getAttribute('placeholder') || '' };
            }
            currentRef++;
          });
        }
        return result;
      }, { targetRef: ref, value });

      if (!filled.filled) {
        return { success: false, error: `Input [${ref}] not found on page`, cost: 0 };
      }

      return { success: true, data: `Filled [${ref}] "${filled.name}" with "${value}"`, cost: 0 };
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
