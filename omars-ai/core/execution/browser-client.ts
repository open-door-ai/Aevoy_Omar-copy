/**
 * Browser Client - Playwright Wrapper
 *
 * Provides a simple interface for managing browser instances
 * for Omar's Personal AI Assistant.
 */

import { chromium, Browser, Page, BrowserContext } from 'playwright';

let sharedBrowser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!sharedBrowser || !sharedBrowser.isConnected()) {
    console.log('[BROWSER] Launching Playwright Chrome...');
    sharedBrowser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    });
  }
  return sharedBrowser;
}

export async function createContext(): Promise<BrowserContext> {
  const browser = await getBrowser();
  return await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });
}

export async function createPage(): Promise<Page> {
  const context = await createContext();
  return await context.newPage();
}

export async function closeBrowser(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
    console.log('[BROWSER] Browser closed');
  }
}
