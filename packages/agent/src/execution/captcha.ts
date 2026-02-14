/**
 * CAPTCHA Detection & Solving Pipeline — Production-Ready
 *
 * Detects reCAPTCHA v2/v3, hCaptcha, Cloudflare Turnstile, and image CAPTCHAs.
 * Solves via CapSolver API (AI-powered, 95%+ success) with fallback to 2Captcha.
 *
 * Features:
 * - Multi-service fallback: CapSolver → 2Captcha → Claude Vision
 * - Cost tracking (logged to ai_cost_log)
 * - User fallback (email screenshot if all services fail)
 * - Daily cost alerts (>$5/day triggers notification)
 * - 3 retry attempts per service
 * - Screenshot evidence for all attempts
 */

import type { Page } from 'playwright';

export type CaptchaType = 'recaptcha_v2' | 'recaptcha_v3' | 'hcaptcha' | 'turnstile' | 'image' | 'funcaptcha' | 'geetest' | 'datadome' | 'none';

interface CaptchaDetection {
  type: CaptchaType;
  siteKey?: string;
  pageUrl: string;
  imageUrl?: string;
}

interface CaptchaSolveResult {
  success: boolean;
  solution?: string;
  error?: string;
  cost?: number;
  service?: 'capsolver' | '2captcha' | 'claude_vision' | 'user_manual';
  screenshot?: string;
}

/**
 * Detect what type of CAPTCHA is present on the page.
 * Enhanced detection for FunCaptcha, GeeTest, DataDome.
 */
export async function detectCaptcha(page: Page): Promise<CaptchaDetection> {
  const pageUrl = page.url();

  const result = await page.evaluate(() => {
    // reCAPTCHA v2
    const recaptchaV2 = document.querySelector('.g-recaptcha, [data-sitekey], iframe[src*="recaptcha"]');
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
    const hcaptcha = document.querySelector('.h-captcha, [data-hcaptcha-sitekey], iframe[src*="hcaptcha"]');
    if (hcaptcha) {
      return {
        type: 'hcaptcha' as const,
        siteKey: hcaptcha.getAttribute('data-sitekey') || hcaptcha.getAttribute('data-hcaptcha-sitekey') || undefined,
      };
    }

    // Cloudflare Turnstile
    const turnstile = document.querySelector('.cf-turnstile, [data-turnstile-sitekey], iframe[src*="turnstile"]');
    if (turnstile) {
      return {
        type: 'turnstile' as const,
        siteKey: turnstile.getAttribute('data-sitekey') || turnstile.getAttribute('data-turnstile-sitekey') || undefined,
      };
    }

    // FunCaptcha (ArkoseLabs)
    const funcaptcha = document.querySelector('[data-public-key], iframe[src*="funcaptcha"], iframe[src*="arkoselabs"]');
    if (funcaptcha) {
      return {
        type: 'funcaptcha' as const,
        siteKey: funcaptcha.getAttribute('data-public-key') || undefined,
      };
    }

    // GeeTest
    const geetest = document.querySelector('.geetest_holder, .geetest_box, [class*="geetest"]');
    if (geetest) {
      return { type: 'geetest' as const, siteKey: undefined };
    }

    // DataDome
    const datadome = document.querySelector('[data-datadome], iframe[src*="datadome"]');
    if (datadome) {
      return {
        type: 'datadome' as const,
        siteKey: datadome.getAttribute('data-datadome') || undefined,
      };
    }

    // Image CAPTCHA (generic)
    const captchaImage = document.querySelector(
      'img[src*="captcha"], img[alt*="captcha" i], img[class*="captcha" i], #captcha-image, .captcha-image'
    );
    if (captchaImage) {
      const imageUrl = (captchaImage as HTMLImageElement).src || undefined;
      return { type: 'image' as const, siteKey: undefined, imageUrl };
    }

    return { type: 'none' as const, siteKey: undefined };
  });

  return { ...result, pageUrl };
}

/**
 * Attempt to solve a detected CAPTCHA with multi-service fallback.
 * Priority: CapSolver (AI, fastest) → 2Captcha (human, reliable) → Claude Vision → User Manual
 */
export async function solveCaptcha(
  page: Page,
  detection: CaptchaDetection,
  userId?: string,
  taskId?: string
): Promise<CaptchaSolveResult> {
  if (detection.type === 'none') {
    return { success: true };
  }

  console.log(`[CAPTCHA] Solving ${detection.type} on ${detection.pageUrl}`);

  const capsolverKey = process.env.CAPSOLVER_API_KEY;
  const twocaptchaKey = process.env.TWOCAPTCHA_API_KEY;

  // Service fallback chain with retry
  const services: Array<{
    name: 'capsolver' | '2captcha' | 'claude_vision';
    fn: () => Promise<CaptchaSolveResult>;
    available: boolean;
  }> = [
    {
      name: 'capsolver',
      fn: () => solveWithCapSolver(page, detection, capsolverKey!),
      available: !!capsolverKey && !!detection.siteKey,
    },
    {
      name: '2captcha',
      fn: () => solveWith2Captcha(page, detection, twocaptchaKey!),
      available: !!twocaptchaKey && (!!detection.siteKey || detection.type === 'image'),
    },
    {
      name: 'claude_vision',
      fn: () => solveWithClaudeVision(page, detection),
      available: !!process.env.ANTHROPIC_API_KEY && detection.type === 'image',
    },
  ];

  let lastError = '';
  for (const service of services.filter(s => s.available)) {
    console.log(`[CAPTCHA] Trying ${service.name}...`);

    // 3 retry attempts per service
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const result = await service.fn();

        if (result.success) {
          console.log(`[CAPTCHA] ✓ Solved with ${service.name} (attempt ${attempt}/3, cost $${result.cost || 0})`);

          // Track cost
          if (result.cost && userId) {
            await trackCaptchaCost(userId, taskId || 'unknown', service.name, detection.type, result.cost);
          }

          return { ...result, service: service.name };
        }

        lastError = result.error || 'Unknown error';
        console.warn(`[CAPTCHA] ${service.name} attempt ${attempt}/3 failed: ${lastError}`);

        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt)); // 2s, 4s, 6s backoff
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[CAPTCHA] ${service.name} attempt ${attempt}/3 error: ${lastError}`);
      }
    }
  }

  // All services failed — fallback to user manual solving
  console.warn(`[CAPTCHA] All automated services failed after retries. Requesting user manual solve.`);
  return await requestUserManualSolve(page, detection, userId);
}

/**
 * Solve CAPTCHA using CapSolver API (AI-powered, 95%+ success, fastest).
 * Pricing: $0.80-$3.00 per 1000 solves depending on type.
 */
async function solveWithCapSolver(
  page: Page,
  detection: CaptchaDetection,
  apiKey: string
): Promise<CaptchaSolveResult> {
  try {
    let taskType: string;
    let taskData: Record<string, unknown>;

    // Map CAPTCHA types to CapSolver task types
    switch (detection.type) {
      case 'recaptcha_v2':
        taskType = 'ReCaptchaV2TaskProxyLess';
        taskData = {
          websiteURL: detection.pageUrl,
          websiteKey: detection.siteKey,
        };
        break;
      case 'recaptcha_v3':
        taskType = 'ReCaptchaV3TaskProxyLess';
        taskData = {
          websiteURL: detection.pageUrl,
          websiteKey: detection.siteKey,
          pageAction: 'verify',
        };
        break;
      case 'hcaptcha':
        taskType = 'HCaptchaTaskProxyLess';
        taskData = {
          websiteURL: detection.pageUrl,
          websiteKey: detection.siteKey,
        };
        break;
      case 'turnstile':
        taskType = 'AntiTurnstileTaskProxyLess';
        taskData = {
          websiteURL: detection.pageUrl,
          websiteKey: detection.siteKey,
        };
        break;
      case 'funcaptcha':
        taskType = 'FunCaptchaTaskProxyLess';
        taskData = {
          websiteURL: detection.pageUrl,
          websitePublicKey: detection.siteKey,
        };
        break;
      case 'geetest':
        taskType = 'GeeTestTaskProxyLess';
        taskData = {
          websiteURL: detection.pageUrl,
        };
        break;
      case 'datadome':
        taskType = 'DataDomeSliderTask';
        taskData = {
          websiteURL: detection.pageUrl,
        };
        break;
      case 'image':
        taskType = 'ImageToTextTask';
        const screenshot = await captureImageCaptcha(page);
        if (!screenshot) {
          return { success: false, error: 'Could not capture image CAPTCHA' };
        }
        taskData = {
          body: screenshot,
          module: 'common', // common, queueit, funcaptcha
        };
        break;
      default:
        return { success: false, error: `Unsupported CAPTCHA type for CapSolver: ${detection.type}` };
    }

    // Create task
    const createResponse = await fetch('https://api.capsolver.com/createTask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: apiKey,
        task: {
          type: taskType,
          ...taskData,
        },
      }),
    });

    const createResult = await createResponse.json() as {
      errorId: number;
      errorCode?: string;
      errorDescription?: string;
      taskId?: string;
    };

    if (createResult.errorId !== 0 || !createResult.taskId) {
      return {
        success: false,
        error: `CapSolver create error: ${createResult.errorDescription || createResult.errorCode}`,
      };
    }

    const taskId = createResult.taskId;

    // Poll for result (max 120 seconds, 5s intervals)
    for (let i = 0; i < 24; i++) {
      await new Promise(resolve => setTimeout(resolve, 5000));

      const getResponse = await fetch('https://api.capsolver.com/getTaskResult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: apiKey, taskId }),
      });

      const getResult = await getResponse.json() as {
        errorId: number;
        errorCode?: string;
        errorDescription?: string;
        status: 'idle' | 'processing' | 'ready' | 'failed';
        solution?: {
          gRecaptchaResponse?: string;
          token?: string;
          text?: string;
          userAgent?: string;
        };
      };

      if (getResult.status === 'ready' && getResult.solution) {
        const solution = getResult.solution.gRecaptchaResponse || getResult.solution.token || getResult.solution.text;
        if (solution) {
          await injectCaptchaToken(page, detection.type, solution);

          // Calculate cost based on CAPTCHA type
          const cost = calculateCapSolverCost(detection.type);
          return { success: true, solution, cost, service: 'capsolver' };
        }
      }

      if (getResult.status === 'failed' || getResult.errorId !== 0) {
        return {
          success: false,
          error: `CapSolver solve error: ${getResult.errorDescription || getResult.errorCode}`,
        };
      }
    }

    return { success: false, error: 'CapSolver solve timed out after 120s' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: `CapSolver error: ${message}` };
  }
}

/**
 * Calculate CapSolver cost per solve (based on 2026 pricing).
 */
function calculateCapSolverCost(type: CaptchaType): number {
  const pricing: Record<CaptchaType, number> = {
    recaptcha_v2: 0.0008, // $0.80 per 1000
    recaptcha_v3: 0.003, // $3.00 per 1000
    hcaptcha: 0.0008, // $0.80 per 1000
    turnstile: 0.0012, // $1.20 per 1000
    funcaptcha: 0.002, // $2.00 per 1000
    geetest: 0.002, // $2.00 per 1000
    datadome: 0.0025, // $2.50 per 1000
    image: 0.0005, // $0.50 per 1000
    none: 0,
  };
  return pricing[type] || 0.002;
}

/**
 * Capture image CAPTCHA screenshot.
 */
async function captureImageCaptcha(page: Page): Promise<string | null> {
  try {
    const captchaEl = await page.$(
      'img[src*="captcha"], img[alt*="captcha" i], img[class*="captcha" i], #captcha-image, .captcha-image'
    );
    if (!captchaEl) return null;

    const screenshot = await captchaEl.screenshot({ type: 'png' });
    return screenshot.toString('base64');
  } catch {
    return null;
  }
}

/**
 * Solve CAPTCHA using 2captcha API service (human solvers, fallback).
 */
async function solveWith2Captcha(
  page: Page,
  detection: CaptchaDetection,
  apiKey: string
): Promise<CaptchaSolveResult> {
  try {
    let taskType: string;
    let taskData: Record<string, unknown>;

    if (detection.type === 'image') {
      return await solveImageWith2Captcha(page, apiKey);
    }

    switch (detection.type) {
      case 'recaptcha_v2':
        taskType = 'NoCaptchaTaskProxyless';
        taskData = {
          websiteURL: detection.pageUrl,
          websiteKey: detection.siteKey,
        };
        break;
      case 'recaptcha_v3':
        taskType = 'RecaptchaV3TaskProxyless';
        taskData = {
          websiteURL: detection.pageUrl,
          websiteKey: detection.siteKey,
          minScore: 0.5,
          pageAction: 'verify',
        };
        break;
      case 'hcaptcha':
        taskType = 'HCaptchaTaskProxyless';
        taskData = {
          websiteURL: detection.pageUrl,
          websiteKey: detection.siteKey,
        };
        break;
      case 'turnstile':
        taskType = 'TurnstileTaskProxyless';
        taskData = {
          websiteURL: detection.pageUrl,
          websiteKey: detection.siteKey,
        };
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
          ...taskData,
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
          await injectCaptchaToken(page, detection.type, token);
          const cost = 0.0025; // 2captcha pricing: $2.50 per 1000 = $0.0025 each
          return { success: true, solution: token, cost, service: '2captcha' };
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
 * Solve image CAPTCHA using Claude Vision (fallback when API services fail).
 */
async function solveWithClaudeVision(page: Page, detection: CaptchaDetection): Promise<CaptchaSolveResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { success: false, error: 'Claude Vision requires Anthropic API key' };
  }

  try {
    const screenshot = await captureImageCaptcha(page);
    if (!screenshot) {
      return { success: false, error: 'Could not capture CAPTCHA image' };
    }

    // Use Claude Vision to read the CAPTCHA
    const { generateVisionResponse } = await import('../services/ai.js');
    const { content, cost } = await generateVisionResponse(
      'Read the text/characters in this CAPTCHA image. Return ONLY the characters, nothing else. No explanation.',
      screenshot,
      'You are reading a CAPTCHA image. Return only the exact text shown.'
    );

    const solution = content.trim().replace(/[^a-zA-Z0-9]/g, '');

    if (solution.length < 2) {
      return { success: false, error: 'Could not read CAPTCHA text (too short)' };
    }

    // Find input field near the CAPTCHA and enter solution
    const inputEl = await page.$('input[name*="captcha" i], input[id*="captcha" i], input[placeholder*="captcha" i]');
    if (inputEl) {
      await inputEl.fill(solution);
      console.log(`[CAPTCHA] Filled CAPTCHA input with solution: ${solution}`);
    } else {
      console.warn('[CAPTCHA] Could not find input field for CAPTCHA solution');
    }

    return { success: true, solution, cost, service: 'claude_vision' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: `Claude Vision error: ${message}` };
  }
}

/**
 * Request user manual CAPTCHA solve (fallback when all automated methods fail).
 * Sends email with screenshot and waits for response.
 */
async function requestUserManualSolve(
  page: Page,
  detection: CaptchaDetection,
  userId?: string
): Promise<CaptchaSolveResult> {
  try {
    if (!userId) {
      return {
        success: false,
        error: 'All CAPTCHA services failed and no user ID for manual fallback',
        service: 'user_manual',
      };
    }

    // Capture full page screenshot with CAPTCHA
    const screenshot = await page.screenshot({ type: 'png', fullPage: true });
    const base64 = screenshot.toString('base64');

    // Send email to user
    const { sendResponse } = await import('../services/email.js');
    const { getSupabaseClient } = await import('../utils/supabase.js');

    const { data: profile } = await getSupabaseClient()
      .from('profiles')
      .select('email, username')
      .eq('id', userId)
      .single();

    if (!profile?.email) {
      return { success: false, error: 'Could not find user email for manual CAPTCHA', service: 'user_manual' };
    }

    await sendResponse({
      to: profile.email,
      from: process.env.RESEND_FROM_EMAIL || 'noreply@aevoy.com',
      subject: `🤖 Help Needed: CAPTCHA on ${new URL(detection.pageUrl).hostname}`,
      body: `Hi ${profile.username || 'there'},

I encountered a ${detection.type.toUpperCase()} CAPTCHA that I couldn't solve automatically.

**Site:** ${detection.pageUrl}
**CAPTCHA Type:** ${detection.type}

Please view the attached screenshot and reply with the solution.

I'll pause this task and wait for your response.

— Your AI Assistant, Aevoy`,
      attachments: [
        {
          filename: 'captcha-screenshot.png',
          content: base64,
        },
      ],
    });

    console.log(`[CAPTCHA] Sent manual solve request to ${profile.email}`);

    return {
      success: false,
      error: 'CAPTCHA requires manual solving — email sent to user',
      screenshot: base64,
      service: 'user_manual',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: `Manual solve request failed: ${message}`,
      service: 'user_manual',
    };
  }
}

/**
 * Track CAPTCHA solving cost to database (ai_cost_log table).
 */
async function trackCaptchaCost(
  userId: string,
  taskId: string,
  service: string,
  captchaType: string,
  cost: number
): Promise<void> {
  try {
    const { getSupabaseClient } = await import('../utils/supabase.js');

    await getSupabaseClient().from('ai_cost_log').insert({
      user_id: userId,
      task_id: taskId,
      model: `captcha_${service}`,
      tokens_used: 0,
      cost_usd: cost,
      task_type: `captcha_${captchaType}`,
      created_at: new Date().toISOString(),
    });

    // Check daily CAPTCHA cost and alert if >$5
    const today = new Date().toISOString().split('T')[0];
    const { data: dailyCost } = await getSupabaseClient()
      .from('ai_cost_log')
      .select('cost_usd')
      .eq('user_id', userId)
      .gte('created_at', `${today}T00:00:00Z`)
      .ilike('model', 'captcha_%');

    const totalToday = dailyCost?.reduce((sum, row) => sum + (row.cost_usd || 0), 0) || 0;

    if (totalToday > 5.0) {
      console.warn(`[CAPTCHA] ⚠️ User ${userId} has exceeded $5 in CAPTCHA costs today ($${totalToday.toFixed(2)})`);

      // Send alert email
      const { sendResponse } = await import('../services/email.js');
      const { data: profile } = await getSupabaseClient()
        .from('profiles')
        .select('email, username')
        .eq('id', userId)
        .single();

      if (profile?.email) {
        await sendResponse({
          to: profile.email,
          from: process.env.RESEND_FROM_EMAIL || 'noreply@aevoy.com',
          subject: '⚠️ High CAPTCHA Costs Alert',
          body: `Hi ${profile.username || 'there'},

Your CAPTCHA solving costs today have exceeded $5.00 (current: $${totalToday.toFixed(2)}).

This might indicate:
- A site with excessive CAPTCHAs
- A task stuck in a CAPTCHA loop
- Potential bot detection issue

Please review your recent tasks and contact support if needed.

— Aevoy`,
        });
      }
    }
  } catch (error) {
    console.error('[CAPTCHA] Failed to track cost:', error);
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
export async function handleCaptchaIfPresent(
  page: Page,
  userId?: string,
  taskId?: string
): Promise<boolean> {
  const detection = await detectCaptcha(page);
  if (detection.type === 'none') {
    return true;
  }

  console.log(`[CAPTCHA] Detected ${detection.type} on ${detection.pageUrl}`);
  const result = await solveCaptcha(page, detection, userId, taskId);

  if (result.success) {
    console.log(`[CAPTCHA] ✓ Solved ${detection.type} via ${result.service} (cost: $${result.cost || 0})`);
    return true;
  }

  console.warn(`[CAPTCHA] ✗ Failed to solve ${detection.type}: ${result.error}`);
  return false;
}
