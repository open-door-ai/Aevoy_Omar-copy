/**
 * Steel.dev Browser Service
 *
 * Manages browser sessions via Steel.dev's hosted browser infrastructure.
 * Sessions connect over CDP WebSocket for Playwright control.
 *
 * Steel hobby plan: browser sessions + CDP, no proxy, no CAPTCHA solving.
 */

import { chromium, type Browser, type Page } from 'playwright';
import { logger } from '../utils/logger.js';

const STEEL_API_KEY = process.env.STEEL_API_KEY;
const STEEL_API_URL = 'https://api.steel.dev/v1';
const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per session
const MAX_CONCURRENT = 3;

interface SteelSession {
  sessionId: string;
  browser: Browser;
  page: Page;
  createdAt: number;
}

const activeSessions = new Map<string, SteelSession>();

/**
 * Create a new Steel browser session and connect via CDP.
 * Returns a Playwright Page ready for interaction.
 */
export async function createSession(taskId: string): Promise<SteelSession> {
  if (!STEEL_API_KEY) {
    throw new Error('STEEL_API_KEY not configured');
  }
  if (activeSessions.size >= MAX_CONCURRENT) {
    throw new Error('Max concurrent browser sessions reached');
  }

  // Create Steel session via API
  const res = await fetch(`${STEEL_API_URL}/sessions`, {
    method: 'POST',
    headers: {
      'steel-api-key': STEEL_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sessionTimeout: SESSION_TIMEOUT_MS,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Steel session creation failed: ${(err as Record<string, string>).message || res.status}`);
  }

  const session = await res.json() as { id: string };
  logger.info(`[STEEL] Created session ${session.id} for task ${taskId.slice(0, 8)}`);

  // Connect via CDP WebSocket
  const wsUrl = `wss://connect.steel.dev?apiKey=${STEEL_API_KEY}&sessionId=${session.id}`;
  const browser = await chromium.connectOverCDP(wsUrl);
  const context = browser.contexts()[0];
  const page = context?.pages()[0] || await (context || await browser.newContext()).newPage();

  const steelSession: SteelSession = {
    sessionId: session.id,
    browser,
    page,
    createdAt: Date.now(),
  };

  activeSessions.set(taskId, steelSession);
  return steelSession;
}

/**
 * Destroy a Steel browser session — close the browser and release the Steel session.
 * Safe to call multiple times (idempotent).
 */
export async function destroySession(taskId: string): Promise<void> {
  const session = activeSessions.get(taskId);
  if (!session) return;

  // Close browser connection
  try {
    await session.browser.close();
  } catch (err) {
    logger.debug(`[STEEL] Browser close error for task ${taskId.slice(0, 8)} (non-critical):`, err);
  }

  // Release Steel session via API
  try {
    await fetch(`${STEEL_API_URL}/sessions/${session.sessionId}`, {
      method: 'DELETE',
      headers: { 'steel-api-key': STEEL_API_KEY! },
    });
    logger.info(`[STEEL] Destroyed session ${session.sessionId} for task ${taskId.slice(0, 8)}`);
  } catch (err) {
    logger.warn(`[STEEL] Session release failed for ${session.sessionId}:`, err);
  }

  activeSessions.delete(taskId);
}

/**
 * Get the active Playwright Page for a task, or null if no session exists.
 */
export async function getPage(taskId: string): Promise<Page | null> {
  const session = activeSessions.get(taskId);
  if (!session) return null;

  // Check if session has expired
  if (Date.now() - session.createdAt > SESSION_TIMEOUT_MS) {
    logger.warn(`[STEEL] Session expired for task ${taskId.slice(0, 8)}, destroying`);
    await destroySession(taskId);
    return null;
  }

  return session.page;
}

/**
 * Check if a task has an active browser session.
 */
export function hasSession(taskId: string): boolean {
  return activeSessions.has(taskId);
}

/**
 * Cleanup orphaned sessions that exceeded their timeout.
 * Called from scheduler or on task completion.
 */
export async function cleanupOrphanedSessions(): Promise<void> {
  const now = Date.now();
  const expiredTasks: string[] = [];

  for (const [taskId, session] of activeSessions) {
    if (now - session.createdAt > SESSION_TIMEOUT_MS + 60_000) {
      expiredTasks.push(taskId);
    }
  }

  for (const taskId of expiredTasks) {
    logger.warn({ taskId }, '[STEEL] Cleaning up orphaned browser session');
    await destroySession(taskId);
  }

  if (expiredTasks.length > 0) {
    logger.info(`[STEEL] Cleaned up ${expiredTasks.length} orphaned session(s)`);
  }
}

/**
 * Get count of active sessions (for monitoring).
 */
export function getActiveSessionCount(): number {
  return activeSessions.size;
}
