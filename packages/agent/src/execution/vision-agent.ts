/**
 * Vision Browser Agent
 *
 * TRUE AGI browser automation: sees the page, reasons about it, acts.
 * No hardcoded selectors. Works on any website.
 *
 * Architecture (browser-use / Operator style):
 *   Observe → screenshot + extract interactive elements with numeric indices
 *   Reason  → send screenshot + element list + task to vision AI (Gemini Flash, free)
 *   Act     → execute ONE action returned by AI
 *   Verify  → screenshot again, check progress
 *   Repeat  → loop until DONE or max steps
 *
 * AI returns: CLICK:N | DBLCLICK:N | RIGHTCLICK:N | HOVER:N | LONGPRESS:N |
 *             DRAG:fromX,fromY,toX,toY | TYPE:N:"text" | SELECT:N:"value" |
 *             SCROLL:up/down | NAVIGATE:"url" | PRESS:key | WAIT |
 *             DONE:"result" | FAIL:"reason"
 */

import type { Page } from 'patchright';
import { generateVisionResponse } from '../services/ai.js';
import { handleCaptchaIfPresent } from './captcha.js';
import { extractVerificationCode } from '../utils/email-code-extractor.js';
import { humanMouseMove } from './stealth.js';
import { getSupabaseClient } from '../utils/supabase.js';

const MAX_STEPS = 150;           // Default max — complex multi-step tasks need room
const MAX_STEPS_BOOKING = 50;    // Booking/reservation: bail early → phone escalation
const STEP_TIMEOUT_MS = 15000;
const TOTAL_TIMEOUT_MS = 2700000; // 45 minutes — complex multi-step tasks take time

export interface VisionAgentResult {
  success: boolean;
  result?: string;
  error?: string;
  steps: number;
  cost: number;
  screenshots: string[]; // base64 evidence trail
}

interface ElementInfo {
  index: number;
  tag: string;
  type?: string;
  text?: string;
  placeholder?: string;
  name?: string;
  href?: string;
  value?: string;
  role?: string;
}

/**
 * Extract all interactive elements from the page with numeric indices.
 * Returns a compact list the AI can reference by number.
 */
async function extractElements(page: Page, sel: string): Promise<ElementInfo[]> {
  return await page.evaluate((sel) => {
    // Traverse both main DOM and shadow roots (Stripe, Shopify, etc. hide forms in shadow DOM)
    function collectElements(root: Document | ShadowRoot | Element, depth = 0): Element[] {
      if (depth > 5) return [];
      const els: Element[] = Array.from(root.querySelectorAll(sel));
      const hosts = Array.from(root.querySelectorAll('*'));
      for (const host of hosts) {
        const sr = (host as Element & { shadowRoot?: ShadowRoot }).shadowRoot;
        if (sr) els.push(...collectElements(sr, depth + 1));
      }
      return els;
    }
    const interactive = collectElements(document);

    const results: Array<{
      index: number; tag: string; type?: string; text?: string;
      placeholder?: string; name?: string; href?: string; value?: string; role?: string;
    }> = [];

    let idx = 0;
    for (const el of interactive) {
      // Skip invisible elements
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute('type') || undefined;
      const placeholder = el.getAttribute('placeholder') || undefined;
      const name = el.getAttribute('name') || el.getAttribute('id') || el.getAttribute('data-testid') || undefined;
      const role = el.getAttribute('role') || undefined;
      const value = tag === 'input' || tag === 'textarea' ? (el as HTMLInputElement).value || undefined : undefined;

      // Get visible text (button/link label)
      let text = el.textContent?.trim().substring(0, 60) || undefined;
      if (!text && el.getAttribute('aria-label')) text = el.getAttribute('aria-label') || undefined;
      if (!text && el.getAttribute('title')) text = el.getAttribute('title') || undefined;

      const href = tag === 'a' ? (el as HTMLAnchorElement).href?.substring(0, 100) || undefined : undefined;

      results.push({ index: idx, tag, type, text: text || undefined, placeholder, name, href, value, role });
      idx++;

      if (idx >= 200) break; // cap at 200 elements (same as browser-use)
    }

    return results;
  }, sel);
}

// Selector for all interactive elements (serialized as string to pass into page.evaluate)
// COMPREHENSIVE: catches standard elements + SPA custom components + ARIA widgets
const INTERACTIVE_SELECTOR =
  'input:not([type="hidden"]):not([disabled]),' +
  'textarea:not([disabled]),' +
  'select:not([disabled]),' +
  'button:not([disabled]),' +
  'a[href],' +
  '[role="button"]:not([disabled]),' +
  '[role="link"],[role="option"],[role="menuitem"],[role="tab"],' +
  '[role="checkbox"],[role="radio"],[role="textbox"],' +
  '[role="combobox"],[role="listbox"],[role="switch"],[role="slider"],' +
  '[contenteditable="true"],' +
  // SPA custom components: focusable divs, dropdown triggers, details toggles
  '[tabindex="0"],' +
  '[aria-haspopup],' +
  'summary';

/**
 * Get interactive element count (for post-action change detection).
 */
async function getInteractiveCount(page: Page): Promise<number> {
  return page.evaluate((sel: string) => {
    return Array.from(document.querySelectorAll(sel)).filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 &&
        window.getComputedStyle(el).display !== 'none' &&
        window.getComputedStyle(el).visibility !== 'hidden';
    }).length;
  }, INTERACTIVE_SELECTOR).catch(() => 0);
}

/**
 * Wait for SPA DOM to stabilize after a click/navigation.
 * Polls element count every 200ms — stops when stable or timeout reached.
 * Much more reliable than a fixed 1500ms sleep for React/Vue SPAs (Canva, Notion, etc.)
 */
async function waitForSpaStable(page: Page, maxMs = 2500): Promise<void> {
  const deadline = Date.now() + maxMs;
  let prevCount = -1;
  let stableRounds = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(200);
    const count = await getInteractiveCount(page);
    if (count === prevCount && count > 0) {
      stableRounds++;
      if (stableRounds >= 2) break; // Stable for 2 consecutive polls (400ms) → settled
    } else {
      stableRounds = 0;
    }
    prevCount = count;
  }
}

/**
 * Click an element by its numeric index.
 * CDP-first approach (browser-use / Manus style):
 *   1. CDP Input.dispatchMouseEvent — bypasses ALL Playwright abstractions, direct browser input
 *   2. Playwright mouse.down/up fallback — if CDP session unavailable
 *   3. JS element.click() — last resort for elements that ignore mouse events
 *
 * CDP is what browser-use switched to after finding Playwright clicks unreliable on SPAs.
 * It sends events directly to the browser's input pipeline — no hit-test, no actionability checks.
 */
async function clickByIndex(page: Page, index: number): Promise<boolean> {
  // Get element position + focus it (scroll into view first)
  const pos = await page.evaluate(([idx, sel]: [number, string]) => {
    const interactive = Array.from(document.querySelectorAll(sel)).filter(el => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const s = window.getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    });
    const el = interactive[idx] as HTMLElement | undefined;
    if (!el) return null;
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    // Focus the element (helps with React hydrated components)
    if (typeof el.focus === 'function') el.focus();
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, [index, INTERACTIVE_SELECTOR] as [number, string]).catch(() => null);

  if (!pos) {
    // Element coordinates unavailable — try JS click directly
    return page.evaluate(([idx, sel]: [number, string]) => {
      const els = Array.from(document.querySelectorAll(sel)).filter(el => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const s = window.getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
      });
      const el = els[idx] as HTMLElement | undefined;
      if (!el) return false;
      el.click();
      return true;
    }, [index, INTERACTIVE_SELECTOR] as [number, string]).catch(() => false);
  }

  // Small jitter (+/- 3px) — humans don't click dead center
  const x = pos.x + (Math.random() - 0.5) * 6;
  const y = pos.y + (Math.random() - 0.5) * 6;

  // Strategy 1: CDP direct Input.dispatchMouseEvent (browser-use approach)
  // Bypasses Playwright's actionability checks, hit-testing, and Node.js relay entirely.
  try {
    const cdp = await (page.context() as any).newCDPSession(page);
    try {
      // Move → Press → Release (what browser-use does)
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left' });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await page.waitForTimeout(30 + Math.floor(Math.random() * 60)); // 30-90ms hold
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      await cdp.detach().catch(() => {});
      return true;
    } catch (cdpErr) {
      await cdp.detach().catch(() => {});
      // Fall through to Strategy 2
    }
  } catch { /* CDP session creation failed — fall through */ }

  // Strategy 2: Playwright mouse (fallback if CDP unavailable)
  try {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(30 + Math.floor(Math.random() * 60));
    await page.mouse.up();
    return true;
  } catch {
    // Strategy 3: JS click (last resort)
    return page.evaluate(([idx, sel]: [number, string]) => {
      const els = Array.from(document.querySelectorAll(sel)).filter(el => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const s = window.getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
      });
      const el = els[idx] as HTMLElement | undefined;
      if (!el) return false;
      el.click();
      return true;
    }, [index, INTERACTIVE_SELECTOR] as [number, string]).catch(() => false);
  }
}

/**
 * Get element center coordinates by index (shared helper for click variants).
 */
async function getElementPosition(page: Page, index: number): Promise<{ x: number; y: number } | null> {
  return page.evaluate(([idx, sel]: [number, string]) => {
    const interactive = Array.from(document.querySelectorAll(sel)).filter(el => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const s = window.getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    });
    const el = interactive[idx] as HTMLElement | undefined;
    if (!el) return null;
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, [index, INTERACTIVE_SELECTOR] as [number, string]).catch(() => null);
}

/**
 * Double-click an element by index.
 * Uses Playwright's native dblclick for proper event sequence:
 * mousedown → mouseup → click → mousedown → mouseup → click → dblclick
 */
async function dblclickByIndex(page: Page, index: number): Promise<boolean> {
  const pos = await getElementPosition(page, index);
  if (!pos) {
    // Fallback: JS dispatch dblclick event
    return page.evaluate(([idx, sel]: [number, string]) => {
      const els = Array.from(document.querySelectorAll(sel)).filter(el => {
        const r = el.getBoundingClientRect();
        const s = window.getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
      });
      const el = els[idx] as HTMLElement | undefined;
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      return true;
    }, [index, INTERACTIVE_SELECTOR] as [number, string]).catch(() => false);
  }
  try { await humanMouseMove(page, pos.x, pos.y); } catch { /* non-critical */ }
  try {
    await page.mouse.dblclick(pos.x, pos.y);
    return true;
  } catch {
    return page.evaluate(([idx, sel]: [number, string]) => {
      const els = Array.from(document.querySelectorAll(sel)).filter(el => {
        const r = el.getBoundingClientRect();
        const s = window.getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
      });
      const el = els[idx] as HTMLElement | undefined;
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      return true;
    }, [index, INTERACTIVE_SELECTOR] as [number, string]).catch(() => false);
  }
}

/**
 * Right-click an element by index (context menu).
 * Uses Playwright mouse with button: 'right' for native event sequence.
 */
async function rightclickByIndex(page: Page, index: number): Promise<boolean> {
  const pos = await getElementPosition(page, index);
  if (!pos) {
    return page.evaluate(([idx, sel]: [number, string]) => {
      const els = Array.from(document.querySelectorAll(sel)).filter(el => {
        const r = el.getBoundingClientRect();
        const s = window.getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
      });
      const el = els[idx] as HTMLElement | undefined;
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      return true;
    }, [index, INTERACTIVE_SELECTOR] as [number, string]).catch(() => false);
  }
  try { await humanMouseMove(page, pos.x, pos.y); } catch { /* non-critical */ }
  try {
    await page.mouse.click(pos.x, pos.y, { button: 'right' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Hover over an element by index (for dropdown menus, tooltips, etc.).
 * Triggers mouseenter + mouseover events. Pauses 300ms to let menus appear.
 */
async function hoverByIndex(page: Page, index: number): Promise<boolean> {
  const pos = await getElementPosition(page, index);
  if (!pos) {
    return page.evaluate(([idx, sel]: [number, string]) => {
      const els = Array.from(document.querySelectorAll(sel)).filter(el => {
        const r = el.getBoundingClientRect();
        const s = window.getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
      });
      const el = els[idx] as HTMLElement | undefined;
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      return true;
    }, [index, INTERACTIVE_SELECTOR] as [number, string]).catch(() => false);
  }
  try { await humanMouseMove(page, pos.x, pos.y); } catch { /* non-critical */ }
  try {
    await page.mouse.move(pos.x, pos.y);
    await page.waitForTimeout(300); // Let dropdown/tooltip appear
    return true;
  } catch {
    return false;
  }
}

/**
 * Long-press an element by index (mousedown → hold 800ms → mouseup).
 * Used for mobile patterns, hold-to-delete, drag-to-unlock.
 */
async function longpressByIndex(page: Page, index: number): Promise<boolean> {
  const pos = await getElementPosition(page, index);
  if (!pos) return false;
  try { await humanMouseMove(page, pos.x, pos.y); } catch { /* non-critical */ }
  try {
    await page.mouse.down();
    await page.waitForTimeout(800); // Hold for 800ms
    await page.mouse.up();
    return true;
  } catch {
    return false;
  }
}

/**
 * Drag from one point to another (for sliders, date pickers, drag-and-drop).
 * Fires mousedown at start → mousemove events along path → mouseup at end.
 */
async function dragBetweenPoints(page: Page, fromX: number, fromY: number, toX: number, toY: number): Promise<boolean> {
  try {
    await humanMouseMove(page, fromX, fromY);
    await page.mouse.down();
    // Smooth drag: move in 10 steps for realistic behavior
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const x = fromX + (toX - fromX) * (i / steps);
      const y = fromY + (toY - fromY) * (i / steps);
      await page.mouse.move(x, y);
      await page.waitForTimeout(20);
    }
    await page.mouse.up();
    return true;
  } catch {
    return false;
  }
}

/**
 * Type text into an element by its numeric index.
 * Clicks to focus, clears with triple-click+Delete (browser-use strategy),
 * then types with 25ms delay. Falls back to FILL if field stays empty.
 */
async function typeByIndex(page: Page, index: number, text: string): Promise<boolean> {
  try {
    const pos = await page.evaluate(([idx, sel]: [number, string]) => {
      const interactive = Array.from(document.querySelectorAll(sel)).filter(el => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const s = window.getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
      });
      const el = interactive[idx] as HTMLElement | undefined;
      if (!el) return null;
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, [index, INTERACTIVE_SELECTOR] as [number, string]);

    if (!pos) return false;
    await page.waitForTimeout(60);

    // Click to focus
    await page.mouse.click(pos.x, pos.y);
    await page.waitForTimeout(60);

    // Clear with triple-click + Delete (browser-use strategy — works on React controlled inputs)
    await page.mouse.click(pos.x, pos.y, { clickCount: 3 });
    await page.keyboard.press('Delete');
    await page.waitForTimeout(30);

    // Also try Ctrl+A + Delete as belt-and-suspenders
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    await page.waitForTimeout(30);

    // Type with 18ms delay per character (browser-use standard speed)
    await page.keyboard.type(text, { delay: 18 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fill an element using React/Vue-compatible value injection.
 * Use when TYPE doesn't trigger framework onChange events.
 */
async function fillByIndex(page: Page, index: number, text: string): Promise<boolean> {
  try {
    const done = await page.evaluate(([idx, val, sel]: [number, string, string]) => {
      const interactive = Array.from(document.querySelectorAll(sel)).filter(el => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const s = window.getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
      });
      const el = interactive[idx] as HTMLInputElement | undefined;
      if (!el) return false;

      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      el.focus();

      // React-compatible value injection via native setter
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(el, val);
      } else {
        el.value = val;
      }

      // Dispatch events React/Vue listen to
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      return true;
    }, [index, text, INTERACTIVE_SELECTOR] as [number, string, string]);

    return done as boolean;
  } catch {
    return false;
  }
}

/**
 * Select an option by index (for <select> elements).
 */
async function selectByIndex(page: Page, index: number, value: string): Promise<boolean> {
  try {
    return await page.evaluate(([idx, val, sel]: [number, string, string]) => {
      const interactive = Array.from(document.querySelectorAll(sel)).filter(el => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const s = window.getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
      });

      const el = interactive[idx] as HTMLSelectElement | undefined;
      if (!el || el.tagName.toLowerCase() !== 'select') return false;

      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const options = Array.from(el.options);
      const opt = options.find(o =>
        o.text.toLowerCase().includes(val.toLowerCase()) ||
        o.value.toLowerCase() === val.toLowerCase()
      );
      if (opt) {
        el.value = opt.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }, [index, value, INTERACTIVE_SELECTOR] as [number, string, string]);
  } catch {
    return false;
  }
}

/**
 * Take a JPEG screenshot for vision AI (quality 70).
 */
async function takeScreenshot(page: Page): Promise<string> {
  const buf = await page.screenshot({ type: 'jpeg', quality: 70 });
  return buf.toString('base64');
}

/**
 * Extract credentials from the task string so they can be injected into every step prompt.
 */
function extractTaskCredentials(task: string): { email: string; password: string; name: string } {
  return {
    email: task.match(/email=([^\s,\n;]+)/)?.[1] || '',
    password: task.match(/password=([^\s,\n;]+)/)?.[1] || '',
    name: task.match(/name=([^\s,\n;]+)/)?.[1] || '',
  };
}

/**
 * Build the AI prompt: element list + current URL + task.
 */
function buildObservePrompt(elements: ElementInfo[], url: string, task: string, history: string[], plan: string = '', viewport?: { width: number; height: number }, creds?: { email: string; password: string; name: string }, newElemIndices?: Set<number>, triedAndFailed?: string, explorationHint?: string): string {
  const elemLines = elements.map(e => {
    const isNew = newElemIndices && newElemIndices.has(e.index);
    const parts = [isNew ? `★NEW [${e.index}] ${e.tag.toUpperCase()}` : `[${e.index}] ${e.tag.toUpperCase()}`];
    if (e.type && e.type !== 'text') parts.push(`type=${e.type}`);
    if (e.role) parts.push(`role=${e.role}`);
    if (e.name) parts.push(`name="${e.name}"`);
    if (e.placeholder) parts.push(`placeholder="${e.placeholder}"`);
    if (e.text) parts.push(`"${e.text}"`);
    if (e.value) parts.push(`value="${e.value}"`);
    if (e.href) parts.push(`href=${e.href}`);
    return parts.join(' ');
  }).join('\n');

  // Show last 15 steps (VY/Vercept: agents need more context to avoid repeating mistakes)
  const historyText = history.length > 0
    ? `\nPREVIOUS STEPS:\n${history.slice(-15).join('\n')}\n`
    : '';

  // ALREADY TRIED section — persistent memory of failed approaches (VY/Vercept: never retry same action)
  const triedSection = triedAndFailed
    ? `\nALREADY TRIED (DO NOT REPEAT THESE — they failed):\n${triedAndFailed}\n`
    : '';

  // EXPLORATION STRATEGIES — injected when stuck to guide alternative approaches
  const exploreSection = explorationHint
    ? `\n${explorationHint}\n`
    : '';

  // If on an error page, tell the agent explicitly
  const isErrorPage = url.startsWith('chrome-error://') || url.startsWith('about:') || url.includes('error') || url === '';
  const errorNote = isErrorPage
    ? `\nNOTE: The browser is on an error/blank page. The task requires you to navigate to a website. Extract the website URL from the TASK description and output NAVIGATE:"url" as your first action.\n`
    : '';

  const vpNote = viewport ? `VIEWPORT: ${viewport.width}x${viewport.height}px (use these dimensions for CLICK_AT coordinates)\n` : '';

  // Credentials block — injected prominently so AI never asks for what's already provided
  const credNote = (creds?.email)
    ? `\n⚡ CREDENTIALS (USE THESE — DO NOT ASK): email=${creds.email}${creds.password ? ` | password=${creds.password}` : ''}${creds.name ? ` | name=${creds.name}` : ''}\n`
    : '';

  const hasNewElems = newElemIndices && newElemIndices.size > 0;
  const newElemNote = hasNewElems
    ? `\n★NEW elements (appeared after your last action — these are the consequence of what you just did):\n${elements.filter(e => newElemIndices!.has(e.index)).map(e => `  [${e.index}] ${e.tag.toUpperCase()}${e.placeholder ? ` placeholder="${e.placeholder}"` : ''}${e.text ? ` "${e.text}"` : ''}`).join('\n')}\n`
    : '';

  return `TASK: ${task}
URL: ${url}
${vpNote}${credNote}${errorNote}${plan ? `\nEXECUTION PLAN:\n${plan}\n` : ''}${triedSection}${exploreSection}${historyText}${newElemNote}
INTERACTIVE ELEMENTS (reference by number, ★NEW = appeared after last action):
${elemLines || '(none visible)'}

Look at the screenshot and the element list. Output 3-5 actions to execute in sequence (one per line). BATCH all form fills together.

RESPOND WITH ACTIONS in this format (one per line, 3-5 preferred):
- CLICK:N              (click element N from the list above)
- DBLCLICK:N           (double-click element N — for text selection, zoom in, map zoom, edit-in-place)
- RIGHTCLICK:N         (right-click element N — opens context menu)
- HOVER:N              (hover over element N — reveals dropdown menus, tooltips, sub-navigation)
- LONGPRESS:N          (press and hold element N for 800ms — mobile patterns, hold-to-delete)
- DRAG:fromX,fromY,toX,toY  (drag from one point to another — sliders, date range pickers, drag-and-drop)
- CLICK_AT:x,y        (click at pixel coordinates — use when element is not in the list but visible in screenshot)
- TYPE:N:"text"        (keyboard-type text into element N — clears first)
- FILL:N:"text"        (directly set value of element N — use for React/custom inputs when TYPE fails)
- SELECT:N:"value"     (select option in dropdown N)
- SCROLL:down          (scroll down to find more elements)
- SCROLL:up            (scroll up)
- NAVIGATE:"url"       (go to URL)
- PRESS:Tab            (press keyboard key)
- PRESS:Enter
- PRESS:Escape         (close modal/dropdown)
- WAIT                 (wait 2 seconds for page to load)
- SWITCH_TAB           (switch focus to the most recently opened popup/new tab — use after OAuth button clicks)
- DONE:"result message" (task complete - describe what was accomplished)
- FAIL:"reason"        (impossible to complete - explain why)

RULES:
- Output 3-5 actions per response (one per line). No explanation text — just action lines.
- Fill ALL visible form fields in ONE response (FILL:N + FILL:M + CLICK:submit).
- Do NOT fill one field then wait — batch all fields together.
- If TYPE does not work on a field (no text appears after 2 tries), use FILL instead.
- After filling all fields, CLICK the submit button.
- If a CAPTCHA appears, output WAIT (it will be solved automatically).
- If you see a success confirmation, output DONE.
- If asked to sign up and you filled the email, that counts as progress — keep going.
- If form has required fields with asterisks (*) fill ALL of them before submitting.
- If a cookie/privacy banner blocks the page, it is auto-dismissed — just proceed with your next action.
- If a date of birth field appears, fill it: month first, then day, then year (or use SELECT for dropdowns).
- For phone/email verification: output WAIT (the system will check email automatically).

CLICK VARIANTS (when to use each):
- CLICK — standard single click for buttons, links, checkboxes, radio buttons
- DBLCLICK — double-click for: editing table cells, selecting text/words, zooming maps
- RIGHTCLICK — right-click for: context menus (Shopify admin, Google Sheets, file managers)
- HOVER — hover without clicking for: dropdown navigation menus, tooltip reveals, sub-menu expansion. After HOVER, the dropdown items will appear as ★NEW elements — then CLICK the sub-item
- LONGPRESS — hold for 800ms for: mobile delete buttons, drag handles, press-and-hold confirmations
- DRAG — for: sliders, range pickers, time selectors, star ratings, drag-and-drop reordering

CLICK_AT IS YOUR SECRET WEAPON (CRITICAL):
- If a button, link, date, time slot, or ANY clickable element is VISIBLE in the screenshot but NOT in the element list — use CLICK_AT:x,y with estimated pixel coordinates from the screenshot.
- Modern SPAs render custom components (date pickers, time selectors, reservation slots, card buttons) that don't appear in the element list. Look at the SCREENSHOT, find the element visually, estimate its center x,y coordinates, and CLICK_AT.
- CLICK_AT is always available. Element list is helpful but NOT required to click things.

NEVER DESCRIBE, ALWAYS ACT:
- NEVER output DONE saying "here's the info" or "you can do X". That means you FAILED.
- NEVER output DONE with advice like "visit the website", "call them", "confirm directly". YOU must do it.
- If you're stuck after trying many approaches: output FAIL with a clear reason, NOT DONE with advice.
- DONE means SUCCESS. FAIL means you tried and couldn't. There is no middle ground.
- Every step MUST be an action (CLICK, TYPE, FILL, NAVIGATE, etc.). If you find yourself wanting to explain something, output the next CLICK action instead.`;
}

/**
 * Parse the AI's one-line action response.
 */
function parseAction(response: string): { type: string; index?: number; text?: string; key?: string; url?: string; result?: string } | null {
  // Scan ALL lines — text-only LLMs (DeepSeek fallback) sometimes add a brief explanation
  // before the action. We find the first line that matches a known action pattern.
  const allLines = response.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const actionPrefixes = /^(CLICK_AT:|DBLCLICK:|RIGHTCLICK:|HOVER:|LONGPRESS:|DRAG:|CLICK:|TYPE:|FILL:|SELECT:|SCROLL:|NAVIGATE:|PRESS:|WAIT$|SWITCH_TAB|DONE:|FAIL:)/;
  const line = allLines.find(l => actionPrefixes.test(l)) || allLines[0] || '';

  const clickAt = line.match(/^CLICK_AT:(\d+),(\d+)/);
  if (clickAt) return { type: 'click_at', index: parseInt(clickAt[1]), text: clickAt[2] };

  const dblclick = line.match(/^DBLCLICK:(\d+)/);
  if (dblclick) return { type: 'dblclick', index: parseInt(dblclick[1]) };

  const rightclick = line.match(/^RIGHTCLICK:(\d+)/);
  if (rightclick) return { type: 'rightclick', index: parseInt(rightclick[1]) };

  const hover = line.match(/^HOVER:(\d+)/);
  if (hover) return { type: 'hover', index: parseInt(hover[1]) };

  const longpress = line.match(/^LONGPRESS:(\d+)/);
  if (longpress) return { type: 'longpress', index: parseInt(longpress[1]) };

  // DRAG:fromX,fromY,toX,toY — store as index=fromX, text="fromY,toX,toY"
  const drag = line.match(/^DRAG:(\d+),(\d+),(\d+),(\d+)/);
  if (drag) return { type: 'drag', index: parseInt(drag[1]), text: `${drag[2]},${drag[3]},${drag[4]}` };

  const click = line.match(/^CLICK:(\d+)/);
  if (click) return { type: 'click', index: parseInt(click[1]) };

  const type = line.match(/^TYPE:(\d+):"((?:[^"\\]|\\.)*)"/);
  if (type) return { type: 'type', index: parseInt(type[1]), text: type[2].replace(/\\"/g, '"') };

  // Also handle TYPE:N:text without quotes
  const typeNoQuote = line.match(/^TYPE:(\d+):(.+)/);
  if (typeNoQuote) return { type: 'type', index: parseInt(typeNoQuote[1]), text: typeNoQuote[2].trim() };

  const fill = line.match(/^FILL:(\d+):"((?:[^"\\]|\\.)*)"/);
  if (fill) return { type: 'fill', index: parseInt(fill[1]), text: fill[2].replace(/\\"/g, '"') };

  const fillNoQuote = line.match(/^FILL:(\d+):(.+)/);
  if (fillNoQuote) return { type: 'fill', index: parseInt(fillNoQuote[1]), text: fillNoQuote[2].trim() };

  const select = line.match(/^SELECT:(\d+):"((?:[^"\\]|\\.)*)"/);
  if (select) return { type: 'select', index: parseInt(select[1]), text: select[2] };

  const scroll = line.match(/^SCROLL:(up|down)/i);
  if (scroll) return { type: 'scroll', text: scroll[1].toLowerCase() };

  const navigate = line.match(/^NAVIGATE:"(.+)"/);
  if (navigate) return { type: 'navigate', url: navigate[1] };

  // NAVIGATE without quotes
  const navigateRaw = line.match(/^NAVIGATE:(.+)/);
  if (navigateRaw) return { type: 'navigate', url: navigateRaw[1].trim() };

  const press = line.match(/^PRESS:(.+)/);
  if (press) return { type: 'press', key: press[1].trim() };

  if (line === 'WAIT') return { type: 'wait' };
  if (line === 'SWITCH_TAB' || line.startsWith('SWITCH_TAB')) return { type: 'switch_tab' };

  const done = line.match(/^DONE:"((?:[^"\\]|\\.)*)"/);
  if (done) return { type: 'done', result: done[1] };

  // DONE without quotes
  const doneRaw = line.match(/^DONE:(.+)/);
  if (doneRaw) return { type: 'done', result: doneRaw[1].trim() };

  const fail = line.match(/^FAIL:"((?:[^"\\]|\\.)*)"/);
  if (fail) return { type: 'fail', result: fail[1] };

  const failRaw = line.match(/^FAIL:(.+)/);
  if (failRaw) return { type: 'fail', result: failRaw[1].trim() };

  return null;
}

const SYSTEM_PROMPT = `You are a browser automation agent. COMPLETE tasks by acting, never by describing.

BATCH 3-5 ACTIONS per response (one per line). Fill ALL visible fields at once + click submit:
FILL:3:"john@example.com"
FILL:5:"MyPassword123"
CLICK:7
Single action only for: NAVIGATE, DONE, FAIL, WAIT, SWITCH_TAB.

CREDENTIALS: If "⚡ CREDENTIALS" is shown — USE THEM. Never ask for credentials that are already provided.

DONE: Only when task FULLY complete. Include actual data (prices, addresses, confirmation #). Never say "want me to" or give advice — DONE means SUCCESS. FAIL means tried and couldn't.
FAIL: If stuck >30 steps on booking form: FAIL:"Booking form too complex — call restaurant instead"

RULES:
- 404/error page → NAVIGATE to base domain
- Form field not in list but visible → CLICK_AT:x,y coordinates from screenshot
- TYPE fails (empty field) → use FILL instead (React-native injection)
- CAPTCHA/reCAPTCHA → output WAIT (auto-solved)
- Date picker → CLICK date field, CLICK correct date in calendar
- Dropdown not in list → CLICK_AT the dropdown visually
- Stuck 3+ steps → SCROLL:down or try different approach
- "📋 NEW TAB OPENED" in history → output SWITCH_TAB
- OAuth buttons open popups → SWITCH_TAB to follow

SIGNUP: Try "Continue with Google/Apple" FIRST (faster). Fall back to email form. Multi-step forms: click "Continue/Next" after email. If "Check your email" appears → WAIT (auto-verified).

BOOKING: If party/date/time selectors visible → fill them, click Search/Find Table, pick time slot, fill contact form (name/email/phone from credentials), click Confirm. DONE only with confirmation details.

ORDER/PURCHASE: Navigate to menu → find item → ADD TO CART → proceed to CHECKOUT → fill delivery address + phone + name from credentials → complete order → DONE with order confirmation. Finding the price/store info is NOT done — you must go through the FULL checkout flow. If you hit a payment wall, DONE with "Order ready in cart — payment required" and include the total.

NEVER describe what you COULD do. ACT. Never fabricate data — only report what's on screen.`;

/**
 * Run the vision-based browser agent on a task.
 *
 * @param page          - Playwright page (already initialized and navigated if needed)
 * @param task          - What to accomplish (e.g. "Sign up for Canva with email test@example.com")
 * @param userId        - For CAPTCHA solving cost tracking
 * @param taskId        - For logging
 * @param emailUsername - Username portion of @aevoy.com for auto-reading verification codes
 */
export async function runVisionAgent(
  page: Page,
  task: string,
  userId?: string,
  taskId?: string,
  emailUsername?: string
): Promise<VisionAgentResult> {
  const startTime = Date.now();
  const screenshots: string[] = [];
  const history: string[] = [];
  let totalCost = 0;
  let steps = 0;

  // POPUP/NEW TAB TRACKING — OAuth flows, payment, email verification all open popups.
  // Track the latest popup and allow AI to switch into it with SWITCH_TAB action.
  let popupPage: Page | null = null;
  let activePage = page; // The page the agent is currently interacting with
  const allPopups: Page[] = [];
  page.on('popup', (popup: Page) => {
    popupPage = popup as Page;
    allPopups.push(popup as Page);
    console.log(`[VISION-AGENT] New popup/tab detected: ${(popup as Page).url() || '(loading)'}`);
    // Notify history on next step so AI knows to switch
  });
  let lastUrl = '';
  let sameUrlCount = 0;
  let lastActionKey = '';
  let lastAction = '';   // Full action text for DOM-first screenshot decisions
  let sameActionCount = 0;
  // Track element signatures to highlight elements that are NEW this step (appeared after last action)
  let prevElementSigs = new Set<string>();
  const getElemSig = (e: ElementInfo) =>
    `${e.tag}|${e.type ?? ''}|${e.name ?? ''}|${e.placeholder ?? ''}|${e.text ?? ''}`.toLowerCase();

  // ═══ ACTION MEMORY (VY/Vercept + browser-use pattern) ═══
  // Persistent record of ALL attempted actions with outcomes. Never forgets.
  // The AI gets a "ALREADY TRIED" section so it never repeats a failed approach.
  // This is the core difference from the old 6-step sliding window.
  interface ActionMemoryEntry {
    actionSig: string;      // semantic hash: "click|button|Submit|5"
    rawAction: string;      // original action text: "CLICK:5"
    outcome: 'success' | 'fail' | 'no_effect';
    step: number;
    reason?: string;        // why it failed/had no effect
    url: string;            // page URL when attempted
  }
  const actionMemory: ActionMemoryEntry[] = [];
  const failedActionSigs = new Set<string>(); // Quick lookup for failed signatures

  // Hash an action + element into a semantic signature for dedup
  function hashAction(actionType: string, elemIndex: number | undefined, elements: ElementInfo[], url: string): string {
    if (elemIndex !== undefined && elemIndex < elements.length) {
      const elem = elements.find(e => e.index === elemIndex);
      if (elem) {
        // Semantic signature: action type + element tag + text/name + domain
        const domain = new URL(url).hostname.replace('www.', '');
        return `${actionType}|${elem.tag}|${(elem.text || elem.name || elem.placeholder || '').substring(0, 30)}|${domain}`.toLowerCase();
      }
    }
    return `${actionType}|idx${elemIndex}|${new URL(url).pathname}`.toLowerCase();
  }

  // Track milestones for dynamic step budget
  let milestonesHit = 0;  // Each milestone adds 20 steps to budget
  let dynamicMaxSteps = 0; // Computed after effectiveMaxSteps is set

  console.log(`[VISION-AGENT] Starting task: "${task.substring(0, 100)}"`);

  // Extract credentials from the task string so they're always visible in every step prompt
  const taskCreds = extractTaskCredentials(task);
  if (taskCreds.email) {
    console.log(`[VISION-AGENT] Credentials extracted: email=${taskCreds.email}, password=${taskCreds.password ? '***' : '(none)'}`);
  }

  // PRE-PLANNING STEP: Only for complex tasks (signups, bookings, multi-step flows).
  // Skip for simple research/lookup tasks to save 3-5s.
  let taskPlan = '';
  const isComplexBrowserTask = /\b(sign\s*up|register|create.*account|book|reserve|order|purchase|checkout|apply|subscribe)\b/i.test(task);
  if (isComplexBrowserTask) {
    try {
      const planPrompt = `TASK: ${task}\n\nOutput a concise execution plan as 3-5 bullet points: URL, fields to fill, submit button, success criteria, fallback. Max 100 words.`;
      const planResult = await generateVisionResponse(planPrompt, '', SYSTEM_PROMPT, userId, taskId);
      taskPlan = planResult.content.substring(0, 400);
      totalCost += planResult.cost;
      console.log(`[VISION-AGENT] Plan: ${taskPlan.substring(0, 150)}`);
    } catch { /* planning is optional — continue without it */ }
  }

  try {
    // PRE-NAVIGATION: If page is blank/error, navigate to the target URL immediately
    const currentStartUrl = activePage.url();
    const isBlankOrError = !currentStartUrl || currentStartUrl === 'about:blank' ||
      currentStartUrl.startsWith('chrome-error://') || currentStartUrl.startsWith('about:');
    if (isBlankOrError) {
      // 1. Explicit URL in task text
      const urlInTask = task.match(/https?:\/\/[^\s,)]+/)?.[0] ||
        task.match(/\bon\s+([\w.-]+\.(com|org|net|io|co|app))/i)?.[1];
      const planUrl = taskPlan.match(/https?:\/\/[^\s,)]+/)?.[0];
      let startUrl = urlInTask?.startsWith('http') ? urlInTask
        : urlInTask ? `https://www.${urlInTask}`
        : planUrl?.startsWith('http') ? planUrl : null;

      // 2. If no explicit URL, extract service name from task description
      // "Create a LinkedIn account" → linkedin.com, "Sign up for GitHub" → github.com
      // Generic — works for any service name that matches a .com domain
      if (!startUrl) {
        const serviceMatch = task.match(
          /\b(?:sign\s*up|create\s+(?:a|an|my)\s+(?:\w+\s+)?account|log\s*in|cancel\s+(?:my\s+)?|go\s+to|navigate\s+to|open|visit)\s+(?:for\s+(?:a\s+)?(?:free\s+)?)?(?:on\s+)?([A-Z][a-zA-Z]+(?:\s*[A-Z][a-zA-Z]*)?)/i
        );
        if (serviceMatch) {
          const serviceName = serviceMatch[1].trim().toLowerCase().replace(/\s+/g, '');
          // Avoid false positives: skip generic words that aren't service names
          const genericWords = new Set(['account', 'free', 'new', 'the', 'this', 'that', 'email', 'user', 'test', 'subscription', 'membership', 'trial']);
          if (!genericWords.has(serviceName) && serviceName.length >= 3) {
            startUrl = `https://www.${serviceName}.com`;
            console.log(`[VISION-AGENT] Inferred service URL from task: "${serviceMatch[1]}" → ${startUrl}`);
          }
        }
      }

      if (startUrl) {
        console.log(`[VISION-AGENT] Pre-navigating to ${startUrl}`);
        await activePage.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
        await activePage.waitForTimeout(1000);
      }
    }

    // SERVICE MISMATCH CHECK: If page is loaded but on the WRONG site, redirect
    // e.g. task says "LinkedIn" but page is on notion.com → navigate to linkedin.com
    const _postNavUrl = activePage.url();
    if (_postNavUrl && !_postNavUrl.startsWith('about:') && !_postNavUrl.startsWith('chrome-error://')) {
      const _taskServiceMatch = task.match(
        /\b(?:sign\s*up|create\s+(?:a|an|my)\s+\w*\s*account|log\s*in|cancel\s+(?:my\s+)?|go\s+to|navigate\s+to|open|visit)\s+(?:for\s+(?:a\s+)?(?:free\s+)?)?(?:on\s+)?([A-Z][a-zA-Z]+)/i
      );
      if (_taskServiceMatch) {
        const _expectedService = _taskServiceMatch[1].toLowerCase();
        const _currentDomain = new URL(_postNavUrl).hostname.toLowerCase();
        const _genericSkip = new Set(['account', 'free', 'new', 'the', 'email', 'user', 'test', 'subscription', 'membership', 'trial']);
        if (!_genericSkip.has(_expectedService) && _expectedService.length >= 3 && !_currentDomain.includes(_expectedService)) {
          const _correctUrl = `https://www.${_expectedService}.com`;
          console.log(`[VISION-AGENT] SERVICE MISMATCH: Task expects "${_expectedService}" but page is on "${_currentDomain}" → redirecting to ${_correctUrl}`);
          await activePage.goto(_correctUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
          await activePage.waitForTimeout(1000);
        }
      }
    }

    // Bot wall detection counters
    // Ordering/booking/food tasks bail after 2 bot wall attempts — call the business is faster.
    // Other tasks (signup, research, etc.) get 4 attempts before bail.
    const isOrderingOrBookingTask = /\b(order|reserve|book|pickup|delivery from|make.*reservation|get.*food|get.*pizza|get.*burger|get.*coffee|get.*sushi|call.*for)\b/i.test(task);
    const BOT_WALL_BAIL_ATTEMPTS = isOrderingOrBookingTask ? 2 : 4;
    const effectiveMaxSteps = isOrderingOrBookingTask ? MAX_STEPS_BOOKING : MAX_STEPS;
    dynamicMaxSteps = effectiveMaxSteps; // Dynamic: grows when milestones are hit
    let botWallCount = 0;
    let lastBotWallUrl = '';
    let lastProgressCheckStep = 0;
    let hasReachedForm = false;     // Detected form fields (input, select, submit)
    let hasFilledAnyField = false;  // Successfully typed/filled into a field

    for (steps = 0; steps < dynamicMaxSteps; steps++) {
      // Check total timeout
      if (Date.now() - startTime > TOTAL_TIMEOUT_MS) {
        return { success: false, error: 'Timeout: 45 minutes exceeded', steps, cost: totalCost, screenshots };
      }

      // Periodic progress update every 10 steps — keeps watchdog from killing long-running tasks
      // (watchdog checks updated_at; this update keeps the task "alive" in the DB)
      if (steps > 0 && steps % 10 === 0 && taskId) {
        const elapsedMin = ((Date.now() - startTime) / 60000).toFixed(1);
        const progressUrl = activePage.url();
        const heartbeatMsg = `[VISION-AGENT] Step ${steps}/${effectiveMaxSteps} (${elapsedMin}min) on ${progressUrl.substring(0, 60)}`;
        console.log(`[VISION-AGENT] Heartbeat: ${heartbeatMsg}`);
        void (async () => {
          try {
            await getSupabaseClient().from('tasks').update({ progress_message: heartbeatMsg }).eq('id', taskId);
          } catch (e) {
            console.warn('[VISION-AGENT] Heartbeat failed:', e);
          }
        })();
      }

      // If a popup appeared since last step, notify AI via history
      if (popupPage) {
        const capturedPopup = popupPage as Page; // stable local ref avoids TS narrowing issues
        const pUrl = capturedPopup.url() || '(loading)';
        history.push(`📋 NEW TAB OPENED: A new browser tab/popup appeared at "${pUrl}". If this is part of the task (OAuth login, payment, etc.), output SWITCH_TAB to move your focus there.`);
        console.log(`[VISION-AGENT] Queued SWITCH_TAB notification for popup at ${pUrl}`);
        popupPage = null; // consumed — will be re-populated if another opens
      }

      // Wait for page to settle (250ms — fast enough for most SPAs, saves ~350ms/step)
      await activePage.waitForLoadState('domcontentloaded').catch(() => {});
      await activePage.waitForTimeout(250);

      // Handle CAPTCHAs automatically EVERY step — CapSolver is fast (<5s) and
      // missing a CAPTCHA wastes 3+ steps of blind clicking
      try {
        const captchaSolved = await handleCaptchaIfPresent(activePage, userId, taskId);
        if (captchaSolved === false) {
          // CAPTCHA detected but not solved — wait and retry once
          await activePage.waitForTimeout(3000);
          await handleCaptchaIfPresent(activePage, userId, taskId);
        }
      } catch { /* non-critical */ }

      // BOT WALL DETECTION: Cloudflare, DataDome, PerimeterX block pages
      // Detected by: checking for challenge/blocked page content
      try {
        const pageTitle = await activePage.title().catch(() => '');
        const bodySnippet = await activePage.evaluate(() => document.body?.innerText?.substring(0, 300) || '').catch(() => '');
        const isBotWall = /just a moment|checking your browser|ddos protection|access denied|cloudflare|blocked|security check|please enable javascript|verify you are human/i.test(pageTitle + ' ' + bodySnippet);
        if (isBotWall) {
          const wallUrl = activePage.url();
          if (wallUrl === lastBotWallUrl) {
            botWallCount++;
          } else {
            botWallCount = 1;
            lastBotWallUrl = wallUrl;
          }
          console.log(`[VISION-AGENT] Bot wall detected at ${wallUrl} (count=${botWallCount})`);
          if (botWallCount === 1) {
            // First hit: wait for Cloudflare auto-pass (5s) then try CapSolver on Turnstile
            await activePage.waitForTimeout(6000);
            try { await handleCaptchaIfPresent(activePage, userId, taskId); } catch { /* ok */ }
          } else if (botWallCount === 2) {
            // Second hit: CapSolver again (Turnstile tokens sometimes need 2 attempts)
            history.push(`⚠️ BOT WALL DETECTED (attempt ${botWallCount}): Site is blocking automated access. Attempting CAPTCHA solve...`);
            try { await handleCaptchaIfPresent(activePage, userId, taskId); } catch { /* ok */ }
            await activePage.waitForTimeout(4000);
          } else if (botWallCount >= BOT_WALL_BAIL_ATTEMPTS) {
            // Persistent bot wall: bail out so processor can escalate to phone call
            const bailReason = isOrderingOrBookingTask
              ? `Bot wall: ${wallUrl} — CALL-GATE: site blocked automated access. Call the business directly.`
              : `Bot wall: ${wallUrl} — blocked by anti-bot system after ${botWallCount} attempts. CALL-GATE will call the business directly.`;
            return { success: false, error: bailReason, steps, cost: totalCost, screenshots };
          }
        } else {
          botWallCount = 0;
        }
      } catch { /* non-critical */ }

      // SMART BAIL-OUT FOR BOOKING TASKS: If we've spent 25+ steps without finding a form
      // or 35+ steps without filling any fields, bail and suggest phone call.
      // A genius human would give up on the website after 2 minutes and just call.
      if (isOrderingOrBookingTask && steps > 0 && steps % 10 === 0 && steps > lastProgressCheckStep) {
        lastProgressCheckStep = steps;
        try {
          const pageText = await activePage.evaluate(() => document.body?.innerText?.substring(0, 1000) || '').catch(() => '');
          const hasConfirmation = /\b(confirm|booked|reserved|success|thank you|your reservation|order placed|order confirmed)\b/i.test(pageText);
          if (hasConfirmation) {
            // Great — we found a confirmation! Let the AI wrap up with DONE
            history.push(`✅ CONFIRMATION DETECTED on page! Look for confirmation details and output DONE with the result.`);
          } else if (steps >= 20 && !hasFilledAnyField) {
            // For ORDER tasks: clicking menu items / add-to-cart IS progress even without text field fills.
            // Check if page URL suggests we're in an ordering flow (cart, menu, checkout).
            const currentUrl = activePage.url().toLowerCase();
            const _isInOrderFlow = /\b(cart|basket|order|menu|checkout|food|catego|product)\b/i.test(currentUrl) ||
              /\b(cart|basket|order|menu|checkout|add to|item|quantity)\b/i.test(pageText.substring(0, 500));
            if (_isInOrderFlow && isOrderingOrBookingTask) {
              // Still in the ordering flow — keep going, don't bail
              history.push(`⚠️ ${steps} steps without filling a text field, but you're in an ordering flow. Keep selecting items, adding to cart, and proceeding to checkout. Fill delivery details when you reach checkout.`);
            } else {
              // 20 steps without filling any form field — escalate to phone ASAP
              const phoneMatch = pageText.match(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
              const phoneNumber = phoneMatch ? phoneMatch[0].trim() : null;
              const bailReason = phoneNumber
                ? `CALL-GATE: Reservation widget too complex after ${steps} steps. Phone number found: ${phoneNumber}. Call the restaurant directly.`
                : `CALL-GATE: Reservation widget too complex after ${steps} steps. Search for the restaurant phone number and call directly.`;
              console.log(`[VISION-AGENT] Smart bail-out: ${bailReason}`);
              return { success: false, error: bailReason, steps, cost: totalCost, screenshots };
            }
          } else if (steps >= 15 && !hasReachedForm) {
            // 15 steps and haven't found any form — we're probably lost in navigation
            history.push(`⚠️ ${steps} steps and no reservation form found yet. STOP navigating — look for a "Reserve" or "Book" button and CLICK it NOW. If you can't find it, look for a phone number on the page.`);
          }
        } catch { /* non-critical */ }
      }

      // Auto-dismiss cookie consent banners and modal overlays (only first 5 steps — banners appear on first load)
      if (steps < 5) try {
        await activePage.evaluate(() => {
          const dismissSelectors = [
            '[id*="cookie"] button[class*="accept"], [id*="cookie"] button[class*="agree"]',
            '[class*="cookie"] button[class*="accept"], [class*="cookie"] button[class*="agree"]',
            '[id*="consent"] button[class*="accept"], [id*="gdpr"] button[class*="accept"]',
            'button[id*="accept-all"], button[id*="acceptAll"], button[id*="accept_all"]',
            'button[data-testid*="accept"], button[aria-label*="Accept all"]',
            '.cc-accept, .cc-allow, #accept-cookies, #acceptCookies',
          ];
          for (const sel of dismissSelectors) {
            const btn = document.querySelector(sel) as HTMLElement | null;
            if (btn && btn.offsetParent !== null) { btn.click(); break; }
          }
          const overlayClose = document.querySelector(
            '[role="dialog"] button[aria-label*="Close"], [role="dialog"] button[aria-label*="close"], ' +
            '.modal button.close, .modal button[aria-label="Close"], ' +
            '[class*="overlay"] button[class*="close"], [class*="modal"] button[class*="close"]'
          ) as HTMLElement | null;
          if (overlayClose && overlayClose.offsetParent !== null) overlayClose.click();
        });
      } catch { /* non-critical */ }

      // OBSERVE: DOM-first with screenshots-as-needed (Browser Use / Manus technique)
      // Screenshots add ~0.8s latency from image encoder. On a 50-step task that's 40s overhead.
      // Only capture screenshots when visual context is truly needed:
      //   1. First step (need to see the page)
      //   2. URL changed (new page loaded)
      //   3. Every 3rd step (periodic visual check)
      //   4. After form submit (need to verify state)
      //   5. When stuck (same URL for 3+ steps)
      //   6. Fewer elements than expected (page might be loading/broken)
      const url = activePage.url();
      const urlChanged = url !== lastUrl;
      const isStuck = !urlChanged && sameUrlCount >= 2;
      const needsScreenshot = steps === 0 || urlChanged || steps % 3 === 0 || isStuck ||
        (lastAction && /submit|NAVIGATE|PRESS:Enter/i.test(lastAction));

      let screenshot: string;
      let elements: ElementInfo[];
      try {
        if (needsScreenshot) {
          [screenshot, elements] = await Promise.all([
            takeScreenshot(activePage),
            extractElements(activePage, INTERACTIVE_SELECTOR),
          ]);
          screenshots.push(screenshot);
        } else {
          // DOM-only step — skip expensive screenshot, use element text for reasoning
          elements = await extractElements(activePage, INTERACTIVE_SELECTOR);
          screenshot = screenshots.length > 0 ? screenshots[screenshots.length - 1] : ''; // reuse last
          console.log(`[VISION-AGENT] Step ${steps + 1}: DOM-only (skipped screenshot — saves ~0.8s)`);
        }
      } catch (err) {
        return { success: false, error: `Page capture failed: ${err}`, steps, cost: totalCost, screenshots };
      }
      console.log(`[VISION-AGENT] Step ${steps + 1}: ${url} — ${elements.length} elements (active tab: ${activePage === page ? 'main' : 'popup'})`);

      // Compute which elements are NEW this step (appeared after the last action)
      const currSigs = new Set(elements.map(getElemSig));
      const newElemIndices = prevElementSigs.size > 0
        ? new Set(elements.filter(e => !prevElementSigs.has(getElemSig(e))).map(e => e.index))
        : new Set<number>(); // First step: nothing is "new"
      prevElementSigs = currSigs;
      if (newElemIndices.size > 0) {
        console.log(`[VISION-AGENT] ${newElemIndices.size} new elements appeared since last action`);
      }

      // STUCK DETECTION: Same URL for too long → force scroll to unstick
      if (url === lastUrl) {
        sameUrlCount++;

        // Early bail-out: stuck on error page for 3+ steps → give up so CALL-GATE can take over
        if (sameUrlCount >= 3 && (url.startsWith('chrome-error://') || url.startsWith('about:') || url === '')) {
          console.log(`[VISION-AGENT] Stuck on error page for ${sameUrlCount} steps — bailing out for CALL-GATE`);
          return { success: false, error: `Site unreachable (bot-blocked or error page). CALL-GATE will call the business directly.`, steps, cost: totalCost, screenshots };
        }

        // ═══ EXPLORATION STRATEGY INJECTION (VY/Vercept pattern) ═══
        // When stuck on same URL, analyze the page for alternative navigation paths.
        // This is what made VY find the screensaver setting under Wallpaper — it used search.
        if (sameUrlCount === 3) {
          // Analyze page for search bars, unexplored menus, and alternative paths
          try {
            const explorationData = await activePage.evaluate((sel: string) => {
              const allEls = Array.from(document.querySelectorAll(sel)).filter(el => {
                const r = el.getBoundingClientRect();
                const s = window.getComputedStyle(el);
                return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
              });
              // Find search bars
              const searchInputs = allEls.filter(el => {
                const tag = el.tagName.toLowerCase();
                const type = el.getAttribute('type') || '';
                const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
                const name = (el.getAttribute('name') || '').toLowerCase();
                const role = el.getAttribute('role') || '';
                return (tag === 'input' && type === 'search') ||
                  placeholder.includes('search') || name.includes('search') ||
                  role === 'searchbox' || role === 'search';
              });
              // Find unexplored navigation menus
              const navItems = allEls.filter(el => {
                const tag = el.tagName.toLowerCase();
                const role = el.getAttribute('role') || '';
                return (tag === 'nav' || role === 'navigation' || role === 'menubar' ||
                  role === 'menu' || el.closest('nav') !== null) &&
                  (tag === 'a' || tag === 'button' || role === 'menuitem');
              });
              // Find sidebar links
              const sidebarLinks = allEls.filter(el => {
                const parent = el.closest('[class*="sidebar"], [class*="side-nav"], [class*="menu"], [role="complementary"]');
                return parent && (el.tagName.toLowerCase() === 'a' || el.getAttribute('role') === 'link');
              });
              return {
                hasSearch: searchInputs.length > 0,
                searchCount: searchInputs.length,
                navItemCount: navItems.length,
                sidebarLinkCount: sidebarLinks.length,
                totalInteractive: allEls.length,
                // Get labels of first few search inputs for the nudge
                searchLabels: searchInputs.slice(0, 3).map(el => ({
                  placeholder: el.getAttribute('placeholder') || '',
                  name: el.getAttribute('name') || '',
                  idx: allEls.indexOf(el),
                })),
              };
            }, INTERACTIVE_SELECTOR).catch(() => null);

            if (explorationData) {
              const nudgeParts: string[] = [];
              if (explorationData.hasSearch) {
                nudgeParts.push(`🔍 SEARCH BAR AVAILABLE: This page has ${explorationData.searchCount} search input(s). TYPE your goal keywords into the search bar to find what you need directly — this is faster than clicking through menus.`);
              }
              if (explorationData.navItemCount > 5) {
                nudgeParts.push(`📂 UNEXPLORED NAVIGATION: ${explorationData.navItemCount} nav items on this page. Look for menu items you haven't tried yet. HOVER over menu headers to reveal sub-items.`);
              }
              if (explorationData.sidebarLinkCount > 3) {
                nudgeParts.push(`📋 SIDEBAR LINKS: ${explorationData.sidebarLinkCount} sidebar links available. Check the sidebar for the section you need.`);
              }
              if (nudgeParts.length > 0) {
                const nudge = `⚡ STUCK ${sameUrlCount} STEPS — EXPLORATION STRATEGIES:\n${nudgeParts.join('\n')}\nTry a FUNDAMENTALLY different approach. If you've been clicking, try searching. If you've been scrolling, try a different menu. Keyboard shortcut Ctrl+F may also find text on the page.`;
                history.push(nudge);
                console.log(`[VISION-AGENT] Exploration nudge injected (search=${explorationData.hasSearch}, nav=${explorationData.navItemCount})`);
              }
            }
          } catch { /* non-critical */ }
        }

        if (sameUrlCount === 4) {
          console.log(`[VISION-AGENT] Stuck on same URL for 4 steps — forcing scroll down`);
          await activePage.mouse.wheel(0, 600);
          await activePage.waitForTimeout(400);
        } else if (sameUrlCount === 7) {
          console.log(`[VISION-AGENT] Stuck for 7 steps — scrolling back up`);
          await activePage.mouse.wheel(0, -600);
          await activePage.waitForTimeout(400);
          // Second exploration nudge with keyboard shortcut hint
          history.push(`⚡ STILL STUCK ${sameUrlCount} STEPS — Try: (1) Ctrl+K or Cmd+K (command palette on many apps), (2) Tab key to cycle through elements, (3) NAVIGATE to a different section of the site, (4) Use the browser's address bar (NAVIGATE to a sub-page like /settings, /account, /search).`);
        } else if (sameUrlCount === 10) {
          // Long stuck: try a page reload
          console.log(`[VISION-AGENT] Stuck for 10 steps — refreshing page`);
          await activePage.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          await activePage.waitForTimeout(2000);
        } else if (sameUrlCount >= 20) {
          // Hard exit raised from 15→20 to give exploration strategies more room
          console.log(`[VISION-AGENT] HARD STUCK: Same URL for ${sameUrlCount} steps — bailing out`);
          return { success: false, error: `Stuck on ${url} for ${sameUrlCount} steps — page is unresponsive. CALL-GATE: Search for the business phone number and call directly.`, steps, cost: totalCost, screenshots };
        }
      } else {
        lastUrl = url;
        sameUrlCount = 0;
      }

      // ═══ COMPUTE ACTION MEMORY CONTEXT ═══
      // Build "ALREADY TRIED" section from failed actions so AI never repeats them
      const failedEntries = actionMemory.filter(m => m.outcome === 'fail' || m.outcome === 'no_effect');
      let triedAndFailedText = '';
      if (failedEntries.length > 0) {
        // Show most recent 15 failed actions (avoid prompt bloat)
        const recentFails = failedEntries.slice(-15);
        triedAndFailedText = recentFails.map(f =>
          `- Step ${f.step}: ${f.rawAction} → ${f.outcome.toUpperCase()}${f.reason ? ` (${f.reason})` : ''}`
        ).join('\n');
      }

      // Compute exploration hint based on stuck state
      let currentExplorationHint = '';
      if (sameUrlCount >= 3 && sameUrlCount < 7) {
        currentExplorationHint = `⚡ YOU ARE STUCK (${sameUrlCount} steps same URL). You MUST try a fundamentally different approach. Do NOT repeat any action from the ALREADY TRIED list.`;
      } else if (sameUrlCount >= 7) {
        currentExplorationHint = `🚨 CRITICALLY STUCK (${sameUrlCount} steps same URL). Previous approaches ALL failed. Try: search bar, keyboard shortcuts (Ctrl+F, Ctrl+K), navigate to a different URL path, or use CLICK_AT on elements visible in screenshot but not in element list.`;
      }

      // REASON: Ask AI what to do
      const viewport = activePage.viewportSize() || { width: 1280, height: 800 };
      const prompt = buildObservePrompt(elements, url, task, history, taskPlan, viewport, taskCreds, newElemIndices, triedAndFailedText, currentExplorationHint);
      let aiResponse: string;
      let stepCost = 0;
      try {
        const result = await Promise.race([
          generateVisionResponse(prompt, screenshot, SYSTEM_PROMPT, userId, taskId),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Vision AI timeout')), STEP_TIMEOUT_MS)
          ),
        ]);
        aiResponse = result.content;
        stepCost = result.cost;
        totalCost += stepCost;
      } catch (err) {
        console.warn(`[VISION-AGENT] AI failed at step ${steps + 1}: ${err}`);
        history.push(`Step ${steps + 1}: AI error — ${err}`);
        await activePage.waitForTimeout(2000);
        continue;
      }

      console.log(`[VISION-AGENT] AI says: ${aiResponse.substring(0, 100)}`);
      history.push(`Step ${steps + 1} @ ${url}: ${aiResponse.substring(0, 80)}`);

      // ACTION-FORCING: If last 4+ steps had no CLICK/CLICK_AT/TYPE/FILL actions, inject urgency
      if (steps >= 4) {
        const recentActions = history.slice(-4);
        const hasClickInRecent = recentActions.some(h =>
          /CLICK:|CLICK_AT:|TYPE:|FILL:/i.test(h)
        );
        if (!hasClickInRecent) {
          history.push(`⚠️ NO CLICKS IN LAST 4 STEPS. You are not interacting with the page! Look at the screenshot — find a button, link, or form field and CLICK it. If it's not in the element list, use CLICK_AT:x,y with coordinates from the screenshot. EVERY step must involve clicking or typing something.`);
          console.log(`[VISION-AGENT] ACTION-FORCING: No clicks in last 4 steps at step ${steps + 1}`);
        }
      }

      // ACT: Parse and execute — support BATCH actions (up to 5 per AI response)
      // Split multi-line responses into individual actions, filter blanks
      const actionLines = aiResponse.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
      const parsedActions = actionLines.map(l => parseAction(l)).filter(a => a !== null);
      // Use first action for loop detection, execute all in sequence
      const action = parsedActions[0] || null;
      const batchSize = parsedActions.length;
      if (batchSize > 1) {
        console.log(`[VISION-AGENT] BATCH: ${batchSize} actions in one response`);
      }

      // ═══ LOOP DETECTION (VY/Vercept + browser-use ActionLoopDetector) ═══
      // Uses semantic action signatures from memory, not just exact string matching.
      const actionKey = aiResponse.trim().split('\n')[0].trim();

      // Check if this action was already tried and failed (semantic dedup)
      if (action && action.type !== 'done' && action.type !== 'fail' && action.type !== 'wait') {
        const proposedSig = hashAction(action.type, action.index, elements, url);
        if (failedActionSigs.has(proposedSig)) {
          const failEntry = actionMemory.find(m => m.actionSig === proposedSig && (m.outcome === 'fail' || m.outcome === 'no_effect'));
          history.push(`🚫 BLOCKED: "${actionKey}" matches a previously FAILED action (step ${failEntry?.step || '?'}: ${failEntry?.reason || 'failed'}). The exact same approach will fail again. You MUST try a fundamentally different strategy: different element, different URL, different action type, or use the search bar.`);
          console.log(`[VISION-AGENT] Semantic dedup blocked: "${actionKey}" matches failed sig "${proposedSig}"`);
        }
      }

      if (actionKey === lastActionKey) {
        sameActionCount++;
        if (sameActionCount >= 3) {
          // Count total unique failed actions — if many, the agent is truly stuck
          const uniqueFailedApproaches = failedActionSigs.size;
          history.push(`⚠️ FROZEN LOOP: You repeated "${actionKey}" ${sameActionCount} times. ${uniqueFailedApproaches} different approaches have already failed. You MUST try something COMPLETELY NEW: (1) Use the SEARCH BAR if available, (2) NAVIGATE to a different page/URL entirely, (3) Try keyboard: PRESS:Tab then PRESS:Enter, (4) CLICK_AT pixel coordinates from screenshot, (5) Try a different section of the site.`);
        }
      } else {
        // Check for ping-pong: last 4 actions form A-B-A-B pattern
        if (history.length >= 4) {
          const recent = history.slice(-4).map(h => h.split(': ')[1] || h);
          if (recent[0] === recent[2] && recent[1] === recent[3] && recent[0] !== recent[1]) {
            history.push(`⚠️ PING-PONG LOOP: You keep alternating between "${recent[0]}" and "${recent[1]}". This oscillation won't complete the task. Try a THIRD, completely different approach — like using the search bar or navigating to a different URL.`);
          }
        }
        lastActionKey = actionKey;
        sameActionCount = 0;
      }
      lastAction = aiResponse; // Track full action for DOM-first screenshot decisions
      if (!action) {
        console.warn(`[VISION-AGENT] Could not parse action: "${aiResponse}"`);
        history.push(`Step ${steps + 1}: parse failed`);
        continue;
      }

      if (action.type === 'done') {
        const doneResult = action.result || '';
        // PASSIVE DONE REJECTION: If DONE says "want me to", "I'll need", etc.
        // it means the AI described what it COULD do instead of DOING it. Force continue.
        const isPassiveDone = /want me to|i['']ll need|would you like|shall i|let me know|i need your|please provide|do you want|can i proceed|should i|could you|please tell me|start the (sign.?up|process|registration|booking|order)|ready to (start|begin|proceed)|i can (help|assist) (you )?(with|to)|if you('d| would) like/i.test(doneResult);
        // GENERIC ADVICE DONE REJECTION: If DONE describes what COULD be done instead of
        // what WAS done, it's advice not completion. Reject and force the agent to keep acting.
        // This is NOT hardcoded per task type — it catches advice patterns universally.
        const _isAdviceDone = !isPassiveDone && (
          // "you can [verb]" — telling user to do it themselves
          /\b(you can|you must|you should|you'll need to|you need to|confirm directly|visit the|check the|call them|contact them)\b/i.test(doneResult) ||
          // "accepts [service]" / "available at/on" / "located at" — describing a page, not completing a task
          /\b(accepts\s+(reservations|bookings|orders)|available\s+(at|on)|located at|phone number is|for availability|may be available)\b/i.test(doneResult) ||
          // Fabricated 555-xxxx phone numbers — hallucinated data
          /\(?\d{3}\)?[-.\s]?555[-.\s]?\d{4}/.test(doneResult) ||
          // "here's how" / "here are the" — instruction-giving
          /\b(here'?s?\s+how|here\s+are\s+the|steps?\s+to|follow\s+these)\b/i.test(doneResult) ||
          // Vague completion without evidence: "registration is initiated", "process is started"
          /\b(registration|signup|sign.?up|process|task) (is|has been) (initiated|started|begun|available|accessible)\b/i.test(doneResult) ||
          // Page description: "Key details include", "Features include", "Accessibility features"
          /\b(key details|features) include\b/i.test(doneResult) ||
          // "can be canceled/booked/done through" — passive voice advice
          /\bcan be (cancel|cancell|book|reserv|subscrib|access|manag|done|complet)\w*\b/i.test(doneResult) ||
          // "users sign in" / "customers can" — third-person instructions
          /\b(users|customers|subscribers|members) (can|should|need to|must|sign|log)\b/i.test(doneResult)
        );
        // ORDER/PURCHASE DONE REJECTION: If this is an ordering task and DONE only has
        // price/location/menu info without order confirmation, it's research not completion.
        const _isOrderTask = /\b(order|purchase|buy|checkout|add to cart|get me a|get.*deliver)\b/i.test(task);
        const _isOrderInfoOnly = _isOrderTask && !isPassiveDone && !_isAdviceDone && (
          // Has price info but no order confirmation
          (/\$\d+|\bcosts?\b|\bpric(e|ed|ing)\b|\bper\s+(night|person|item)\b/i.test(doneResult) &&
           !/\b(order(ed|.*confirm)|receipt|confirmation|checkout complete|added to cart|in.*cart|order.*placed|order.*number|transaction)\b/i.test(doneResult)) ||
          // Has store/menu info but no actual order
          (/\b(menu|store|location|address|deliver(y|s) to)\b/i.test(doneResult) &&
           !/\b(order(ed|.*confirm)|receipt|added to cart|in.*cart|placed|transaction|checkout)\b/i.test(doneResult))
        );
        // DATA-MISSING DONE REJECTION: If task asks for specific data (prices, links, deals,
        // listings) and DONE result doesn't contain any, reject. "Done! Scrolled down" is not an answer.
        const _taskWantsData = /\b(price|deal|listing|link|rating|review|cost|address|phone|result|find|give me|tell me|show me|report|compare)\b/i.test(task);
        const _doneHasData = doneResult.length > 80 && (
          /\$\d+|\d+\.\d{2}|\bhttps?:\/\/\S+|\b\d{3}[-.]?\d{3}[-.]?\d{4}\b|\b\d+\s*\/\s*5\b|\b\d+\s*star/i.test(doneResult) ||
          /\b(found|here|result|listing|option|deal|price|cost|total|rating)\b/i.test(doneResult)
        );
        const _isDataMissingDone = _taskWantsData && !_doneHasData && !isPassiveDone && !_isAdviceDone && !_isOrderInfoOnly && doneResult.length < 200;

        if (isPassiveDone || _isAdviceDone || _isOrderInfoOnly || _isDataMissingDone) {
          const credHint = taskCreds.email
            ? ` Credentials already provided: email=${taskCreds.email}, password=${taskCreds.password}. USE THEM.`
            : '';
          const reason = isPassiveDone ? 'PASSIVE' : _isOrderInfoOnly ? 'ORDER-INCOMPLETE' : _isDataMissingDone ? 'DATA-MISSING' : 'ADVICE';
          console.log(`[VISION-AGENT] REJECTED ${reason} DONE at step ${steps + 1}: "${doneResult.substring(0, 80)}"`);
          const orderHint = _isOrderInfoOnly
            ? ' Finding prices/locations is RESEARCH, not completing the order. You must: ADD TO CART → CHECKOUT → FILL delivery info → COMPLETE ORDER. Go back to the menu/cart and continue.'
            : '';
          history.push(`⚠️ ${reason} DONE REJECTED: "${doneResult.substring(0, 100)}". This is NOT complete — you described what you COULD do instead of DOING IT.${credHint}${orderHint} You MUST actually complete the task. Click buttons, fill forms, submit. If truly impossible after many tries, output FAIL (not DONE with advice). DONE = task succeeded. FAIL = task impossible. Advice = neither.`);
          // If we've rejected 3+ DONE attempts, force FAIL to prevent infinite loop
          const doneRejectCount = history.filter(h => h.includes('DONE REJECTED')).length;
          if (doneRejectCount >= 3) {
            console.log(`[VISION-AGENT] 3+ DONE rejections — forcing FAIL to prevent infinite loop`);
            return { success: false, error: `Agent could not complete task after ${steps + 1} steps — kept giving advice instead of acting. Last attempt: "${doneResult.substring(0, 200)}"`, steps: steps + 1, cost: totalCost, screenshots };
          }
          continue; // Force the loop to keep going
        }
        // Strip raw page content (HTML/JS/CSS) from done result before returning
        let cleanDoneResult = doneResult;
        if (/<(div|span|script|style|html|body|head|meta|form|input|table|section)\b/i.test(doneResult) ||
            /\b(typeof\s+\w+|const\s+\w+\s*=|function\s*\(|document\.|window\.)\b/.test(doneResult) ||
            /\{[\s\S]{0,200}?(background-color|font-size|display:|position:|z-index)/i.test(doneResult)) {
          // Extract only the first readable sentence before the garbage starts
          const firstSentence = doneResult.match(/^[^<{]*?[.!]\s/)?.[0]?.trim();
          cleanDoneResult = firstSentence || `Task completed on ${activePage.url()}`;
          console.log(`[VISION-AGENT] Stripped raw page content from DONE result. Clean: ${cleanDoneResult.substring(0, 100)}`);
        }
        console.log(`[VISION-AGENT] DONE after ${steps + 1} steps: ${cleanDoneResult.substring(0, 200)}`);
        return { success: true, result: cleanDoneResult, steps: steps + 1, cost: totalCost, screenshots };
      }

      if (action.type === 'fail') {
        const currentUrl = activePage.url();
        const onErrorPage = currentUrl.startsWith('chrome-error://') || currentUrl.startsWith('about:') || steps < 2;
        if (onErrorPage && steps < 3) {
          const urlInTask = task.match(/https?:\/\/[^\s,)]+/)?.[0] ||
            task.match(/\bon\s+(\w[\w.-]+\.(com|org|net|io|co))/i)?.[1];
          const navUrl = urlInTask?.startsWith('http') ? urlInTask : urlInTask ? `https://www.${urlInTask}` : null;
          if (navUrl) {
            console.log(`[VISION-AGENT] FAIL on error page — forcing navigate to ${navUrl}`);
            await activePage.goto(navUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
            await activePage.waitForTimeout(1000);
            continue;
          }
        }
        console.log(`[VISION-AGENT] FAIL: ${action.result}`);
        return { success: false, error: action.result, steps: steps + 1, cost: totalCost, screenshots };
      }

      // Execute the action
      let actionOk = false;
      try {
        switch (action.type) {
          case 'switch_tab': {
            // Switch to the most recently opened popup/tab
            const target = allPopups.filter(p => !p.isClosed()).pop() || null;
            if (target) {
              activePage = target;
              await activePage.waitForLoadState('domcontentloaded').catch(() => {});
              await activePage.waitForTimeout(1000);
              history.push(`✅ SWITCHED to new tab: ${activePage.url()}`);
              console.log(`[VISION-AGENT] Switched to popup tab: ${activePage.url()}`);
              actionOk = true;
            } else {
              history.push(`⚠️ SWITCH_TAB: No open popup tabs found. The popup may have been closed already.`);
              actionOk = false;
            }
            break;
          }

          case 'click': {
            const urlBeforeClick = activePage.url();
            const countBeforeClick = elements.length;

            actionOk = await Promise.race([
              clickByIndex(activePage, action.index!),
              new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5000)),
            ]);

            if (actionOk) {
              await activePage.waitForLoadState('domcontentloaded').catch(() => {});
              await waitForSpaStable(activePage, 1500);

              // Post-click verification: if URL and element count unchanged, the click
              // may have been intercepted/blocked. Try JS .click() as secondary strategy.
              const urlAfterClick = activePage.url();
              const countAfterClick = await getInteractiveCount(activePage);
              if (urlAfterClick === urlBeforeClick && Math.abs(countAfterClick - countBeforeClick) < 2) {
                console.log(`[VISION-AGENT] Post-click: page unchanged — trying hover-then-click + JS fallback`);

                // Strategy 2: Hover-then-click (dropdown menus, tooltip buttons)
                const hoverOk = await hoverByIndex(activePage, action.index!).catch(() => false);
                if (hoverOk) {
                  await activePage.waitForTimeout(200);
                  await clickByIndex(activePage, action.index!).catch(() => {});
                  await waitForSpaStable(activePage, 1000);
                  const countAfterHover = await getInteractiveCount(activePage);
                  if (activePage.url() !== urlBeforeClick || Math.abs(countAfterHover - countBeforeClick) >= 2) {
                    break; // Hover-then-click worked
                  }
                }

                // Strategy 3: JS click fallback
                const jsOk = await activePage.evaluate(([idx, sel]: [number, string]) => {
                  const els = Array.from(document.querySelectorAll(sel)).filter(el => {
                    const r = el.getBoundingClientRect();
                    if (r.width === 0 || r.height === 0) return false;
                    const s = window.getComputedStyle(el);
                    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
                  });
                  const el = els[idx] as HTMLElement | undefined;
                  if (!el) return false;
                  el.click();
                  return true;
                }, [action.index!, INTERACTIVE_SELECTOR] as [number, string]).catch(() => false);

                if (jsOk) {
                  await waitForSpaStable(activePage, 1500);
                  const countAfterJs = await getInteractiveCount(activePage);
                  if (Math.abs(countAfterJs - countBeforeClick) < 2 && activePage.url() === urlBeforeClick) {
                    // Strategy 4: Force click with full pointer + mouse event sequence
                    await activePage.evaluate(([idx, sel]: [number, string]) => {
                      const els = Array.from(document.querySelectorAll(sel)).filter(el => {
                        const r = el.getBoundingClientRect();
                        const s = window.getComputedStyle(el);
                        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
                      });
                      const el = els[idx] as HTMLElement | undefined;
                      if (!el) return;
                      const rect = el.getBoundingClientRect();
                      const cx = rect.left + rect.width / 2 + (Math.random() - 0.5) * 4;
                      const cy = rect.top + rect.height / 2 + (Math.random() - 0.5) * 4;
                      const evOpts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0, pointerId: 1, pointerType: 'mouse' as const, isPrimary: true, width: 1, height: 1, pressure: 0.5 };
                      // Pointer events first (React/Angular/Vue listen to these)
                      el.dispatchEvent(new PointerEvent('pointerdown', evOpts));
                      el.dispatchEvent(new MouseEvent('mousedown', evOpts));
                      // Focus the element if focusable
                      if ('focus' in el && typeof (el as any).focus === 'function') (el as HTMLElement).focus();
                      el.dispatchEvent(new PointerEvent('pointerup', evOpts));
                      el.dispatchEvent(new MouseEvent('mouseup', evOpts));
                      el.dispatchEvent(new MouseEvent('click', evOpts));
                    }, [action.index!, INTERACTIVE_SELECTOR] as [number, string]).catch(() => {});
                    await waitForSpaStable(activePage, 1000);
                    const countFinal = await getInteractiveCount(activePage);
                    if (Math.abs(countFinal - countBeforeClick) < 2 && activePage.url() === urlBeforeClick) {
                      history.push(`⚠️ CLICK:${action.index} — page unchanged after 4 click strategies (mouse, hover+click, JS, force dispatch). Try: HOVER:${action.index} to reveal dropdown, DBLCLICK:${action.index}, SCROLL:down, or CLICK_AT with exact pixel coords.`);
                    }
                  }
                } else {
                  history.push(`⚠️ CLICK:${action.index} — element not found for JS fallback. Use CLICK_AT:x,y with coordinates from the screenshot instead.`);
                }
              }
            }
            break;
          }

          case 'click_at': {
            const x = action.index!;
            const y = parseInt(action.text!);
            const caUrlBefore = activePage.url();
            const caCountBefore = elements?.length || 0;
            const caJX = x + (Math.random() - 0.5) * 4;
            const caJY = y + (Math.random() - 0.5) * 4;
            // CDP direct click (same as clickByIndex Strategy 1)
            try {
              const cdp2 = await (activePage.context() as any).newCDPSession(activePage);
              await cdp2.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: caJX, y: caJY, button: 'left' });
              await cdp2.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: caJX, y: caJY, button: 'left', clickCount: 1 });
              await activePage.waitForTimeout(30 + Math.floor(Math.random() * 60));
              await cdp2.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: caJX, y: caJY, button: 'left', clickCount: 1 });
              await cdp2.detach().catch(() => {});
            } catch {
              // Fallback to Playwright mouse
              await activePage.mouse.move(caJX, caJY);
              await activePage.mouse.down();
              await activePage.waitForTimeout(30 + Math.floor(Math.random() * 60));
              await activePage.mouse.up();
            }
            await activePage.waitForLoadState('domcontentloaded').catch(() => {});
            await waitForSpaStable(activePage, 1200);
            // Post-click: if page unchanged, try full pointer+mouse event dispatch at coords
            const caUrlAfter = activePage.url();
            const caCountAfter = await getInteractiveCount(activePage);
            if (caUrlAfter === caUrlBefore && Math.abs(caCountAfter - caCountBefore) < 2) {
              await activePage.evaluate(([cx, cy]: [number, number]) => {
                const target = document.elementFromPoint(cx, cy);
                if (!target) return;
                const evOpts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0, pointerId: 1, pointerType: 'mouse' as const, isPrimary: true, width: 1, height: 1, pressure: 0.5 };
                target.dispatchEvent(new PointerEvent('pointerdown', evOpts));
                target.dispatchEvent(new MouseEvent('mousedown', evOpts));
                if ('focus' in target && typeof (target as any).focus === 'function') (target as HTMLElement).focus();
                target.dispatchEvent(new PointerEvent('pointerup', evOpts));
                target.dispatchEvent(new MouseEvent('mouseup', evOpts));
                target.dispatchEvent(new MouseEvent('click', evOpts));
              }, [x, y] as [number, number]).catch(() => {});
              await waitForSpaStable(activePage, 1000);
            }
            actionOk = true;
            break;
          }

          case 'dblclick': {
            actionOk = await Promise.race([
              dblclickByIndex(activePage, action.index!),
              new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5000)),
            ]);
            if (actionOk) {
              await activePage.waitForLoadState('domcontentloaded').catch(() => {});
              await waitForSpaStable(activePage, 1200);
            }
            break;
          }

          case 'rightclick': {
            actionOk = await Promise.race([
              rightclickByIndex(activePage, action.index!),
              new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5000)),
            ]);
            if (actionOk) {
              await waitForSpaStable(activePage, 800);
            }
            break;
          }

          case 'hover': {
            actionOk = await Promise.race([
              hoverByIndex(activePage, action.index!),
              new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5000)),
            ]);
            if (actionOk) {
              await waitForSpaStable(activePage, 800);
            }
            break;
          }

          case 'longpress': {
            actionOk = await Promise.race([
              longpressByIndex(activePage, action.index!),
              new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5000)),
            ]);
            if (actionOk) {
              await waitForSpaStable(activePage, 1200);
            }
            break;
          }

          case 'drag': {
            const fromX = action.index!;
            const [fromYStr, toXStr, toYStr] = action.text!.split(',');
            actionOk = await Promise.race([
              dragBetweenPoints(activePage, fromX, parseInt(fromYStr), parseInt(toXStr), parseInt(toYStr)),
              new Promise<boolean>(resolve => setTimeout(() => resolve(false), 8000)),
            ]);
            if (actionOk) {
              await waitForSpaStable(activePage, 1200);
            }
            break;
          }

          case 'type': {
            hasReachedForm = true;
            actionOk = await typeByIndex(activePage, action.index!, action.text!);
            if (actionOk) {
              hasFilledAnyField = true;
              await activePage.waitForTimeout(100);
              const fieldVal = await activePage.evaluate(([idx, sel]: [number, string]) => {
                const els = Array.from(document.querySelectorAll(sel)).filter(el => {
                  const r = el.getBoundingClientRect();
                  const s = window.getComputedStyle(el);
                  return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
                });
                const el = els[idx] as HTMLInputElement | undefined;
                return el?.value || '';
              }, [action.index!, INTERACTIVE_SELECTOR] as [number, string]).catch(() => '');
              if (fieldVal.length === 0 && action.text!.length > 0) {
                history.push(`⚠️ TYPE:${action.index} — text not in field after typing. Field is empty. Try FILL:${action.index}:"${action.text}" instead.`);
              }
            }
            break;
          }

          case 'fill': {
            hasReachedForm = true;
            actionOk = await fillByIndex(activePage, action.index!, action.text!);
            if (actionOk) {
              hasFilledAnyField = true;
              await activePage.waitForTimeout(100);
              const fieldVal = await activePage.evaluate(([idx, sel]: [number, string]) => {
                const els = Array.from(document.querySelectorAll(sel)).filter(el => {
                  const r = el.getBoundingClientRect();
                  const s = window.getComputedStyle(el);
                  return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
                });
                const el = els[idx] as HTMLInputElement | undefined;
                return el?.value || '';
              }, [action.index!, INTERACTIVE_SELECTOR] as [number, string]).catch(() => '');
              if (fieldVal.length === 0 && action.text!.length > 0) {
                history.push(`⚠️ FILL:${action.index} — field still empty after inject. Try CLICK:${action.index} first then TYPE.`);
              }
            }
            break;
          }

          case 'select': {
            hasReachedForm = true;
            actionOk = await selectByIndex(activePage, action.index!, action.text!);
            if (actionOk) hasFilledAnyField = true;
            break;
          }

          case 'scroll': {
            const dir = action.text === 'up' ? -600 : 600;
            await activePage.mouse.wheel(0, dir);
            await activePage.waitForTimeout(500);
            actionOk = true;
            break;
          }

          case 'navigate': {
            const navErr = await activePage.goto(action.url!, { waitUntil: 'domcontentloaded', timeout: 20000 })
              .then(() => null)
              .catch((e: Error) => e.message);
            await activePage.waitForTimeout(500);
            const landedUrl = activePage.url();
            const isStillError = landedUrl.startsWith('chrome-error://') || landedUrl.startsWith('about:blank');
            if (isStillError || navErr) {
              history.push(`⚠️ NAVIGATE to ${action.url} failed (${navErr || 'error page'}). Try a different URL or use search instead.`);
              actionOk = false;
            } else {
              actionOk = true;
            }
            break;
          }

          case 'press': {
            await activePage.keyboard.press(action.key!);
            await activePage.waitForTimeout(100);
            actionOk = true;
            break;
          }

          case 'wait': {
            const waitUrl = activePage.url();
            const waitText = await activePage.textContent('body').catch(() => '') || '';
            const isVerificationPage = /verif|confirm.*email|check.*inbox|code.*sent|enter.*code|otp|one.time/i.test(waitUrl + ' ' + waitText.substring(0, 500));

            if (isVerificationPage && emailUsername) {
              console.log(`[VISION-AGENT] Verification page detected — waiting 20s then checking ${emailUsername}@aevoy.com`);
              await activePage.waitForTimeout(20000);
              try {
                const { fetchRecentEmails } = await import('../services/inbox-poller.js');
                const emails = await fetchRecentEmails(`${emailUsername}@aevoy.com`, 3, 5);
                for (const email of emails) {
                  const extracted = extractVerificationCode(email.body || email.subject || '');
                  if (extracted.code) {
                    console.log(`[VISION-AGENT] Found verification code: ${extracted.code} — auto-filling`);
                    // Auto-fill: find the first visible code/OTP input and fill it
                    const autoFilled = await activePage.evaluate((code: string) => {
                      const selectors = [
                        'input[name*="code"]', 'input[name*="otp"]', 'input[name*="token"]',
                        'input[placeholder*="code"]', 'input[placeholder*="OTP"]', 'input[placeholder*="Code"]',
                        'input[type="number"]', 'input[inputmode="numeric"]',
                        'input[autocomplete*="one-time"]',
                      ];
                      for (const sel of selectors) {
                        const el = document.querySelector(sel) as HTMLInputElement | null;
                        if (el && el.offsetParent !== null) {
                          el.focus();
                          el.value = code;
                          el.dispatchEvent(new Event('input', { bubbles: true }));
                          el.dispatchEvent(new Event('change', { bubbles: true }));
                          return true;
                        }
                      }
                      return false;
                    }, extracted.code).catch(() => false);
                    if (autoFilled) {
                      history.push(`📧 VERIFICATION CODE "${extracted.code}" auto-filled into OTP field. Now click Submit/Verify button.`);
                    } else {
                      history.push(`📧 EMAIL VERIFICATION CODE FOUND: "${extracted.code}". Find the code input field and TYPE:N:"${extracted.code}" into it.`);
                    }
                    break;
                  } else if (extracted.verifyLink) {
                    history.push(`📧 EMAIL VERIFICATION LINK FOUND: NAVIGATE to "${extracted.verifyLink}" to verify.`);
                    console.log(`[VISION-AGENT] Found verification link: ${extracted.verifyLink.substring(0, 80)}`);
                    break;
                  }
                }
              } catch (emailErr) {
                console.warn(`[VISION-AGENT] Email check failed: ${emailErr}`);
                // Fall through with normal wait
              }
            } else {
              await activePage.waitForTimeout(2500);
            }
            actionOk = true;
            break;
          }
        }
      } catch (err) {
        console.warn(`[VISION-AGENT] Action ${action.type} failed: ${err}`);
        actionOk = false;
      }

      console.log(`[VISION-AGENT] ${action.type}${action.index !== undefined ? ':' + action.index : ''} → ${actionOk ? 'ok' : 'FAIL'}`);

      // ═══ RECORD ACTION OUTCOME IN MEMORY ═══
      {
        const sig = hashAction(action.type, action.index, elements, url);
        const urlAfterAction = activePage.url();
        const urlChanged2 = urlAfterAction !== url;
        // Determine outcome: success (page changed), no_effect (page unchanged), fail (action threw)
        let outcome: 'success' | 'fail' | 'no_effect' = 'fail';
        let reason: string | undefined;
        if (actionOk) {
          if (urlChanged2 || newElemIndices.size > 2 || ['type', 'fill', 'select', 'scroll', 'wait', 'press', 'navigate'].includes(action.type)) {
            outcome = 'success';
            // Milestone detection: URL change = progress = extend step budget
            if (urlChanged2 && !isOrderingOrBookingTask) {
              milestonesHit++;
              const newBudget = effectiveMaxSteps + (milestonesHit * 20);
              if (newBudget > dynamicMaxSteps && newBudget <= 300) {
                dynamicMaxSteps = newBudget;
                console.log(`[VISION-AGENT] Milestone! URL changed → step budget extended to ${dynamicMaxSteps}`);
              }
            }
          } else {
            outcome = 'no_effect';
            reason = 'page unchanged after action';
          }
        } else {
          outcome = 'fail';
          reason = 'action execution failed';
        }
        actionMemory.push({
          actionSig: sig,
          rawAction: `${action.type.toUpperCase()}${action.index !== undefined ? ':' + action.index : ''}${action.text ? ':"' + action.text.substring(0, 30) + '"' : ''}`,
          outcome,
          step: steps + 1,
          reason,
          url,
        });
        if (outcome === 'fail' || outcome === 'no_effect') {
          failedActionSigs.add(sig);
        }
      }

      // BATCH EXECUTION: If AI returned multiple actions, execute remaining ones
      // Skip batch if first action failed, was navigation (page changed), or was done/fail
      if (batchSize > 1 && actionOk && !['navigate', 'done', 'fail', 'scroll', 'wait', 'switch_tab'].includes(action.type)) {
        for (let bi = 1; bi < parsedActions.length && bi < 8; bi++) {
          const batchAction = parsedActions[bi]!;
          if (!batchAction || batchAction.type === 'done' || batchAction.type === 'fail' || batchAction.type === 'navigate') break;
          try {
            let bOk = false;
            switch (batchAction.type) {
              case 'fill': {
                bOk = await activePage.evaluate(([idx, val, sel]: [number, string, string]) => {
                  const els = Array.from(document.querySelectorAll(sel)).filter(el => {
                    const r = el.getBoundingClientRect();
                    const s = window.getComputedStyle(el);
                    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
                  });
                  const el = els[idx] as HTMLInputElement | undefined;
                  if (!el) return false;
                  el.focus();
                  const nativeSetter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype, 'value'
                  )?.set || Object.getOwnPropertyDescriptor(
                    window.HTMLTextAreaElement.prototype, 'value'
                  )?.set;
                  if (nativeSetter) nativeSetter.call(el, val);
                  else el.value = val;
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  return true;
                }, [batchAction.index!, batchAction.text!, INTERACTIVE_SELECTOR] as [number, string, string]).catch(() => false);
                break;
              }
              case 'type': {
                bOk = await typeByIndex(activePage, batchAction.index!, batchAction.text!);
                break;
              }
              case 'click': {
                bOk = await clickByIndex(activePage, batchAction.index!);
                break;
              }
              case 'click_at': {
                const bx = batchAction.index!;
                const by = parseInt(batchAction.text!);
                await activePage.mouse.click(bx, by);
                bOk = true;
                break;
              }
              case 'press': {
                await activePage.keyboard.press(batchAction.text || 'Enter');
                bOk = true;
                break;
              }
              default:
                break;
            }
            if (bOk) {
              history.push(`  ↳ batch ${batchAction.type}:${batchAction.index ?? ''} → ok`);
              console.log(`[VISION-AGENT] BATCH ${bi}: ${batchAction.type}:${batchAction.index ?? ''} → ok`);
            } else {
              console.log(`[VISION-AGENT] BATCH ${bi}: ${batchAction.type}:${batchAction.index ?? ''} → FAIL, stopping batch`);
              break;
            }
            await activePage.waitForTimeout(100); // Brief pause between batch actions
          } catch (batchErr) {
            console.warn(`[VISION-AGENT] Batch action ${bi} failed: ${batchErr}`);
            break;
          }
        }
        // Wait for page to settle after batch
        await waitForSpaStable(activePage, 1500);
      }
    }

    // For booking/ordering tasks that hit max steps, signal CALL-GATE to escalate to phone
    if (isOrderingOrBookingTask) {
      // Try to extract phone number from the current page before bailing
      let phoneOnPage = '';
      try {
        phoneOnPage = await activePage.evaluate(() => {
          const text = document.body?.innerText || '';
          const match = text.match(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
          return match ? match[0].trim() : '';
        }).catch(() => '');
      } catch { /* non-critical */ }
      const callGateMsg = phoneOnPage
        ? `CALL-GATE: Browser couldn't complete reservation after ${steps} steps. Phone: ${phoneOnPage}. Call the restaurant.`
        : `CALL-GATE: Browser couldn't complete reservation after ${steps} steps. Search for phone number and call the restaurant.`;
      return { success: false, error: callGateMsg, steps, cost: totalCost, screenshots };
    }
    return { success: false, error: `Max steps (${dynamicMaxSteps}) reached — task is too complex or site is bot-blocking`, steps, cost: totalCost, screenshots };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg, steps, cost: totalCost, screenshots };
  }
}
