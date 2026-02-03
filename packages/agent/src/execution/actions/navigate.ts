/**
 * Navigation Actions — 8 Fallback Methods
 *
 * Never fails to navigate. If one method fails, tries the next.
 * Methods:
 * 1. Direct URL navigation
 * 2. Search engine + click result
 * 3. Menu/nav bar navigation
 * 4. Sitemap.xml parsing
 * 5. Mobile version (m.site.com)
 * 6. Cached/saved route from failure memory
 * 7. Fallback URL patterns (www vs non-www, .com vs .ca)
 * 8. Claude Vision-guided navigation
 */

import type { Page } from "playwright";
import { getFailureMemory, learnSolution } from "../../memory/failure-db.js";
import { generateVisionResponse } from "../../services/ai.js";

export interface NavigateParams {
  url?: string;
  target?: string; // Description of what we're looking for (e.g., "reservations page")
  siteDomain?: string;
}

export interface NavigateResult {
  success: boolean;
  method?: string;
  finalUrl?: string;
  error?: string;
}

/**
 * Navigate to a target with fallback chain.
 */
export async function executeNavigate(page: Page, params: NavigateParams): Promise<NavigateResult> {
  const methods: Array<{
    name: string;
    fn: () => Promise<NavigateResult>;
  }> = [
    { name: "direct_url", fn: () => directUrlNavigation(page, params) },
    { name: "cached_route", fn: () => cachedRouteNavigation(page, params) },
    { name: "search_engine", fn: () => searchEngineNavigation(page, params) },
    { name: "menu_navigation", fn: () => menuNavigation(page, params) },
    { name: "sitemap", fn: () => sitemapNavigation(page, params) },
    { name: "mobile_version", fn: () => mobileVersionNavigation(page, params) },
    { name: "fallback_urls", fn: () => fallbackUrlPatterns(page, params) },
    { name: "vision_guided", fn: () => visionGuidedNavigation(page, params) },
  ];

  for (const method of methods) {
    try {
      console.log(`[NAVIGATE] Trying method: ${method.name}`);
      const result = await method.fn();
      if (result.success) {
        console.log(`[NAVIGATE] Success with method: ${method.name} → ${result.finalUrl}`);

        // Learn this successful route
        if (params.target && result.finalUrl) {
          await learnSolution({
            site: params.siteDomain || new URL(result.finalUrl).hostname,
            actionType: "navigate",
            originalSelector: params.target,
            error: "navigation",
            solution: { method: method.name, selector: result.finalUrl },
          }).catch(() => {});
        }

        return { ...result, method: method.name };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      console.log(`[NAVIGATE] Method ${method.name} threw: ${msg}`);
    }
  }

  return { success: false, error: "All 8 navigation methods failed" };
}

// ---- Method 1: Direct URL ----

async function directUrlNavigation(page: Page, params: NavigateParams): Promise<NavigateResult> {
  if (!params.url) {
    return { success: false, error: "No URL provided" };
  }

  try {
    const response = await page.goto(params.url, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    if (!response || response.status() >= 400) {
      return { success: false, error: `HTTP ${response?.status() || "no response"}` };
    }

    return { success: true, finalUrl: page.url() };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: msg };
  }
}

// ---- Method 2: Search Engine + Click ----

async function searchEngineNavigation(page: Page, params: NavigateParams): Promise<NavigateResult> {
  const query = params.target || params.url || "";
  if (!query) {
    return { success: false, error: "No search query" };
  }

  // Add site domain to query if available
  const searchQuery = params.siteDomain
    ? `site:${params.siteDomain} ${query}`
    : query;

  const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(searchQuery)}&ia=web`;

  try {
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(2000);

    // Click first result
    const firstResult = page.locator(".result__title a, .result__a").first();
    if ((await firstResult.count()) > 0) {
      await firstResult.click();
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      return { success: true, finalUrl: page.url() };
    }

    return { success: false, error: "No search results found" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: msg };
  }
}

// ---- Method 3: Menu/Nav Bar Navigation ----

async function menuNavigation(page: Page, params: NavigateParams): Promise<NavigateResult> {
  if (!params.target) {
    return { success: false, error: "No target description for menu navigation" };
  }

  // Must already be on the site
  const currentUrl = page.url();
  if (currentUrl === "about:blank") {
    if (params.siteDomain) {
      await page.goto(`https://${params.siteDomain}`, { waitUntil: "domcontentloaded", timeout: 15000 });
    } else {
      return { success: false, error: "Not on any site" };
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
        await page.waitForLoadState("domcontentloaded").catch(() => {});
        return { success: true, finalUrl: page.url() };
      }
    } catch {
      // Selector invalid or element not interactive
    }
  }

  return { success: false, error: "Could not find target in navigation" };
}

// ---- Method 4: Sitemap.xml ----

async function sitemapNavigation(page: Page, params: NavigateParams): Promise<NavigateResult> {
  const domain = params.siteDomain || (params.url ? new URL(params.url).hostname : "");
  if (!domain) {
    return { success: false, error: "No domain for sitemap" };
  }

  try {
    const sitemapUrl = `https://${domain}/sitemap.xml`;
    const response = await page.goto(sitemapUrl, {
      waitUntil: "domcontentloaded",
      timeout: 10000,
    });

    if (!response || response.status() >= 400) {
      return { success: false, error: "No sitemap.xml found" };
    }

    const content = await page.textContent("body");
    if (!content || !params.target) {
      return { success: false, error: "Empty sitemap or no target" };
    }

    // Find URL in sitemap matching target
    const urlRegex = /https?:\/\/[^\s<>]+/g;
    const urls = content.match(urlRegex) || [];
    const target = params.target.toLowerCase();

    const matchingUrl = urls.find((u) => u.toLowerCase().includes(target));
    if (matchingUrl) {
      await page.goto(matchingUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
      return { success: true, finalUrl: page.url() };
    }

    return { success: false, error: "Target not found in sitemap" };
  } catch {
    return { success: false, error: "Sitemap navigation failed" };
  }
}

// ---- Method 5: Mobile Version ----

async function mobileVersionNavigation(page: Page, params: NavigateParams): Promise<NavigateResult> {
  const domain = params.siteDomain || (params.url ? new URL(params.url).hostname : "");
  if (!domain) {
    return { success: false, error: "No domain for mobile version" };
  }

  const mobileDomain = domain.startsWith("m.") ? domain : `m.${domain}`;
  const path = params.url ? new URL(params.url).pathname : "/";

  try {
    const mobileUrl = `https://${mobileDomain}${path}`;
    const response = await page.goto(mobileUrl, {
      waitUntil: "domcontentloaded",
      timeout: 10000,
    });

    if (response && response.status() < 400) {
      return { success: true, finalUrl: page.url() };
    }

    return { success: false, error: "Mobile site not available" };
  } catch {
    return { success: false, error: "Mobile site navigation failed" };
  }
}

// ---- Method 6: Cached Route ----

async function cachedRouteNavigation(page: Page, params: NavigateParams): Promise<NavigateResult> {
  const domain = params.siteDomain || (params.url ? new URL(params.url).hostname : "");
  if (!domain || !params.target) {
    return { success: false, error: "No domain/target for cache lookup" };
  }

  const cached = await getFailureMemory({
    site: `https://${domain}`,
    actionType: "navigate",
    selector: params.target,
  });

  if (cached?.solution?.selector) {
    try {
      await page.goto(cached.solution.selector, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      return { success: true, finalUrl: page.url() };
    } catch {
      return { success: false, error: "Cached route failed" };
    }
  }

  return { success: false, error: "No cached route available" };
}

// ---- Method 7: Fallback URL Patterns ----

async function fallbackUrlPatterns(page: Page, params: NavigateParams): Promise<NavigateResult> {
  if (!params.url) {
    return { success: false, error: "No URL for pattern fallback" };
  }

  const url = new URL(params.url);
  const variations = [
    // www vs non-www
    url.hostname.startsWith("www.")
      ? `${url.protocol}//${url.hostname.slice(4)}${url.pathname}`
      : `${url.protocol}//www.${url.hostname}${url.pathname}`,
    // .com vs .ca, .co.uk etc
    params.url.replace(/\.com/, ".ca"),
    params.url.replace(/\.com/, ".co.uk"),
    // With/without trailing slash
    params.url.endsWith("/") ? params.url.slice(0, -1) : params.url + "/",
    // HTTP vs HTTPS
    params.url.replace("https://", "http://"),
  ];

  for (const variant of variations) {
    try {
      const response = await page.goto(variant, {
        waitUntil: "domcontentloaded",
        timeout: 8000,
      });
      if (response && response.status() < 400) {
        return { success: true, finalUrl: page.url() };
      }
    } catch {
      // Try next variant
    }
  }

  return { success: false, error: "No URL variant worked" };
}

// ---- Method 8: Vision-Guided Navigation ----

async function visionGuidedNavigation(page: Page, params: NavigateParams): Promise<NavigateResult> {
  if (!process.env.ANTHROPIC_API_KEY || !params.target) {
    return { success: false, error: "Vision requires Anthropic API key and target" };
  }

  // Navigate to site root first
  const domain = params.siteDomain || (params.url ? new URL(params.url).hostname : "");
  if (domain) {
    await page.goto(`https://${domain}`, { waitUntil: "domcontentloaded", timeout: 15000 });
  }

  await page.waitForTimeout(2000);

  const screenshot = await page.screenshot({ type: "png" });
  const base64 = screenshot.toString("base64");

  const { content } = await generateVisionResponse(
    `I need to navigate to "${params.target}" on this website. Look at the page and tell me which link or button to click. Return JSON: { "selector": "css selector to click", "text": "text of the element" }. Return ONLY the JSON.`,
    base64,
    "You are helping navigate a website by analyzing a screenshot."
  );

  try {
    const guidance = JSON.parse(content);

    if (guidance.selector) {
      const el = page.locator(guidance.selector);
      if ((await el.count()) > 0) {
        await el.first().click();
        await page.waitForLoadState("domcontentloaded").catch(() => {});
        return { success: true, finalUrl: page.url() };
      }
    }

    if (guidance.text) {
      const el = page.getByText(guidance.text, { exact: false });
      if ((await el.count()) > 0) {
        await el.first().click();
        await page.waitForLoadState("domcontentloaded").catch(() => {});
        return { success: true, finalUrl: page.url() };
      }
    }

    return { success: false, error: "Vision guidance did not find element" };
  } catch {
    return { success: false, error: "Could not parse vision response" };
  }
}
