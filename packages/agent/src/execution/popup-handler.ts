/**
 * Popup & Overlay Handler
 *
 * Dismisses cookie banners, modals, newsletter popups, and chat widgets
 * that block page interaction. Also blocks ad networks.
 */

import type { Page, BrowserContext } from 'playwright';

// Common cookie banner selectors
const COOKIE_BANNER_SELECTORS = [
  '#onetrust-accept-btn-handler',
  '#onetrust-accept-btn',
  '.cookie-banner button',
  '.cookie-consent button',
  '#cookie-accept',
  '#accept-cookies',
  '#acceptCookies',
  'button[data-cookiebanner="accept_button"]',
  '.cc-btn.cc-allow',
  '.cc-accept',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  '#CybotCookiebotDialogBodyButtonAccept',
  'button:has-text("Accept all")',
  'button:has-text("Accept cookies")',
  'button:has-text("Accept All Cookies")',
  'button:has-text("I agree")',
  'button:has-text("Got it")',
  'button:has-text("Allow all")',
  'button:has-text("OK")',
  '[aria-label="Accept cookies"]',
  '[aria-label="Close cookie banner"]',
  '.gdpr-accept',
  '#gdpr-accept',
  '.consent-accept',
];

// Common modal/popup selectors
const MODAL_CLOSE_SELECTORS = [
  '[role="dialog"] button[aria-label="Close"]',
  '[role="dialog"] button[aria-label="Dismiss"]',
  '[role="dialog"] .close-button',
  '[role="dialog"] .close',
  '.modal button[aria-label="Close"]',
  '.modal .close',
  '.modal-close',
  '.popup-close',
  '[data-dismiss="modal"]',
  '.overlay-close',
  'button[aria-label="Close dialog"]',
  'button[aria-label="Close modal"]',
];

// Newsletter popup selectors
const NEWSLETTER_CLOSE_SELECTORS = [
  '.newsletter-popup button.close',
  '.newsletter-modal button.close',
  '.email-popup button.close',
  '[class*="newsletter"] button[aria-label="Close"]',
  '[class*="subscribe"] button[aria-label="Close"]',
  'button:has-text("No thanks")',
  'button:has-text("No, thanks")',
  'button:has-text("Maybe later")',
  'a:has-text("No thanks")',
];

// Chat widget selectors
const CHAT_WIDGET_SELECTORS = [
  '#intercom-close',
  '.intercom-lightweight-app-launcher',
  '[data-testid="close-button"]',
  '.drift-widget-controller',
  '#hubspot-messages-iframe-container button.close',
  '.crisp-client .crisp-1swadon',
  '#tidio-chat .close-button',
  'button[aria-label="Close live chat"]',
  'button[aria-label="Minimize chat"]',
];

// Ad network domains to block
const AD_DOMAINS = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'google-analytics.com',
  'facebook.net',
  'facebook.com/tr',
  'analytics.tiktok.com',
  'connect.facebook.net',
  'adservice.google.com',
  'pagead2.googlesyndication.com',
  'cdn.taboola.com',
  'cdn.outbrain.com',
  'ads.linkedin.com',
  'bat.bing.com',
  'snap.licdn.com',
];

/**
 * Dismiss all popups, cookie banners, modals, and overlays on a page.
 * Returns the number of popups dismissed.
 */
export async function dismissPopups(page: Page): Promise<number> {
  let dismissed = 0;

  const allSelectors = [
    ...COOKIE_BANNER_SELECTORS,
    ...MODAL_CLOSE_SELECTORS,
    ...NEWSLETTER_CLOSE_SELECTORS,
    ...CHAT_WIDGET_SELECTORS,
  ];

  for (const selector of allSelectors) {
    try {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 200 }).catch(() => false)) {
        await el.click({ timeout: 1000 }).catch(() => {});
        dismissed++;
        // Brief wait for animation
        await page.waitForTimeout(300);
      }
    } catch {
      // Selector not found or not clickable, continue
    }
  }

  // Also try to dismiss via Escape key if a dialog is focused
  if (dismissed === 0) {
    try {
      const hasDialog = await page.locator('[role="dialog"]:visible').count();
      if (hasDialog > 0) {
        await page.keyboard.press('Escape');
        dismissed++;
      }
    } catch {
      // No dialog
    }
  }

  if (dismissed > 0) {
    console.log(`[POPUP] Dismissed ${dismissed} popup(s)/overlay(s)`);
  }

  return dismissed;
}

/**
 * Set up ad blocking by intercepting requests to known ad networks.
 */
export async function setupAdBlocking(context: BrowserContext): Promise<void> {
  for (const domain of AD_DOMAINS) {
    await context.route(`**/*${domain}*`, (route) => {
      route.abort().catch(() => {});
    });
  }
  console.log(`[ADBLOCK] Blocking ${AD_DOMAINS.length} ad domains`);
}

/**
 * Remove overlay elements that might block interaction via JS.
 */
export async function removeOverlays(page: Page): Promise<void> {
  await page.evaluate(() => {
    // Remove elements with high z-index that cover the page
    const allElements = Array.from(document.querySelectorAll('*'));
    for (const el of allElements) {
      const style = window.getComputedStyle(el);
      const zIndex = parseInt(style.zIndex || '0', 10);
      if (
        zIndex > 9000 &&
        style.position === 'fixed' &&
        (el as HTMLElement).offsetHeight > window.innerHeight * 0.3
      ) {
        (el as HTMLElement).style.display = 'none';
      }
    }

    // Remove body scroll locks
    document.body.style.overflow = 'auto';
    document.body.style.position = 'static';
    document.documentElement.style.overflow = 'auto';
  }).catch(() => {});
}
