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
 * AI returns: CLICK:N | TYPE:N:"text" | SELECT:N:"value" | SCROLL:up/down |
 *             NAVIGATE:"url" | PRESS:key | WAIT | DONE:"result" | FAIL:"reason"
 */

import type { Page } from 'patchright';
import { generateVisionResponse } from '../services/ai.js';
import { handleCaptchaIfPresent } from './captcha.js';
import { extractVerificationCode } from '../utils/email-code-extractor.js';

const MAX_STEPS = 40;
const STEP_TIMEOUT_MS = 15000;
const TOTAL_TIMEOUT_MS = 480000; // 8 minutes — enough for Twitter signup + email verification

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
    const interactive = Array.from(document.querySelectorAll(sel));

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
const INTERACTIVE_SELECTOR =
  'input:not([type="hidden"]):not([disabled]),' +
  'textarea:not([disabled]),' +
  'select:not([disabled]),' +
  'button:not([disabled]),' +
  'a[href],' +
  '[role="button"]:not([disabled]),' +
  '[role="link"],[role="option"],[role="menuitem"],[role="tab"],' +
  '[role="checkbox"],[role="radio"],[role="textbox"],' +
  '[contenteditable="true"]';

/**
 * Click an element by its numeric index.
 * Scrolls element into view first so clicks work on elements below the fold.
 */
async function clickByIndex(page: Page, index: number): Promise<boolean> {
  try {
    // Scroll into view first
    await page.evaluate(([idx, sel]: [number, string]) => {
      const interactive = Array.from(document.querySelectorAll(sel)).filter(el => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const s = window.getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
      });
      const el = interactive[idx] as HTMLElement | undefined;
      if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' });
    }, [index, INTERACTIVE_SELECTOR] as [number, string]);

    await page.waitForTimeout(150);

    const result = await page.evaluate(([idx, sel]: [number, string]) => {
      const interactive = Array.from(document.querySelectorAll(sel)).filter(el => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const s = window.getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
      });
      const el = interactive[idx] as HTMLElement | undefined;
      if (!el) return { ok: false as const };
      const rect = el.getBoundingClientRect();
      return { ok: true as const, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, [index, INTERACTIVE_SELECTOR] as [number, string]);

    if (!result.ok) return false;
    await page.mouse.click(result.x!, result.y!);
    return true;
  } catch {
    return false;
  }
}

/**
 * Type text into an element by its numeric index.
 * Scrolls into view, clicks to focus, clears, then types with keyboard.
 */
async function typeByIndex(page: Page, index: number, text: string): Promise<boolean> {
  try {
    // Scroll into view + get position
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
    await page.waitForTimeout(150);

    await page.mouse.click(pos.x, pos.y);
    await page.waitForTimeout(200);

    // Clear existing value then type
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(text, { delay: 30 });
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
 * Build the AI prompt: element list + current URL + task.
 */
function buildObservePrompt(elements: ElementInfo[], url: string, task: string, history: string[], plan: string = '', viewport?: { width: number; height: number }): string {
  const elemLines = elements.map(e => {
    const parts = [`[${e.index}] ${e.tag.toUpperCase()}`];
    if (e.type && e.type !== 'text') parts.push(`type=${e.type}`);
    if (e.role) parts.push(`role=${e.role}`);
    if (e.name) parts.push(`name="${e.name}"`);
    if (e.placeholder) parts.push(`placeholder="${e.placeholder}"`);
    if (e.text) parts.push(`"${e.text}"`);
    if (e.value) parts.push(`value="${e.value}"`);
    if (e.href) parts.push(`href=${e.href}`);
    return parts.join(' ');
  }).join('\n');

  const historyText = history.length > 0
    ? `\nPREVIOUS STEPS:\n${history.slice(-8).join('\n')}\n`
    : '';

  // If on an error page, tell the agent explicitly
  const isErrorPage = url.startsWith('chrome-error://') || url.startsWith('about:') || url.includes('error') || url === '';
  const errorNote = isErrorPage
    ? `\nNOTE: The browser is on an error/blank page. The task requires you to navigate to a website. Extract the website URL from the TASK description and output NAVIGATE:"url" as your first action.\n`
    : '';

  const vpNote = viewport ? `VIEWPORT: ${viewport.width}x${viewport.height}px (use these dimensions for CLICK_AT coordinates)\n` : '';

  return `TASK: ${task}
URL: ${url}
${vpNote}${errorNote}${plan ? `\nEXECUTION PLAN:\n${plan}\n` : ''}${historyText}
INTERACTIVE ELEMENTS (reference by number):
${elemLines || '(none visible)'}

Look at the screenshot and the element list. Choose ONE action to take next.

RESPOND WITH EXACTLY ONE LINE in this format:
- CLICK:N              (click element N from the list above)
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
- DONE:"result message" (task complete - describe what was accomplished)
- FAIL:"reason"        (impossible to complete - explain why)

RULES:
- One action only. No explanation.
- If you need to fill a form, fill ONE field at a time.
- After typing in a field, use PRESS:Tab to move to the next field.
- If TYPE does not work on a field (no text appears after 2 tries), use FILL instead.
- If an element you need to click is NOT in the element list but you can SEE it in the screenshot, use CLICK_AT:x,y with estimated pixel coordinates.
- After filling all fields, CLICK the submit button.
- If a CAPTCHA appears, output WAIT (it will be solved automatically).
- If you see a success confirmation, output DONE.
- If asked to sign up and you filled the email, that counts as progress — keep going.
- If form has required fields with asterisks (*) fill ALL of them before submitting.
- If a cookie/privacy banner blocks the page, it is auto-dismissed — just proceed with your next action.
- If a date of birth field appears, fill it: month first, then day, then year (or use SELECT for dropdowns).
- For phone/email verification: output WAIT (the system will check email automatically).`;
}

/**
 * Parse the AI's one-line action response.
 */
function parseAction(response: string): { type: string; index?: number; text?: string; key?: string; url?: string; result?: string } | null {
  const line = response.trim().split('\n')[0].trim();

  const clickAt = line.match(/^CLICK_AT:(\d+),(\d+)/);
  if (clickAt) return { type: 'click_at', index: parseInt(clickAt[1]), text: clickAt[2] };

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

const SYSTEM_PROMPT = `You are a browser automation agent. You control a real web browser.
Your job is to complete tasks by observing the page screenshot and list of interactive elements.
Be direct and efficient. One action per response. No explanations.

KEY RULES:
- If you see a 404, "page not found", or error page: NAVIGATE to the base domain (e.g. NAVIGATE:"https://example.com")
- If the signup/register URL fails: try NAVIGATE:"https://example.com/register" then NAVIGATE:"https://example.com/join" then NAVIGATE:"https://example.com" and find signup link
- If a form field is not in the element list but you can see it visually: CLICK at its location, it may be a custom component
- For date pickers: CLICK the date field, then CLICK the correct date in the calendar
- For dropdowns/selects not in list: CLICK the visible dropdown element, then CLICK the option
- If stuck on same page for 3+ steps: SCROLL:down to find more elements, or NAVIGATE to a different approach
- DONE only when task is fully complete with confirmation visible. FAIL only if truly impossible.`;

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
  let lastUrl = '';
  let sameUrlCount = 0;
  let lastActionKey = '';
  let sameActionCount = 0;

  console.log(`[VISION-AGENT] Starting task: "${task.substring(0, 100)}"`);

  // PRE-PLANNING STEP (Manus-style): Generate a structured plan before touching the browser.
  // This gives the AI a north star to follow even when individual steps fail.
  let taskPlan = '';
  try {
    const planPrompt = `TASK: ${task}

You are a browser automation planner. Output a concise execution plan as 3-5 bullet points:
1. What URL to navigate to first
2. What form fields to fill (if any)
3. What button to click to submit
4. What success looks like
5. Fallback if the primary approach fails

Be specific (use actual URLs, field names). Max 150 words. No fluff.`;
    const planResult = await generateVisionResponse(planPrompt, '', SYSTEM_PROMPT);
    taskPlan = planResult.content.substring(0, 500);
    totalCost += planResult.cost;
    console.log(`[VISION-AGENT] Plan: ${taskPlan.substring(0, 200)}`);
  } catch { /* planning is optional — continue without it */ }

  try {
    // PRE-NAVIGATION: If page is blank/error, navigate to the target URL immediately
    // Extract from task string or plan before wasting step 0 on it
    const currentStartUrl = page.url();
    const isBlankOrError = !currentStartUrl || currentStartUrl === 'about:blank' ||
      currentStartUrl.startsWith('chrome-error://') || currentStartUrl.startsWith('about:');
    if (isBlankOrError) {
      const urlInTask = task.match(/https?:\/\/[^\s,)]+/)?.[0] ||
        task.match(/\bon\s+([\w.-]+\.(com|org|net|io|co|app))/i)?.[1];
      const planUrl = taskPlan.match(/https?:\/\/[^\s,)]+/)?.[0];
      const startUrl = urlInTask?.startsWith('http') ? urlInTask
        : urlInTask ? `https://www.${urlInTask}`
        : planUrl?.startsWith('http') ? planUrl : null;
      if (startUrl) {
        console.log(`[VISION-AGENT] Pre-navigating to ${startUrl}`);
        await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(1000);
      }
    }

    for (steps = 0; steps < MAX_STEPS; steps++) {
      // Check total timeout
      if (Date.now() - startTime > TOTAL_TIMEOUT_MS) {
        return { success: false, error: 'Timeout: 3 minutes exceeded', steps, cost: totalCost, screenshots };
      }

      // Wait for page to settle
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(600);

      // Handle CAPTCHAs automatically
      try {
        await handleCaptchaIfPresent(page, userId, taskId);
      } catch { /* non-critical */ }

      // Auto-dismiss cookie consent banners and modal overlays that block interaction
      try {
        await page.evaluate(() => {
          // Common cookie consent / GDPR dismiss buttons
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
          // Auto-close "X" close buttons on overlays/modals (but NOT the whole page)
          const overlayClose = document.querySelector(
            '[role="dialog"] button[aria-label*="Close"], [role="dialog"] button[aria-label*="close"], ' +
            '.modal button.close, .modal button[aria-label="Close"], ' +
            '[class*="overlay"] button[class*="close"], [class*="modal"] button[class*="close"]'
          ) as HTMLElement | null;
          if (overlayClose && overlayClose.offsetParent !== null) overlayClose.click();
        });
      } catch { /* non-critical */ }

      // OBSERVE: Screenshot + extract elements
      let screenshot: string;
      let elements: ElementInfo[];
      try {
        [screenshot, elements] = await Promise.all([
          takeScreenshot(page),
          extractElements(page, INTERACTIVE_SELECTOR),
        ]);
      } catch (err) {
        return { success: false, error: `Page capture failed: ${err}`, steps, cost: totalCost, screenshots };
      }

      screenshots.push(screenshot);
      const url = page.url();
      console.log(`[VISION-AGENT] Step ${steps + 1}: ${url} — ${elements.length} elements`);

      // STUCK DETECTION: Same URL for too long → force scroll to unstick
      if (url === lastUrl) {
        sameUrlCount++;

        // Early bail-out: stuck on error page for 3+ steps → give up so CALL-GATE can take over
        if (sameUrlCount >= 3 && (url.startsWith('chrome-error://') || url.startsWith('about:') || url === '')) {
          console.log(`[VISION-AGENT] Stuck on error page for ${sameUrlCount} steps — bailing out for CALL-GATE`);
          return { success: false, error: `Site unreachable (bot-blocked or error page). CALL-GATE will call the business directly.`, steps, cost: totalCost, screenshots };
        }

        if (sameUrlCount === 4) {
          console.log(`[VISION-AGENT] Stuck on same URL for 4 steps — forcing scroll down`);
          await page.mouse.wheel(0, 600);
          await page.waitForTimeout(400);
        } else if (sameUrlCount === 7) {
          console.log(`[VISION-AGENT] Stuck for 7 steps — scrolling back up`);
          await page.mouse.wheel(0, -600);
          await page.waitForTimeout(400);
        }
      } else {
        lastUrl = url;
        sameUrlCount = 0;
      }

      // REASON: Ask AI what to do
      const viewport = page.viewportSize() || { width: 1280, height: 800 };
      const prompt = buildObservePrompt(elements, url, task, history, taskPlan, viewport);
      let aiResponse: string;
      let stepCost = 0;
      try {
        const result = await Promise.race([
          generateVisionResponse(prompt, screenshot, SYSTEM_PROMPT),
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
        await page.waitForTimeout(2000);
        continue;
      }

      console.log(`[VISION-AGENT] AI says: ${aiResponse.substring(0, 100)}`);
      history.push(`Step ${steps + 1} @ ${url}: ${aiResponse.substring(0, 80)}`);

      // ACT: Parse and execute
      const action = parseAction(aiResponse);

      // REPEATED ACTION DETECTION: Same action 3+ times → add a stern hint to history
      const actionKey = aiResponse.trim().split('\n')[0].trim();
      if (actionKey === lastActionKey) {
        sameActionCount++;
        if (sameActionCount >= 3) {
          history.push(`⚠️ You repeated "${actionKey}" ${sameActionCount} times. Try something DIFFERENT: SCROLL, FILL instead of TYPE, or NAVIGATE elsewhere.`);
        }
      } else {
        lastActionKey = actionKey;
        sameActionCount = 0;
      }
      if (!action) {
        console.warn(`[VISION-AGENT] Could not parse action: "${aiResponse}"`);
        history.push(`Step ${steps + 1}: parse failed`);
        continue;
      }

      if (action.type === 'done') {
        console.log(`[VISION-AGENT] DONE after ${steps + 1} steps: ${action.result}`);
        return { success: true, result: action.result, steps: steps + 1, cost: totalCost, screenshots };
      }

      if (action.type === 'fail') {
        // Don't accept FAIL on an error page in early steps — force navigate instead
        const currentUrl = page.url();
        const onErrorPage = currentUrl.startsWith('chrome-error://') || currentUrl.startsWith('about:') || steps < 2;
        if (onErrorPage && steps < 3) {
          // Extract URL from task and navigate there instead of giving up
          const urlInTask = task.match(/https?:\/\/[^\s,)]+/)?.[0] ||
            task.match(/\bon\s+(\w[\w.-]+\.(com|org|net|io|co))/i)?.[1];
          const navUrl = urlInTask?.startsWith('http') ? urlInTask : urlInTask ? `https://www.${urlInTask}` : null;
          if (navUrl) {
            console.log(`[VISION-AGENT] FAIL on error page — forcing navigate to ${navUrl}`);
            await page.goto(navUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
            await page.waitForTimeout(1000);
            continue; // Try again after navigation
          }
        }
        console.log(`[VISION-AGENT] FAIL: ${action.result}`);
        return { success: false, error: action.result, steps: steps + 1, cost: totalCost, screenshots };
      }

      // Execute the action
      let actionOk = false;
      try {
        switch (action.type) {
          case 'click': {
            actionOk = await Promise.race([
              clickByIndex(page, action.index!),
              new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5000)),
            ]);
            if (actionOk) {
              await page.waitForLoadState('domcontentloaded').catch(() => {});
              await page.waitForTimeout(800);
            }
            break;
          }

          case 'click_at': {
            // Coordinate-based click — Manus-style fallback for elements not in DOM list
            const x = action.index!;
            const y = parseInt(action.text!);
            await page.mouse.click(x, y);
            await page.waitForLoadState('domcontentloaded').catch(() => {});
            await page.waitForTimeout(800);
            actionOk = true;
            break;
          }

          case 'type': {
            actionOk = await typeByIndex(page, action.index!, action.text!);
            if (actionOk) await page.waitForTimeout(300);
            break;
          }

          case 'fill': {
            // React-compatible fill — sets value directly via native setter
            actionOk = await fillByIndex(page, action.index!, action.text!);
            if (actionOk) await page.waitForTimeout(300);
            break;
          }

          case 'select': {
            actionOk = await selectByIndex(page, action.index!, action.text!);
            break;
          }

          case 'scroll': {
            const dir = action.text === 'up' ? -600 : 600;
            await page.mouse.wheel(0, dir);
            await page.waitForTimeout(500);
            actionOk = true;
            break;
          }

          case 'navigate': {
            await page.goto(action.url!, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
            await page.waitForTimeout(1000);
            actionOk = true;
            break;
          }

          case 'press': {
            await page.keyboard.press(action.key!);
            await page.waitForTimeout(300);
            actionOk = true;
            break;
          }

          case 'wait': {
            // Check if page is waiting for email verification
            const waitUrl = page.url();
            const waitText = await page.textContent('body').catch(() => '') || '';
            const isVerificationPage = /verif|confirm.*email|check.*inbox|code.*sent|enter.*code|otp|one.time/i.test(waitUrl + ' ' + waitText.substring(0, 500));

            if (isVerificationPage && emailUsername) {
              // Wait 20 seconds for the email to arrive then check inbox
              console.log(`[VISION-AGENT] Verification page detected — waiting 20s then checking ${emailUsername}@aevoy.com`);
              await page.waitForTimeout(20000);
              try {
                const { fetchRecentEmails } = await import('../services/inbox-poller.js');
                const emails = await fetchRecentEmails(`${emailUsername}@aevoy.com`, 3, 5);
                for (const email of emails) {
                  const extracted = extractVerificationCode(email.body || email.subject || '');
                  if (extracted.code) {
                    history.push(`📧 EMAIL VERIFICATION CODE FOUND: "${extracted.code}" (from ${email.from}). Enter this code into the verification field now.`);
                    console.log(`[VISION-AGENT] Found verification code: ${extracted.code}`);
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
              await page.waitForTimeout(2500);
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
    }

    return { success: false, error: `Max steps (${MAX_STEPS}) reached without completing task`, steps, cost: totalCost, screenshots };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg, steps, cost: totalCost, screenshots };
  }
}
