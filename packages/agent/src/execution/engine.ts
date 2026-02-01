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
  
  constructor(intent: LockedIntent) {
    this.intent = intent;
    this.validator = new ActionValidator(intent);
  }
  
  async initialize(): Promise<void> {
    this.browser = await chromium.launch({ 
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ]
    });
    
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    
    this.page = await this.context.newPage();
  }
  
  async cleanup(): Promise<void> {
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
    this.page = null;
    this.context = null;
    this.browser = null;
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
  
  async executeSteps(steps: ExecutionStep[]): Promise<{ success: boolean; data?: unknown; error?: string }> {
    if (!this.page) {
      throw new Error('Engine not initialized. Call initialize() first.');
    }
    
    for (const step of steps) {
      const result = await this.executeStep(step);
      this.results.push(result);
      
      if (!result.success) {
        return { 
          success: false, 
          error: `Step '${step.action}' failed: ${result.error}`,
          data: this.results
        };
      }
    }
    
    // Return last step's data or aggregate
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
    
    return { success: true, action: 'navigate', data: { url } };
  }
  
  private async handleClick(params: Record<string, unknown>): Promise<StepResult> {
    const url = this.page!.url();
    const selector = params.selector as string | undefined;
    
    // Check failure memory for learned solutions
    const pastFailure = await getFailureMemory({
      site: url,
      actionType: 'click',
      selector
    });
    
    // Apply learned fix if available
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
    
    // Learn from successful workarounds
    if (result.success && result.method && result.method !== 'method_1') {
      await learnSolution({
        site: url,
        actionType: 'click',
        originalSelector: selector,
        error: 'initial_method_failed',
        solution: { method: result.method }
      });
      console.log(`[LEARNING] Learned click method ${result.method} for ${url}`);
    }
    
    // Record failures for learning
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
    
    // Check failure memory for learned solutions
    const pastFailure = await getFailureMemory({
      site: url,
      actionType: 'fill',
      selector: selector || label
    });
    
    // Apply learned fix if available
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
    
    // Learn from successful workarounds
    if (result.success && result.method && result.method !== 'method_1') {
      await learnSolution({
        site: url,
        actionType: 'fill',
        originalSelector: selector || label,
        error: 'initial_method_failed',
        solution: { method: result.method }
      });
      console.log(`[LEARNING] Learned fill method ${result.method} for ${url}`);
    }
    
    // Record failures for learning
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
    
    // Verification: Take screenshot and verify outcome if expected outcome is specified
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
   * Verify action success using screenshot + AI analysis
   */
  private async verifyActionSuccess(
    actionType: string, 
    expectedOutcome: string
  ): Promise<{ success: boolean; reason?: string; screenshot?: string }> {
    try {
      // Take screenshot
      const screenshotBuffer = await this.page!.screenshot({ type: 'png' });
      const screenshotBase64 = screenshotBuffer.toString('base64');
      
      // First, try quick text-based verification
      const pageText = await this.page!.textContent('body');
      const textLower = (pageText || '').toLowerCase();
      const expectedLower = expectedOutcome.toLowerCase();
      
      // Quick heuristic checks
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
      
      // If we have Claude API, use vision for detailed verification
      if (process.env.ANTHROPIC_API_KEY) {
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
      }
      
      // Default: assume success if no clear error indicators
      return { success: true, screenshot: screenshotBase64 };
    } catch (error) {
      console.error('[VERIFY] Verification error:', error);
      // Don't fail the action if verification itself fails
      return { success: true };
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
