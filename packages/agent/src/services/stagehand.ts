/**
 * Stagehand Service — Browserbase + Stagehand v3 Integration
 *
 * Provides AI-driven browser automation with managed cloud infrastructure.
 * Falls back to local Playwright when Browserbase is unavailable.
 *
 * Key features:
 * - act(): Execute actions with natural language
 * - agent(): Multi-step tasks with reasoning
 * - extract(): Get structured data (Zod schemas)
 * - observe(): Find interactive elements
 * - Hybrid mode: DOM + Vision for maximum reliability
 * - Auto-caching of discovered elements
 * - Built-in CAPTCHA solving
 */

import { chromium, Browser, BrowserContext, Page } from "playwright";
import { z, ZodType } from "zod";

// ---- Types ----

interface StagehandInstance {
  page: Page;
  context: BrowserContext;
  init: () => Promise<void>;
  close: () => Promise<void>;
  act: (opts: { action: string }) => Promise<{ success: boolean; message?: string }>;
  agent?: (opts: { task: string; maxSteps?: number }) => Promise<{ success: boolean; message?: string }>;
  extract: <T>(opts: { instruction: string; schema: z.ZodType<T> }) => Promise<T>;
  observe: (opts?: { instruction?: string }) => Promise<Array<{ selector: string; description: string; type: string }>>;
}

export interface StagehandConfig {
  apiKey?: string;
  projectId?: string;
  useLocal?: boolean;
}

interface StagehandSession {
  id: string;
  page: Page;
  context: BrowserContext;
  browser: Browser;
  isCloud: boolean;
}

interface ActResult {
  success: boolean;
  message?: string;
  error?: string;
}

interface ExtractResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface ObserveResult {
  success: boolean;
  elements?: Array<{
    selector: string;
    description: string;
    type: string;
  }>;
  error?: string;
}

// ---- Stagehand Service ----

export class StagehandService {
  private config: StagehandConfig;
  private session: StagehandSession | null = null;
  private stagehand: StagehandInstance | null = null;

  constructor(config?: StagehandConfig) {
    this.config = {
      apiKey: config?.apiKey || process.env.BROWSERBASE_API_KEY,
      projectId: config?.projectId || process.env.BROWSERBASE_PROJECT_ID,
      useLocal: config?.useLocal ?? false,
    };
  }

  /**
   * Initialize a browser session.
   * Tries Browserbase first, falls back to local Playwright.
   */
  async init(): Promise<Page> {
    // Try Browserbase + Stagehand if configured
    if (this.config.apiKey && this.config.projectId && !this.config.useLocal) {
      try {
        return await this.initCloud();
      } catch (error) {
        console.warn("[STAGEHAND] Browserbase init failed, falling back to local:", error);
      }
    }

    // Fallback to local Playwright
    return await this.initLocal();
  }

  private async initCloud(): Promise<Page> {
    try {
      // Dynamic import to avoid errors when not installed
      const { Stagehand } = await import("@browserbasehq/stagehand");

      const stagehand = new Stagehand({
        env: "BROWSERBASE",
        apiKey: this.config.apiKey,
        projectId: this.config.projectId,
        modelName: process.env.STAGEHAND_MODEL || "google/gemini-2.0-flash",
        modelClientOptions: {
          apiKey: process.env.GOOGLE_API_KEY || "",
        },
      });

      // 30s timeout on init
      await Promise.race([
        stagehand.init(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Stagehand init timed out after 30s')), 30000)),
      ]);
      this.stagehand = stagehand as unknown as StagehandInstance;

      const page = stagehand.page;
      const context = stagehand.context;

      this.session = {
        id: `bb-${Date.now()}`,
        page,
        context,
        browser: null as unknown as Browser,
        isCloud: true,
      };

      console.log("[STAGEHAND] Browserbase session initialized");
      return page;
    } catch (error) {
      console.error("[STAGEHAND] Cloud init error:", error);
      throw error;
    }
  }

  private async initLocal(): Promise<Page> {
    const args = ["--disable-dev-shm-usage"];
    // Only use --no-sandbox in development; production should run in a proper sandbox
    if (process.env.NODE_ENV !== "production") {
      args.push("--no-sandbox", "--disable-setuid-sandbox");
    }
    const browser = await chromium.launch({
      headless: true,
      args,
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    const page = await context.newPage();

    this.session = {
      id: `local-${Date.now()}`,
      page,
      context,
      browser,
      isCloud: false,
    };

    console.log("[STAGEHAND] Local Playwright session initialized");
    return page;
  }

  /**
   * Execute a single action using natural language.
   * Cloud mode: Stagehand act() with AI understanding.
   * Local mode: Translates to Playwright commands.
   */
  async act(instruction: string): Promise<ActResult> {
    if (!this.session) {
      return { success: false, error: "Session not initialized" };
    }

    try {
      if (this.session.isCloud && this.stagehand) {
        // Use Stagehand's native act()
        const sh = this.stagehand as { act: (opts: { action: string }) => Promise<{ success: boolean; message?: string }> };
        const result = await sh.act({ action: instruction });
        return { success: result.success, message: result.message };
      }

      // Local mode: parse instruction and execute with Playwright
      return await this.actLocal(instruction);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`[STAGEHAND] act() failed: ${message}`);
      return { success: false, error: message };
    }
  }

  /**
   * Execute multi-step task with reasoning (Stagehand agent mode).
   * Falls back to sequential act() calls locally.
   */
  async agent(task: string): Promise<ActResult> {
    if (!this.session) {
      return { success: false, error: "Session not initialized" };
    }

    try {
      if (this.session.isCloud && this.stagehand) {
        // Gate behind runtime method existence check
        if (typeof this.stagehand.agent !== 'function') {
          console.warn('[STAGEHAND] agent() not available in this version, falling back to act()');
          return await this.actLocal(task);
        }
        const result = await this.stagehand.agent({ task, maxSteps: 20 });
        return { success: result.success, message: result.message };
      }

      // Local fallback: just act on the task description
      return await this.actLocal(task);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: message };
    }
  }

  /**
   * Extract structured data from the current page.
   * Cloud mode: Stagehand extract() with Zod schema.
   * Local mode: Page text extraction.
   */
  async extract<T>(instruction: string, schema: ZodType<T>): Promise<ExtractResult<T>> {
    if (!this.session) {
      return { success: false, error: "Session not initialized" };
    }

    try {
      if (this.session.isCloud && this.stagehand) {
        const sh = this.stagehand as {
          extract: (opts: { instruction: string; schema: ZodType<T> }) => Promise<T>;
        };
        const data = await sh.extract({ instruction, schema });
        return { success: true, data };
      }

      // Local fallback: extract page text and try to parse
      const text = await this.session.page.textContent("body");
      const trimmed = text?.trim() || "";

      // Attempt 1: Try JSON parse if content looks like JSON
      try {
        const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const jsonData = JSON.parse(jsonMatch[0]);
          const parsed = schema.parse(jsonData);
          return { success: true, data: parsed };
        }
      } catch {
        // Not JSON, continue
      }

      // Attempt 2: Try to fit raw text into schema
      try {
        const parsed = schema.parse({ text: trimmed });
        return { success: true, data: parsed };
      } catch {
        // Continue
      }

      // Attempt 3: Try wrapping in common schema patterns
      try {
        const parsed = schema.parse(trimmed);
        return { success: true, data: parsed };
      } catch {
        return { success: false, error: "Could not parse page content into schema" };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: message };
    }
  }

  /**
   * Find interactive elements on the current page.
   */
  async observe(instruction?: string): Promise<ObserveResult> {
    if (!this.session) {
      return { success: false, error: "Session not initialized" };
    }

    try {
      if (this.session.isCloud && this.stagehand) {
        const sh = this.stagehand as {
          observe: (opts?: { instruction?: string }) => Promise<
            Array<{ selector: string; description: string; type: string }>
          >;
        };
        const elements = await sh.observe(instruction ? { instruction } : undefined);
        return { success: true, elements };
      }

      // Local fallback: find common interactive elements
      const page = this.session.page;
      const elements: Array<{ selector: string; description: string; type: string }> = [];

      const interactiveSelectors = [
        { sel: "a[href]", type: "link" },
        { sel: "button", type: "button" },
        { sel: "input", type: "input" },
        { sel: "select", type: "select" },
        { sel: "textarea", type: "textarea" },
      ];

      for (const { sel, type } of interactiveSelectors) {
        const count = await page.locator(sel).count();
        const limit = Math.min(count, 5);
        for (let i = 0; i < limit; i++) {
          const el = page.locator(sel).nth(i);
          const text = await el.textContent().catch(() => "");
          const placeholder = await el.getAttribute("placeholder").catch(() => "");
          const name = await el.getAttribute("name").catch(() => "");
          elements.push({
            selector: `${sel}:nth-of-type(${i + 1})`,
            description: text?.trim() || placeholder || name || type,
            type,
          });
        }
      }

      return { success: true, elements };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: message };
    }
  }

  /**
   * Take a screenshot of the current page.
   */
  async screenshot(): Promise<string | null> {
    if (!this.session) return null;
    try {
      const buffer = await this.session.page.screenshot({ type: "png" });
      return buffer.toString("base64");
    } catch {
      return null;
    }
  }

  /**
   * Navigate to a URL.
   */
  async goto(url: string): Promise<boolean> {
    if (!this.session) return false;
    try {
      await this.session.page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      return true;
    } catch (error) {
      console.error(`[STAGEHAND] goto() failed: ${error}`);
      return false;
    }
  }

  /**
   * Get the current page object (for direct Playwright access).
   */
  getPage(): Page | null {
    return this.session?.page || null;
  }

  /**
   * Check if using cloud (Browserbase) or local.
   */
  isCloud(): boolean {
    return this.session?.isCloud || false;
  }

  /**
   * Close the session and clean up.
   */
  async close(): Promise<void> {
    if (!this.session) return;

    try {
      if (this.session.isCloud && this.stagehand) {
        const sh = this.stagehand as { close: () => Promise<void> };
        await sh.close();
      } else {
        await this.session.context.close();
        await this.session.browser.close();
      }
    } catch (error) {
      console.error("[STAGEHAND] Close error:", error);
    }

    this.session = null;
    this.stagehand = null;
    console.log("[STAGEHAND] Session closed");
  }

  // ---- Local mode helpers ----

  /**
   * Parse natural language instruction and execute with Playwright.
   * Handles common patterns like "click on X", "type Y into Z", etc.
   */
  private async actLocal(instruction: string): Promise<ActResult> {
    const page = this.session!.page;
    const lower = instruction.toLowerCase();

    try {
      // Click patterns (expanded)
      if (lower.includes("click") || lower.includes("press") || lower.includes("tap") || lower.includes("hit")) {
        const target = instruction.replace(/(?:click|press|tap|hit)\s+(?:on\s+|the\s+)?/i, "").trim();
        // Try text-based click
        const el = page.getByText(target, { exact: false });
        if ((await el.count()) > 0) {
          await el.first().click();
          return { success: true, message: `Clicked: ${target}` };
        }
        // Try role-based
        const btn = page.getByRole("button", { name: target });
        if ((await btn.count()) > 0) {
          await btn.first().click();
          return { success: true, message: `Clicked button: ${target}` };
        }
        // Try link
        const link = page.getByRole("link", { name: target });
        if ((await link.count()) > 0) {
          await link.first().click();
          return { success: true, message: `Clicked link: ${target}` };
        }
        return { success: false, error: `Could not find element: ${target}` };
      }

      // Fill/type patterns (expanded)
      if (lower.includes("type") || lower.includes("fill") || lower.includes("enter") || lower.includes("input") || lower.includes("write")) {
        const match = instruction.match(/(?:type|fill|enter|input|write)\s+"?([^"]+)"?\s+(?:in|into|in the|to)\s+"?([^"]+)"?/i);
        if (match) {
          const value = match[1].trim();
          const target = match[2].trim();

          const input = page.getByLabel(target);
          if ((await input.count()) > 0) {
            await input.first().fill(value);
            return { success: true, message: `Filled ${target} with value` };
          }
          const byPlaceholder = page.getByPlaceholder(target);
          if ((await byPlaceholder.count()) > 0) {
            await byPlaceholder.first().fill(value);
            return { success: true, message: `Filled ${target} with value` };
          }
          return { success: false, error: `Could not find input: ${target}` };
        }
      }

      // Select patterns
      if (lower.includes("select")) {
        const match = instruction.match(/select\s+"?([^"]+)"?\s+(?:from|in)\s+"?([^"]+)"?/i);
        if (match) {
          const value = match[1].trim();
          const target = match[2].trim();
          const select = page.getByLabel(target);
          if ((await select.count()) > 0) {
            await select.first().selectOption(value);
            return { success: true, message: `Selected ${value} in ${target}` };
          }
        }
      }

      // Wait pattern
      if (lower.includes("wait")) {
        const match = instruction.match(/wait\s+(\d+)/i);
        const ms = match ? parseInt(match[1]) * 1000 : 2000;
        await page.waitForTimeout(Math.min(ms, 10000));
        return { success: true, message: `Waited ${ms}ms` };
      }

      // Scroll pattern
      if (lower.includes("scroll")) {
        if (lower.includes("down")) {
          await page.evaluate(() => window.scrollBy(0, 500));
        } else if (lower.includes("up")) {
          await page.evaluate(() => window.scrollBy(0, -500));
        } else {
          await page.evaluate(() => window.scrollBy(0, 500));
        }
        return { success: true, message: "Scrolled" };
      }

      // Navigate patterns
      if (lower.includes("go to") || lower.includes("navigate") || lower.includes("open") || lower.includes("visit")) {
        const urlMatch = instruction.match(/(?:go to|navigate to|open|visit)\s+"?([^\s"]+)"?/i);
        if (urlMatch) {
          const url = urlMatch[1].startsWith('http') ? urlMatch[1] : `https://${urlMatch[1]}`;
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
          return { success: true, message: `Navigated to: ${url}` };
        }
      }

      // Submit patterns
      if (lower.includes("submit") || lower.includes("send form")) {
        const submitBtn = page.locator('button[type="submit"], input[type="submit"], form button');
        if ((await submitBtn.count()) > 0) {
          await submitBtn.first().click();
          return { success: true, message: 'Form submitted' };
        }
        await page.keyboard.press('Enter');
        return { success: true, message: 'Submitted via Enter key' };
      }

      return { success: false, error: `Could not understand instruction: ${instruction}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: message };
    }
  }
}

// ---- Per-task factory (no shared singleton to prevent session leaks) ----

export function createStagehandService(config?: StagehandConfig): StagehandService {
  return new StagehandService(config);
}
