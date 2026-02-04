/**
 * Anti-Bot Detection & Handling
 *
 * Detects Cloudflare challenges, AWS WAF, rate limits, and other
 * anti-bot measures. Provides strategies to handle each.
 */

import type { Page } from 'playwright';
import { delay } from '../utils/timeout.js';

export type AntiBotType = 'cloudflare' | 'aws_waf' | 'rate_limit' | 'unknown' | 'none';

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

    case 'none':
      return true;

    default:
      console.warn(`[ANTIBOT] Unknown anti-bot type: ${detection.type}`);
      return false;
  }
}

/**
 * Handle Cloudflare challenge by waiting for auto-resolve.
 */
async function handleCloudflare(page: Page): Promise<boolean> {
  console.log('[ANTIBOT] Cloudflare challenge detected, waiting for auto-resolve...');

  // Cloudflare typically auto-resolves in 5-10 seconds
  for (let i = 0; i < 6; i++) {
    await delay(5000);

    // Check if challenge is still present
    const stillBlocked = await page.evaluate(() => {
      const title = document.title.toLowerCase();
      return title.includes('just a moment') || title.includes('attention required');
    }).catch(() => true);

    if (!stillBlocked) {
      console.log('[ANTIBOT] Cloudflare challenge resolved');
      return true;
    }

    // Try clicking the checkbox if it appears (Turnstile)
    try {
      const checkbox = page.locator('input[type="checkbox"], .cf-turnstile iframe');
      if (await checkbox.count() > 0) {
        await checkbox.first().click().catch(() => {});
      }
    } catch {
      // No checkbox
    }
  }

  console.warn('[ANTIBOT] Cloudflare challenge did not auto-resolve after 30s');
  return false;
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
  const delays = [5000, 15000, 45000]; // Exponential backoff

  for (let i = 0; i < delays.length; i++) {
    const waitMs = retryAfterSec ? retryAfterSec * 1000 : delays[i];
    console.log(`[ANTIBOT] Rate limited, waiting ${waitMs}ms (attempt ${i + 1}/${delays.length})`);
    await delay(waitMs);

    await page.reload().catch(() => {});
    await delay(2000);

    const detection = await detectAntiBot(page);
    if (detection.type === 'none') {
      console.log('[ANTIBOT] Rate limit resolved');
      return true;
    }
  }

  console.warn('[ANTIBOT] Rate limit not resolved after all retries');
  return false;
}

/**
 * Get proxy configuration from environment.
 * Reads PROXY_LIST env var (comma-separated list of proxy URLs).
 */
export function getProxyConfig(): { server: string } | undefined {
  const proxyList = process.env.PROXY_LIST;
  if (!proxyList) return undefined;

  const proxies = proxyList.split(',').map(p => p.trim()).filter(Boolean);
  if (proxies.length === 0) return undefined;

  // Rotate through proxies
  const proxy = proxies[Math.floor(Math.random() * proxies.length)];
  return { server: proxy };
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
