/**
 * CAPTCHA Detection & Solving — Simplified for Steel/Playwright
 *
 * Detects reCAPTCHA v2/v3, hCaptcha, Cloudflare Turnstile, and image CAPTCHAs.
 * Solves via CapSolver API (primary) with 2Captcha fallback.
 *
 * Designed for transparent use: browser_go calls detectAndSolve() after navigation.
 * The AI never needs to think about CAPTCHAs.
 */

import type { Page } from 'playwright';
import { logger } from '../utils/logger.js';

// ── Types ──

export type CaptchaType =
  | 'recaptcha_v2'
  | 'recaptcha_v3'
  | 'hcaptcha'
  | 'turnstile'
  | 'image'
  | 'funcaptcha'
  | 'verification_page'
  | 'none';

export interface CaptchaDetection {
  type: CaptchaType;
  siteKey?: string;
  pageUrl: string;
  isInvisible?: boolean;
  isEnterprise?: boolean;
}

interface SolveResult {
  solved: boolean;
  error?: string;
  cost: number;
  service?: 'capsolver' | '2captcha';
}

// ── Public API ──

/**
 * Detect what CAPTCHA (if any) is present on the page.
 */
export async function detectCaptcha(page: Page): Promise<CaptchaDetection> {
  const pageUrl = page.url();

  try {
    const result = await page.evaluate(() => {
      // reCAPTCHA v2
      const recaptchaV2 = document.querySelector(
        '.g-recaptcha, [data-sitekey], iframe[src*="recaptcha"]'
      );
      if (recaptchaV2) {
        let siteKey = recaptchaV2.getAttribute('data-sitekey') || undefined;
        if (!siteKey) {
          const parent = recaptchaV2.closest('[data-sitekey]');
          if (parent) siteKey = parent.getAttribute('data-sitekey') || undefined;
        }
        if (!siteKey) {
          const iframe = document.querySelector('iframe[src*="recaptcha"]');
          if (iframe) {
            const src = iframe.getAttribute('src') || '';
            const kMatch = src.match(/[?&]k=([^&]+)/);
            if (kMatch) siteKey = kMatch[1];
          }
        }
        const isInvisible = !!(
          recaptchaV2.getAttribute('data-size') === 'invisible' ||
          document.querySelector('[data-size="invisible"]')
        );
        const isEnterprise = !!(
          document.querySelector('iframe[src*="recaptcha/enterprise"]') ||
          document.querySelector('script[src*="recaptcha/enterprise"]')
        );
        return { type: 'recaptcha_v2' as const, siteKey, isInvisible, isEnterprise };
      }

      // reCAPTCHA v3
      const v3Script = document.querySelector('script[src*="recaptcha/api.js?render="]');
      if (v3Script) {
        const src = v3Script.getAttribute('src') || '';
        const match = src.match(/render=([^&]+)/);
        return { type: 'recaptcha_v3' as const, siteKey: match?.[1] };
      }

      // hCaptcha
      const hcaptcha = document.querySelector(
        '.h-captcha, [data-hcaptcha-sitekey], iframe[src*="hcaptcha"]'
      );
      if (hcaptcha) {
        return {
          type: 'hcaptcha' as const,
          siteKey:
            hcaptcha.getAttribute('data-sitekey') ||
            hcaptcha.getAttribute('data-hcaptcha-sitekey') ||
            undefined,
        };
      }

      // Cloudflare Turnstile (widget)
      const turnstile = document.querySelector(
        '.cf-turnstile, [data-turnstile-sitekey], iframe[src*="turnstile"]'
      );
      if (turnstile) {
        return {
          type: 'turnstile' as const,
          siteKey:
            turnstile.getAttribute('data-sitekey') ||
            turnstile.getAttribute('data-turnstile-sitekey') ||
            undefined,
        };
      }

      // Cloudflare challenge page ("Just a moment...")
      const cfChallenge = document.querySelector(
        '#challenge-form, #challenge-running, .cf-browser-verification'
      );
      const isCfPage =
        document.title.toLowerCase().includes('just a moment') ||
        document.title.toLowerCase().includes('attention required');
      if (cfChallenge || isCfPage) {
        let cfSiteKey: string | undefined;
        const cfIframes = Array.from(
          document.querySelectorAll(
            'iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"]'
          )
        );
        for (const iframe of cfIframes) {
          const src = iframe.getAttribute('src') || '';
          const keyMatch = src.match(/[?&]k=([^&]+)/);
          if (keyMatch) {
            cfSiteKey = keyMatch[1];
            break;
          }
        }
        if (!cfSiteKey) {
          const scripts = Array.from(document.querySelectorAll('script'));
          for (const script of scripts) {
            const text = script.textContent || '';
            const keyMatch = text.match(/sitekey['":\s]+['"]?(0x[A-Za-z0-9_-]+)['"]?/i);
            if (keyMatch) {
              cfSiteKey = keyMatch[1];
              break;
            }
          }
        }
        return { type: 'turnstile' as const, siteKey: cfSiteKey };
      }

      // FunCaptcha (ArkoseLabs)
      const funcaptcha = document.querySelector(
        '[data-public-key], iframe[src*="funcaptcha"], iframe[src*="arkoselabs"]'
      );
      if (funcaptcha) {
        return {
          type: 'funcaptcha' as const,
          siteKey: funcaptcha.getAttribute('data-public-key') || undefined,
        };
      }

      // Image CAPTCHA
      const captchaImage = document.querySelector(
        'img[src*="captcha"], img[alt*="captcha" i], img[class*="captcha" i], #captcha-image, .captcha-image'
      );
      if (captchaImage) {
        return { type: 'image' as const, siteKey: undefined };
      }

      // Generic verification page
      const bodyText = (document.body?.innerText || '').toLowerCase().substring(0, 2000);
      const isVerification =
        /\b(verify you are (a )?human|are you a robot|prove you('re| are) not a (bot|robot)|human verification|bot detection|please verify|security check|checking your browser)\b/i.test(
          bodyText
        ) && bodyText.length < 1500;
      if (isVerification) {
        return { type: 'verification_page' as const, siteKey: undefined };
      }

      return { type: 'none' as const, siteKey: undefined };
    });

    return { ...result, pageUrl };
  } catch (err) {
    logger.debug('[CAPTCHA] Detection failed:', err);
    return { type: 'none', pageUrl };
  }
}

/**
 * Detect and solve CAPTCHA transparently. Returns true if page is usable.
 * This is the main entry point — called automatically after page navigation.
 */
export async function detectAndSolve(page: Page): Promise<{
  hadCaptcha: boolean;
  solved: boolean;
  note?: string;
}> {
  const detection = await detectCaptcha(page);

  if (detection.type === 'none') {
    return { hadCaptcha: false, solved: true };
  }

  logger.info(
    `[CAPTCHA] Detected ${detection.type} on ${detection.pageUrl} (siteKey=${detection.siteKey ? detection.siteKey.substring(0, 15) + '...' : 'NONE'})`
  );

  // Try CapSolver first, then 2Captcha
  const result = await solveCaptcha(page, detection);

  if (result.solved) {
    logger.info(
      `[CAPTCHA] Solved ${detection.type} via ${result.service} (cost: $${result.cost.toFixed(4)})`
    );
    // Wait for page to update after CAPTCHA solve
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    return { hadCaptcha: true, solved: true };
  }

  logger.warn(`[CAPTCHA] Failed to solve ${detection.type}: ${result.error}`);
  return {
    hadCaptcha: true,
    solved: false,
    note: `CAPTCHA detected (${detection.type}) but couldn't be solved automatically. The page may have limited content.`,
  };
}

// ── Solve Orchestration ──

async function solveCaptcha(page: Page, detection: CaptchaDetection): Promise<SolveResult> {
  const capsolverKey = process.env.CAPSOLVER_API_KEY;
  const twocaptchaKey = process.env.TWOCAPTCHA_API_KEY;

  // Try to extract siteKey if missing (needed for most solvers)
  if (!detection.siteKey && detection.type !== 'image' && detection.type !== 'verification_page') {
    const extracted = await extractSiteKey(page, detection.type);
    if (extracted) detection.siteKey = extracted;
  }

  // CapSolver (primary)
  if (capsolverKey) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const result = await solveWithCapSolver(page, detection, capsolverKey);
      if (result.solved) return result;
      logger.debug(`[CAPTCHA] CapSolver attempt ${attempt}/2 failed: ${result.error}`);
      if (attempt < 2) await delay(2000);
    }
  }

  // 2Captcha (fallback)
  if (twocaptchaKey && detection.siteKey) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const result = await solveWith2Captcha(page, detection, twocaptchaKey);
      if (result.solved) return result;
      logger.debug(`[CAPTCHA] 2Captcha attempt ${attempt}/2 failed: ${result.error}`);
      if (attempt < 2) await delay(2000);
    }
  }

  return { solved: false, error: 'All CAPTCHA services failed', cost: 0 };
}

// ── CapSolver ──

async function solveWithCapSolver(
  page: Page,
  detection: CaptchaDetection,
  apiKey: string
): Promise<SolveResult> {
  try {
    const { taskType, taskData } = buildCapSolverTask(page, detection);
    if (!taskType) {
      return { solved: false, error: `Unsupported type for CapSolver: ${detection.type}`, cost: 0 };
    }

    // Create task
    const createRes = await fetch('https://api.capsolver.com/createTask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: apiKey,
        task: { type: taskType, ...taskData },
      }),
    });

    const createResult = (await createRes.json()) as {
      errorId: number;
      errorCode?: string;
      errorDescription?: string;
      taskId?: string;
    };

    if (createResult.errorId !== 0 || !createResult.taskId) {
      return {
        solved: false,
        error: `CapSolver create: ${createResult.errorDescription || createResult.errorCode || 'unknown'}`,
        cost: 0,
      };
    }

    // Poll for result
    const isAdvanced =
      detection.type === 'turnstile' ||
      detection.type === 'funcaptcha';
    const maxPolls = isAdvanced ? 20 : 12;

    for (let i = 0; i < maxPolls; i++) {
      await delay(3000);

      const getRes = await fetch('https://api.capsolver.com/getTaskResult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: apiKey, taskId: createResult.taskId }),
      });

      const getResult = (await getRes.json()) as {
        errorId: number;
        errorDescription?: string;
        status: 'idle' | 'processing' | 'ready' | 'failed';
        solution?: {
          gRecaptchaResponse?: string;
          token?: string;
          text?: string;
        };
      };

      if (getResult.status === 'ready' && getResult.solution) {
        const token =
          getResult.solution.gRecaptchaResponse ||
          getResult.solution.token ||
          getResult.solution.text;

        if (token) {
          await injectToken(page, detection.type, token);
          const cost = CAPSOLVER_PRICING[detection.type] || 0.002;
          return { solved: true, cost, service: 'capsolver' };
        }
      }

      if (getResult.status === 'failed' || getResult.errorId !== 0) {
        return {
          solved: false,
          error: `CapSolver: ${getResult.errorDescription || 'solve failed'}`,
          cost: 0,
        };
      }
    }

    return { solved: false, error: `CapSolver timeout (${maxPolls * 3}s)`, cost: 0 };
  } catch (err) {
    return { solved: false, error: `CapSolver error: ${err instanceof Error ? err.message : 'unknown'}`, cost: 0 };
  }
}

function buildCapSolverTask(
  page: Page,
  detection: CaptchaDetection
): { taskType: string | null; taskData: Record<string, unknown> } {
  // Note: page param is kept for future image CAPTCHA screenshot support
  void page;

  switch (detection.type) {
    case 'recaptcha_v2':
      if (!detection.siteKey) return { taskType: null, taskData: {} };
      return {
        taskType: detection.isEnterprise
          ? 'ReCaptchaV2EnterpriseTaskProxyLess'
          : 'ReCaptchaV2TaskProxyLess',
        taskData: {
          websiteURL: detection.pageUrl,
          websiteKey: detection.siteKey,
          ...(detection.isInvisible ? { isInvisible: true } : {}),
          ...(detection.isEnterprise ? { enterprisePayload: {} } : {}),
        },
      };

    case 'recaptcha_v3':
      if (!detection.siteKey) return { taskType: null, taskData: {} };
      return {
        taskType: 'ReCaptchaV3TaskProxyLess',
        taskData: {
          websiteURL: detection.pageUrl,
          websiteKey: detection.siteKey,
          pageAction: 'verify',
        },
      };

    case 'hcaptcha':
      if (!detection.siteKey) return { taskType: null, taskData: {} };
      return {
        taskType: 'HCaptchaTaskProxyLess',
        taskData: {
          websiteURL: detection.pageUrl,
          websiteKey: detection.siteKey,
        },
      };

    case 'turnstile':
      if (!detection.siteKey) return { taskType: null, taskData: {} };
      return {
        taskType: 'AntiTurnstileTaskProxyLess',
        taskData: {
          websiteURL: detection.pageUrl,
          websiteKey: detection.siteKey,
          metadata: { action: 'managed', cdata: '' },
        },
      };

    case 'funcaptcha':
      if (!detection.siteKey) return { taskType: null, taskData: {} };
      return {
        taskType: 'FunCaptchaTaskProxyLess',
        taskData: {
          websiteURL: detection.pageUrl,
          websitePublicKey: detection.siteKey,
        },
      };

    case 'image':
    case 'verification_page':
      // Image-based — would need screenshot capture, skip for now
      return { taskType: null, taskData: {} };

    default:
      return { taskType: null, taskData: {} };
  }
}

// ── 2Captcha ──

async function solveWith2Captcha(
  page: Page,
  detection: CaptchaDetection,
  apiKey: string
): Promise<SolveResult> {
  try {
    let taskType: string;
    const taskData: Record<string, unknown> = {
      websiteURL: detection.pageUrl,
      websiteKey: detection.siteKey,
    };

    switch (detection.type) {
      case 'recaptcha_v2':
        taskType = 'NoCaptchaTaskProxyless';
        break;
      case 'recaptcha_v3':
        taskType = 'RecaptchaV3TaskProxyless';
        taskData.minScore = 0.5;
        taskData.pageAction = 'verify';
        break;
      case 'hcaptcha':
        taskType = 'HCaptchaTaskProxyless';
        break;
      case 'turnstile':
        taskType = 'TurnstileTaskProxyless';
        break;
      default:
        return { solved: false, error: `Unsupported type for 2Captcha: ${detection.type}`, cost: 0 };
    }

    // Create task
    const createRes = await fetch('https://api.2captcha.com/createTask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: apiKey,
        task: { type: taskType, ...taskData },
      }),
    });

    const createResult = (await createRes.json()) as {
      errorId: number;
      taskId?: string;
      errorDescription?: string;
    };

    if (createResult.errorId !== 0 || !createResult.taskId) {
      return {
        solved: false,
        error: `2Captcha create: ${createResult.errorDescription || 'unknown'}`,
        cost: 0,
      };
    }

    // Poll for result (max 30s)
    for (let i = 0; i < 10; i++) {
      await delay(3000);

      const getRes = await fetch('https://api.2captcha.com/getTaskResult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: apiKey, taskId: createResult.taskId }),
      });

      const getResult = (await getRes.json()) as {
        errorId: number;
        status: string;
        solution?: { gRecaptchaResponse?: string; token?: string };
        errorDescription?: string;
      };

      if (getResult.status === 'ready' && getResult.solution) {
        const token = getResult.solution.gRecaptchaResponse || getResult.solution.token;
        if (token) {
          await injectToken(page, detection.type, token);
          return { solved: true, cost: 0.0025, service: '2captcha' };
        }
      }

      if (getResult.errorId !== 0) {
        return {
          solved: false,
          error: `2Captcha: ${getResult.errorDescription || 'solve failed'}`,
          cost: 0,
        };
      }
    }

    return { solved: false, error: '2Captcha timeout (30s)', cost: 0 };
  } catch (err) {
    return { solved: false, error: `2Captcha error: ${err instanceof Error ? err.message : 'unknown'}`, cost: 0 };
  }
}

// ── Token Injection ──

async function injectToken(page: Page, type: CaptchaType, token: string): Promise<void> {
  const injected = await page.evaluate(
    ({ type, token }) => {
      let success = false;

      if (type === 'recaptcha_v2' || type === 'recaptcha_v3') {
        // Set response textarea
        const textarea = document.querySelector(
          '#g-recaptcha-response, [name="g-recaptcha-response"]'
        ) as HTMLTextAreaElement;
        if (textarea) {
          textarea.style.display = 'block';
          textarea.value = token;
          success = true;
        }
        // Try official callback via ___grecaptcha_cfg
        try {
          const win = window as unknown as Record<string, unknown>;
          if (typeof win.___grecaptcha_cfg === 'object') {
            const cfg = win.___grecaptcha_cfg as Record<string, unknown>;
            const clients = cfg.clients as Record<string, unknown> | undefined;
            if (clients) {
              for (const clientId of Object.keys(clients)) {
                const client = clients[clientId] as Record<string, unknown>;
                for (const key of Object.keys(client)) {
                  const prop = client[key] as Record<string, unknown>;
                  if (prop && typeof prop === 'object') {
                    for (const subKey of Object.keys(prop)) {
                      const sub = prop[subKey] as Record<string, unknown>;
                      if (sub && typeof sub.callback === 'function') {
                        (sub.callback as (t: string) => void)(token);
                        success = true;
                      }
                    }
                  }
                }
              }
            }
          }
          const cb = win.__recaptcha_callback as ((t: string) => void) | undefined;
          if (typeof cb === 'function') {
            cb(token);
            success = true;
          }
        } catch {
          /* callback not found */
        }
        // Auto-submit form containing recaptcha
        if (success) {
          try {
            const forms = Array.from(document.querySelectorAll('form'));
            for (const form of forms) {
              if (form.querySelector('[name="g-recaptcha-response"]')) {
                form.submit();
                break;
              }
            }
            const submitBtn = document.querySelector(
              'button[type="submit"], input[type="submit"]'
            ) as HTMLButtonElement;
            if (submitBtn) submitBtn.click();
          } catch {
            /* best-effort */
          }
        }
      } else if (type === 'hcaptcha') {
        const textarea = document.querySelector(
          '[name="h-captcha-response"], [name="g-recaptcha-response"]'
        ) as HTMLTextAreaElement;
        if (textarea) {
          textarea.value = token;
          success = true;
        }
        try {
          const win = window as unknown as Record<string, unknown>;
          const hcaptcha = win.hcaptcha as
            | { setResponse?: (t: string) => void }
            | undefined;
          if (hcaptcha?.setResponse) {
            hcaptcha.setResponse(token);
            success = true;
          }
        } catch {
          /* ok */
        }
      } else if (type === 'turnstile') {
        const input = document.querySelector(
          '[name="cf-turnstile-response"]'
        ) as HTMLInputElement;
        if (input) {
          input.value = token;
          success = true;
        }
        const challengeInput = document.querySelector(
          '#challenge-form input[name="cf-turnstile-response"], #challenge-form input[type="hidden"]'
        ) as HTMLInputElement;
        if (challengeInput && !challengeInput.value) {
          challengeInput.value = token;
          success = true;
        }
        try {
          const win = window as unknown as Record<string, unknown>;
          const turnstile = win.turnstile as
            | { callback?: (t: string) => void }
            | undefined;
          if (turnstile?.callback) {
            turnstile.callback(token);
            success = true;
          }
        } catch {
          /* ok */
        }
        // Auto-submit challenge form
        const form = document.querySelector('#challenge-form') as HTMLFormElement;
        if (form && success) {
          try {
            form.submit();
          } catch {
            /* ok */
          }
        }
      } else if (type === 'funcaptcha') {
        const input = document.querySelector(
          'input[name="fc-token"], input[name="verification-token"], #fc-token'
        ) as HTMLInputElement;
        if (input) {
          input.value = token;
          success = true;
        }
        try {
          const win = window as unknown as Record<string, unknown>;
          const fnCallback = win.arkoseCallback as ((t: string) => void) | undefined;
          if (typeof fnCallback === 'function') {
            fnCallback(token);
            success = true;
          }
        } catch {
          /* ok */
        }
      }

      return success;
    },
    { type, token }
  );

  if (injected) {
    logger.info(`[CAPTCHA] Token injected for ${type}`);
  } else {
    logger.warn(`[CAPTCHA] Token injection may have failed for ${type}`);
  }
}

// ── Site Key Extraction ──

async function extractSiteKey(page: Page, type: CaptchaType): Promise<string | undefined> {
  try {
    return await page.evaluate((captchaType: string) => {
      // 1. data-sitekey attributes
      const els = Array.from(
        document.querySelectorAll('[data-sitekey], [data-hcaptcha-sitekey], [data-turnstile-sitekey]')
      );
      for (const el of els) {
        const key =
          el.getAttribute('data-sitekey') ||
          el.getAttribute('data-hcaptcha-sitekey') ||
          el.getAttribute('data-turnstile-sitekey');
        if (key && key.length > 10) return key;
      }

      // 2. iframe src params
      const iframeSelector = captchaType === 'turnstile'
        ? 'iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"]'
        : captchaType.startsWith('recaptcha')
          ? 'iframe[src*="recaptcha"]'
          : 'iframe[src*="hcaptcha"]';
      const iframes = Array.from(document.querySelectorAll(iframeSelector));
      for (const iframe of iframes) {
        const src = iframe.getAttribute('src') || '';
        const kMatch = src.match(/[?&]k=([^&]+)/);
        if (kMatch) return kMatch[1];
        const sitekeyMatch = src.match(/[?&]sitekey=([^&]+)/);
        if (sitekeyMatch) return sitekeyMatch[1];
      }

      // 3. Script src (reCAPTCHA v3 render param)
      if (captchaType === 'recaptcha_v3') {
        const scripts = Array.from(document.querySelectorAll('script[src*="recaptcha"]'));
        for (const script of scripts) {
          const src = script.getAttribute('src') || '';
          const renderMatch = src.match(/render=([^&]+)/);
          if (renderMatch && renderMatch[1] !== 'explicit') return renderMatch[1];
        }
      }

      // 4. Inline scripts with sitekey pattern
      const scripts = Array.from(document.querySelectorAll('script'));
      for (const script of scripts) {
        const text = script.textContent || '';
        // Turnstile keys start with 0x
        if (captchaType === 'turnstile') {
          const turnstileMatch = text.match(/sitekey['":\s]+['"]?(0x[A-Za-z0-9_-]+)['"]?/i);
          if (turnstileMatch) return turnstileMatch[1];
        }
        const sitekeyMatch = text.match(/sitekey['"\s:]+['"]?([A-Za-z0-9_-]{30,})/i);
        if (sitekeyMatch) return sitekeyMatch[1];
      }

      return undefined;
    }, type);
  } catch {
    return undefined;
  }
}

// ── Helpers ──

const CAPSOLVER_PRICING: Record<CaptchaType, number> = {
  recaptcha_v2: 0.0008,
  recaptcha_v3: 0.003,
  hcaptcha: 0.0008,
  turnstile: 0.0012,
  funcaptcha: 0.002,
  image: 0.0005,
  verification_page: 0.001,
  none: 0,
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
