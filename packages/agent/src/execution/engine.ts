/**
 * Execution Engine
 *
 * Orchestrates browser automation with fallback chains and learning.
 * Never makes the same mistake twice - learns from every failure.
 */

import { chromium, Browser, BrowserContext, Page } from 'patchright';
import { LockedIntent } from '../security/intent-lock.js';
import { ActionValidator } from '../security/validator.js';
import { executeClick } from './actions/click.js';
import { executeFill } from './actions/fill.js';
import { executeLogin } from './actions/login.js';
import { createExcelFile, createSimpleTable, type ExcelGenerationParams } from './actions/create-excel.js';
import { createPowerPoint, createSimplePresentation, type PresentationParams } from './actions/create-powerpoint.js';
import { createWordDocument, createSimpleDocument, type WordDocumentParams } from './actions/create-word.js';
import { createPDF, createSimplePDF, type PDFParams } from './actions/create-pdf.js';
import { screenshotWithOCR, type ScreenshotOCRParams, type OCRResult } from './actions/screenshot-ocr.js';
import { getFailureMemory, recordFailure, learnSolution } from '../memory/failure-db.js';
import { quickValidate, generateVisionResponse } from '../services/ai.js';
import { getCredential } from '../services/credential-vault.js';
import { MultiUserBrowserService, createMultiUserBrowser } from '../services/multi-user-browser.js';
import { withTimeout, delay } from '../utils/timeout.js';
import { applyStealthPatches, getRealisticUserAgent, humanizeInteraction } from './stealth.js';
import { dismissPopups } from './popup-handler.js';
import { waitForSPAReady } from './dynamic-content.js';
import { checkAndHandleAntiBot, getProxyConfig } from './antibot.js';
import { handleCaptchaIfPresent } from './captcha.js';
import { sessionManager } from './session-manager.js';
import { logTaskStep } from './task-logger.js';
import { RetryPolicy } from './retry.js';
import { validateUrlSafety } from '../utils/url-validator.js';

// Timeouts — tuned per action type for optimal speed vs reliability
const TASK_TIMEOUT_MS = 1200000;  // 20 minutes per task
const STEP_TIMEOUT_MS = 15000;    // 15 seconds for click/fill/select (fast fail on bad selectors)
const NAV_TIMEOUT_MS = 35000;     // 35 seconds for navigate/submit (heavy pages like Amazon need time)
const POST_ACTION_WAIT_MS = 800;  // Wait after click/fill/submit/select

export interface ExecutionStep {
  action: string;
  params: Record<string, unknown>;
  expected?: string;
}

interface StepResult {
  success: boolean;
  action: string;
  method?: string;
  data?: unknown;
  error?: string;
  screenshot?: string;
}

export class ExecutionEngine {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private intent: LockedIntent;
  private validator: ActionValidator;
  private totalCost = 0;
  private results: StepResult[] = [];
  private multiUserBrowser: MultiUserBrowserService | null = null;
  private useMultiUser: boolean;
  private useRemoteCDP: boolean;
  private userId?: string;
  private domain?: string;
  private isMultiUser = false;
  private isRemoteCDP = false; // Whether using remote CDP browser
  private useBrightData = false;
  private taskId?: string;

  constructor(intent: LockedIntent) {
    this.intent = intent;
    this.validator = new ActionValidator(intent);

    // Priority: Bright Data > Remote CDP > VPS Multi-User > Local Playwright
    const forceLocal = process.env.FORCE_LOCAL_BROWSER === 'true';

    // PRIORITY 0: Bright Data Scraping Browser (real managed Chrome, bypasses DataDome/Akamai)
    this.useBrightData = !forceLocal && !!(process.env.BRIGHT_DATA_BROWSER_WS);

    // PRIORITY 1: Remote CDP browser (connects to VPS Chrome via WebSocket)
    this.useRemoteCDP = !forceLocal && !this.useBrightData && !!(process.env.REMOTE_BROWSER_CDP);

    // PRIORITY 2: VPS Multi-User Browser (shared Chrome on this process)
    this.useMultiUser = !forceLocal && !this.useBrightData && !this.useRemoteCDP && !!(process.env.VPS_BROWSER_HOST);

    if (this.useBrightData) {
      console.log('[ENGINE] Will use Bright Data Scraping Browser');
    } else if (this.useRemoteCDP) {
      console.log('[ENGINE] Will use Remote CDP Browser (VPS)');
    } else if (this.useMultiUser) {
      console.log('[ENGINE] Will use VPS Multi-User Browser');
    } else {
      console.log('[ENGINE] Will use local Playwright');
    }
  }

  async initialize(userId?: string, domain?: string, taskId?: string): Promise<void> {
    this.userId = userId;
    this.domain = domain;
    this.taskId = taskId;

    // PRIORITY 0: Bright Data Scraping Browser — managed real Chrome, bypasses DataDome/Akamai
    if (this.useBrightData) {
      try {
        const wsUrl = process.env.BRIGHT_DATA_BROWSER_WS!;
        console.log(`[ENGINE] Connecting to Bright Data Scraping Browser...`);

        const cdpTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
          Promise.race([promise, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} timeout after ${ms}ms`)), ms))]);

        // Bright Data provides a direct WSS endpoint — no /json/version step needed
        this.browser = await cdpTimeout(chromium.connectOverCDP(wsUrl), 15000, 'brightdata-connect');
        this.isRemoteCDP = true;

        this.context = await cdpTimeout(this.browser.newContext({
          viewport: { width: 1280, height: 800 },
          locale: 'en-US',
          timezoneId: 'America/New_York',
        }), 10000, 'brightdata-newContext');

        this.page = await cdpTimeout(this.context.newPage(), 10000, 'brightdata-newPage');
        await cdpTimeout(this.page.evaluate(() => document.readyState), 5000, 'brightdata-readyState');
        console.log(`[ENGINE] Connected to Bright Data Scraping Browser`);
        return;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.warn(`[ENGINE] Bright Data connection failed: ${errorMsg} — falling back`);
        this.browser = null; this.context = null; this.page = null; this.isRemoteCDP = false;
      }
    }

    // PRIORITY 1: Remote CDP Browser — connect to Chrome running on VPS via WebSocket
    if (this.useRemoteCDP) {
      try {
        const cdpEndpoint = process.env.REMOTE_BROWSER_CDP!; // e.g. http://77.42.31.185:9223
        console.log(`[ENGINE] Connecting to remote CDP at ${cdpEndpoint}...`);

        // Get the WebSocket debugger URL from the CDP endpoint
        const versionUrl = cdpEndpoint.replace(/\/$/, '') + '/json/version';
        const versionRes = await fetch(versionUrl, { signal: AbortSignal.timeout(5000) });
        const versionData = await versionRes.json() as { webSocketDebuggerUrl?: string };
        const wsUrl = versionData.webSocketDebuggerUrl;

        if (!wsUrl) throw new Error('No webSocketDebuggerUrl in CDP /json/version');

        // Connect via CDP with 10s timeout — the VPS Chrome stays running, we get a Browser handle
        const cdpTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
          Promise.race([promise, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} timeout after ${ms}ms`)), ms))]);

        this.browser = await cdpTimeout(chromium.connectOverCDP(wsUrl), 10000, 'connectOverCDP');
        this.isRemoteCDP = true;

        // Create an isolated context for this task (with timeout for each step)
        const { getDeviceProfile } = await import('./stealth.js');
        const profile = getDeviceProfile();
        this.context = await cdpTimeout(this.browser.newContext({
          viewport: profile.viewport,
          screen: profile.screen,
          deviceScaleFactor: profile.deviceScaleFactor,
          userAgent: getRealisticUserAgent(),
          locale: 'en-US',
          timezoneId: 'America/New_York',
        }), 10000, 'newContext');

        await applyStealthPatches(this.context);
        this.page = await cdpTimeout(this.context.newPage(), 10000, 'newPage');
        await humanizeInteraction(this.page);

        // Verify page is responsive
        await cdpTimeout(this.page.evaluate(() => document.readyState), 5000, 'readyState');
        console.log(`[ENGINE] Connected to remote CDP browser (Chrome ${(versionData as any).Browser || 'unknown'})`);
        return;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.warn(`[ENGINE] Remote CDP connection failed: ${errorMsg} — falling back to local`);
        this.browser = null;
        this.context = null;
        this.page = null;
        this.isRemoteCDP = false;
        // Fall through to local Playwright
      }
    }

    // PRIORITY 1: Multi-User Browser (VPS) - Best for autonomy
    if (this.useMultiUser && userId) {
      try {
        console.log('[ENGINE] Initializing Multi-User Browser (VPS)...');
        this.multiUserBrowser = createMultiUserBrowser(userId);
        this.page = await this.multiUserBrowser.init();
        this.isMultiUser = true;

        // Verify page is responsive
        try {
          await this.page.evaluate(() => document.readyState);
          console.log("[ENGINE] Initialized with Multi-User Browser (VPS) — page responsive");
          return;
        } catch (pageErr) {
          console.warn("[ENGINE] Multi-User Browser page not responsive:", pageErr);
          this.multiUserBrowser = null;
          this.page = null;
          // Fall through to next option
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.warn(`[ENGINE] Multi-User Browser init failed:`, errorMsg);
        this.multiUserBrowser = null;
        // Fall through to next option
      }
    }

    // PRIORITY 2: Local Playwright fallback with stealth + manual session restore
    let savedSession = null;
    if (userId && domain) {
      savedSession = await sessionManager.loadSession(userId, domain);
      if (savedSession) {
        console.log(`[ENGINE] Found saved session for ${domain}, will restore after browser init`);
      }
    }

    // --no-sandbox required in Docker containers (Railway runs as root)
    // --no-zygote: Railway containers have tight thread limits; zygote spawns many threads at startup
    //   causing pthread_create EAGAIN (signal 6 crash). --no-zygote eliminates the zygote subprocess.
    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--no-zygote',
      '--ignore-certificate-errors', // Don't crash on www. vs non-www cert mismatches
      '--disable-blink-features=AutomationControlled',
      // Disable HTTP/2 when using a proxy — Geonode (and most residential proxies) don't
      // properly tunnel HTTP/2 CONNECT, causing ERR_HTTP2_PROTOCOL_ERROR. HTTP/1.1 works fine.
      ...(process.env.PROXY_URL || process.env.PROXY_LIST ? ['--disable-http2'] : []),
    ];

    // Wire proxy config if available (for anti-bot bypass)
    const proxyConfig = getProxyConfig();

    this.browser = await chromium.launch({
      headless: true,
      args: launchArgs,
      ...(proxyConfig ? { proxy: proxyConfig } : {}),
    });

    const { getDeviceProfile } = await import('./stealth.js');
    const profile = getDeviceProfile();
    this.context = await this.browser.newContext({
      viewport: profile.viewport,
      screen: profile.screen,
      deviceScaleFactor: profile.deviceScaleFactor,
      userAgent: getRealisticUserAgent(),
      locale: 'en-US',
      timezoneId: 'America/New_York',
      acceptDownloads: false,
      permissions: [],
    });

    await applyStealthPatches(this.context);
    this.page = await this.context.newPage();

    // Apply humanized interaction delays to reduce bot detection
    await humanizeInteraction(this.page);

    // Manual session restore for local Playwright
    if (savedSession && this.context && this.page) {
      await sessionManager.restoreSession(this.context, this.page, savedSession);
      console.log("[ENGINE] Restored session into local Playwright browser");
    }

    console.log("[ENGINE] Initialized with local Playwright (stealth)");
  }

  async cleanup(): Promise<void> {
    // Save session before cleanup
    if (this.multiUserBrowser) {
      try {
        await this.multiUserBrowser.saveAllSessions();
        console.log('[ENGINE] Saved VPS Browser sessions');
      } catch (error) {
        console.warn('[ENGINE] Failed to save VPS sessions:', error);
      }
      await this.multiUserBrowser.close();
      this.multiUserBrowser = null;
    } else if (this.userId && this.domain && this.page && this.context) {
      try {
        await sessionManager.saveSession(this.userId, this.domain, this.context, this.page, true);
        console.log(`[ENGINE] Saved session for ${this.domain} before cleanup`);
      } catch (error) {
        console.warn('[ENGINE] Failed to save session during cleanup:', error);
      }
    }

    // Remote CDP: close context only (browser stays running on VPS for other tasks)
    // Local Playwright: close everything
    if (this.isRemoteCDP) {
      if (this.context) await this.context.close().catch(() => {});
      // Disconnect from remote browser (don't close it — it serves other tasks)
      if (this.browser) await this.browser.close().catch(() => {});
      console.log('[ENGINE] Disconnected from remote CDP browser');
    } else if (!this.multiUserBrowser) {
      if (this.context) await this.context.close().catch(() => {});
      if (this.browser) await this.browser.close().catch(() => {});
    }

    this.page = null;
    this.context = null;
    this.browser = null;
  }

  getPage(): Page | null {
    return this.page;
  }

  getTotalCost(): number {
    return this.totalCost;
  }

  getResults(): StepResult[] {
    return this.results;
  }

  getCurrentUrl(): string {
    return this.page?.url() || '';
  }

  /**
   * Get the Live View URL for the current browser session.
   * Users can open this on their phone to see/interact with the browser in real time.
   * Only available when using VPS Browser.
   */
  async getLiveViewUrl(): Promise<string | null> {
    if (!this.multiUserBrowser) return null;
    try {
      const { url } = await this.multiUserBrowser.createTakeover();
      return url;
    } catch {
      return null;
    }
  }

  getActionSuccessRate(): number {
    if (this.results.length === 0) return 100;
    const successes = this.results.filter(r => r.success).length;
    return Math.round((successes / this.results.length) * 100);
  }

  async retryFailedSteps(): Promise<{ success: boolean; improved: number }> {
    const failed = this.results.filter(r => !r.success);
    if (failed.length === 0) return { success: true, improved: 0 };

    let improved = 0;
    for (const failedResult of failed) {
      const step: ExecutionStep = {
        action: failedResult.action,
        params: (failedResult.data as Record<string, unknown>) || {},
      };

      try {
        const retryResult = await this.executeStep(step);
        if (retryResult.success) {
          improved++;
          // Replace the failed result in the results array
          const idx = this.results.indexOf(failedResult);
          if (idx !== -1) {
            this.results[idx] = retryResult;
          }
        }
      } catch {
        // Continue with next failed step
      }
    }

    return { success: improved > 0, improved };
  }

  /**
   * Check if the page is still alive; re-initialize if crashed.
   */
  private async ensurePageAlive(): Promise<boolean> {
    if (!this.page) return false;
    try {
      if (this.page.isClosed()) {
        console.warn('[ENGINE] Page closed unexpectedly, re-initializing...');
        const savedUserId = this.userId;
        const savedDomain = this.domain;
        await this.cleanup();
        await this.initialize(savedUserId, savedDomain);
        return !!this.page;
      }
      return true;
    } catch {
      console.warn('[ENGINE] Page health check failed, re-initializing...');
      const savedUserId = this.userId;
      const savedDomain = this.domain;
      await this.cleanup();
      await this.initialize(savedUserId, savedDomain);
      return !!this.page;
    }
  }

  async executeSteps(steps: ExecutionStep[]): Promise<{ success: boolean; data?: unknown; error?: string }> {
    if (!this.page) {
      throw new Error('Engine not initialized. Call initialize() first.');
    }

    console.log(`[ENGINE] executeSteps: ${steps.length} steps, taskId=${this.taskId?.slice(0, 8)}, vps=${this.isMultiUser}`);

    // Wrap entire execution in a task-level timeout
    try {
      return await withTimeout(
        this._executeStepsInner(steps),
        TASK_TIMEOUT_MS,
        'Task execution'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (message.includes('timed out')) {
        console.error(`[ENGINE] Task timed out after ${TASK_TIMEOUT_MS}ms`);
        await this.cleanup();
      }
      return { success: false, error: message, data: this.results };
    }
  }

  private async _executeStepsInner(steps: ExecutionStep[]): Promise<{ success: boolean; data?: unknown; error?: string }> {
    for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
      const step = steps[stepIndex];
      const stepStart = Date.now();

      // Ensure page is still alive before each step
      const alive = await this.ensurePageAlive();
      if (!alive) {
        return { success: false, error: 'Page not available', data: this.results };
      }

      // Wrap each step in a step-level timeout (navigate/submit get more time for heavy pages)
      const isSlowAction = ['navigate', 'submit', 'login'].includes(step.action);
      const isWaitAction = step.action === 'wait';
      const stepTimeout = isWaitAction
        ? Math.min(((step.params?.ms as number) || 5000) + 5000, 60000) // wait: requested + 5s buffer, max 60s
        : isSlowAction ? NAV_TIMEOUT_MS : STEP_TIMEOUT_MS;
      let result: StepResult;
      try {
        result = await withTimeout(
          this.executeStep(step),
          stepTimeout,
          `Step: ${step.action}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        result = { success: false, action: step.action, error: message };
      }

      const stepDuration = Date.now() - stepStart;

      // Post-action wait for click, fill, submit, select, login
      if (['click', 'fill', 'submit', 'select', 'login'].includes(step.action) && this.page && !this.page.isClosed()) {
        await this.page.waitForLoadState('networkidle').catch(() => {});
        await delay(POST_ACTION_WAIT_MS);

        // Universal CAPTCHA check after ALL interactive actions (not just navigate/submit)
        // CAPTCHAs frequently appear after clicks, form fills, and selections
        try {
          await handleCaptchaIfPresent(this.page!, this.userId, this.taskId);
        } catch {
          // Non-critical — don't fail the action because CAPTCHA check errored
        }
      }

      // Capture post-action screenshot for evidence (JPEG, quality 60 for efficiency)
      if (this.page && !this.page.isClosed() && step.action !== 'screenshot' && step.action !== 'wait') {
        try {
          const buffer = await this.page.screenshot({ type: 'jpeg', quality: 60 });
          result.screenshot = buffer.toString('base64');
        } catch {
          // Non-critical
        }
      }

      // Log every step to task_logs for audit trail
      if (this.userId) {
        const target = (step.params?.selector || step.params?.url || step.params?.text || step.action) as string;
        console.log(`[ENGINE] Step ${stepIndex}: ${step.action} → ${result.success ? 'ok' : 'FAIL'} (${stepDuration}ms)${result.error ? ' error=' + result.error : ''}`);
        logTaskStep(
          this.taskId || step.params?.taskId as string || '',
          this.userId,
          stepIndex,
          step.action,
          target,
          result.method || step.action,
          result.success,
          result.screenshot ? `data:image/jpeg;base64,${result.screenshot.substring(0, 100)}...` : undefined,
          result.error,
          stepDuration,
          { params: step.params }
        ).catch((logErr) => {
          console.error('[ENGINE] logTaskStep rejected:', logErr);
        });
      } else {
        console.warn(`[ENGINE] Skipping step log: no userId set`);
      }

      this.results.push(result);

      if (!result.success) {
        // Step-level retry: exponential backoff (1s, 2s, 4s) for transient failures
        // Skip retry for bot-blocked or page crash — retrying won't help
        const isBotBlockedError = result.error?.includes('Bot-blocked') || result.error?.includes('bot-block');
        const isPageCrash = result.error?.includes('Page crashed') || result.error?.includes('Target closed');
        if (step.action !== 'verify' && step.action !== 'wait' && !isBotBlockedError && !isPageCrash) {
          console.log(`[ENGINE] Step '${step.action}' failed, retrying with exponential backoff...`);

          const retryPolicy = new RetryPolicy({
            maxRetries: 2,       // 2 retries = 3 total attempts
            baseDelayMs: 1000,   // 1s, 2s, 4s
            maxDelayMs: 8000,
          });

          try {
            const retryResult = await retryPolicy.execute(
              async (attempt) => {
                const alive = await this.ensurePageAlive();
                if (!alive) {
                  throw new Error('Page not available');
                }

                const res = await withTimeout(
                  this.executeStep(step),
                  stepTimeout,
                  `Step retry ${attempt + 1}: ${step.action}`
                );

                if (!res.success) {
                  throw new Error(res.error || 'Step failed');
                }

                return res;
              },
              `Step ${step.action}`
            );

            // Replace the failed result
            this.results[this.results.length - 1] = retryResult;
            continue;
          } catch (error) {
            console.warn(`[ENGINE] All retries failed for ${step.action}:`, error);
            // Use original error, continue to failure handling
          }
        }

        return {
          success: false,
          error: `Step '${step.action}' failed: ${result.error}`,
          data: this.results
        };
      }
    }

    const lastResult = this.results[this.results.length - 1];
    return {
      success: true,
      data: lastResult?.data || 'Task completed successfully'
    };
  }

  async executeStep(step: ExecutionStep): Promise<StepResult> {
    if (!this.page) {
      return { success: false, action: step.action, error: 'Page not initialized' };
    }

    // Dismiss popups before each step
    await dismissPopups(this.page).catch(() => {});

    // Validate action against intent
    // For navigate actions, validate the TARGET URL, not current page (which may be about:blank)
    const validationDomain = step.action === 'navigate' && step.params?.url
      ? step.params.url as string
      : this.page.url();
    const validation = await this.validator.validate({
      type: step.action,
      domain: validationDomain,
      ...step.params as { target?: string; value?: string }
    });

    if (!validation.approved) {
      return {
        success: false,
        action: step.action,
        error: `Action blocked: ${validation.reason}`
      };
    }

    // Pre-execution learning: Check if we've failed this action before and have a learned solution
    if (this.domain && (step.action === 'click' || step.action === 'fill')) {
      const selector = (step.params?.selector || step.params?.target) as string | undefined;
      if (selector) {
        const learning = await getFailureMemory({
          site: this.domain,
          actionType: step.action,
          selector,
        });

        if (learning?.solution) {
          console.log(`[LEARNING] Applying pre-execution learning for ${step.action} on ${this.domain}`);
          console.log(`[LEARNING] Solution: ${learning.solution.method || 'alternative selector'}`);

          // Apply the learned solution to params
          if (learning.solution.selector && learning.solution.selector !== selector) {
            console.log(`[LEARNING] Using learned selector: ${learning.solution.selector}`);
            step.params = {
              ...step.params,
              selector: learning.solution.selector,
              originalSelector: selector, // Keep original for reference
            };
          }

          if (learning.solution.method) {
            step.params = {
              ...step.params,
              preferredMethod: learning.solution.method,
            };
          }
        }
      }
    }

    try {
      switch (step.action) {
        case 'navigate':
          return await this.handleNavigate(step.params);

        case 'click':
          return await this.handleClick(step.params);

        case 'fill':
          return await this.handleFill(step.params);

        case 'select':
          return await this.handleSelect(step.params);

        case 'submit':
          return await this.handleSubmit(step.params);

        case 'extract':
          return await this.handleExtract(step.params);

        case 'screenshot':
          return await this.handleScreenshot();

        case 'scroll':
          return await this.handleScroll(step.params);

        case 'wait':
          return await this.handleWait(step.params);

        case 'verify':
          return await this.handleVerify(step.params);

        case 'login':
          return await this.handleLogin(step.params);

        case 'search':
          return await this.handleSearch(step.params);

        case 'create_excel':
          return await this.handleCreateExcel(step.params);

        case 'create_powerpoint':
          return await this.handleCreatePowerPoint(step.params);

        case 'create_word':
          return await this.handleCreateWord(step.params);

        case 'create_pdf':
          return await this.handleCreatePDF(step.params);

        case 'screenshot_ocr':
          return await this.handleScreenshotOCR(step.params);

        default:
          return {
            success: false,
            action: step.action,
            error: `Unknown action: ${step.action}`
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, action: step.action, error: message };
    }
  }

  private async handleLogin(params: Record<string, unknown>): Promise<StepResult> {
    const url = params.url as string;
    const username = params.username as string | undefined;
    const password = params.password as string | undefined;
    const domain = params.domain as string | undefined;

    if (!url) {
      return { success: false, action: 'login', error: 'Login URL is required' };
    }

    // Step 1: Check for saved session first
    if (this.userId && domain) {
      const savedSession = await sessionManager.loadSession(this.userId, domain);
      if (savedSession && this.context && this.page) {
        await sessionManager.restoreSession(this.context, this.page, savedSession);
        await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        await this.page.waitForTimeout(2000);
        // Check if session restored us to a logged-in state
        const pageUrl = this.page.url().toLowerCase();
        if (!pageUrl.includes('/login') && !pageUrl.includes('/signin') && !pageUrl.includes('/sign-in')) {
          console.log('[LOGIN] Session restore succeeded');
          return { success: true, action: 'login', method: 'session_restore' };
        }
      }
    }

    // Step 2: Check credential vault for stored credentials
    let loginUsername = username;
    let loginPassword = password;
    if (this.userId && domain && (!loginUsername || !loginPassword)) {
      const cred = await getCredential(this.userId, domain);
      if (cred) {
        loginUsername = loginUsername || cred.username;
        loginPassword = loginPassword || cred.password;
        console.log(`[LOGIN] Found credentials in vault for ${domain}`);
      }
    }

    if (!loginUsername || !loginPassword) {
      return { success: false, action: 'login', error: 'No credentials available (not in params or vault)' };
    }

    // Step 3: Execute login with fallback chain
    const result = await executeLogin(this.page!, {
      url,
      username: loginUsername,
      password: loginPassword,
    });

    // Step 4: Save session after successful login
    if (result.success && this.userId && domain && this.context && this.page) {
      try {
        await sessionManager.saveSession(this.userId, domain, this.context, this.page, true);
        console.log(`[LOGIN] Saved session for ${domain}`);
      } catch {
        // Non-critical
      }
    }

    return {
      success: result.success,
      action: 'login',
      method: result.method,
      error: result.error,
    };
  }

  private isBotBlocked(url: string, text: string): boolean {
    // Detect bot-block pages across search engines
    if (url.includes('418.html') || url.includes('bno=')) return true;
    if (text.includes('unusual traffic') || text.includes('not a robot')) return true;
    if (url.includes('/challenge') || url.includes('captcha')) return true;
    return false;
  }

  private async handleSearch(params: Record<string, unknown>): Promise<StepResult> {
    const query = params.query as string;
    // Default to bing — more permissive than DuckDuckGo for headless browsers
    const requestedEngine = (params.engine as string) || 'bing';

    if (!query) {
      return { success: false, action: 'search', error: 'Search query is required' };
    }

    // Use direct search URL — no homepage navigation + typing (faster, less detectable)
    const buildSearchUrl = (eng: string) => {
      const q = encodeURIComponent(query);
      switch (eng) {
        case 'google': return `https://www.google.com/search?q=${q}`;
        case 'bing': return `https://www.bing.com/search?q=${q}`;
        case 'brave': return `https://search.brave.com/search?q=${q}`;
        case 'html_ddg': return `https://html.duckduckgo.com/html/?q=${q}`;
        default: return `https://www.bing.com/search?q=${q}`;
      }
    };

    const engineOrder = [requestedEngine, 'bing', 'brave', 'html_ddg'].filter(
      (e, i, arr) => arr.indexOf(e) === i
    );

    for (const engine of engineOrder) {
      const searchUrl = buildSearchUrl(engine);
      try {
        console.log(`[SEARCH] Searching for "${query}" on ${engine}`);

        await this.page!.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await this.page!.waitForTimeout(1500);

        const currentUrl = this.page!.url();
        const resultsText = await this.page!.textContent('body') || '';

        // Detect bot-blocking and try next engine
        if (this.isBotBlocked(currentUrl, resultsText)) {
          console.warn(`[SEARCH] ${engine} blocked (bot detection), trying next engine...`);
          continue;
        }

        // Need at least meaningful content
        if (resultsText.length < 200) {
          console.warn(`[SEARCH] ${engine} returned minimal content, trying next...`);
          continue;
        }

        console.log(`[SEARCH] ${engine} search ok — ${resultsText.length} chars`);
        // Include first 3000 chars of search results so AI can read pricing/links directly
        const searchSnippet = resultsText.replace(/\s+/g, ' ').trim().substring(0, 3000);
        return {
          success: true,
          action: 'search',
          data: { query, engine, url: currentUrl, resultsLength: resultsText.length, results: searchSnippet },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.warn(`[SEARCH] ${engine} failed: ${message}, trying next...`);
        continue;
      }
    }

    return { success: false, action: 'search', error: 'All search engines blocked or failed' };
  }

  private async handleCreateExcel(params: Record<string, unknown>): Promise<StepResult> {
    try {
      console.log('[EXCEL] Creating Excel file...');

      // Extract parameters
      const filename = params.filename as string;
      const sheets = params.sheets as ExcelGenerationParams['sheets'];
      const title = params.title as string | undefined;
      const description = params.description as string | undefined;
      const author = params.author as string | undefined;

      // Validate required params
      if (!filename) {
        return { success: false, action: 'create_excel', error: 'Filename is required' };
      }

      if (!sheets || !Array.isArray(sheets) || sheets.length === 0) {
        return { success: false, action: 'create_excel', error: 'At least one sheet is required' };
      }

      // Call Excel generation function
      const result = await createExcelFile({
        filename,
        sheets,
        title,
        description,
        author
      });

      if (result.success) {
        console.log(`[EXCEL] File created: ${result.filepath} (${result.fileSize} bytes, ${result.sheetCount} sheets, ${result.rowCount} rows)`);
        return {
          success: true,
          action: 'create_excel',
          data: {
            filepath: result.filepath,
            url: result.url,
            rowCount: result.rowCount,
            sheetCount: result.sheetCount,
            fileSize: result.fileSize
          }
        };
      } else {
        console.error(`[EXCEL] Generation failed: ${result.error}`);
        return { success: false, action: 'create_excel', error: result.error || 'Excel generation failed' };
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[EXCEL] Error: ${message}`);
      return { success: false, action: 'create_excel', error: `Excel generation error: ${message}` };
    }
  }

  private async handleCreatePowerPoint(params: Record<string, unknown>): Promise<StepResult> {
    try {
      console.log('[POWERPOINT] Creating PowerPoint presentation...');

      // Extract parameters
      const filename = params.filename as string;
      const slides = params.slides as PresentationParams['slides'];
      const title = params.title as string | undefined;
      const author = params.author as string | undefined;
      const subject = params.subject as string | undefined;
      const theme = params.theme as PresentationParams['theme'] | undefined;

      // Validate required params
      if (!filename) {
        return { success: false, action: 'create_powerpoint', error: 'Filename is required' };
      }

      if (!slides || !Array.isArray(slides) || slides.length === 0) {
        return { success: false, action: 'create_powerpoint', error: 'At least one slide is required' };
      }

      // Call PowerPoint generation function
      const result = await createPowerPoint({
        filename,
        slides,
        title,
        author,
        subject,
        theme
      });

      if (result.success) {
        console.log(`[POWERPOINT] File created: ${result.filepath} (${result.fileSize} bytes, ${result.slideCount} slides)`);
        return {
          success: true,
          action: 'create_powerpoint',
          data: {
            filepath: result.filepath,
            url: result.url,
            slideCount: result.slideCount,
            fileSize: result.fileSize
          }
        };
      } else {
        console.error(`[POWERPOINT] Generation failed: ${result.error}`);
        return { success: false, action: 'create_powerpoint', error: result.error || 'PowerPoint generation failed' };
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[POWERPOINT] Error: ${message}`);
      return { success: false, action: 'create_powerpoint', error: `PowerPoint generation error: ${message}` };
    }
  }

  private async handleCreateWord(params: Record<string, unknown>): Promise<StepResult> {
    try {
      console.log('[WORD] Creating Word document...');

      // Extract parameters
      const filename = params.filename as string;
      const sections = params.sections as WordDocumentParams['sections'];
      const title = params.title as string | undefined;
      const author = params.author as string | undefined;

      // Validate required params
      if (!filename) {
        return { success: false, action: 'create_word', error: 'Filename is required' };
      }

      if (!sections || !Array.isArray(sections) || sections.length === 0) {
        return { success: false, action: 'create_word', error: 'At least one section is required' };
      }

      // Call Word generation function
      const result = await createWordDocument({
        filename,
        sections,
        title,
        author
      });

      if (result.success) {
        console.log(`[WORD] File created: ${result.filepath} (${result.fileSize} bytes, ${result.sectionCount} sections)`);
        return {
          success: true,
          action: 'create_word',
          data: {
            filepath: result.filepath,
            url: result.url,
            sectionCount: result.sectionCount,
            fileSize: result.fileSize
          }
        };
      } else {
        console.error(`[WORD] Generation failed: ${result.error}`);
        return { success: false, action: 'create_word', error: result.error || 'Word generation failed' };
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[WORD] Error: ${message}`);
      return { success: false, action: 'create_word', error: `Word generation error: ${message}` };
    }
  }

  private async handleCreatePDF(params: Record<string, unknown>): Promise<StepResult> {
    try {
      console.log('[PDF] Creating PDF document...');

      // Extract parameters
      const filename = params.filename as string;
      const content = params.content as PDFParams['content'];
      const title = params.title as string | undefined;
      const author = params.author as string | undefined;
      const subject = params.subject as string | undefined;
      const pageSize = params.pageSize as PDFParams['pageSize'] | undefined;
      const margins = params.margins as PDFParams['margins'] | undefined;

      // Validate required params
      if (!filename) {
        return { success: false, action: 'create_pdf', error: 'Filename is required' };
      }

      if (!content || !Array.isArray(content) || content.length === 0) {
        return { success: false, action: 'create_pdf', error: 'At least one content item is required' };
      }

      // Call PDF generation function
      const result = await createPDF({
        filename,
        content,
        title,
        author,
        subject,
        pageSize,
        margins
      });

      if (result.success) {
        console.log(`[PDF] File created: ${result.filepath} (${result.fileSize} bytes, ${result.pageCount} pages)`);
        return {
          success: true,
          action: 'create_pdf',
          data: {
            filepath: result.filepath,
            url: result.url,
            pageCount: result.pageCount,
            fileSize: result.fileSize
          }
        };
      } else {
        console.error(`[PDF] Generation failed: ${result.error}`);
        return { success: false, action: 'create_pdf', error: result.error || 'PDF generation failed' };
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[PDF] Error: ${message}`);
      return { success: false, action: 'create_pdf', error: `PDF generation error: ${message}` };
    }
  }

  private async handleScreenshotOCR(params: Record<string, unknown>): Promise<StepResult> {
    try {
      console.log('[OCR] Starting screenshot + OCR...');

      if (!this.page) {
        return { success: false, action: 'screenshot_ocr', error: 'No active page' };
      }

      // Extract parameters
      const fullPage = params.fullPage as boolean | undefined;
      const region = params.region as ScreenshotOCRParams['region'] | undefined;
      const engine = params.engine as ScreenshotOCRParams['engine'] | undefined;
      const languages = params.languages as string[] | undefined;
      const detectTables = params.detectTables as boolean | undefined;
      const detectForms = params.detectForms as boolean | undefined;
      const format = params.format as 'text' | 'structured' | undefined;

      // Call OCR function
      const result = await screenshotWithOCR(this.page, {
        fullPage,
        region,
        engine,
        languages,
        detectTables,
        detectForms,
        format
      });

      if (result.success) {
        console.log(`[OCR] Extracted ${result.text?.length || 0} characters with ${result.confidence}% confidence (${result.engine})`);
        return {
          success: true,
          action: 'screenshot_ocr',
          data: {
            text: result.text,
            confidence: result.confidence,
            engine: result.engine,
            screenshotPath: result.screenshotPath,
            structuredData: result.structuredData
          }
        };
      } else {
        console.error(`[OCR] Extraction failed: ${result.error}`);
        return { success: false, action: 'screenshot_ocr', error: result.error || 'OCR extraction failed' };
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[OCR] Error: ${message}`);
      return { success: false, action: 'screenshot_ocr', error: `OCR error: ${message}` };
    }
  }

  private async handleNavigate(params: Record<string, unknown>): Promise<StepResult> {
    let url = params.url as string;
    if (!url) {
      return { success: false, action: 'navigate', error: 'URL is required' };
    }

    // Auto-prepend https:// if no protocol specified
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }

    // SECURITY: Block navigation to private/internal network addresses (SSRF prevention)
    const urlBlockReason = validateUrlSafety(url);
    if (urlBlockReason) {
      console.warn(`[ENGINE-SECURITY] ${urlBlockReason}`);
      return { success: false, action: 'navigate', error: urlBlockReason };
    }

    // HARD 45s BACKSTOP: page.goto() timeout (30s) doesn't always fire on WAF/Cloudflare sites.
    // handleCloudflare waits 30s. Total: goto(30) + SPA(10) + antibot(30) = 70s possible.
    // This backstop prevents indefinite hangs regardless of what Chromium does.
    const NAV_HARD_TIMEOUT = 45000;
    try {
      return await Promise.race([
        this._doNavigate(url),
        new Promise<StepResult>((resolve) =>
          setTimeout(() => {
            console.error(`[ENGINE] HARD NAV TIMEOUT: ${url} did not complete in ${NAV_HARD_TIMEOUT / 1000}s`);
            resolve({
              success: false,
              action: 'navigate',
              error: `Navigation to ${url} timed out after ${NAV_HARD_TIMEOUT / 1000}s. Site may be blocking automated browsers. Use [ACTION:search("...")] instead.`
            });
          }, NAV_HARD_TIMEOUT)
        ),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown navigation error';
      console.error(`[ENGINE] Navigation failed for ${url}: ${message}`);
      return { success: false, action: 'navigate', error: `Navigation to ${url} failed: ${message}` };
    }
  }

  private async _doNavigate(url: string): Promise<StepResult> {
    try {
      console.log(`[ENGINE] Navigating to: ${url} (${this.isMultiUser ? 'vps' : 'local'})`);
      await this.page!.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Use SPA-ready wait instead of just domcontentloaded
      await waitForSPAReady(this.page!);

      // Check for anti-bot challenges after navigation
      const antiBotResolved = await checkAndHandleAntiBot(this.page!);

      if (!antiBotResolved) {
        // Bot-blocked — extract domain for fallback suggestion
        const domain = new URL(url).hostname;
        const query = new URL(url).searchParams.get('k') || new URL(url).searchParams.get('q') || domain;
        console.warn(`[ENGINE] Bot-block detected on ${domain}, caller should pivot to Bing search`);
        return {
          success: false,
          action: 'navigate',
          error: `Bot-blocked by ${domain}. Use [ACTION:search("${query}")] to find this via Bing instead.`
        };
      }

      // Check for CAPTCHAs
      await handleCaptchaIfPresent(this.page!, this.userId, this.taskId);

      console.log(`[ENGINE] Navigation successful: ${url}`);
      return { success: true, action: 'navigate', data: { url } };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown navigation error';
      console.error(`[ENGINE] Navigation failed for ${url}: ${message}`);
      return { success: false, action: 'navigate', error: `Navigation to ${url} failed: ${message}` };
    }
  }

  private async handleClick(params: Record<string, unknown>): Promise<StepResult> {
    const url = this.page!.url();
    const selector = params.selector as string | undefined;

    const pastFailure = await getFailureMemory({
      site: url,
      actionType: 'click',
      selector
    });

    let effectiveParams = { ...params };
    if (pastFailure?.solution?.selector) {
      console.log(`[LEARNING] Using learned selector for click: ${pastFailure.solution.selector}`);
      effectiveParams.selector = pastFailure.solution.selector;
    }

    const result = await executeClick(this.page!, {
      selector: effectiveParams.selector as string | undefined,
      text: effectiveParams.text as string | undefined,
      description: effectiveParams.description as string | undefined,
      role: effectiveParams.role as string | undefined
    });

    if (result.success && result.method && result.method !== 'css_selector') {
      await learnSolution({
        site: url,
        actionType: 'click',
        originalSelector: selector,
        error: 'initial_method_failed',
        solution: { method: result.method }
      });
      console.log(`[LEARNING] Learned click method ${result.method} for ${url}`);
    }

    if (!result.success && result.error) {
      await recordFailure({
        site: url,
        actionType: 'click',
        selector,
        error: result.error
      });
    }

    return {
      success: result.success,
      action: 'click',
      method: result.method,
      error: result.error
    };
  }

  private async handleFill(params: Record<string, unknown>): Promise<StepResult> {
    const url = this.page!.url();
    const selector = params.selector as string | undefined;
    const label = params.label as string | undefined;
    const value = (params.value as string) || '';
    const page = this.page!;

    // --- Dropdown detection: check if target is a <select> or custom dropdown BEFORE fill cascade ---
    if (selector) {
      try {
        const elementInfo = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const tagName = el.tagName.toLowerCase();
          const role = el.getAttribute('role');
          const ariaHaspopup = el.getAttribute('aria-haspopup');
          return { tagName, role, ariaHaspopup };
        }, selector);

        // Case 1: Native <select> element — use selectOption() instead of fill()
        if (elementInfo?.tagName === 'select') {
          console.log(`[FILL] Detected <select> element, using selectOption instead of fill`);
          const selectMethods: Array<{ name: string; fn: () => Promise<boolean> }> = [
            {
              name: 'select_by_value',
              fn: async () => { await page.selectOption(selector, value); return true; },
            },
            {
              name: 'select_by_label',
              fn: async () => { await page.selectOption(selector, { label: value }); return true; },
            },
            {
              name: 'select_by_text_match',
              fn: async () => {
                // Find option whose text contains the value (case-insensitive)
                const matched = await page.evaluate(({ sel, val }) => {
                  const select = document.querySelector(sel) as HTMLSelectElement;
                  if (!select) return false;
                  const valLower = val.toLowerCase();
                  for (const opt of Array.from(select.options)) {
                    if (opt.text.toLowerCase().includes(valLower) || opt.value.toLowerCase().includes(valLower)) {
                      select.value = opt.value;
                      select.dispatchEvent(new Event('change', { bubbles: true }));
                      select.dispatchEvent(new Event('input', { bubbles: true }));
                      return true;
                    }
                  }
                  return false;
                }, { sel: selector, val: value });
                return matched;
              },
            },
          ];
          for (const method of selectMethods) {
            try {
              const success = await method.fn();
              if (success) {
                return { success: true, action: 'fill', method: `dropdown_${method.name}` };
              }
            } catch {
              continue;
            }
          }
          return { success: false, action: 'fill', error: `<select> detected but all selectOption methods failed for: ${selector}` };
        }

        // Case 2: Custom dropdown (combobox, listbox, aria-haspopup) — click to open then click matching option
        if (elementInfo?.role === 'combobox' || elementInfo?.role === 'listbox' || elementInfo?.ariaHaspopup === 'true' || elementInfo?.ariaHaspopup === 'listbox') {
          console.log(`[FILL] Detected custom dropdown (role=${elementInfo.role}, aria-haspopup=${elementInfo.ariaHaspopup}), clicking to open`);
          try {
            await page.click(selector);
            await page.waitForTimeout(500);
            // Try to click the matching option in the dropdown
            const optionLocator = page.locator(
              `[role="option"]:has-text("${value}"), li:has-text("${value}"), [data-value="${value}"], option:has-text("${value}")`
            );
            if ((await optionLocator.count()) > 0) {
              await optionLocator.first().click();
              return { success: true, action: 'fill', method: 'dropdown_click_option' };
            }
            // Fallback: type the value into the combobox input to filter, then pick first option
            try {
              await page.locator(selector).fill(value);
              await page.waitForTimeout(300);
              const filteredOption = page.locator('[role="option"], li[class*="option"]');
              if ((await filteredOption.count()) > 0) {
                await filteredOption.first().click();
                return { success: true, action: 'fill', method: 'dropdown_type_then_select' };
              }
            } catch {
              // Type-to-filter failed, continue to regular fill cascade
            }
          } catch {
            // Custom dropdown interaction failed, fall through to regular fill cascade
          }
        }
      } catch {
        // Element detection failed, proceed with normal fill cascade
      }
    }

    // --- Also detect <select> by label when no selector is provided ---
    if (!selector && label) {
      try {
        const isSelect = await page.evaluate((lbl) => {
          // Find label matching text, then check if associated element is a select
          const labels = Array.from(document.querySelectorAll('label'));
          for (const labelEl of labels) {
            if (labelEl.textContent?.toLowerCase().includes(lbl.toLowerCase())) {
              const forAttr = labelEl.getAttribute('for');
              if (forAttr) {
                const target = document.getElementById(forAttr);
                if (target?.tagName.toLowerCase() === 'select') return forAttr;
              }
              // Check next sibling or child
              const sibling = labelEl.nextElementSibling;
              if (sibling?.tagName.toLowerCase() === 'select') return true;
              const child = labelEl.querySelector('select');
              if (child) return true;
            }
          }
          return false;
        }, label);

        if (isSelect) {
          console.log(`[FILL] Detected <select> via label "${label}", redirecting to selectOption`);
          const selectSelector = typeof isSelect === 'string' ? `#${isSelect}` : `select`;
          try {
            await page.selectOption(selectSelector, value);
            return { success: true, action: 'fill', method: 'dropdown_label_select_value' };
          } catch {
            try {
              await page.selectOption(selectSelector, { label: value });
              return { success: true, action: 'fill', method: 'dropdown_label_select_label' };
            } catch {
              // Fall through to normal fill cascade
            }
          }
        }
      } catch {
        // Label-based select detection failed, proceed normally
      }
    }

    // --- Standard fill cascade (for text inputs, textareas, etc.) ---

    const pastFailure = await getFailureMemory({
      site: url,
      actionType: 'fill',
      selector: selector || label
    });

    let effectiveParams = { ...params };
    if (pastFailure?.solution?.selector) {
      console.log(`[LEARNING] Using learned selector for fill: ${pastFailure.solution.selector}`);
      effectiveParams.selector = pastFailure.solution.selector;
    }

    const result = await executeFill(this.page!, {
      selector: effectiveParams.selector as string | undefined,
      label: effectiveParams.label as string | undefined,
      placeholder: effectiveParams.placeholder as string | undefined,
      name: effectiveParams.name as string | undefined,
      value: effectiveParams.value as string || ''
    });

    if (result.success && result.method && result.method !== 'css_selector') {
      await learnSolution({
        site: url,
        actionType: 'fill',
        originalSelector: selector || label,
        error: 'initial_method_failed',
        solution: { method: result.method }
      });
      console.log(`[LEARNING] Learned fill method ${result.method} for ${url}`);
    }

    if (!result.success && result.error) {
      await recordFailure({
        site: url,
        actionType: 'fill',
        selector: selector || label,
        error: result.error
      });
    }

    return {
      success: result.success,
      action: 'fill',
      method: result.method,
      error: result.error
    };
  }

  private async handleSelect(params: Record<string, unknown>): Promise<StepResult> {
    const selector = params.selector as string;
    const value = params.value as string;
    const label = params.label as string | undefined;
    const text = params.text as string | undefined;
    const page = this.page!;

    const selectMethods: Array<{ name: string; fn: () => Promise<boolean> }> = [
      // Method 1: selectOption by value
      {
        name: 'select_by_value',
        fn: async () => {
          if (!selector) return false;
          await page.selectOption(selector, value);
          return true;
        },
      },
      // Method 2: selectOption by label
      {
        name: 'select_by_label',
        fn: async () => {
          if (!selector) return false;
          await page.selectOption(selector, { label: label || value });
          return true;
        },
      },
      // Method 3: Click dropdown then click option
      {
        name: 'click_dropdown_option',
        fn: async () => {
          if (!selector) return false;
          await page.click(selector);
          await page.waitForTimeout(500);
          const optionText = text || label || value;
          const option = page.locator(`option:has-text("${optionText}"), li:has-text("${optionText}"), [role="option"]:has-text("${optionText}")`);
          if ((await option.count()) > 0) {
            await option.first().click();
            return true;
          }
          return false;
        },
      },
      // Method 4: JavaScript .value + dispatch change
      {
        name: 'js_set_value',
        fn: async () => {
          if (!selector) return false;
          const success = await page.evaluate(({ sel, val }) => {
            const el = document.querySelector(sel) as HTMLSelectElement;
            if (!el) return false;
            el.value = val;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          }, { sel: selector, val: value });
          return success;
        },
      },
    ];

    for (const method of selectMethods) {
      try {
        const success = await method.fn();
        if (success) {
          return { success: true, action: 'select', method: method.name };
        }
      } catch {
        // Try next method
      }
    }

    return { success: false, action: 'select', error: `All select methods failed for: ${selector || 'no selector'}` };
  }

  private async handleSubmit(params: Record<string, unknown>): Promise<StepResult> {
    const selector = params.selector as string | undefined;
    const expectedOutcome = params.expected as string;
    const page = this.page!;

    const submitMethods: Array<{ name: string; fn: () => Promise<boolean> }> = [
      // Method 1: Find [type="submit"] button and click
      {
        name: 'type_submit',
        fn: async () => {
          const sel = selector || 'button[type="submit"], input[type="submit"]';
          const el = page.locator(sel);
          if ((await el.count()) > 0) {
            await el.first().click({ timeout: 5000 });
            return true;
          }
          return false;
        },
      },
      // Method 2: Find button with submit-like text
      {
        name: 'text_submit',
        fn: async () => {
          const submitTexts = ['submit', 'send', 'confirm', 'continue', 'next', 'save', 'done', 'go', 'sign up', 'register', 'create'];
          for (const txt of submitTexts) {
            const btn = page.locator(`button:has-text("${txt}"), input[value="${txt}" i]`);
            if ((await btn.count()) > 0) {
              await btn.first().click({ timeout: 5000 });
              return true;
            }
          }
          return false;
        },
      },
      // Method 3: Press Enter in last focused form field
      {
        name: 'enter_key',
        fn: async () => {
          const inputs = page.locator('input:visible, textarea:visible');
          const count = await inputs.count();
          if (count > 0) {
            await inputs.nth(count - 1).press('Enter');
            return true;
          }
          return false;
        },
      },
      // Method 4: Find form and call form.submit() via JS
      {
        name: 'js_form_submit',
        fn: async () => {
          const submitted = await page.evaluate(() => {
            const forms = document.querySelectorAll('form');
            if (forms.length > 0) {
              forms[forms.length - 1].submit();
              return true;
            }
            return false;
          });
          return submitted;
        },
      },
      // Method 5: Find primary/CTA button by styling
      {
        name: 'cta_button',
        fn: async () => {
          const ctaSelectors = [
            'button.primary, button.btn-primary, button.cta',
            'button[class*="primary"], button[class*="submit"], button[class*="cta"]',
            'form button:last-of-type',
            '.form-actions button, .form-footer button',
          ];
          for (const sel of ctaSelectors) {
            const el = page.locator(sel);
            if ((await el.count()) > 0) {
              await el.first().click({ timeout: 5000 });
              return true;
            }
          }
          return false;
        },
      },
    ];

    let usedMethod = 'unknown';
    let submitted = false;

    for (const method of submitMethods) {
      try {
        const success = await method.fn();
        if (success) {
          usedMethod = method.name;
          submitted = true;
          break;
        }
      } catch {
        // Try next method
      }
    }

    if (!submitted) {
      return { success: false, action: 'submit', error: 'All submit methods failed' };
    }

    await page.waitForLoadState('networkidle').catch(() => {});

    // Check for CAPTCHAs after submit
    await handleCaptchaIfPresent(page, this.userId, this.taskId);

    if (expectedOutcome) {
      const verifyResult = await this.verifyActionSuccess('submit', expectedOutcome);
      if (!verifyResult.success) {
        return {
          success: false,
          action: 'submit',
          method: usedMethod,
          error: `Verification failed: ${verifyResult.reason}`,
          screenshot: verifyResult.screenshot
        };
      }
    }

    return { success: true, action: 'submit', method: usedMethod };
  }

  /**
   * Verify action success using screenshot + AI analysis.
   * No longer defaults to success — requires evidence.
   */
  private async verifyActionSuccess(
    actionType: string,
    expectedOutcome: string
  ): Promise<{ success: boolean; reason?: string; screenshot?: string }> {
    try {
      const screenshotBuffer = await this.page!.screenshot({ type: 'png' });
      const screenshotBase64 = screenshotBuffer.toString('base64');

      const pageText = await this.page!.textContent('body');
      const textLower = (pageText || '').toLowerCase();

      const successIndicators = ['success', 'thank you', 'confirmed', 'submitted', 'complete'];
      const errorIndicators = ['error', 'failed', 'invalid', 'required', 'please try again'];

      const hasSuccessIndicator = successIndicators.some(s => textLower.includes(s));
      const hasErrorIndicator = errorIndicators.some(e => textLower.includes(e));

      if (hasSuccessIndicator && !hasErrorIndicator) {
        console.log(`[VERIFY] Quick check passed for ${actionType}`);
        return { success: true, screenshot: screenshotBase64 };
      }

      if (hasErrorIndicator) {
        console.log(`[VERIFY] Error indicator found for ${actionType}`);
        return {
          success: false,
          reason: 'Error message detected on page',
          screenshot: screenshotBase64
        };
      }

      // Use vision for detailed verification
      if (process.env.ANTHROPIC_API_KEY) {
        try {
          const visionResult = await generateVisionResponse(
            `Does this screenshot show that the ${actionType} action was successful? Expected outcome: "${expectedOutcome}". Respond with only "YES" or "NO" followed by a brief reason.`,
            screenshotBase64,
            'You are verifying if a web action succeeded. Be concise.'
          );

          this.totalCost += visionResult.cost;

          const isSuccess = visionResult.content.toUpperCase().startsWith('YES');
          console.log(`[VERIFY] Vision verification: ${isSuccess ? 'passed' : 'failed'}`);

          return {
            success: isSuccess,
            reason: visionResult.content,
            screenshot: screenshotBase64
          };
        } catch (error) {
          // Detect 429 rate limit errors explicitly
          const errorMsg = error instanceof Error ? error.message : '';
          if (errorMsg.includes('429') || errorMsg.includes('rate limit')) {
            console.warn('[VERIFY] Vision API rate limited (429)');
            return { success: false, reason: 'Vision API rate limited', screenshot: screenshotBase64 };
          }
          console.error('[VERIFY] Vision error:', error);
          // Don't assume success on vision failure
          return { success: false, reason: 'Vision verification failed', screenshot: screenshotBase64 };
        }
      }

      // No vision available and no clear indicators — NOT assumed success
      return { success: false, reason: 'No verification evidence', screenshot: screenshotBase64 };
    } catch (error) {
      console.error('[VERIFY] Verification error:', error);
      // Don't assume success if verification itself fails
      return { success: false, reason: 'Verification process failed' };
    }
  }

  private async handleExtract(params: Record<string, unknown>): Promise<StepResult> {
    const selector = params.selector as string || 'body';
    try {
      console.log(`[ENGINE] Extracting content with selector: ${selector}`);
      const text = await this.page!.textContent(selector);
      const extracted = text?.trim().substring(0, 5000) || '';
      console.log(`[ENGINE] Extracted ${extracted.length} chars`);
      return {
        success: true,
        action: 'extract',
        data: extracted
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown extract error';
      console.error(`[ENGINE] Extract failed for selector '${selector}': ${message}`);
      return { success: false, action: 'extract', error: `Extract failed: ${message}` };
    }
  }

  private async handleScreenshot(): Promise<StepResult> {
    const buffer = await this.page!.screenshot({ type: 'png' });

    return {
      success: true,
      action: 'screenshot',
      screenshot: buffer.toString('base64')
    };
  }

  private async handleScroll(params: Record<string, unknown>): Promise<StepResult> {
    const direction = params.direction as string || 'down';
    const amount = params.amount as number || 500;

    if (direction === 'down') {
      await this.page!.evaluate((amt) => window.scrollBy(0, amt), amount);
    } else if (direction === 'up') {
      await this.page!.evaluate((amt) => window.scrollBy(0, -amt), amount);
    } else if (direction === 'top') {
      await this.page!.evaluate(() => window.scrollTo(0, 0));
    } else if (direction === 'bottom') {
      await this.page!.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    }

    return { success: true, action: 'scroll' };
  }

  private async handleWait(params: Record<string, unknown>): Promise<StepResult> {
    const ms = params.ms as number || 1000;
    const selector = params.selector as string;

    if (selector) {
      await this.page!.waitForSelector(selector, { timeout: ms });
    } else {
      await this.page!.waitForTimeout(ms);
    }

    return { success: true, action: 'wait' };
  }

  private async handleVerify(params: Record<string, unknown>): Promise<StepResult> {
    const condition = params.condition as string;
    const selector = params.selector as string;

    if (selector) {
      const visible = await this.page!.isVisible(selector);
      return {
        success: visible,
        action: 'verify',
        data: { visible },
        error: visible ? undefined : `Element not visible: ${selector}`
      };
    }

    if (condition) {
      const text = await this.page!.textContent('body');
      const found = text?.toLowerCase().includes(condition.toLowerCase());
      return {
        success: !!found,
        action: 'verify',
        data: { found },
        error: found ? undefined : `Condition not met: ${condition}`
      };
    }

    return { success: false, action: 'verify', error: 'No condition or selector provided' };
  }
}
