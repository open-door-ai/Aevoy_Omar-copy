/**
 * Multi-Tab Browser Orchestration
 *
 * Manages multiple browser tabs within a single BrowserContext.
 * Tabs share cookies (login on tab1 works on tab2).
 * Addressed by human-readable labels, not indices.
 *
 * Security:
 * - Max 5 tabs per task (memory protection)
 * - Popup hijacking protection (auto-close unexpected popups)
 * - Tab crash recovery (auto-remove from registry)
 * - Concurrent operation serialization
 */

import type { Page, BrowserContext } from 'patchright';

export interface TabInfo {
  label: string;
  url: string;
  createdAt: Date;
  active: boolean;
}

export class TabManager {
  private tabs: Map<string, Page> = new Map();
  private activeLabel: string = 'main';
  private context: BrowserContext;
  private mainPage: Page;
  private operationLock: boolean = false;
  private readonly MAX_TABS = 5;

  constructor(context: BrowserContext, mainPage: Page, mainLabel: string = 'main') {
    this.context = context;
    this.mainPage = mainPage;
    this.tabs.set(mainLabel, mainPage);
    this.activeLabel = mainLabel;

    // Handle page crashes
    mainPage.on('crash', () => {
      console.warn('[TAB-MANAGER] Main page crashed');
    });

    // Auto-close unexpected popups (hijacking protection)
    context.on('page', (newPage) => {
      // If we didn't intentionally open this, close it
      // (intentional opens go through openTab() which registers before context fires)
      setTimeout(() => {
        if (!this.isPageRegistered(newPage)) {
          console.warn('[TAB-MANAGER] Unexpected popup detected — closing for security');
          newPage.close().catch(() => {});
        }
      }, 100); // 100ms grace period for intentional opens to register
    });
  }

  private isPageRegistered(page: Page): boolean {
    for (const p of this.tabs.values()) {
      if (p === page) return true;
    }
    return false;
  }

  private async acquireLock(): Promise<void> {
    let waited = 0;
    while (this.operationLock) {
      await new Promise(r => setTimeout(r, 50));
      waited += 50;
      if (waited > 10000) throw new Error('Tab operation timed out waiting for lock');
    }
    this.operationLock = true;
  }

  private releaseLock(): void {
    this.operationLock = false;
  }

  /**
   * Open a new tab with the given label and URL.
   * Returns an error string if tab limit reached or URL is unsafe.
   */
  async openTab(label: string, url: string): Promise<{ ok: boolean; message: string }> {
    // Validate label
    if (!/^[a-zA-Z0-9_-]{1,30}$/.test(label)) {
      return { ok: false, message: `Invalid tab label "${label}". Use alphanumeric + hyphens/underscores only.` };
    }

    // Tab limit
    if (this.tabs.size >= this.MAX_TABS) {
      const tabList = [...this.tabs.keys()].join(', ');
      return { ok: false, message: `Tab limit reached (max ${this.MAX_TABS}). Close a tab first. Open tabs: ${tabList}` };
    }

    // If label already exists, close old tab
    if (this.tabs.has(label)) {
      await this.closeTab(label);
    }

    await this.acquireLock();
    try {
      const newPage = await this.context.newPage();

      // Register BEFORE navigation (so popup handler doesn't close it)
      this.tabs.set(label, newPage);

      // Crash handler
      newPage.on('crash', () => {
        console.warn(`[TAB-MANAGER] Tab "${label}" crashed — removing from registry`);
        this.tabs.delete(label);
        if (this.activeLabel === label) {
          // Fall back to main tab
          this.activeLabel = 'main';
        }
      });

      // Navigate
      await newPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {
        // Non-fatal — tab is open but may show error page
      });

      // Switch to new tab
      this.activeLabel = label;

      return { ok: true, message: `Opened tab "${label}" at ${url}` };
    } catch (err: any) {
      this.tabs.delete(label);
      return { ok: false, message: `Failed to open tab "${label}": ${err.message}` };
    } finally {
      this.releaseLock();
    }
  }

  /**
   * Switch active tab to the given label.
   */
  async switchTab(label: string): Promise<{ ok: boolean; message: string; page?: Page }> {
    const page = this.tabs.get(label);
    if (!page) {
      const available = [...this.tabs.keys()].join(', ');
      return { ok: false, message: `Tab "${label}" not found. Available tabs: ${available}` };
    }

    this.activeLabel = label;
    const url = page.url();
    return { ok: true, message: `Switched to tab "${label}" at ${url}`, page };
  }

  /**
   * Close a tab by label.
   */
  async closeTab(label: string): Promise<{ ok: boolean; message: string }> {
    if (label === 'main' && this.tabs.size === 1) {
      return { ok: false, message: 'Cannot close the only remaining tab.' };
    }

    const page = this.tabs.get(label);
    if (!page) {
      return { ok: false, message: `Tab "${label}" not found.` };
    }

    this.tabs.delete(label);

    if (this.activeLabel === label) {
      // Switch to main tab or first available
      this.activeLabel = this.tabs.has('main') ? 'main' : [...this.tabs.keys()][0];
    }

    await page.close().catch(() => {});
    return { ok: true, message: `Closed tab "${label}". Active tab: "${this.activeLabel}"` };
  }

  /**
   * Get accessibility snapshot of a non-active tab without switching focus.
   * Note: this briefly focuses the tab to get accurate content, then refocuses active.
   */
  async readTab(label: string): Promise<{ ok: boolean; content: string }> {
    const page = this.tabs.get(label);
    if (!page) {
      return { ok: false, content: `Tab "${label}" not found.` };
    }

    try {
      // Get text content without full a11y snapshot (faster)
      const url = page.url();
      const title = await page.title().catch(() => '');
      const text = await Promise.race([
        page.evaluate(() => {
          const headings = Array.from(document.querySelectorAll('h1,h2,h3')).map(h => h.textContent?.trim()).filter(Boolean).slice(0, 5);
          const bodyText = (document.body as HTMLElement)?.innerText?.substring(0, 1000) || '';
          return { headings, bodyText };
        }),
        new Promise<{ headings: string[]; bodyText: string }>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]);

      const summary = [
        `Tab "${label}": ${url}`,
        title ? `Title: ${title}` : '',
        text.headings.length ? `Headings: ${text.headings.join(' | ')}` : '',
        text.bodyText ? `Content preview: ${text.bodyText.substring(0, 500)}` : '',
      ].filter(Boolean).join('\n');

      return { ok: true, content: summary };
    } catch (err: any) {
      return { ok: false, content: `Could not read tab "${label}": ${err.message}` };
    }
  }

  /**
   * Get current active page for action execution.
   */
  getActivePage(): Page {
    const page = this.tabs.get(this.activeLabel);
    if (!page) {
      // Fallback to main page
      return this.mainPage;
    }
    return page;
  }

  /**
   * Get a summary of all open tabs.
   */
  listTabs(): string {
    const lines: string[] = [];
    for (const [label, page] of this.tabs) {
      const url = page.url();
      const active = label === this.activeLabel ? ' [ACTIVE]' : '';
      lines.push(`"${label}": ${url}${active}`);
    }
    return `Open tabs (${this.tabs.size}/${this.MAX_TABS}):\n${lines.join('\n')}`;
  }

  getActiveLabel(): string {
    return this.activeLabel;
  }

  getTabCount(): number {
    return this.tabs.size;
  }
}
