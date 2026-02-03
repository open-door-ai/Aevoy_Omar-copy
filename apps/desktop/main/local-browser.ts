/**
 * Local Browser Manager — Playwright automation on user's machine
 *
 * Same fallback chains as cloud mode, but runs locally.
 * Used by the desktop app for browser automation tasks.
 */

import { chromium, Browser, BrowserContext, Page } from "playwright";

export class LocalBrowserManager {
  private browser: Browser | null = null;
  private contexts: Map<string, BrowserContext> = new Map();
  private active = false;

  isActive(): boolean {
    return this.active;
  }

  async launch(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: false, // Show browser for local mode
        args: ["--disable-blink-features=AutomationControlled"],
      });
    }
    return this.browser;
  }

  async createSession(sessionId: string): Promise<Page> {
    const browser = await this.launch();

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    this.contexts.set(sessionId, context);
    this.active = true;

    return await context.newPage();
  }

  async closeSession(sessionId: string): Promise<void> {
    const context = this.contexts.get(sessionId);
    if (context) {
      await context.close();
      this.contexts.delete(sessionId);
    }

    if (this.contexts.size === 0) {
      this.active = false;
    }
  }

  async stopAll(): Promise<void> {
    for (const [id, context] of this.contexts) {
      try {
        await context.close();
      } catch {
        // Ignore close errors during panic
      }
      this.contexts.delete(id);
    }

    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // Ignore
      }
      this.browser = null;
    }

    this.active = false;
    console.log("[LOCAL-BROWSER] All sessions stopped");
  }
}
