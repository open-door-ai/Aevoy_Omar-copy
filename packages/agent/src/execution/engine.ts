/**
 * Execution Engine
 *
 * Orchestrates browser automation with fallback chains and learning.
 * Never makes the same mistake twice - learns from every failure.
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { LockedIntent } from '../security/intent-lock.js';
import { ActionValidator } from '../security/validator.js';
import { executeClick } from './actions/click.js';
import { executeFill } from './actions/fill.js';
import { getFailureMemory, recordFailure, learnSolution } from '../memory/failure-db.js';
import { quickValidate, generateVisionResponse } from '../services/ai.js';
import { StagehandService } from '../services/stagehand.js';
import { withTimeout, delay } from '../utils/timeout.js';
import { applyStealthPatches, getRealisticUserAgent } from './stealth.js';
import { dismissPopups } from './popup-handler.js';
import { waitForSPAReady } from './dynamic-content.js';
import { checkAndHandleAntiBot } from './antibot.js';
import { handleCaptchaIfPresent } from './captcha.js';
import { sessionManager } from './session-manager.js';
import { RetryPolicy } from './retry.js';

// Timeouts
const TASK_TIMEOUT_MS = 180000;  // 3 minutes per task
const STEP_TIMEOUT_MS = 30000;   // 30 seconds per step
const POST_ACTION_WAIT_MS = 800; // Wait after click/fill/submit/select

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
  private stagehand: StagehandService | null = null;
  private useStagehand: boolean;
  private userId?: string;
  private domain?: string;

  constructor(intent: LockedIntent) {
    this.intent = intent;
    this.validator = new ActionValidator(intent);
    this.useStagehand = !!(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID);
  }

  async initialize(userId?: string, domain?: string): Promise<void> {
    this.userId = userId;
    this.domain = domain;

    // Try to load saved session if userId and domain provided
    let savedSession = null;
    if (userId && domain) {
      savedSession = await sessionManager.loadSession(userId, domain);
      if (savedSession) {
        console.log(`[ENGINE] Found saved session for ${domain}, will restore after browser init`);
      }
    }
    if (this.useStagehand) {
      try {
        this.stagehand = new StagehandService();
        this.page = await this.stagehand.init();
        this.context = this.stagehand.session?.context || null;

        // Restore session if available
        if (savedSession && this.context && this.page) {
          await sessionManager.restoreSession(this.context, this.page, savedSession);
          console.log("[ENGINE] Restored session into Stagehand browser");
        }

        console.log("[ENGINE] Initialized with Stagehand (cloud)");
        return;
      } catch (error) {
        console.warn("[ENGINE] Stagehand init failed, falling back to local Playwright:", error);
        this.stagehand = null;
      }
    }

    // Local Playwright fallback with stealth
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ]
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: getRealisticUserAgent(),
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });

    // Apply stealth patches to avoid bot detection
    await applyStealthPatches(this.context);

    this.page = await this.context.newPage();

    // Restore session if available
    if (savedSession && this.context && this.page) {
      await sessionManager.restoreSession(this.context, this.page, savedSession);
      console.log("[ENGINE] Restored session into local Playwright browser");
    }

    console.log("[ENGINE] Initialized with local Playwright (stealth)");
  }

  async cleanup(): Promise<void> {
    // Save session before cleanup if userId and domain are set
    if (this.userId && this.domain && this.page && this.context) {
      try {
        await sessionManager.saveSession(this.userId, this.domain, this.context, this.page, true);
        console.log(`[ENGINE] Saved session for ${this.domain} before cleanup`);
      } catch (error) {
        console.warn('[ENGINE] Failed to save session during cleanup:', error);
      }
    }

    if (this.stagehand) {
      await this.stagehand.close();
      this.stagehand = null;
    } else {
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
    for (const step of steps) {
      // Ensure page is still alive before each step
      const alive = await this.ensurePageAlive();
      if (!alive) {
        return { success: false, error: 'Page not available', data: this.results };
      }

      // Wrap each step in a step-level timeout
      let result: StepResult;
      try {
        result = await withTimeout(
          this.executeStep(step),
          STEP_TIMEOUT_MS,
          `Step: ${step.action}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        result = { success: false, action: step.action, error: message };
      }

      // Post-action wait for click, fill, submit, select
      if (['click', 'fill', 'submit', 'select'].includes(step.action) && this.page && !this.page.isClosed()) {
        await this.page.waitForLoadState('networkidle').catch(() => {});
        await delay(POST_ACTION_WAIT_MS);
      }

      // Capture post-action screenshot for evidence
      if (this.page && !this.page.isClosed() && step.action !== 'screenshot' && step.action !== 'wait') {
        try {
          const buffer = await this.page.screenshot({ type: 'png' });
          result.screenshot = buffer.toString('base64');
        } catch {
          // Non-critical
        }
      }

      this.results.push(result);

      if (!result.success) {
        // Step-level retry: exponential backoff (1s, 2s, 4s) for transient failures
        if (step.action !== 'verify' && step.action !== 'wait') {
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
                  STEP_TIMEOUT_MS,
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
    const validation = await this.validator.validate({
      type: step.action,
      domain: this.page.url(),
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

  private async handleNavigate(params: Record<string, unknown>): Promise<StepResult> {
    const url = params.url as string;
    if (!url) {
      return { success: false, action: 'navigate', error: 'URL is required' };
    }

    await this.page!.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Use SPA-ready wait instead of just domcontentloaded
    await waitForSPAReady(this.page!);

    // Check for anti-bot challenges after navigation
    await checkAndHandleAntiBot(this.page!);

    // Check for CAPTCHAs
    await handleCaptchaIfPresent(this.page!);

    return { success: true, action: 'navigate', data: { url } };
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

    await this.page!.selectOption(selector, value);
    return { success: true, action: 'select' };
  }

  private async handleSubmit(params: Record<string, unknown>): Promise<StepResult> {
    const selector = params.selector as string || 'button[type="submit"], input[type="submit"], form button';
    const expectedOutcome = params.expected as string;

    await this.page!.click(selector);
    await this.page!.waitForLoadState('networkidle').catch(() => {});

    // Check for CAPTCHAs after submit
    await handleCaptchaIfPresent(this.page!);

    if (expectedOutcome) {
      const verifyResult = await this.verifyActionSuccess('submit', expectedOutcome);
      if (!verifyResult.success) {
        return {
          success: false,
          action: 'submit',
          error: `Verification failed: ${verifyResult.reason}`,
          screenshot: verifyResult.screenshot
        };
      }
    }

    return { success: true, action: 'submit' };
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
    const text = await this.page!.textContent(selector);

    return {
      success: true,
      action: 'extract',
      data: text?.trim().substring(0, 5000)
    };
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
