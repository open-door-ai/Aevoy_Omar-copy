/**
 * Anti-Bot Detection & Handling
 *
 * Detects Cloudflare challenges, AWS WAF, rate limits, and other
 * anti-bot measures. Provides strategies to handle each.
 */

import type { Page } from 'patchright';
import { delay } from '../utils/timeout.js';
import { detectCaptcha, solveCaptcha } from './captcha.js';

export type AntiBotType = 'cloudflare' | 'aws_waf' | 'rate_limit' | 'generic_block' | 'unknown' | 'none';

interface AntiBotDetection {
  type: AntiBotType;
  statusCode?: number;
  retryAfter?: number;
}

/**
 * Detect if the page is showing an anti-bot challenge.
 */
export async function detectAntiBot(page: Page): Promise<AntiBotDetection> {
  try {
    const result = await page.evaluate(() => {
      const text = document.body?.textContent?.toLowerCase() || '';
      const title = document.title.toLowerCase();

      // Cloudflare challenge
      if (
        title.includes('just a moment') ||
        title.includes('attention required') ||
        text.includes('checking your browser') ||
        text.includes('cloudflare') && text.includes('ray id') ||
        document.querySelector('#challenge-running, #challenge-form, .cf-browser-verification')
      ) {
        return { type: 'cloudflare' as const };
      }

      // AWS WAF
      if (
        text.includes('request blocked') && text.includes('waf') ||
        document.querySelector('[class*="aws-waf"]')
      ) {
        return { type: 'aws_waf' as const };
      }

      // Generic rate limit
      if (
        title.includes('429') ||
        title.includes('too many requests') ||
        text.includes('rate limit') ||
        text.includes('too many requests') ||
        text.includes('please try again later') && text.includes('requests')
      ) {
        return { type: 'rate_limit' as const };
      }

      // Generic bot-block / error pages (Amazon, Walmart, etc.)
      if (
        title.includes('sorry! something went wrong') ||
        title.includes('robot or human') ||
        title.includes('access denied') ||
        title.includes('automated access') ||
        text.includes('automated access to our website') ||
        text.includes('unusual activity') && text.includes('shopping') ||
        (text.length < 500 && (title.includes('error') || title.includes('sorry')))
      ) {
        return { type: 'generic_block' as const };
      }

      return { type: 'none' as const };
    });

    return result;
  } catch {
    return { type: 'none' };
  }
}

/**
 * Handle a detected anti-bot challenge.
 * Returns true if the challenge was resolved.
 */
export async function handleAntiBot(page: Page, detection: AntiBotDetection): Promise<boolean> {
  switch (detection.type) {
    case 'cloudflare':
      return await handleCloudflare(page);

    case 'aws_waf':
      return await handleAWSWAF(page);

    case 'rate_limit':
      return await handleRateLimit(page, detection.retryAfter);

    case 'generic_block':
      // Generic blocks (Amazon "Sorry!", etc.) cannot be resolved — caller should pivot to Bing
      console.warn('[ANTIBOT] Generic bot-block detected — page content unavailable');
      return false;

    case 'none':
      return true;

    default:
      console.warn(`[ANTIBOT] Unknown anti-bot type: ${detection.type}`);
      return false;
  }
}

/**
 * Handle Cloudflare challenge — wait briefly for auto-resolve, then actively solve via CapSolver.
 * Cloudflare uses Turnstile under the hood; we detect it and solve it programmatically.
 */
async function handleCloudflare(page: Page): Promise<boolean> {
  console.log('[ANTIBOT] Cloudflare challenge detected — attempting active solve...');

  // Phase 1: Quick wait (5s) — many Cloudflare JS challenges auto-resolve for stealth browsers
  await delay(5000);
  const quickResolved = await page.evaluate(() => {
    const title = document.title.toLowerCase();
    return !title.includes('just a moment') && !title.includes('attention required');
  }).catch(() => false);

  if (quickResolved) {
    console.log('[ANTIBOT] Cloudflare challenge auto-resolved in 5s');
    return true;
  }

  // Phase 2: Active CAPTCHA solving via CapSolver (Turnstile)
  console.log('[ANTIBOT] Auto-resolve failed — using CapSolver for Turnstile...');
  try {
    const detection = await detectCaptcha(page);
    if (detection.type === 'turnstile' || detection.type === 'none') {
      // Even if detectCaptcha says 'none', we KNOW this is a CF challenge page.
      // Force Turnstile detection with siteKey extraction.
      const siteKey = detection.siteKey || await extractTurnstileSiteKey(page);

      if (siteKey) {
        console.log(`[ANTIBOT] Found Turnstile siteKey: ${siteKey.substring(0, 10)}...`);
        const result = await solveCaptcha(page, {
          type: 'turnstile',
          siteKey,
          pageUrl: page.url(),
        });

        if (result.success) {
          console.log(`[ANTIBOT] ✓ Cloudflare Turnstile solved via ${result.service}`);
          // Wait for page to process the token and redirect
          await delay(3000);
          const resolved = await page.evaluate(() => {
            const title = document.title.toLowerCase();
            return !title.includes('just a moment') && !title.includes('attention required');
          }).catch(() => false);
          if (resolved) return true;

          // Token injected but page didn't redirect — try submitting the challenge form
          await page.evaluate(() => {
            const form = document.querySelector('#challenge-form') as HTMLFormElement;
            if (form) form.submit();
          }).catch(() => {});
          await delay(3000);
          const resolvedAfterSubmit = await page.evaluate(() => {
            const title = document.title.toLowerCase();
            return !title.includes('just a moment') && !title.includes('attention required');
          }).catch(() => false);
          if (resolvedAfterSubmit) return true;
        }
      } else {
        console.warn('[ANTIBOT] Could not extract Turnstile siteKey from Cloudflare page');
      }
    } else {
      // Some other CAPTCHA type on the Cloudflare page
      const result = await solveCaptcha(page, detection);
      if (result.success) {
        console.log(`[ANTIBOT] ✓ Solved ${detection.type} on Cloudflare page via ${result.service}`);
        await delay(3000);
        return true;
      }
    }
  } catch (error) {
    console.warn('[ANTIBOT] Active CAPTCHA solve failed:', error);
  }

  // Phase 3: Extended wait with checkbox click attempts (15s more)
  console.log('[ANTIBOT] Active solve didn\'t resolve page — trying extended wait + checkbox clicks...');
  for (let i = 0; i < 3; i++) {
    try {
      const checkbox = page.locator('input[type="checkbox"], .cf-turnstile iframe');
      if (await checkbox.count() > 0) {
        await checkbox.first().click().catch(() => {});
      }
    } catch { /* no checkbox */ }

    await delay(5000);

    const stillBlocked = await page.evaluate(() => {
      const title = document.title.toLowerCase();
      return title.includes('just a moment') || title.includes('attention required');
    }).catch(() => true);

    if (!stillBlocked) {
      console.log('[ANTIBOT] Cloudflare resolved after extended wait');
      return true;
    }
  }

  console.warn('[ANTIBOT] Cloudflare challenge not resolved after active solve + 30s wait');
  return false;
}

/**
 * Extract Turnstile siteKey from a Cloudflare challenge page.
 * Looks in iframes, scripts, and data attributes.
 */
async function extractTurnstileSiteKey(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    // Check iframes
    const iframes = Array.from(document.querySelectorAll('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"]'));
    for (let i = 0; i < iframes.length; i++) {
      const src = iframes[i].getAttribute('src') || '';
      const keyMatch = src.match(/[?&]k=([^&]+)/);
      if (keyMatch) return keyMatch[1];
    }
    // Check inline scripts
    const scripts = Array.from(document.querySelectorAll('script'));
    for (let i = 0; i < scripts.length; i++) {
      const text = scripts[i].textContent || '';
      const keyMatch = text.match(/sitekey['":\s]+['"]?(0x[A-Za-z0-9_-]+)['"]?/i);
      if (keyMatch) return keyMatch[1];
      const cDataMatch = text.match(/cData\s*\[?\s*['"]?sitekey['"]?\s*\]?\s*[:=]\s*['"]?(0x[A-Za-z0-9_-]+)/i);
      if (cDataMatch) return cDataMatch[1];
      const renderMatch = text.match(/turnstile\.render\s*\([^)]*sitekey\s*:\s*['"]([^'"]+)/i);
      if (renderMatch) return renderMatch[1];
    }
    // Check data attributes
    const cfElements = Array.from(document.querySelectorAll('[data-sitekey], [data-turnstile-sitekey]'));
    for (let i = 0; i < cfElements.length; i++) {
      const key = cfElements[i].getAttribute('data-sitekey') || cfElements[i].getAttribute('data-turnstile-sitekey');
      if (key) return key;
    }
    // Check challenge form hidden inputs
    const challengeForm = document.querySelector('#challenge-form');
    if (challengeForm) {
      const inner = challengeForm.querySelector('[data-sitekey]');
      if (inner) return inner.getAttribute('data-sitekey') || undefined;
    }
    return undefined;
  }).catch(() => undefined);
}

/**
 * Handle AWS WAF block by rotating headers.
 */
async function handleAWSWAF(page: Page): Promise<boolean> {
  console.log('[ANTIBOT] AWS WAF block detected');

  // Try refreshing with different headers
  await page.setExtraHTTPHeaders({
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  });

  await delay(3000);
  await page.reload().catch(() => {});
  await delay(2000);

  // Check if still blocked
  const stillBlocked = await detectAntiBot(page);
  return stillBlocked.type === 'none';
}

/**
 * Handle rate limiting with exponential backoff.
 */
async function handleRateLimit(page: Page, retryAfterSec?: number): Promise<boolean> {
  // Single retry only — if the site is bot-blocking (not truly rate-limited),
  // waiting longer won't help. The processor's dynamic failure tracker
  // will switch to search() after 2 failures on the same domain.
  const waitMs = retryAfterSec ? Math.min(retryAfterSec * 1000, 10000) : 5000;
  console.log(`[ANTIBOT] Rate limited, waiting ${waitMs}ms (single retry)`);
  await delay(waitMs);

  await page.reload().catch(() => {});
  await delay(2000);

  const detection = await detectAntiBot(page);
  if (detection.type === 'none') {
    console.log('[ANTIBOT] Rate limit resolved after single retry');
    return true;
  }

  console.warn('[ANTIBOT] Rate limit not resolved — returning false (caller should pivot)');
  return false;
}

/**
 * Get proxy configuration from environment.
 * Supports two formats:
 *   PROXY_URL=http://user:pass@proxy.example.com:port  (single residential proxy with auth)
 *   PROXY_LIST=proxy1,proxy2,proxy3  (multiple proxies, rotated randomly)
 *
 * Residential proxy providers (BrightData, Oxylabs, SmartProxy, etc.) typically use
 * authenticated proxies with username:password. This config passes credentials to Playwright.
 */
export function getProxyConfig(): { server: string; username?: string; password?: string } | undefined {
  // Single authenticated proxy (preferred for residential)
  const singleProxy = process.env.PROXY_URL;
  if (singleProxy) {
    try {
      const parsed = new URL(singleProxy);
      const server = `${parsed.protocol}//${parsed.hostname}${parsed.port ? ':' + parsed.port : ''}`;
      if (parsed.username) {
        return { server, username: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password) };
      }
      return { server };
    } catch {
      return { server: singleProxy };
    }
  }

  // Multiple proxy rotation
  const proxyList = process.env.PROXY_LIST;
  if (!proxyList) return undefined;

  const proxies = proxyList.split(',').map(p => p.trim()).filter(Boolean);
  if (proxies.length === 0) return undefined;

  const proxy = proxies[Math.floor(Math.random() * proxies.length)];
  try {
    const parsed = new URL(proxy);
    const server = `${parsed.protocol}//${parsed.hostname}${parsed.port ? ':' + parsed.port : ''}`;
    if (parsed.username) {
      return { server, username: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password) };
    }
    return { server: proxy };
  } catch {
    return { server: proxy };
  }
}

/**
 * Check for anti-bot after a page navigation and handle if detected.
 */
export async function checkAndHandleAntiBot(page: Page): Promise<boolean> {
  const detection = await detectAntiBot(page);
  if (detection.type === 'none') return true;

  console.log(`[ANTIBOT] Detected: ${detection.type}`);
  return await handleAntiBot(page, detection);
}
