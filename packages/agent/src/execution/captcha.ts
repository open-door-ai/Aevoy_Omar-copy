/**
 * CAPTCHA Detection & Solving Pipeline
 *
 * Detects reCAPTCHA v2/v3, hCaptcha, Cloudflare Turnstile, and image CAPTCHAs.
 * Solves via 2captcha API or Claude Vision for image CAPTCHAs.
 */

import type { Page } from 'playwright';

export type CaptchaType = 'recaptcha_v2' | 'recaptcha_v3' | 'hcaptcha' | 'turnstile' | 'image' | 'none';

interface CaptchaDetection {
  type: CaptchaType;
  siteKey?: string;
  pageUrl: string;
}

interface CaptchaSolveResult {
  success: boolean;
  solution?: string;
  error?: string;
}

/**
 * Detect what type of CAPTCHA is present on the page.
 */
export async function detectCaptcha(page: Page): Promise<CaptchaDetection> {
  const pageUrl = page.url();

  const result = await page.evaluate(() => {
    // reCAPTCHA v2
    const recaptchaV2 = document.querySelector('.g-recaptcha, [data-sitekey]');
    if (recaptchaV2) {
      return {
        type: 'recaptcha_v2' as const,
        siteKey: recaptchaV2.getAttribute('data-sitekey') || undefined,
      };
    }

    // reCAPTCHA v3 (invisible)
    const recaptchaV3Script = document.querySelector('script[src*="recaptcha/api.js?render="]');
    if (recaptchaV3Script) {
      const src = recaptchaV3Script.getAttribute('src') || '';
      const match = src.match(/render=([^&]+)/);
      return {
        type: 'recaptcha_v3' as const,
        siteKey: match ? match[1] : undefined,
      };
    }

    // hCaptcha
    const hcaptcha = document.querySelector('.h-captcha, [data-hcaptcha-sitekey]');
    if (hcaptcha) {
      return {
        type: 'hcaptcha' as const,
        siteKey: hcaptcha.getAttribute('data-sitekey') || hcaptcha.getAttribute('data-hcaptcha-sitekey') || undefined,
      };
    }

    // Cloudflare Turnstile
    const turnstile = document.querySelector('.cf-turnstile, [data-turnstile-sitekey]');
    if (turnstile) {
      return {
        type: 'turnstile' as const,
        siteKey: turnstile.getAttribute('data-sitekey') || turnstile.getAttribute('data-turnstile-sitekey') || undefined,
      };
    }

    // Image CAPTCHA (generic)
    const captchaImage = document.querySelector(
      'img[src*="captcha"], img[alt*="captcha" i], img[class*="captcha" i], #captcha-image'
    );
    if (captchaImage) {
      return { type: 'image' as const, siteKey: undefined };
    }

    return { type: 'none' as const, siteKey: undefined };
  });

  return { ...result, pageUrl };
}

/**
 * Attempt to solve a detected CAPTCHA.
 */
export async function solveCaptcha(page: Page, detection: CaptchaDetection): Promise<CaptchaSolveResult> {
  if (detection.type === 'none') {
    return { success: true };
  }

  const apiKey = process.env.TWOCAPTCHA_API_KEY;

  switch (detection.type) {
    case 'recaptcha_v2':
    case 'recaptcha_v3':
    case 'hcaptcha':
    case 'turnstile': {
      if (!apiKey) {
        return { success: false, error: `No 2captcha API key for ${detection.type}` };
      }
      if (!detection.siteKey) {
        return { success: false, error: 'No site key found for CAPTCHA' };
      }
      return await solveWith2Captcha(page, detection, apiKey);
    }

    case 'image': {
      // Prioritize 2captcha (90% success) over Claude Vision (75% success)
      if (apiKey) {
        const result = await solveImageWith2Captcha(page, apiKey);
        if (result.success) {
          return result;
        }
        console.log('[CAPTCHA] 2captcha failed for image, falling back to Claude Vision');
      }
      return await solveImageCaptcha(page);
    }

    default:
      return { success: false, error: `Unknown CAPTCHA type: ${detection.type}` };
  }
}

/**
 * Solve CAPTCHA using 2captcha API service.
 */
async function solveWith2Captcha(
  page: Page,
  detection: CaptchaDetection,
  apiKey: string
): Promise<CaptchaSolveResult> {
  try {
    let method: string;
    let taskType: string;

    switch (detection.type) {
      case 'recaptcha_v2':
        method = 'userrecaptcha';
        taskType = 'NoCaptchaTaskProxyless';
        break;
      case 'recaptcha_v3':
        method = 'userrecaptcha';
        taskType = 'RecaptchaV3TaskProxyless';
        break;
      case 'hcaptcha':
        method = 'hcaptcha';
        taskType = 'HCaptchaTaskProxyless';
        break;
      case 'turnstile':
        method = 'turnstile';
        taskType = 'TurnstileTaskProxyless';
        break;
      default:
        return { success: false, error: 'Unsupported CAPTCHA type for 2captcha' };
    }

    // Submit task
    const createResponse = await fetch('https://api.2captcha.com/createTask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: apiKey,
        task: {
          type: taskType,
          websiteURL: detection.pageUrl,
          websiteKey: detection.siteKey,
          ...(detection.type === 'recaptcha_v3' ? { minScore: 0.5, pageAction: 'verify' } : {}),
        },
      }),
    });

    const createResult = await createResponse.json() as { errorId: number; taskId?: string; errorDescription?: string };
    if (createResult.errorId !== 0) {
      return { success: false, error: `2captcha create error: ${createResult.errorDescription}` };
    }

    const taskId = createResult.taskId;
    if (!taskId) {
      return { success: false, error: '2captcha did not return task ID' };
    }

    // Poll for result (max 120 seconds)
    for (let i = 0; i < 24; i++) {
      await new Promise(resolve => setTimeout(resolve, 5000));

      const getResponse = await fetch('https://api.2captcha.com/getTaskResult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: apiKey, taskId }),
      });

      const getResult = await getResponse.json() as {
        errorId: number;
        status: string;
        solution?: { gRecaptchaResponse?: string; token?: string };
        errorDescription?: string;
      };

      if (getResult.status === 'ready' && getResult.solution) {
        const token = getResult.solution.gRecaptchaResponse || getResult.solution.token;
        if (token) {
          // Inject token into page
          await injectCaptchaToken(page, detection.type, token);
          return { success: true, solution: token };
        }
      }

      if (getResult.errorId !== 0) {
        return { success: false, error: `2captcha solve error: ${getResult.errorDescription}` };
      }
    }

    return { success: false, error: '2captcha solve timed out' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: `2captcha error: ${message}` };
  }
}

/**
 * Solve image CAPTCHA using 2captcha API.
 */
async function solveImageWith2Captcha(page: Page, apiKey: string): Promise<CaptchaSolveResult> {
  try {
    // Find and screenshot the CAPTCHA image
    const captchaEl = await page.$('img[src*="captcha"], img[alt*="captcha" i], img[class*="captcha" i], #captcha-image');
    if (!captchaEl) {
      return { success: false, error: 'Could not find CAPTCHA image element' };
    }

    const screenshot = await captchaEl.screenshot({ type: 'png' });
    const base64 = screenshot.toString('base64');

    // Submit to 2captcha image recognition endpoint
    const createResponse = await fetch('https://api.2captcha.com/createTask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: apiKey,
        task: {
          type: 'ImageToTextTask',
          body: base64,
        },
      }),
    });

    const createResult = await createResponse.json() as { errorId: number; taskId?: string; errorDescription?: string };
    if (createResult.errorId !== 0) {
      return { success: false, error: `2captcha image error: ${createResult.errorDescription}` };
    }

    const taskId = createResult.taskId;
    if (!taskId) {
      return { success: false, error: '2captcha did not return task ID' };
    }

    // Poll for result (max 30 seconds for image CAPTCHAs)
    for (let i = 0; i < 6; i++) {
      await new Promise(resolve => setTimeout(resolve, 5000));

      const getResponse = await fetch('https://api.2captcha.com/getTaskResult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: apiKey, taskId }),
      });

      const getResult = await getResponse.json() as {
        errorId: number;
        status: string;
        solution?: { text?: string };
        errorDescription?: string;
      };

      if (getResult.status === 'ready' && getResult.solution?.text) {
        const solution = getResult.solution.text.trim().replace(/[^a-zA-Z0-9]/g, '');

        // Find input field near the CAPTCHA and enter solution
        const inputEl = await page.$('input[name*="captcha" i], input[id*="captcha" i], input[placeholder*="captcha" i]');
        if (inputEl) {
          await inputEl.fill(solution);
        }

        return { success: true, solution };
      }

      if (getResult.errorId !== 0) {
        return { success: false, error: `2captcha image solve error: ${getResult.errorDescription}` };
      }
    }

    return { success: false, error: '2captcha image solve timed out' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: `2captcha image error: ${message}` };
  }
}

/**
 * Solve image CAPTCHA using Claude Vision.
 */
async function solveImageCaptcha(page: Page): Promise<CaptchaSolveResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { success: false, error: 'Image CAPTCHA requires Anthropic API key' };
  }

  try {
    // Find and screenshot the CAPTCHA image
    const captchaEl = await page.$('img[src*="captcha"], img[alt*="captcha" i], img[class*="captcha" i], #captcha-image');
    if (!captchaEl) {
      return { success: false, error: 'Could not find CAPTCHA image element' };
    }

    const screenshot = await captchaEl.screenshot({ type: 'png' });
    const base64 = screenshot.toString('base64');

    // Use Claude Vision to read the CAPTCHA
    const { generateVisionResponse } = await import('../services/ai.js');
    const { content } = await generateVisionResponse(
      'Read the text/characters in this CAPTCHA image. Return ONLY the characters, nothing else. No explanation.',
      base64,
      'You are reading a CAPTCHA image. Return only the exact text shown.'
    );

    const solution = content.trim().replace(/[^a-zA-Z0-9]/g, '');

    if (solution.length < 2) {
      return { success: false, error: 'Could not read CAPTCHA text' };
    }

    // Find input field near the CAPTCHA and enter solution
    const inputEl = await page.$('input[name*="captcha" i], input[id*="captcha" i], input[placeholder*="captcha" i]');
    if (inputEl) {
      await inputEl.fill(solution);
    }

    return { success: true, solution };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: `Image CAPTCHA error: ${message}` };
  }
}

/**
 * Inject a solved CAPTCHA token into the page.
 */
async function injectCaptchaToken(page: Page, type: CaptchaType, token: string): Promise<void> {
  await page.evaluate(
    ({ type, token }) => {
      if (type === 'recaptcha_v2' || type === 'recaptcha_v3') {
        // Set reCAPTCHA response
        const textarea = document.querySelector('#g-recaptcha-response, [name="g-recaptcha-response"]') as HTMLTextAreaElement;
        if (textarea) {
          textarea.style.display = 'block';
          textarea.value = token;
        }
        // Call callback if exists
        const callback = (window as unknown as Record<string, unknown>).__recaptcha_callback as ((token: string) => void) | undefined;
        if (typeof callback === 'function') {
          callback(token);
        }
      } else if (type === 'hcaptcha') {
        const textarea = document.querySelector('[name="h-captcha-response"], [name="g-recaptcha-response"]') as HTMLTextAreaElement;
        if (textarea) {
          textarea.value = token;
        }
      } else if (type === 'turnstile') {
        const input = document.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement;
        if (input) {
          input.value = token;
        }
      }
    },
    { type, token }
  );
}

/**
 * Check for CAPTCHA after a page action and solve if found.
 * Returns true if a CAPTCHA was found and solved (or none found).
 */
export async function handleCaptchaIfPresent(page: Page): Promise<boolean> {
  const detection = await detectCaptcha(page);
  if (detection.type === 'none') {
    return true;
  }

  console.log(`[CAPTCHA] Detected ${detection.type} on ${detection.pageUrl}`);
  const result = await solveCaptcha(page, detection);

  if (result.success) {
    console.log(`[CAPTCHA] Solved ${detection.type}`);
    return true;
  }

  console.warn(`[CAPTCHA] Failed to solve ${detection.type}: ${result.error}`);
  return false;
}
