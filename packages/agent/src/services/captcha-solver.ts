/**
 * CAPTCHA Solver Service - Universal CAPTCHA handling
 * 
 * Uses 2captcha API for best cost/success ratio
 * Falls back to vision-based solving for edge cases
 * Cost: ~$2.50 per 1000 CAPTCHAs = $0.0025 each
 */

import axios from "axios";
import { Page } from "playwright";
import { generateVisionResponse } from "./ai.js";

type CaptchaType = "recaptcha_v2" | "recaptcha_v3" | "hcaptcha" | "turnstile" | "image" | "geetest" | "unknown";

interface CaptchaResult {
  success: boolean;
  token?: string;
  error?: string;
  cost: number; // In USD
  method: string;
}

const TWOCAPTCHA_API_KEY = process.env.TWOCAPTCHA_API_KEY;
const TWOCAPTCHA_BASE = "http://2captcha.com";

export class CaptchaSolver {
  private apiKey: string;

  constructor() {
    this.apiKey = TWOCAPTCHA_API_KEY || "";
  }

  /**
   * Detect and solve any CAPTCHA on page
   */
  async solve(page: Page): Promise<CaptchaResult> {
    const type = await this.detectType(page);
    
    console.log(`[CAPTCHA] Detected: ${type}`);

    switch (type) {
      case "recaptcha_v2":
        return this.solveReCaptchaV2(page);
      case "recaptcha_v3":
        return this.solveReCaptchaV3(page);
      case "hcaptcha":
        return this.solveHCaptcha(page);
      case "turnstile":
        return this.solveTurnstile(page);
      case "image":
        return this.solveImageCaptcha(page);
      default:
        // Try vision as last resort
        return this.solveWithVision(page);
    }
  }

  /**
   * Detect CAPTCHA type on page
   */
  private async detectType(page: Page): Promise<CaptchaType> {
    return page.evaluate(() => {
      // reCAPTCHA v2
      if (document.querySelector(".g-recaptcha") || 
          document.querySelector("[data-sitekey]") ||
          document.querySelector("iframe[src*='google.com/recaptcha']")) {
        return "recaptcha_v2";
      }

      // reCAPTCHA v3 (invisible)
      if ((window as any).grecaptcha) {
        return "recaptcha_v3";
      }

      // hCaptcha
      if (document.querySelector(".h-captcha") ||
          document.querySelector("[data-hcaptcha-sitekey]") ||
          document.querySelector("iframe[src*='hcaptcha.com']")) {
        return "hcaptcha";
      }

      // Cloudflare Turnstile
      if (document.querySelector(".cf-turnstile") ||
          document.querySelector("[data-sitekey*='turnstile']")) {
        return "turnstile";
      }

      // Image CAPTCHA
      const img = document.querySelector('img[src*="captcha"], img[alt*="captcha"], .captcha-image');
      if (img) return "image";

      // Geetest
      if (document.querySelector(".geetest_canvas_bg") || document.querySelector("[class*='geetest']")) {
        return "geetest";
      }

      return "unknown";
    });
  }

  /**
   * Solve reCAPTCHA v2
   */
  private async solveReCaptchaV2(page: Page): Promise<CaptchaResult> {
    const siteKey = await page.evaluate(() => {
      const el = document.querySelector(".g-recaptcha");
      return el?.getAttribute("data-sitekey") || 
             document.querySelector("[data-sitekey]")?.getAttribute("data-sitekey");
    });

    if (!siteKey) {
      return { success: false, error: "No sitekey found", cost: 0, method: "recaptcha_v2" };
    }

    const pageUrl = page.url();
    
    // Submit to 2captcha
    const result = await this.submitTo2Captcha("userrecaptcha", {
      googlekey: siteKey,
      pageurl: pageUrl,
    });

    if (!result.success || !result.token) {
      return { success: false, error: result.error, cost: result.cost, method: "recaptcha_v2" };
    }

    // Inject solution
    await page.evaluate((token) => {
      (window as any).grecaptcha.getResponse = () => token;
      if ((window as any).grecaptcha.enterprise) {
        (window as any).grecaptcha.enterprise.getResponse = () => token;
      }
      
      // Find and fill textarea
      const textarea = document.querySelector("#g-recaptcha-response") as HTMLTextAreaElement;
      if (textarea) textarea.value = token;
    }, result.token);

    return { success: true, token: result.token, cost: 0.0025, method: "recaptcha_v2" };
  }

  /**
   * Solve reCAPTCHA v3 (invisible)
   */
  private async solveReCaptchaV3(page: Page): Promise<CaptchaResult> {
    const siteKey = await page.evaluate(() => {
      return document.querySelector("[data-sitekey]")?.getAttribute("data-sitekey");
    });

    if (!siteKey) {
      return { success: false, error: "No sitekey found", cost: 0, method: "recaptcha_v3" };
    }

    const result = await this.submitTo2Captcha("userrecaptcha", {
      googlekey: siteKey,
      pageurl: page.url(),
      version: "v3",
      action: "verify",
      min_score: 0.3,
    });

    if (result.success && result.token) {
      await page.evaluate((token) => {
        (window as any).grecaptcha.enterprise?.execute?.(undefined, { action: "verify" })
          ?.then(() => {});
        (window as any).grecaptchaResponse = token;
      }, result.token);
    }

    return { 
      success: result.success, 
      token: result.token, 
      cost: 0.003, // V3 is slightly more expensive
      method: "recaptcha_v3" 
    };
  }

  /**
   * Solve hCaptcha
   */
  private async solveHCaptcha(page: Page): Promise<CaptchaResult> {
    const siteKey = await page.evaluate(() => {
      return document.querySelector(".h-captcha")?.getAttribute("data-sitekey") ||
             document.querySelector("[data-hcaptcha-sitekey]")?.getAttribute("data-hcaptcha-sitekey");
    });

    if (!siteKey) {
      return { success: false, error: "No sitekey found", cost: 0, method: "hcaptcha" };
    }

    const result = await this.submitTo2Captcha("hcaptcha", {
      sitekey: siteKey,
      pageurl: page.url(),
    });

    if (result.success && result.token) {
      await page.evaluate((token) => {
        const textarea = document.querySelector("[name='h-captcha-response']") as HTMLTextAreaElement;
        if (textarea) textarea.value = token;
        (window as any).hcaptchaResponse = token;
      }, result.token);
    }

    return { success: result.success, token: result.token, cost: 0.003, method: "hcaptcha" };
  }

  /**
   * Solve Cloudflare Turnstile
   */
  private async solveTurnstile(page: Page): Promise<CaptchaResult> {
    const siteKey = await page.evaluate(() => {
      return document.querySelector(".cf-turnstile")?.getAttribute("data-sitekey");
    });

    if (!siteKey) {
      return { success: false, error: "No sitekey found", cost: 0, method: "turnstile" };
    }

    const result = await this.submitTo2Captcha("turnstile", {
      sitekey: siteKey,
      pageurl: page.url(),
    });

    // Turnstile auto-validates, just need to wait
    if (result.success) {
      await page.waitForTimeout(2000);
    }

    return { success: result.success, cost: 0.002, method: "turnstile" };
  }

  /**
   * Solve image CAPTCHA
   */
  private async solveImageCaptcha(page: Page): Promise<CaptchaResult> {
    // Find CAPTCHA image
    const captchaUrl = await page.evaluate(() => {
      const img = document.querySelector('img[src*="captcha"], img[alt*="captcha"], .captcha-image') as HTMLImageElement;
      return img?.src;
    });

    if (!captchaUrl) {
      return { success: false, error: "No CAPTCHA image found", cost: 0, method: "image" };
    }

    // Download image
    const imageData = await page.evaluate(async (url) => {
      const response = await fetch(url);
      const blob = await response.blob();
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    }, captchaUrl);

    const base64Image = imageData.split(",")[1];

    // Submit to 2captcha
    const result = await this.submitImageTo2Captcha(base64Image);

    if (result.success && result.text) {
      // Find input and fill
      const input = await page.locator('input[name*="captcha"], input[placeholder*="captcha"], .captcha-input').first();
      if (await input.count() > 0) {
        await input.fill(result.text);
      }
    }

    return { success: result.success, cost: 0.001, method: "image" };
  }

  /**
   * Fallback: Solve with AI vision
   */
  private async solveWithVision(page: Page): Promise<CaptchaResult> {
    console.log("[CAPTCHA] Falling back to vision...");
    
    const screenshotBuffer = await page.screenshot();
    const screenshot = screenshotBuffer.toString('base64');
    
    const result = await generateVisionResponse(
      "Solve the CAPTCHA in this image. Return ONLY the solution text, nothing else.",
      `data:image/png;base64,${screenshot}`,
      "You are solving a CAPTCHA. Be precise."
    );

    const solution = result.content.trim();

    // Try to find and fill input
    const input = await page.locator('input[type="text"]').first();
    if (await input.count() > 0) {
      await input.fill(solution);
    }

    return { 
      success: true, 
      token: solution, 
      cost: result.cost, 
      method: "vision" 
    };
  }

  /**
   * Submit to 2captcha API
   */
  private async submitTo2Captcha(
    method: string, 
    params: Record<string, any>
  ): Promise<{ success: boolean; token?: string; text?: string; error?: string; cost: number }> {
    if (!this.apiKey) {
      return { success: false, error: "No 2captcha API key", cost: 0 };
    }

    try {
      // Submit task
      const submitRes = await axios.get(`${TWOCAPTCHA_BASE}/in.php`, {
        params: {
          key: this.apiKey,
          method,
          json: 1,
          ...params,
        },
        timeout: 30000,
      });

      if (submitRes.data.status !== 1) {
        return { success: false, error: submitRes.data.request, cost: 0 };
      }

      const captchaId = submitRes.data.request;

      // Poll for result
      const result = await this.pollResult(captchaId);
      return result;

    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error", 
        cost: 0 
      };
    }
  }

  /**
   * Submit image CAPTCHA
   */
  private async submitImageTo2Captcha(
    base64Image: string
  ): Promise<{ success: boolean; text?: string; error?: string; cost: number }> {
    if (!this.apiKey) {
      return { success: false, error: "No 2captcha API key", cost: 0 };
    }

    try {
      const submitRes = await axios.post(`${TWOCAPTCHA_BASE}/in.php`, {
        key: this.apiKey,
        method: "base64",
        body: base64Image,
        json: 1,
      }, {
        timeout: 30000,
      });

      if (submitRes.data.status !== 1) {
        return { success: false, error: submitRes.data.request, cost: 0 };
      }

      const captchaId = submitRes.data.request;
      return this.pollResult(captchaId);

    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error", 
        cost: 0 
      };
    }
  }

  /**
   * Poll for CAPTCHA result
   */
  private async pollResult(
    captchaId: string
  ): Promise<{ success: boolean; token?: string; text?: string; error?: string; cost: number }> {
    const maxAttempts = 30; // 30 * 5s = 150s max
    
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 5000));

      try {
        const res = await axios.get(`${TWOCAPTCHA_BASE}/res.php`, {
          params: {
            key: this.apiKey,
            action: "get",
            id: captchaId,
            json: 1,
          },
          timeout: 10000,
        });

        if (res.data.status === 1) {
          // Success
          const response = res.data.request;
          // Check if it's a token (gRecaptchaResponse) or text
          if (response.length > 100) {
            return { success: true, token: response, cost: 0.0025 };
          } else {
            return { success: true, text: response, cost: 0.001 };
          }
        }

        if (res.data.request !== "CAPCHA_NOT_READY") {
          return { success: false, error: res.data.request, cost: 0 };
        }

      } catch (error) {
        // Continue polling
      }
    }

    return { success: false, error: "Timeout waiting for CAPTCHA", cost: 0 };
  }
}

// Export singleton
export const captchaSolver = new CaptchaSolver();
