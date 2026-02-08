/**
 * VPS Browser Service - Always-On Remote Chrome
 * 
 * Single persistent Chrome instance per user on VPS
 * Cost: ~$40/month VPS = 400 minutes on Browserbase
 * Break-even at 400 minutes, everything after is free
 */

import { chromium, Browser, BrowserContext, Page } from "playwright";
import { WebSocketServer, WebSocket } from "ws";
import { getCredential } from "./credential-vault.js";
import { encryptWithServerKey, decryptWithServerKey } from "../security/encryption.js";
import { getSupabaseClient } from "../utils/supabase.js";

interface VPSBrowserSession {
  userId: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  wss: WebSocketServer;
  clients: Set<WebSocket>;
  lastActivity: Date;
  isExecuting: boolean;
}

interface TakeoverSession {
  userId: string;
  wsUrl: string;
  token: string;
  createdAt: Date;
}

const sessions = new Map<string, VPSBrowserSession>();
const takeovers = new Map<string, TakeoverSession>();

// VPS Configuration
const VPS_HOST = process.env.VPS_BROWSER_HOST || "localhost";
const BASE_PORT = 9000;

export class VPSBrowserService {
  private userId: string;
  private session: VPSBrowserSession | null = null;

  constructor(userId: string) {
    this.userId = userId;
  }

  /**
   * Initialize or reconnect to existing browser session
   */
  async init(): Promise<Page> {
    // Check if session exists
    const existing = sessions.get(this.userId);
    if (existing) {
      existing.lastActivity = new Date();
      this.session = existing;
      
      // Health check
      try {
        await existing.page.evaluate(() => document.title);
        return existing.page;
      } catch {
        // Session dead, recreate
        await this.cleanup(existing);
        sessions.delete(this.userId);
      }
    }

    // Create new persistent session
    return this.createSession();
  }

  private async createSession(): Promise<Page> {
    const port = BASE_PORT + (sessions.size % 100); // Port rotation
    
    // Launch persistent browser
    const browser = await chromium.launch({
      headless: false, // We need UI for rare takeovers
      args: [
        "--disable-dev-shm-usage",
        "--disable-setuid-sandbox",
        "--no-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--window-size=1280,800",
        `--remote-debugging-port=${port}`,
      ],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: this.getRotatedUserAgent(),
      locale: "en-US",
      timezoneId: "America/New_York",
    });

    // Apply stealth
    await this.applyStealth(context);

    const page = await context.newPage();

    // Setup WebSocket for remote takeover
    const wss = new WebSocketServer({ port: port + 1000 });
    const clients = new Set<WebSocket>();

    wss.on("connection", (ws) => {
      clients.add(ws);
      
      ws.on("message", async (data) => {
        const msg = JSON.parse(data.toString());
        await this.handleRemoteCommand(msg, page);
      });

      ws.on("close", () => clients.delete(ws));
    });

    // Start screenshot streaming for live view
    this.startScreenshotStream(page, clients);

    this.session = {
      userId: this.userId,
      browser,
      context,
      page,
      wss,
      clients,
      lastActivity: new Date(),
      isExecuting: false,
    };

    sessions.set(this.userId, this.session);

    // Restore all saved sessions
    await this.restoreAllSessions(context, page);

    console.log(`[VPS-BROWSER] Session created for ${this.userId} on port ${port}`);
    return page;
  }

  /**
   * Restore all saved sessions for this user
   */
  private async restoreAllSessions(context: BrowserContext, page: Page): Promise<void> {
    const { data: userSessions } = await getSupabaseClient()
      .from("user_sessions")
      .select("domain, session_data_encrypted")
      .eq("user_id", this.userId)
      .gt("expires_at", new Date().toISOString());

    if (!userSessions || userSessions.length === 0) return;

    for (const session of userSessions) {
      try {
        const decrypted = await decryptWithServerKey(session.session_data_encrypted);
        const data = JSON.parse(decrypted);

        // Restore cookies for this domain
        if (data.cookies?.length > 0) {
          const domainCookies = data.cookies.filter((c: any) => 
            session.domain.includes(c.domain) || c.domain.includes(session.domain)
          );
          await context.addCookies(domainCookies);
        }

        console.log(`[VPS-BROWSER] Restored session for ${session.domain}`);
      } catch (err) {
        console.warn(`[VPS-BROWSER] Failed to restore ${session.domain}:`, err);
      }
    }
  }

  /**
   * Save all current sessions
   */
  async saveAllSessions(): Promise<void> {
    if (!this.session) return;

    const cookies = await this.session.context.cookies();
    
    // Group cookies by domain
    const byDomain = new Map<string, any[]>();
    for (const cookie of cookies) {
      const domain = cookie.domain.replace(/^\./, "");
      if (!byDomain.has(domain)) byDomain.set(domain, []);
      byDomain.get(domain)!.push(cookie);
    }

    // Save each domain
    for (const [domain, domainCookies] of byDomain) {
      const sessionData = {
        cookies: domainCookies,
        localStorage: {}, // Extract per-domain
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
          expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 YEAR
        }, { onConflict: "user_id,domain" });
    }

    console.log(`[VPS-BROWSER] Saved ${byDomain.size} sessions`);
  }

  /**
   * Create takeover session for user intervention
   */
  async createTakeover(): Promise<{ url: string; token: string }> {
    if (!this.session) throw new Error("No session");

    const token = crypto.randomUUID();
    const port = this.session.wss.options.port as number;
    
    const takeover: TakeoverSession = {
      userId: this.userId,
      wsUrl: `wss://${VPS_HOST}:${port}`,
      token,
      createdAt: new Date(),
    };

    takeovers.set(token, takeover);

    // URL for user to open
    const url = `${process.env.NEXT_PUBLIC_APP_URL}/takeover/${token}`;

    return { url, token };
  }

  /**
   * Execute with never-stop retry logic
   */
  async executeWithResilience<T>(
    fn: () => Promise<T>,
    options: {
      maxAttempts?: number;
      onObstacle?: (error: Error, attempt: number) => Promise<boolean>;
    } = {}
  ): Promise<T> {
    const maxAttempts = options.maxAttempts || 10;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        this.session!.isExecuting = true;
        const result = await fn();
        this.session!.isExecuting = false;
        return result;
      } catch (error) {
        lastError = error as Error;
        this.session!.isExecuting = false;

        console.log(`[VPS-BROWSER] Attempt ${attempt}/${maxAttempts} failed:`, lastError.message);

        // Try obstacle handler
        if (options.onObstacle) {
          const shouldContinue = await options.onObstacle(lastError, attempt);
          if (!shouldContinue) break;
        }

        // Exponential backoff: 1s, 2s, 4s, 8s...
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    throw lastError || new Error("Max attempts reached");
  }

  getPage(): Page | null {
    return this.session?.page || null;
  }

  private async handleRemoteCommand(msg: any, page: Page): Promise<void> {
    switch (msg.type) {
      case "click":
        await page.click(msg.selector);
        break;
      case "type":
        await page.fill(msg.selector, msg.text);
        break;
      case "navigate":
        await page.goto(msg.url);
        break;
      case "screenshot":
        const screenshotBuffer = await page.screenshot();
        this.broadcast({ type: "screenshot", data: screenshotBuffer.toString('base64') });
        break;
    }
  }

  private startScreenshotStream(page: Page, clients: Set<WebSocket>): void {
    const stream = setInterval(async () => {
      if (clients.size === 0) return;
      
      try {
        const screenshotBuffer = await page.screenshot({ 
          type: "jpeg",
          quality: 60,
        });
        const screenshot = screenshotBuffer.toString('base64');
        
        clients.forEach(ws => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "screenshot", data: screenshot }));
          }
        });
      } catch {
        // Ignore screenshot errors
      }
    }, 500); // 2 FPS - smooth enough for remote control

    // Store interval for cleanup
    (this.session as any).screenshotInterval = stream;
  }

  private broadcast(msg: any): void {
    if (!this.session) return;
    const data = JSON.stringify(msg);
    this.session.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });
  }

  private getRotatedUserAgent(): string {
    const agents = [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
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

  private async cleanup(session: VPSBrowserSession): Promise<void> {
    try {
      await session.wss.close();
      await session.context.close();
      await session.browser.close();
    } catch {
      // Ignore cleanup errors
    }
  }

  async close(): Promise<void> {
    if (this.session) {
      await this.saveAllSessions();
      // DON'T close - keep persistent!
      // Only close if explicit shutdown requested
    }
  }
}

// Health check - keep sessions alive
setInterval(async () => {
  const now = new Date();
  for (const [userId, session] of sessions) {
    // If idle for 30 minutes, save and keep alive
    if (now.getTime() - session.lastActivity.getTime() > 30 * 60 * 1000) {
      console.log(`[VPS-BROWSER] Keeping session alive for ${userId}`);
      // Touch session to keep it active
      try {
        await session.page.evaluate(() => document.title);
      } catch {
        // Session died, will be recreated on next use
      }
    }
  }
}, 60 * 1000);
