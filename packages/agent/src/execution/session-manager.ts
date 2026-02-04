/**
 * Session Manager
 *
 * Manages browser sessions across tasks, with LRU eviction.
 * Saves and restores cookies + localStorage for persistent login.
 */

import type { BrowserContext, Page } from 'playwright';
import { getSupabaseClient } from '../utils/supabase.js';

interface SessionData {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
  }>;
  localStorage: Record<string, string>;
  savedAt: string;
}

interface SessionEntry {
  key: string;
  data: SessionData;
  lastUsed: number;
}

const MAX_SESSIONS = 10;

/**
 * In-memory LRU session cache, keyed by userId + domain.
 */
export class SessionManager {
  private cache: Map<string, SessionEntry> = new Map();

  private makeKey(userId: string, domain: string): string {
    return `${userId}::${domain}`;
  }

  /**
   * Serialize the current browser session (cookies + localStorage).
   */
  async serializeSession(context: BrowserContext, page: Page): Promise<SessionData> {
    const cookies = await context.cookies();

    let localStorage: Record<string, string> = {};
    try {
      localStorage = await page.evaluate(() => {
        const items: Record<string, string> = {};
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (key) {
            items[key] = window.localStorage.getItem(key) || '';
          }
        }
        return items;
      });
    } catch {
      // localStorage might not be accessible
    }

    return {
      cookies: cookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite as 'Strict' | 'Lax' | 'None',
      })),
      localStorage,
      savedAt: new Date().toISOString(),
    };
  }

  /**
   * Restore a saved session into a browser context.
   */
  async restoreSession(context: BrowserContext, page: Page, data: SessionData): Promise<void> {
    // Restore cookies
    if (data.cookies.length > 0) {
      await context.addCookies(data.cookies);
    }

    // Restore localStorage
    if (Object.keys(data.localStorage).length > 0) {
      await page.evaluate((items) => {
        for (const [key, value] of Object.entries(items)) {
          try {
            window.localStorage.setItem(key, value);
          } catch {
            // Storage might be full or restricted
          }
        }
      }, data.localStorage);
    }
  }

  /**
   * Save session to in-memory cache and optionally to database.
   */
  async saveSession(
    userId: string,
    domain: string,
    context: BrowserContext,
    page: Page,
    persist: boolean = true
  ): Promise<void> {
    const key = this.makeKey(userId, domain);
    const data = await this.serializeSession(context, page);

    // Update cache
    this.cache.set(key, { key, data, lastUsed: Date.now() });
    this.evictIfNeeded();

    // Persist to database
    if (persist) {
      try {
        await getSupabaseClient()
          .from('user_sessions')
          .upsert({
            user_id: userId,
            domain,
            session_data: data,
            last_used_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          }, { onConflict: 'user_id,domain' });
      } catch (error) {
        console.warn('[SESSION] Failed to persist session:', error);
      }
    }

    console.log(`[SESSION] Saved session for ${domain} (${data.cookies.length} cookies)`);
  }

  /**
   * Load a session from cache or database.
   */
  async loadSession(
    userId: string,
    domain: string
  ): Promise<SessionData | null> {
    const key = this.makeKey(userId, domain);

    // Check in-memory cache first
    const cached = this.cache.get(key);
    if (cached) {
      cached.lastUsed = Date.now();
      return cached.data;
    }

    // Check database
    try {
      const { data } = await getSupabaseClient()
        .from('user_sessions')
        .select('session_data')
        .eq('user_id', userId)
        .eq('domain', domain)
        .gt('expires_at', new Date().toISOString())
        .single();

      if (data?.session_data) {
        const sessionData = data.session_data as SessionData;
        // Cache it
        this.cache.set(key, { key, data: sessionData, lastUsed: Date.now() });
        this.evictIfNeeded();
        return sessionData;
      }
    } catch {
      // No saved session
    }

    return null;
  }

  /**
   * LRU eviction when cache exceeds max size.
   */
  private evictIfNeeded(): void {
    while (this.cache.size > MAX_SESSIONS) {
      let oldestKey = '';
      let oldestTime = Infinity;

      for (const [key, entry] of this.cache) {
        if (entry.lastUsed < oldestTime) {
          oldestTime = entry.lastUsed;
          oldestKey = key;
        }
      }

      if (oldestKey) {
        this.cache.delete(oldestKey);
        console.log(`[SESSION] Evicted LRU session: ${oldestKey}`);
      }
    }
  }

  /**
   * Clear all cached sessions for a user.
   */
  clearUserSessions(userId: string): void {
    for (const [key] of this.cache) {
      if (key.startsWith(`${userId}::`)) {
        this.cache.delete(key);
      }
    }
  }
}

// Singleton instance
export const sessionManager = new SessionManager();
