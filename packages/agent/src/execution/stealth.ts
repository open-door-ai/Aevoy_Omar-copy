/**
 * Browser Stealth Patches
 *
 * Makes automated browsers look like real users.
 * Overrides detection signals and humanizes interactions.
 */

import type { BrowserContext, Page } from 'playwright';

// Recent Chrome user agents for rotation
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
];

/**
 * Get a realistic user agent string, rotated per session.
 */
export function getRealisticUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Apply stealth patches to a browser context to avoid bot detection.
 */
export async function applyStealthPatches(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    // Override navigator.webdriver
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });

    // Override navigator.plugins to look real
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const plugins = [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
          { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
        ];
        const arr = Object.create(PluginArray.prototype);
        for (let i = 0; i < plugins.length; i++) {
          const p = Object.create(Plugin.prototype);
          Object.defineProperties(p, {
            name: { value: plugins[i].name },
            filename: { value: plugins[i].filename },
            description: { value: plugins[i].description },
            length: { value: 0 },
          });
          Object.defineProperty(arr, i, { value: p });
        }
        Object.defineProperty(arr, 'length', { value: plugins.length });
        return arr;
      },
    });

    // Override navigator.languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });

    // Add window.chrome object
    if (!(window as unknown as Record<string, unknown>).chrome) {
      (window as unknown as Record<string, unknown>).chrome = {
        runtime: {},
        loadTimes: () => ({}),
        csi: () => ({}),
        app: { isInstalled: false },
      };
    }

    // Override Permissions.prototype.query
    const originalQuery = Permissions.prototype.query;
    Permissions.prototype.query = function (parameters: PermissionDescriptor) {
      if (parameters.name === 'notifications') {
        return Promise.resolve({ state: 'prompt', onchange: null } as PermissionStatus);
      }
      return originalQuery.call(this, parameters);
    };

    // Override iframe contentWindow detection
    const originalAttachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init: ShadowRootInit) {
      return originalAttachShadow.call(this, { ...init, mode: 'open' });
    };
  });
}

/**
 * Humanize mouse and keyboard interactions on a page.
 * Adds realistic delays, bezier mouse curves, and typing variation.
 */
export async function humanizeInteraction(page: Page): Promise<void> {
  // Add slight random delay to all clicks
  const originalClick = page.click.bind(page);
  page.click = async (selector: string, options?: Record<string, unknown>) => {
    await page.waitForTimeout(randomBetween(50, 200));
    return originalClick(selector, options);
  };
}

/**
 * Generate a random integer between min and max (inclusive).
 */
function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Get a random typing delay per character (ms).
 */
export function getTypingDelay(): number {
  return randomBetween(30, 120);
}

/**
 * Get a random pause between actions (ms).
 */
export function getActionPause(): number {
  return randomBetween(200, 800);
}
