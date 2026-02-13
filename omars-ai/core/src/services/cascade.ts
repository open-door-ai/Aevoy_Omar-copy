/**
 * Cascade System - Multi-tier execution with fallbacks
 * Part of OpenClaw feature set
 *
 * Tiers:
 * 1. API Skills (instant, free)
 * 2. Cached Browser Session (fast, cheap)
 * 3. New Browser Session (slow, expensive)
 * 4. Email Fallback (requires human)
 * 5. Manual Fallback (human handoff)
 */

import { Page, chromium } from 'playwright';

export type CascadeLevel = 'api' | 'browser_cached' | 'browser_new' | 'email' | 'manual';

export interface CascadeResult {
  success: boolean;
  level: CascadeLevel;
  message: string;
  cost: number;
  durationMs: number;
  data?: any;
}

interface CascadeContext {
  taskDescription: string;
  userId: string;
  attemptedLevels: CascadeLevel[];
  startTime: number;
}

// Browser session cache (reuse browsers for same user)
const browserSessions: Map<string, { browser: any; page: Page; lastUsed: number }> = new Map();
const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function executeCascade(taskDescription: string, userId: string): Promise<CascadeResult> {
  const context: CascadeContext = {
    taskDescription,
    userId,
    attemptedLevels: [],
    startTime: Date.now(),
  };

  console.log(`[CASCADE] Starting cascade for user ${userId}`);

  // Tier 1: Try API Skills (not implemented yet)
  // const apiResult = await tryAPISkills(context);
  // if (apiResult.success) return apiResult;

  // Tier 2: Try cached browser session
  const cachedResult = await tryCachedBrowser(context);
  if (cachedResult.success) return cachedResult;

  // Tier 3: Try new browser session
  const newBrowserResult = await tryNewBrowser(context);
  if (newBrowserResult.success) return newBrowserResult;

  // Tier 4: Email fallback
  return await emailFallback(context);
}

async function tryCachedBrowser(context: CascadeContext): Promise<CascadeResult> {
  const startTime = Date.now();
  context.attemptedLevels.push('browser_cached');

  try {
    const session = browserSessions.get(context.userId);

    // Check if session exists and is fresh
    if (session && Date.now() - session.lastUsed < SESSION_TTL_MS) {
      console.log(`[CASCADE] 🔄 Using cached browser for ${context.userId}`);

      // Update last used
      session.lastUsed = Date.now();

      // Execute task (simplified - would use AutonomousExecutor)
      const page = session.page;
      await page.evaluate(() => document.title);

      return {
        success: true,
        level: 'browser_cached',
        message: 'Executed using cached browser session',
        cost: 0.0001, // Very cheap
        durationMs: Date.now() - startTime,
      };
    } else {
      console.log(`[CASCADE] ❌ No valid cached browser for ${context.userId}`);
      return {
        success: false,
        level: 'browser_cached',
        message: 'No cached session available',
        cost: 0,
        durationMs: Date.now() - startTime,
      };
    }
  } catch (error: any) {
    console.error(`[CASCADE] ❌ Cached browser failed:`, error.message);
    return {
      success: false,
      level: 'browser_cached',
      message: error.message,
      cost: 0,
      durationMs: Date.now() - startTime,
    };
  }
}

async function tryNewBrowser(context: CascadeContext): Promise<CascadeResult> {
  const startTime = Date.now();
  context.attemptedLevels.push('browser_new');

  let browser = null;

  try {
    console.log(`[CASCADE] 🌐 Launching new browser for ${context.userId}`);

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const browserContext = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    });

    const page = await browserContext.newPage();

    // Cache the session for reuse
    browserSessions.set(context.userId, {
      browser,
      page,
      lastUsed: Date.now(),
    });

    // Execute task (simplified)
    await page.goto('https://www.google.com', { waitUntil: 'networkidle', timeout: 30000 });

    return {
      success: true,
      level: 'browser_new',
      message: 'Executed using new browser session',
      cost: 0.001, // More expensive
      durationMs: Date.now() - startTime,
    };
  } catch (error: any) {
    console.error(`[CASCADE] ❌ New browser failed:`, error.message);

    if (browser) {
      await browser.close().catch(() => {});
    }

    return {
      success: false,
      level: 'browser_new',
      message: error.message,
      cost: 0.001,
      durationMs: Date.now() - startTime,
    };
  }
}

async function emailFallback(context: CascadeContext): Promise<CascadeResult> {
  const startTime = Date.now();
  context.attemptedLevels.push('email');

  console.log(`[CASCADE] 📧 Email fallback for ${context.userId}`);

  // Would send email to user asking for manual intervention
  return {
    success: true,
    level: 'email',
    message: `I need your help with this task. I've tried: ${context.attemptedLevels.join(' → ')}. Please confirm or provide more details.`,
    cost: 0,
    durationMs: Date.now() - startTime,
  };
}

// Cleanup old sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [userId, session] of browserSessions.entries()) {
    if (now - session.lastUsed > SESSION_TTL_MS) {
      console.log(`[CASCADE] 🧹 Cleaning up old browser session for ${userId}`);
      session.browser.close().catch(() => {});
      browserSessions.delete(userId);
    }
  }
}, 60000); // Every minute
