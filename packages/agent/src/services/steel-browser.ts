/**
 * Steel.dev Browser Service
 *
 * Manages browser sessions via Steel.dev's hosted browser infrastructure.
 * Sessions connect over CDP WebSocket for Playwright control.
 *
 * Includes anti-detection measures:
 * - Random User-Agent rotation (realistic Chrome UAs)
 * - Viewport randomization (near 1920x1080)
 * - Stealth HTTP headers (Accept-Language, Accept-Encoding)
 * - WebDriver property masking
 */

import { chromium, type Browser, type Page } from 'playwright';
import { logger } from '../utils/logger.js';
import { getSupabaseClient } from '../utils/supabase.js';

const STEEL_API_KEY = process.env.STEEL_API_KEY;
const STEEL_API_URL = 'https://api.steel.dev/v1';
const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes per session — complex flows need more time
const MAX_CONCURRENT = 3;

// ── Anti-Detection: Realistic User Agents ──

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
];

const MOBILE_USER_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
];

function getRandomUA(mobile = false): string {
  const pool = mobile ? MOBILE_USER_AGENTS : USER_AGENTS;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Apply anti-detection stealth measures to a Playwright page.
 * Works without paid proxies — pure header/fingerprint evasion.
 */
export async function applyStealthMeasures(page: Page, mobile = false): Promise<void> {
  const ua = getRandomUA(mobile);

  // Set stealth HTTP headers
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Sec-CH-UA': '"Chromium";v="131", "Not_A Brand";v="24"',
    'Sec-CH-UA-Mobile': mobile ? '?1' : '?0',
    'Sec-CH-UA-Platform': mobile ? '"Android"' : '"Windows"',
    'Upgrade-Insecure-Requests': '1',
  });

  // Randomize viewport (near standard sizes, +/- some pixels)
  const width = mobile
    ? 390 + Math.floor(Math.random() * 30) - 15
    : 1920 + Math.floor(Math.random() * 100) - 50;
  const height = mobile
    ? 844 + Math.floor(Math.random() * 30) - 15
    : 1080 + Math.floor(Math.random() * 60) - 30;
  await page.setViewportSize({ width, height });

  // Mask WebDriver and automation indicators via page init script
  await page.addInitScript(() => {
    // Hide webdriver flag
    Object.defineProperty(navigator, 'webdriver', { get: () => false });

    // Realistic plugins array (empty array looks suspicious)
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5], // non-empty, mimics real browser
    });

    // Realistic languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });

    // Chrome runtime mock (missing in headless)
    if (!(window as unknown as Record<string, unknown>).chrome) {
      (window as unknown as Record<string, unknown>).chrome = {
        runtime: {},
        loadTimes: () => ({}),
        csi: () => ({}),
      };
    }

    // Notification permission query (headless returns 'denied' too fast)
    const originalQuery = window.navigator.permissions.query.bind(
      window.navigator.permissions
    );
    window.navigator.permissions.query = (parameters: PermissionDescriptor) => {
      if (parameters.name === 'notifications') {
        return Promise.resolve({ state: 'prompt', onchange: null } as PermissionStatus);
      }
      return originalQuery(parameters);
    };
  });

  // Set User-Agent via CDP (more reliable than header override)
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.setUserAgentOverride', {
      userAgent: ua,
      platform: mobile ? 'Linux armv81' : 'Win32',
    });
  } catch {
    // CDP session may not be available in all contexts — headers still work
    logger.debug('[STEEL] CDP UA override not available, using header-based UA');
  }

  logger.debug(`[STEEL] Stealth applied: ${ua.substring(0, 50)}..., viewport ${width}x${height}`);
}

interface SteelSession {
  sessionId: string;
  browser: Browser;
  page: Page;
  createdAt: number;
}

const activeSessions = new Map<string, SteelSession>();

/**
 * Create a new Steel browser session and connect via CDP.
 * Returns a Playwright Page ready for interaction.
 */
export async function createSession(taskId: string): Promise<SteelSession> {
  if (activeSessions.size >= MAX_CONCURRENT) {
    throw new Error('Max concurrent browser sessions reached');
  }

  // Try Steel.dev first, fall back to local Chrome if it fails
  let browser: Browser;
  let sessionId: string;
  let usedLocal = false;

  const isSelfHosted = STEEL_API_URL.includes('.railway.internal') || STEEL_API_URL.includes('localhost');

  if (STEEL_API_KEY || isSelfHosted) {
    try {
      // Create Steel session via API
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (!isSelfHosted && STEEL_API_KEY) {
        headers['steel-api-key'] = STEEL_API_KEY;
      }

      const apiBase = isSelfHosted ? `${STEEL_API_URL}/v1` : STEEL_API_URL;
      const res = await fetch(`${apiBase}/sessions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          sessionTimeout: SESSION_TIMEOUT_MS,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`Steel session creation failed: ${(err as Record<string, string>).message || res.status}`);
      }

      const session = await res.json() as { id: string };
      sessionId = session.id;
      logger.info(`[STEEL] Created session ${sessionId} for task ${taskId.slice(0, 8)}`);

      // Connect via CDP WebSocket with timeout
      const wsUrl = isSelfHosted
        ? `ws://${new URL(STEEL_API_URL).host}?sessionId=${sessionId}`
        : `wss://connect.steel.dev?apiKey=${STEEL_API_KEY}&sessionId=${sessionId}`;
      browser = await Promise.race([
        chromium.connectOverCDP(wsUrl),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('CDP connection timeout (15s)')), 15_000)),
      ]);
    } catch (steelErr) {
      logger.warn(`[STEEL] Steel failed, falling back to local Chrome: ${steelErr instanceof Error ? steelErr.message : 'unknown'}`);
      // Fall through to local Chrome
      browser = null as unknown as Browser;
      sessionId = '';
    }
  }

  // Fallback: launch local Chrome (already installed on Railway via Dockerfile)
  if (!browser!) {
    try {
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-blink-features=AutomationControlled',
        ],
      });
      sessionId = `local-${taskId.slice(0, 8)}-${Date.now()}`;
      usedLocal = true;
      logger.info(`[STEEL] Using local Chrome for task ${taskId.slice(0, 8)}`);
    } catch (localErr) {
      throw new Error(`Both Steel and local Chrome failed. Steel: connection issue. Local: ${localErr instanceof Error ? localErr.message : 'unknown'}`);
    }
  }

  const context = usedLocal
    ? await browser.newContext()
    : (browser.contexts()[0] || await browser.newContext());
  const page = usedLocal
    ? await context.newPage()
    : (context.pages()[0] || await context.newPage());

  // Apply anti-detection stealth measures (user-agent, viewport, headers)
  await applyStealthMeasures(page);

  const steelSession: SteelSession = {
    sessionId: sessionId!,
    browser,
    page,
    createdAt: Date.now(),
  };

  activeSessions.set(taskId, steelSession);
  return steelSession;
}

/**
 * Destroy a Steel browser session — close the browser and release the Steel session.
 * Safe to call multiple times (idempotent).
 */
export async function destroySession(taskId: string): Promise<void> {
  const session = activeSessions.get(taskId);
  if (!session) return;

  // Close browser connection
  try {
    await session.browser.close();
  } catch (err) {
    logger.debug(`[STEEL] Browser close error for task ${taskId.slice(0, 8)} (non-critical):`, err);
  }

  // Release Steel session via API (skip for local Chrome sessions)
  if (!session.sessionId.startsWith('local-')) {
    try {
      await fetch(`${STEEL_API_URL}/sessions/${session.sessionId}`, {
        method: 'DELETE',
        headers: { 'steel-api-key': STEEL_API_KEY! },
      });
      logger.info(`[STEEL] Destroyed session ${session.sessionId} for task ${taskId.slice(0, 8)}`);
    } catch (err) {
      logger.warn(`[STEEL] Session release failed for ${session.sessionId}:`, err);
    }
  } else {
    logger.info(`[STEEL] Closed local Chrome session for task ${taskId.slice(0, 8)}`);
  }

  activeSessions.delete(taskId);
}

/**
 * Get the active Playwright Page for a task, or null if no session exists.
 */
export async function getPage(taskId: string): Promise<Page | null> {
  const session = activeSessions.get(taskId);
  if (!session) return null;

  // Check if session has expired
  if (Date.now() - session.createdAt > SESSION_TIMEOUT_MS) {
    logger.warn(`[STEEL] Session expired for task ${taskId.slice(0, 8)}, destroying`);
    await destroySession(taskId);
    return null;
  }

  return session.page;
}

/**
 * Check if a task has an active browser session.
 */
export function hasSession(taskId: string): boolean {
  return activeSessions.has(taskId);
}

/**
 * Cleanup orphaned sessions that exceeded their timeout.
 * Called from scheduler or on task completion.
 */
export async function cleanupOrphanedSessions(): Promise<void> {
  const now = Date.now();
  const expiredTasks: string[] = [];

  for (const [taskId, session] of activeSessions) {
    if (now - session.createdAt > SESSION_TIMEOUT_MS + 60_000) {
      expiredTasks.push(taskId);
    }
  }

  for (const taskId of expiredTasks) {
    logger.warn({ taskId }, '[STEEL] Cleaning up orphaned browser session');
    await destroySession(taskId);
  }

  if (expiredTasks.length > 0) {
    logger.info(`[STEEL] Cleaned up ${expiredTasks.length} orphaned session(s)`);
  }
}

/**
 * Get count of active sessions (for monitoring).
 */
export function getActiveSessionCount(): number {
  return activeSessions.size;
}

// ── Persistent Browser Context (Cookies) ──────────────────────────

const CONTEXT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_COOKIES_PER_DOMAIN = 50;

/**
 * Save browser cookies for a user+domain so future tasks can restore the session.
 * Stores in the `user_context` table with context_type='habit' and key='browser_session:<domain>'.
 * Silently skips if there are fewer than 2 cookies (no meaningful session).
 */
export async function saveUserBrowserContext(page: Page, userId: string): Promise<void> {
  try {
    const pageUrl = page.url();
    if (!pageUrl || pageUrl === 'about:blank') return;

    const domain = new URL(pageUrl).hostname;
    const cookies = await page.context().cookies();

    // Only save if there are meaningful cookies (likely a logged-in session)
    if (cookies.length < 2) return;

    // Limit cookie count to prevent bloat
    const trimmedCookies = cookies.slice(0, MAX_COOKIES_PER_DOMAIN);

    const supabase = getSupabaseClient();
    await supabase.from('user_context').upsert({
      user_id: userId,
      context_type: 'habit',
      key: `browser_session:${domain}`,
      value: {
        cookies: trimmedCookies,
        domain,
        savedAt: Date.now(),
      },
      confidence: 1.0,
      source: 'observed',
      last_confirmed_at: new Date().toISOString(),
      times_observed: 1,
    }, { onConflict: 'user_id,context_type,key' });

    logger.info({ userId, domain, cookieCount: trimmedCookies.length }, '[STEEL] Browser context saved');
  } catch (err) {
    logger.warn({ err }, '[STEEL] Failed to save browser context');
  }
}

/**
 * Load previously saved cookies for a domain and inject them into the browser context.
 * Returns true if cookies were restored, false otherwise.
 * Skips contexts older than 7 days.
 */
export async function loadUserBrowserContext(page: Page, userId: string, url: string): Promise<boolean> {
  try {
    const domain = new URL(url).hostname;
    const supabase = getSupabaseClient();

    const { data } = await supabase
      .from('user_context')
      .select('value')
      .eq('user_id', userId)
      .eq('context_type', 'habit')
      .eq('key', `browser_session:${domain}`)
      .single();

    if (!data?.value?.cookies || !Array.isArray(data.value.cookies) || data.value.cookies.length === 0) {
      return false;
    }

    // Check if saved context is expired
    const savedAt = data.value.savedAt || 0;
    if (Date.now() - savedAt > CONTEXT_EXPIRY_MS) {
      logger.debug({ userId, domain }, '[STEEL] Saved browser context expired, skipping');
      return false;
    }

    await page.context().addCookies(data.value.cookies);
    logger.info({ userId, domain, cookieCount: data.value.cookies.length }, '[STEEL] Browser context restored');
    return true;
  } catch {
    return false;
  }
}

/**
 * Save browser context for a task before destroying its session.
 * Call this with the userId before destroySession().
 */
export async function saveBrowserContextForTask(taskId: string, userId: string): Promise<void> {
  const session = activeSessions.get(taskId);
  if (!session) return;

  try {
    await saveUserBrowserContext(session.page, userId);
  } catch (err) {
    logger.debug({ err, taskId }, '[STEEL] Browser context save before destroy failed (non-critical)');
  }
}
