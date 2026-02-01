import { chromium, Browser, BrowserContext, Page } from "playwright";
import Anthropic from "@anthropic-ai/sdk";

let browser: Browser | null = null;
let anthropic: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropic) {
    anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY || "",
    });
  }
  return anthropic;
}

export async function launchBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });
  }
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

export async function createContext(): Promise<BrowserContext> {
  const b = await launchBrowser();
  return b.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 720 },
  });
}

export interface BrowseResult {
  success: boolean;
  url: string;
  title: string;
  content: string;
  error?: string;
}

export async function browse(url: string): Promise<BrowseResult> {
  const context = await createContext();
  
  try {
    const page = await context.newPage();
    
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Wait for page to settle
    await page.waitForTimeout(1000);

    const title = await page.title();
    
    // Extract main content
    const content = await page.evaluate(() => {
      // Remove script and style elements
      const scripts = document.querySelectorAll("script, style, noscript");
      scripts.forEach((s: Element) => s.remove());

      // Get main content
      const main = document.querySelector("main, article, [role='main']");
      if (main) {
        return main.textContent?.trim() || "";
      }

      // Fallback to body
      const body = document.body;
      return body.textContent?.trim() || "";
    });

    // Truncate content to reasonable length
    const truncatedContent = content.substring(0, 5000);

    await context.close();

    return {
      success: true,
      url,
      title,
      content: truncatedContent,
    };
  } catch (error) {
    await context.close();
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      url,
      title: "",
      content: "",
      error: message,
    };
  }
}

export interface ScreenshotResult {
  success: boolean;
  url: string;
  screenshot: string; // base64 encoded
  error?: string;
}

export async function screenshot(url: string): Promise<ScreenshotResult> {
  const context = await createContext();
  
  try {
    const page = await context.newPage();
    
    await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    // Wait for page to settle
    await page.waitForTimeout(2000);

    const buffer = await page.screenshot({
      type: "png",
      fullPage: false,
    });

    await context.close();

    return {
      success: true,
      url,
      screenshot: buffer.toString("base64"),
    };
  } catch (error) {
    await context.close();
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      url,
      screenshot: "",
      error: message,
    };
  }
}

export interface SearchResult {
  success: boolean;
  query: string;
  results: { title: string; url: string; snippet: string }[];
  error?: string;
}

export async function search(query: string): Promise<SearchResult> {
  const context = await createContext();
  
  try {
    const page = await context.newPage();
    
    // Use DuckDuckGo HTML (doesn't require JavaScript)
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    
    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Extract search results
    const results = await page.evaluate(() => {
      const items: { title: string; url: string; snippet: string }[] = [];
      const resultElements = document.querySelectorAll(".result");

      resultElements.forEach((el: Element) => {
        const titleEl = el.querySelector(".result__title a");
        const snippetEl = el.querySelector(".result__snippet");

        if (titleEl) {
          items.push({
            title: titleEl.textContent?.trim() || "",
            url: titleEl.getAttribute("href") || "",
            snippet: snippetEl?.textContent?.trim() || "",
          });
        }
      });

      return items.slice(0, 10);
    });

    await context.close();

    return {
      success: true,
      query,
      results,
    };
  } catch (error) {
    await context.close();
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      query,
      results: [],
      error: message,
    };
  }
}

export interface FormField {
  selector?: string;
  label?: string;
  name?: string;
  value: string;
}

export interface FillFormResult {
  success: boolean;
  url: string;
  fieldsFilledAttempted: number;
  submitted: boolean;
  screenshot?: string;
  error?: string;
}

export async function fillForm(
  url: string,
  fields: Record<string, string>
): Promise<FillFormResult> {
  const context = await createContext();
  
  try {
    const page = await context.newPage();
    
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    await page.waitForTimeout(2000);

    let filledCount = 0;

    for (const [key, value] of Object.entries(fields)) {
      try {
        // Try different strategies to find the field
        let filled = false;

        // Try by name attribute
        const byName = page.locator(`[name="${key}"]`);
        if ((await byName.count()) > 0) {
          await byName.first().fill(value);
          filled = true;
        }

        // Try by id
        if (!filled) {
          const byId = page.locator(`#${key}`);
          if ((await byId.count()) > 0) {
            await byId.first().fill(value);
            filled = true;
          }
        }

        // Try by label text
        if (!filled) {
          const byLabel = page.locator(`label:has-text("${key}")`);
          if ((await byLabel.count()) > 0) {
            const forAttr = await byLabel.first().getAttribute("for");
            if (forAttr) {
              await page.locator(`#${forAttr}`).fill(value);
              filled = true;
            }
          }
        }

        // Try by placeholder
        if (!filled) {
          const byPlaceholder = page.locator(`[placeholder*="${key}" i]`);
          if ((await byPlaceholder.count()) > 0) {
            await byPlaceholder.first().fill(value);
            filled = true;
          }
        }

        if (filled) {
          filledCount++;
        }
      } catch (e) {
        console.log(`Failed to fill field "${key}":`, e);
      }
    }

    // Take screenshot of filled form
    const screenshotBuffer = await page.screenshot({ type: "png" });

    await context.close();

    return {
      success: filledCount > 0,
      url,
      fieldsFilledAttempted: Object.keys(fields).length,
      submitted: false, // We don't auto-submit for safety
      screenshot: screenshotBuffer.toString("base64"),
    };
  } catch (error) {
    await context.close();
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      url,
      fieldsFilledAttempted: 0,
      submitted: false,
      error: message,
    };
  }
}

export interface CaptchaSolveResult {
  success: boolean;
  solution?: string;
  error?: string;
}

export async function solveCaptcha(page: Page): Promise<CaptchaSolveResult> {
  try {
    // Common CAPTCHA selectors
    const captchaSelectors = [
      'img[alt*="captcha" i]',
      'img[src*="captcha" i]',
      ".captcha-image",
      "#captcha-image",
      '[class*="captcha"] img',
    ];

    let captchaElement = null;

    for (const selector of captchaSelectors) {
      const elements = page.locator(selector);
      if ((await elements.count()) > 0) {
        captchaElement = elements.first();
        break;
      }
    }

    if (!captchaElement) {
      return {
        success: false,
        error: "No CAPTCHA found on page",
      };
    }

    // Take screenshot of just the CAPTCHA element
    const screenshotBuffer = await captchaElement.screenshot({ type: "png" });
    const base64Image = screenshotBuffer.toString("base64");

    // Send to Claude Vision
    const response = await getAnthropicClient().messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: base64Image,
              },
            },
            {
              type: "text",
              text: 'This is a CAPTCHA image. Please read and solve it. Return ONLY the text/numbers you see in the CAPTCHA, nothing else. If you cannot read it clearly, respond with "UNCLEAR".',
            },
          ],
        },
      ],
    });

    const solution = (response.content[0] as { type: string; text: string }).text?.trim();

    if (!solution || solution === "UNCLEAR") {
      return {
        success: false,
        error: "Could not solve CAPTCHA",
      };
    }

    // Try to find and fill the CAPTCHA input
    const captchaInputSelectors = [
      'input[name*="captcha" i]',
      '#captcha-input',
      '[class*="captcha"] input[type="text"]',
      'input[placeholder*="captcha" i]',
    ];

    for (const selector of captchaInputSelectors) {
      const input = page.locator(selector);
      if ((await input.count()) > 0) {
        await input.first().fill(solution);
        break;
      }
    }

    return {
      success: true,
      solution,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      error: message,
    };
  }
}

// Check if CAPTCHA is present on page
export async function detectCaptcha(page: Page): Promise<boolean> {
  const captchaIndicators = [
    'img[alt*="captcha" i]',
    'img[src*="captcha" i]',
    '[class*="captcha"]',
    '[id*="captcha"]',
    'iframe[src*="recaptcha"]',
    'iframe[src*="hcaptcha"]',
    '.g-recaptcha',
    '.h-captcha',
  ];

  for (const selector of captchaIndicators) {
    const elements = page.locator(selector);
    if ((await elements.count()) > 0) {
      return true;
    }
  }

  return false;
}
