/**
 * Multi-User Browser Service - ONE Chrome, ALL Users
 * 
 * Architecture:
 * - ONE VPS runs ONE Chrome browser ($40/month total)
 * - Each user gets isolated BrowserContext (like Chrome profiles)
 * - 50-100 users per VPS before scaling
 * 
 * Cost: $40/month for unlimited users (until RAM limit)
 * Fallback: Browserbase only if VPS fails
 */

import { chromium, Browser, BrowserContext, Page } from "playwright";
import { WebSocketServer, WebSocket } from "ws";
import { getCredential } from "./credential-vault.js";
import { encryptWithServerKey, decryptWithServerKey } from "../security/encryption.js";
import { getSupabaseClient } from "../utils/supabase.js";
import { captchaSolver } from "./captcha-solver.js";

interface UserContext {
  userId: string;
  context: BrowserContext;
  page: Page;
  lastUsed: Date;
  isActive: boolean;
  wsClients: Set<WebSocket>;
}

interface BrowserSession {
  browser: Browser;
  contexts: Map<string, UserContext>; // userId -> context
  wss: WebSocketServer;
  startedAt: Date;
}

// Single shared browser instance
let sharedBrowser: BrowserSession | null = null;
const USER_CONTEXT_TIMEOUT = 30 * 60 * 1000; // 30 min idle before pausing

export class MultiUserBrowserService {
  private userId: string;
  private userContext: UserContext | null = null;

  constructor(userId: string) {
    this.userId = userId;
  }

  /**
   * Initialize shared browser (singleton) or connect to existing
   */
  async init(): Promise<Page> {
    try {
      // Initialize shared browser if not exists
      if (!sharedBrowser) {
        await this.initializeSharedBrowser();
      }

      // Get or create user context
      this.userContext = await this.getOrCreateUserContext();
      
      return this.userContext.page;
    } catch (error) {
      console.error("[MULTI-BROWSER] Init failed:", error);
      throw error;
    }
  }

  /**
   * Initialize the ONE shared Chrome instance
   */
  private async initializeSharedBrowser(): Promise<void> {
    console.log("[MULTI-BROWSER] Initializing shared Chrome instance...");
    
    try {
      const browser = await chromium.launch({
      headless: process.env.NODE_ENV === "production",
      args: [
        "--disable-dev-shm-usage",
        "--disable-setuid-sandbox",
        "--no-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--window-size=1280,800",
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-breakpad",
        "--disable-component-update",
        "--disable-default-apps",
        "--disable-features=TranslateUI",
        "--disable-hang-monitor",
        "--disable-ipc-flooding-protection",
        "--disable-popup-blocking",
        "--disable-prompt-on-repost",
        "--disable-renderer-backgrounding",
        "--force-color-profile=srgb",
        "--metrics-recording-only",
        "--no-first-run",
        "--safebrowsing-disable-auto-update",
        "--enable-automation",
        "--password-store=basic",
        "--use-mock-keychain",
      ],
    });

    // WebSocket for remote takeovers (all users)
    const wss = new WebSocketServer({ port: 9999 });
    
    wss.on("connection", (ws, req) => {
      const userId = this.extractUserIdFromUrl(req.url);
      if (!userId) {
        ws.close(4001, "No user ID");
        return;
      }

      const ctx = sharedBrowser?.contexts.get(userId);
      if (ctx) {
        ctx.wsClients.add(ws);
        this.startStreamingToClient(ctx, ws);
      }

      ws.on("close", () => {
        ctx?.wsClients.delete(ws);
      });
    });

    sharedBrowser = {
      browser,
      contexts: new Map(),
      wss,
      startedAt: new Date(),
    };

    console.log("[MULTI-BROWSER] Shared Chrome ready");

    // Start cleanup interval
    this.startCleanupInterval();
    } catch (error) {
      console.error("[MULTI-BROWSER] Failed to launch Chrome:", error);
      throw error;
    }
  }

  /**
   * Get existing context or create new one for user
   */
  private async getOrCreateUserContext(): Promise<UserContext> {
    if (!sharedBrowser) throw new Error("Shared browser not initialized");

    // Check if context exists
    let ctx = sharedBrowser.contexts.get(this.userId);
    if (ctx) {
      ctx.lastUsed = new Date();
      ctx.isActive = true;
      
      // Verify context is alive
      try {
        await ctx.page.evaluate(() => document.title);
        return ctx;
      } catch {
        // Dead, recreate
        await ctx.context.close().catch(() => {});
        sharedBrowser.contexts.delete(this.userId);
      }
    }

    // Create new isolated context
    console.log(`[MULTI-BROWSER] Creating new context for ${this.userId}`);

    const context = await sharedBrowser.browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: this.getRotatedUserAgent(),
      locale: "en-US",
      timezoneId: "America/New_York",
      // Each context gets its own isolated storage
      storageState: await this.loadStorageState(),
    });

    // Apply stealth
    await this.applyStealth(context);

    const page = await context.newPage();

    // Restore all sessions for this user
    await this.restoreAllSessions(context, page);

    ctx = {
      userId: this.userId,
      context,
      page,
      lastUsed: new Date(),
      isActive: true,
      wsClients: new Set(),
    };

    sharedBrowser.contexts.set(this.userId, ctx);

    // Log resource usage
    const contextCount = sharedBrowser.contexts.size;
    console.log(`[MULTI-BROWSER] Total contexts: ${contextCount}`);
    
    // Warn if approaching limit
    if (contextCount > 80) {
      console.warn(`[MULTI-BROWSER] WARNING: ${contextCount} contexts, near capacity`);
    }

    return ctx;
  }

  /**
   * Load storage state from Supabase
   */
  private async loadStorageState(): Promise<any | undefined> {
    try {
      const { data } = await getSupabaseClient()
        .from("browser_contexts")
        .select("storage_state_encrypted")
        .eq("user_id", this.userId)
        .single();

      if (data?.storage_state_encrypted) {
        const decrypted = await decryptWithServerKey(data.storage_state_encrypted);
        return JSON.parse(decrypted);
      }
    } catch {
      // No saved state
    }
    return undefined;
  }

  /**
   * Save storage state to Supabase
   */
  async saveStorageState(): Promise<void> {
    if (!this.userContext) return;

    try {
      const state = await this.userContext.context.storageState();
      const encrypted = await encryptWithServerKey(JSON.stringify(state));

      await getSupabaseClient()
        .from("browser_contexts")
        .upsert({
          user_id: this.userId,
          storage_state_encrypted: encrypted,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
    } catch (error) {
      console.warn(`[MULTI-BROWSER] Failed to save state:`, error);
    }
  }

  /**
   * Restore all sessions for user
   */
  private async restoreAllSessions(context: BrowserContext, page: Page): Promise<void> {
    const { data: sessions } = await getSupabaseClient()
      .from("user_sessions")
      .select("domain, session_data_encrypted")
      .eq("user_id", this.userId)
      .gt("expires_at", new Date().toISOString());

    if (!sessions) return;

    for (const session of sessions) {
      try {
        const decrypted = await decryptWithServerKey(session.session_data_encrypted);
        const data = JSON.parse(decrypted);

        if (data.cookies?.length > 0) {
          await context.addCookies(data.cookies);
        }

        console.log(`[MULTI-BROWSER] Restored ${session.domain}`);
      } catch (err) {
        console.warn(`[MULTI-BROWSER] Failed to restore ${session.domain}:`, err);
      }
    }
  }

  /**
   * Save all sessions for user
   */
  async saveAllSessions(): Promise<void> {
    if (!this.userContext) return;

    const cookies = await this.userContext.context.cookies();
    
    // Group by domain
    const byDomain = new Map<string, any[]>();
    for (const cookie of cookies) {
      const domain = cookie.domain.replace(/^\./, "");
      if (!byDomain.has(domain)) byDomain.set(domain, []);
      byDomain.get(domain)!.push(cookie);
    }

    for (const [domain, domainCookies] of byDomain) {
      const sessionData = {
        cookies: domainCookies,
        savedAt: new Date().toISOString(),
      };

      const encrypted = await encryptWithServerKey(JSON.stringify(sessionData));

      await getSupabaseClient()
        .from("user_sessions")
        .upsert({
          user_id: this.userId,
          domain,
          session_data_encrypted: encrypted,
          last_used_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        }, { onConflict: "user_id,domain" });
    }

    // Also save full storage state
    await this.saveStorageState();
  }

  /**
   * Create takeover session
   */
  async createTakeover(): Promise<{ url: string; token: string }> {
    if (!this.userContext) throw new Error("No context");

    const token = crypto.randomUUID();
    
    // URL to open in browser
    const url = `${process.env.NEXT_PUBLIC_APP_URL}/takeover/${this.userId}?token=${token}`;

    return { url, token };
  }

  getPage(): Page | null {
    return this.userContext?.page || null;
  }

  /**
   * Clean up this user's context (but keep browser running)
   */
  async close(): Promise<void> {
    if (this.userContext) {
      await this.saveAllSessions();
      this.userContext.isActive = false;
      // DON'T close context - keep for reuse!
    }
  }

  /**
   * Start screenshot streaming to WebSocket client
   */
  private startStreamingToClient(ctx: UserContext, ws: WebSocket): void {
    const interval = setInterval(async () => {
      if (ws.readyState !== WebSocket.OPEN) {
        clearInterval(interval);
        return;
      }

      try {
        const screenshotBuffer = await ctx.page.screenshot({
          type: "jpeg",
          quality: 60,
        });

        ws.send(JSON.stringify({
          type: "screenshot",
          data: screenshotBuffer.toString('base64'),
          timestamp: Date.now(),
        }));
      } catch {
        // Ignore errors
      }
    }, 500); // 2 FPS
  }

  /**
   * Extract user ID from WebSocket URL
   */
  private extractUserIdFromUrl(url: string | undefined): string | null {
    if (!url) return null;
    const match = url.match(/\/([^\/]+)$/);
    return match ? match[1] : null;
  }

  /**
   * Cleanup idle contexts periodically
   */
  private startCleanupInterval(): void {
    setInterval(async () => {
      if (!sharedBrowser) return;

      const now = Date.now();
      
      for (const [userId, ctx] of sharedBrowser.contexts) {
        // Close contexts idle for 30+ minutes
        if (now - ctx.lastUsed.getTime() > USER_CONTEXT_TIMEOUT && !ctx.isActive) {
          console.log(`[MULTI-BROWSER] Cleaning up idle context: ${userId}`);
          
          // Save state first
          try {
            const state = await ctx.context.storageState();
            const encrypted = await encryptWithServerKey(JSON.stringify(state));
            
            await getSupabaseClient()
              .from("browser_contexts")
              .upsert({
                user_id: userId,
                storage_state_encrypted: encrypted,
                updated_at: new Date().toISOString(),
              }, { onConflict: "user_id" });
          } catch (err) {
            console.warn("Failed to save idle context:", err);
          }

          // Close context
          await ctx.context.close().catch(() => {});
          sharedBrowser.contexts.delete(userId);
        }
      }

      console.log(`[MULTI-BROWSER] Active contexts: ${sharedBrowser.contexts.size}`);
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  private getRotatedUserAgent(): string {
    const agents = [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    ];
    return agents[Math.floor(Math.random() * agents.length)];
  }

  private async applyStealth(context: BrowserContext): Promise<void> {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "plugins", {
        get: () => [
          { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer" },
          { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai" },
        ],
      });
      (window as any).chrome = { runtime: {} };
    });
  }

  /**
   * Get stats about shared browser
   */
  static getStats(): { contexts: number; uptime: number } | null {
    if (!sharedBrowser) return null;
    return {
      contexts: sharedBrowser.contexts.size,
      uptime: Date.now() - sharedBrowser.startedAt.getTime(),
    };
  }

  /**
   * Fallback to Browserbase if VPS fails
   */
  static async createFallback(userId: string): Promise<any> {
    console.log("[MULTI-BROWSER] Falling back to Browserbase...");
    const { StagehandService } = await import("./stagehand.js");
    return new StagehandService({ userId });
  }
}

// Export factory
export function createMultiUserBrowser(userId: string): MultiUserBrowserService {
  return new MultiUserBrowserService(userId);
}
