/**
 * Dynamic Content Handling
 *
 * Handles SPAs, Shadow DOM, iframes, and dynamic content loading.
 */

import type { Page, Frame } from 'playwright';

/**
 * Wait for a SPA to be fully ready:
 * - readyState === 'complete'
 * - No pending fetch requests
 * - No DOM mutations for 500ms
 * Max wait: 10 seconds.
 */
export async function waitForSPAReady(page: Page, maxWaitMs: number = 10000): Promise<void> {
  const startTime = Date.now();

  // First wait for basic load
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  // Then wait for network to settle and DOM to stabilize
  try {
    await page.evaluate((maxMs) => {
      return new Promise<void>((resolve) => {
        const start = Date.now();

        // Check if page is ready
        function checkReady() {
          if (Date.now() - start > maxMs) {
            resolve();
            return;
          }

          if (document.readyState !== 'complete') {
            setTimeout(checkReady, 100);
            return;
          }

          // Wait for DOM stability (no mutations for 500ms)
          let mutationTimer: ReturnType<typeof setTimeout>;
          const observer = new MutationObserver(() => {
            clearTimeout(mutationTimer);
            mutationTimer = setTimeout(() => {
              observer.disconnect();
              resolve();
            }, 500);
          });

          observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
          });

          // Initial timeout in case no mutations happen
          mutationTimer = setTimeout(() => {
            observer.disconnect();
            resolve();
          }, 500);
        }

        checkReady();
      });
    }, maxWaitMs);
  } catch {
    // Page might have navigated, that's ok
  }

  // Ensure we don't exceed max wait
  const elapsed = Date.now() - startTime;
  if (elapsed < maxWaitMs) {
    // Also try networkidle with remaining time
    const remaining = Math.min(maxWaitMs - elapsed, 5000);
    await page.waitForLoadState('networkidle', { timeout: remaining }).catch(() => {});
  }
}

/**
 * Pierce Shadow DOM to find elements matching a selector.
 * Traverses all shadow roots on the page.
 */
export async function pierceShadowDOM(page: Page, selector: string): Promise<string | null> {
  return await page.evaluate((sel) => {
    function findInShadowRoots(root: Document | ShadowRoot, selector: string): Element | null {
      // Try direct match first
      const direct = root.querySelector(selector);
      if (direct) return direct;

      // Search in shadow roots
      const allElements = Array.from(root.querySelectorAll('*'));
      for (const el of allElements) {
        if (el.shadowRoot) {
          const found = findInShadowRoots(el.shadowRoot, selector);
          if (found) return found;
        }
      }
      return null;
    }

    const found = findInShadowRoots(document, sel);
    if (!found) return null;

    // Build a unique selector path back to the element
    // For now, return a data attribute we can use
    const uniqueId = `shadow-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    found.setAttribute('data-aevoy-id', uniqueId);
    return `[data-aevoy-id="${uniqueId}"]`;
  }, selector);
}

/**
 * Navigate into an iframe and return the Frame object.
 */
export async function navigateIframe(page: Page, frameSelector: string): Promise<Frame | null> {
  try {
    // Try by selector
    const frameElement = await page.$(frameSelector);
    if (frameElement) {
      const frame = await frameElement.contentFrame();
      if (frame) return frame;
    }

    // Try by name or id
    const frameName = frameSelector.replace(/^#/, '');
    const frame = page.frame({ name: frameName });
    if (frame) return frame;

    // Try by URL pattern
    const frameByUrl = page.frames().find(f => f.url().includes(frameSelector));
    if (frameByUrl) return frameByUrl;

    return null;
  } catch {
    return null;
  }
}

/**
 * Wait for a specific element to appear, checking both main DOM and Shadow DOM.
 */
export async function waitForElement(
  page: Page,
  selector: string,
  timeoutMs: number = 5000
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    // Check normal DOM
    const normalEl = await page.$(selector).catch(() => null);
    if (normalEl) return true;

    // Check Shadow DOM
    const shadowSelector = await pierceShadowDOM(page, selector);
    if (shadowSelector) return true;

    await page.waitForTimeout(200);
  }

  return false;
}
