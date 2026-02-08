/**
 * Autonomous Executor - Never-Stop Execution Engine
 * 
 * Works with MultiUserBrowserService
 * 5 strategies before giving up
 * Alternative paths automatically
 * 20-min timeout, then continue
 */

import { Page } from "playwright";
import { MultiUserBrowserService } from "./multi-user-browser.js";
import { captchaSolver } from "./captcha-solver.js";
import { qualityChecker } from "./quality-checker.js";
import { ExecutionPlan } from "./planning.js";
import { getCredential } from "./credential-vault.js";
import { sendResponse } from "./email.js";
import { getSupabaseClient } from "../utils/supabase.js";

interface ExecutionState {
  plan: ExecutionPlan;
  currentStepIndex: number;
  attemptCount: number;
  obstacleHistory: ObstacleRecord[];
  alternativePathIndex: number;
  waitingForUser: boolean;
  userPromptedAt?: Date;
  result?: any;
}

interface ObstacleRecord {
  step: number;
  type: string;
  error: string;
  strategiesTried: string[];
  resolved: boolean;
}

interface ExecutionResult {
  success: boolean;
  completed: boolean;
  result?: any;
  error?: string;
  quality?: any;
  stepsExecuted: number;
  durationMs: number;
  attempts: number;
}

export class AutonomousExecutor {
  private userId: string;
  private browser: MultiUserBrowserService;
  private state: ExecutionState | null = null;
  private startTime: number = 0;

  constructor(userId: string, browser: MultiUserBrowserService) {
    this.userId = userId;
    this.browser = browser;
  }

  /**
   * Execute plan with never-stop resilience
   */
  async execute(plan: ExecutionPlan): Promise<ExecutionResult> {
    this.startTime = Date.now();
    const page = this.browser.getPage();
    
    if (!page) {
      return this.returnResult(false, "Browser not available");
    }

    this.state = {
      plan,
      currentStepIndex: 0,
      attemptCount: 0,
      obstacleHistory: [],
      alternativePathIndex: 0,
      waitingForUser: false,
      result: {},
    };

    console.log(`[EXECUTOR] Starting: ${plan.goal}`);
    console.log(`[EXECUTOR] ${plan.steps.length} steps, ${plan.alternativePaths.length} alternatives`);

    try {
      while (this.state.currentStepIndex < plan.steps.length) {
        // Check user timeout
        if (this.state.waitingForUser) {
          const shouldContinue = await this.checkUserTimeout();
          if (shouldContinue) {
            this.state.waitingForUser = false;
            this.state.userPromptedAt = undefined;
            console.log("[EXECUTOR] User timeout - continuing");
          } else {
            await new Promise(r => setTimeout(r, 5000));
            continue;
          }
        }

        const step = plan.steps[this.state.currentStepIndex];
        console.log(`[EXECUTOR] Step ${step.order}: ${step.type} - ${step.description}`);

        // Execute step
        const result = await this.executeStep(step, page);

        if (result.success) {
          this.state.currentStepIndex++;
          this.state.attemptCount = 0;
          console.log(`[EXECUTOR] ✓ Step complete`);
        } else {
          console.log(`[EXECUTOR] ✗ Step failed: ${result.error}`);
          
          // Handle obstacle
          const resolved = await this.handleObstacle(step, result.error || "Unknown", page);
          
          if (!resolved) {
            // Try alternative path
            const alternativeWorked = await this.tryAlternativePath(page);
            
            if (!alternativeWorked && !step.canSkip) {
              // Last resort: ask user
              if (!this.state.waitingForUser) {
                await this.promptUserForHelp(step, result.error || "Unknown");
              }
            } else if (!alternativeWorked && step.canSkip) {
              // Skip and continue
              console.log(`[EXECUTOR] Skipping non-critical step ${step.order}`);
              this.state.currentStepIndex++;
            }
          }
        }

        // Safety limit
        if (this.state.attemptCount > 50) {
          return this.returnResult(false, "Maximum retry attempts exceeded");
        }
      }

      // Build final result
      this.state.result = {
        goal: plan.goal,
        stepsCompleted: this.state.currentStepIndex,
        finalUrl: page.url(),
        title: await page.title().catch(() => ""),
      };

      return this.returnResult(true, undefined, this.state.result);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      return this.returnResult(false, errorMsg);
    }
  }

  /**
   * Execute single step
   */
  private async executeStep(step: any, page: Page): Promise<{ success: boolean; error?: string }> {
    try {
      switch (step.type) {
        case "navigate":
          await page.goto(step.target, { waitUntil: "domcontentloaded", timeout: 30000 });
          await page.waitForLoadState("networkidle").catch(() => {});
          break;

        case "login":
          const cred = await getCredential(this.userId, step.target);
          if (!cred) throw new Error(`No credentials for ${step.target}`);
          await this.performLogin(page, step.target, cred.username, cred.password);
          break;

        case "fill":
          await page.fill(step.target, step.value);
          break;

        case "click":
          await page.click(step.target);
          break;

        case "select":
          await page.selectOption(step.target, step.value);
          break;

        case "captcha":
          const captchaResult = await captchaSolver.solve(page);
          if (!captchaResult.success) throw new Error("CAPTCHA failed: " + captchaResult.error);
          break;

        case "wait":
          await page.waitForTimeout(step.duration || 2000);
          break;

        case "verify":
          // Verification handled separately
          break;

        default:
          throw new Error(`Unknown step type: ${step.type}`);
      }

      return { success: true };

    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      };
    }
  }

  /**
   * Handle obstacle with 5 strategies
   */
  private async handleObstacle(step: any, error: string, page: Page): Promise<boolean> {
    this.state!.attemptCount++;
    
    const obstacle: ObstacleRecord = {
      step: step.order,
      type: this.classifyObstacle(error),
      error,
      strategiesTried: [],
      resolved: false,
    };

    console.log(`[EXECUTOR] Obstacle: ${obstacle.type}`);

    // Strategy 1: Wait and retry
    if (!obstacle.strategiesTried.includes("wait")) {
      obstacle.strategiesTried.push("wait");
      console.log("[EXECUTOR] Strategy 1: Wait 3s and retry");
      await page.waitForTimeout(3000);
      const retry = await this.executeStep(step, page);
      if (retry.success) {
        obstacle.resolved = true;
        return true;
      }
    }

    // Strategy 2: Alternative selector
    if (!obstacle.strategiesTried.includes("alternative")) {
      obstacle.strategiesTried.push("alternative");
      console.log("[EXECUTOR] Strategy 2: Try alternative method");
      const altStep = await this.findAlternativeMethod(step, page);
      if (altStep) {
        const result = await this.executeStep(altStep, page);
        if (result.success) return true;
      }
    }

    // Strategy 3: Refresh page
    if (!obstacle.strategiesTried.includes("refresh")) {
      obstacle.strategiesTried.push("refresh");
      console.log("[EXECUTOR] Strategy 3: Refresh and retry");
      await page.reload();
      await page.waitForTimeout(2000);
      const result = await this.executeStep(step, page);
      if (result.success) return true;
    }

    // Strategy 4: CAPTCHA
    if (!obstacle.strategiesTried.includes("captcha")) {
      obstacle.strategiesTried.push("captcha");
      if (await this.detectCaptcha(page)) {
        console.log("[EXECUTOR] Strategy 4: Solving CAPTCHA");
        const result = await captchaSolver.solve(page);
        if (result.success) {
          const retry = await this.executeStep(step, page);
          if (retry.success) return true;
        }
      }
    }

    // Strategy 5: Vision-guided
    if (!obstacle.strategiesTried.includes("vision")) {
      obstacle.strategiesTried.push("vision");
      console.log("[EXECUTOR] Strategy 5: Vision-guided action");
      const visionResult = await this.visionGuidedAction(step, page);
      if (visionResult) return true;
    }

    this.state!.obstacleHistory.push(obstacle);
    return false;
  }

  /**
   * Try alternative execution path
   */
  private async tryAlternativePath(page: Page): Promise<boolean> {
    const alternatives = this.state!.plan.alternativePaths;
    
    if (this.state!.alternativePathIndex >= alternatives.length) {
      return false;
    }

    const alt = alternatives[this.state!.alternativePathIndex++];
    console.log(`[EXECUTOR] Trying alternative: ${alt.name}`);

    // Reset step index to retry from beginning with alternative
    this.state!.currentStepIndex = 0;
    this.state!.attemptCount = 0;

    if (alt.name === "Mobile Site") {
      const currentUrl = page.url();
      const mobileUrl = currentUrl.replace(/^https:\/\//, "https://m.");
      await page.goto(mobileUrl);
    }

    return true;
  }

  /**
   * Check user timeout (20 min)
   */
  private async checkUserTimeout(): Promise<boolean> {
    if (!this.state!.userPromptedAt) return true;
    
    const timeoutMinutes = this.state!.plan.userResponseTimeout;
    const elapsed = Date.now() - this.state!.userPromptedAt.getTime();
    
    return elapsed >= timeoutMinutes * 60 * 1000;
  }

  /**
   * Prompt user for help (LAST RESORT)
   */
  private async promptUserForHelp(step: any, error: string): Promise<void> {
    this.state!.waitingForUser = true;
    this.state!.userPromptedAt = new Date();

    const { url } = await this.browser.createTakeover();

    // Get user email
    const { data: profile } = await getSupabaseClient()
      .from("profiles")
      .select("email")
      .eq("id", this.userId)
      .single();

    const message = `
I'm working on: ${this.state!.plan.goal}

Stuck at: ${step.description}
Error: ${error}

Tried: ${this.state!.obstacleHistory.map(o => o.strategiesTried.join(", ")).join("; ")}

Take over: ${url}

Or reply with instructions. Continuing in ${this.state!.plan.userResponseTimeout} min if no response.
`;

    await sendResponse({
      to: profile?.email || "",
      from: "agent@aevoy.com",
      subject: `Help needed: ${this.state!.plan.goal}`,
      body: message,
    });

    console.log("[EXECUTOR] Prompted user for help");
  }

  private classifyObstacle(error: string): string {
    const lower = error.toLowerCase();
    if (lower.includes("timeout")) return "timeout";
    if (lower.includes("selector") || lower.includes("element")) return "element_not_found";
    if (lower.includes("captcha")) return "captcha";
    if (lower.includes("login")) return "auth";
    if (lower.includes("rate")) return "rate_limit";
    return "unknown";
  }

  private async findAlternativeMethod(step: any, page: Page): Promise<any | null> {
    // Try different selectors
    if (step.target?.startsWith("#")) {
      return { ...step, target: `[id="${step.target.slice(1)}"]` };
    }
    if (step.target?.startsWith(".")) {
      return { ...step, target: `[class="${step.target.slice(1)}"]` };
    }
    return null;
  }

  private async detectCaptcha(page: Page): Promise<boolean> {
    return page.evaluate(() => {
      return !!document.querySelector('.g-recaptcha, .h-captcha, .cf-turnstile, img[src*="captcha"]');
    });
  }

  private async visionGuidedAction(step: any, page: Page): Promise<boolean> {
    // Simplified - would use AI vision
    console.log("[EXECUTOR] Vision mode not fully implemented");
    return false;
  }

  private async performLogin(page: Page, domain: string, username: string, password: string): Promise<void> {
    const url = page.url();
    if (!url.includes(domain)) {
      await page.goto(`https://${domain}/login`);
    }

    // Try multiple selectors
    const emailSelectors = ['input[type="email"]', 'input[name="email"]', '#email', '[name="username"]'];
    const passSelectors = ['input[type="password"]', 'input[name="password"]', '#password'];

    for (const sel of emailSelectors) {
      if (await page.locator(sel).count() > 0) {
        await page.fill(sel, username);
        break;
      }
    }

    for (const sel of passSelectors) {
      if (await page.locator(sel).count() > 0) {
        await page.fill(sel, password);
        break;
      }
    }

    await page.click('button[type="submit"]').catch(() => page.keyboard.press("Enter"));
    await page.waitForLoadState("networkidle").catch(() => {});
  }

  private returnResult(success: boolean, error?: string, result?: any): ExecutionResult {
    return {
      success,
      completed: success,
      result,
      error,
      stepsExecuted: this.state?.currentStepIndex || 0,
      durationMs: Date.now() - this.startTime,
      attempts: this.state?.attemptCount || 0,
    };
  }
}

export function createAutonomousExecutor(userId: string, browser: MultiUserBrowserService): AutonomousExecutor {
  return new AutonomousExecutor(userId, browser);
}
