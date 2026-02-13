/**
 * Navigation Actions - 8 Fallback Methods
 *
 * Never fails to navigate. If one method fails, tries the next.
 * Simplified version for Omar's Personal AI Assistant.
 */

import type { Page } from 'playwright';

export interface NavigateParams {
  url?: string;
  target?: string; // Description of what we're looking for
  siteDomain?: string;
}

export interface NavigateResult {
  success: boolean;
  method?: string;
  finalUrl?: string;
  error?: string;
}

export async function executeNavigate(page: Page, params: NavigateParams): Promise<NavigateResult> {
  const methods: Array<{
    name: string;
    fn: () => Promise<NavigateResult>;
  }> = [
    { name: 'direct_url', fn: () => directUrlNavigation(page, params) },
    { name: 'search_engine', fn: () => searchEngineNavigation(page, params) },
    { name: 'menu_navigation', fn: () => menuNavigation(page, params) },
    { name: 'mobile_version', fn: () => mobileVersionNavigation(page, params) },
    { name: 'fallback_urls', fn: () => fallbackUrlPatterns(page, params) },
  ];

  for (const method of methods) {
    try {
      console.log(`[NAVIGATE] Trying method: ${method.name}`);
      const result = await method.fn();
      if (result.success) {
        console.log(`[NAVIGATE] Success with method: ${method.name} → ${result.finalUrl}`);
        return { ...result, method: method.name };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.log(`[NAVIGATE] Method ${method.name} threw: ${msg}`);
    }
  }

  return { success: false, error: 'All navigation methods failed' };
}

// Method 1: Direct URL
async function directUrlNavigation(page: Page, params: NavigateParams): Promise<NavigateResult> {
  if (!params.url) {
    return { success: false, error: 'No URL provided' };
  }

  // Auto-prepend https:// if missing
  let url = params.url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }

  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    if (!response || response.status() >= 400) {
      return { success: false, error: `HTTP ${response?.status() || 'no response'}` };
    }

    return { success: true, finalUrl: page.url() };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: msg };
  }
}

// Method 2: Search Engine + Click
async function searchEngineNavigation(page: Page, params: NavigateParams): Promise<NavigateResult> {
  const query = params.target || params.url || '';
  if (!query) {
    return { success: false, error: 'No search query' };
  }

  const searchQuery = params.siteDomain
    ? `site:${params.siteDomain} ${query}`
    : query;

  const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(searchQuery)}&ia=web`;

  try {
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);

    // Click first result
    const firstResult = page.locator('.result__title a, .result__a').first();
    if ((await firstResult.count()) > 0) {
      await firstResult.click();
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      return { success: true, finalUrl: page.url() };
    }

    return { success: false, error: 'No search results found' };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: msg };
  }
}

// Method 3: Menu/Nav Bar Navigation
async function menuNavigation(page: Page, params: NavigateParams): Promise<NavigateResult> {
  if (!params.target) {
    return { success: false, error: 'No target description for menu navigation' };
  }

  // Must already be on the site
  const currentUrl = page.url();
  if (currentUrl === 'about:blank') {
    if (params.siteDomain) {
      await page.goto(`https://${params.siteDomain}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } else {
      return { success: false, error: 'Not on any site' };
    }
  }

  const target = params.target.toLowerCase();

  // Look for nav links matching the target
  const navSelectors = [
    `nav a:has-text("${target}")`,
    `header a:has-text("${target}")`,
    `a[href*="${target}"]`,
    `a:has-text("${target}")`,
    `.menu a:has-text("${target}")`,
    `.nav a:has-text("${target}")`,
  ];

  for (const sel of navSelectors) {
    try {
      const el = page.locator(sel);
      if ((await el.count()) > 0) {
        await el.first().click();
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        return { success: true, finalUrl: page.url() };
      }
    } catch {
      // Selector invalid or element not interactive
    }
  }

  return { success: false, error: 'Could not find target in navigation' };
}

// Method 4: Mobile Version
async function mobileVersionNavigation(page: Page, params: NavigateParams): Promise<NavigateResult> {
  const domain = params.siteDomain || (params.url ? new URL(params.url).hostname : '');
  if (!domain) {
    return { success: false, error: 'No domain for mobile version' };
  }

  const mobileDomain = domain.startsWith('m.') ? domain : `m.${domain}`;
  const path = params.url ? new URL(params.url).pathname : '/';

  try {
    const mobileUrl = `https://${mobileDomain}${path}`;
    const response = await page.goto(mobileUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    });

    if (response && response.status() < 400) {
      return { success: true, finalUrl: page.url() };
    }

    return { success: false, error: 'Mobile site not available' };
  } catch {
    return { success: false, error: 'Mobile site navigation failed' };
  }
}

// Method 5: Fallback URL Patterns
async function fallbackUrlPatterns(page: Page, params: NavigateParams): Promise<NavigateResult> {
  if (!params.url) {
    return { success: false, error: 'No URL for pattern fallback' };
  }

  const url = new URL(params.url);
  const variations = [
    // www vs non-www
    url.hostname.startsWith('www.')
      ? `${url.protocol}//${url.hostname.slice(4)}${url.pathname}`
      : `${url.protocol}//www.${url.hostname}${url.pathname}`,
    // With/without trailing slash
    params.url.endsWith('/') ? params.url.slice(0, -1) : params.url + '/',
  ];

  for (const variant of variations) {
    try {
      const response = await page.goto(variant, {
        waitUntil: 'domcontentloaded',
        timeout: 8000,
      });
      if (response && response.status() < 400) {
        return { success: true, finalUrl: page.url() };
      }
    } catch {
      // Try next variant
    }
  }

  return { success: false, error: 'No URL variant worked' };
}
