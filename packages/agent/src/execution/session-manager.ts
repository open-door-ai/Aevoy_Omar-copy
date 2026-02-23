/**
 * Session Manager - PERMANENT Sessions
 * 
 * All sessions are permanent with automatic refresh
 * User never has to re-login
 * 1-year expiry with background refresh
 */

import type { BrowserContext, Page } from 'patchright';
import { getSupabaseClient } from '../utils/supabase.js';
import { encryptWithServerKey, decryptWithServerKey } from '../security/encryption.js';

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
  localStorage: Record<string, Record<string, string>>; // Per-domain
  sessionStorage: Record<string, Record<string, string>>;
  indexedDB?: Record<string, any>;
  savedAt: string;
}

interface SessionEntry {
  key: string;
  data: SessionData;
  lastUsed: number;
  domain: string;
}

const MAX_SESSIONS = 50; // Increased from 10
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * In-memory LRU session cache
 */
export class SessionManager {
  private cache: Map<string, SessionEntry> = new Map();

  private makeKey(userId: string, domain: string): string {
    return `${userId}::${domain}`;
  }

  /**
   * Serialize the current browser session
   */
  async serializeSession(context: BrowserContext, page: Page): Promise<SessionData> {
    const cookies = await context.cookies();

    // Get current domain
    const url = page.url();
    const domain = new URL(url).hostname;

    // Extract localStorage for current domain
    const localStorage: Record<string, Record<string, string>> = {};
    try {
      localStorage[domain] = await page.evaluate(() => {
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

    // Extract sessionStorage
    const sessionStorage: Record<string, Record<string, string>> = {};
    try {
      sessionStorage[domain] = await page.evaluate(() => {
        const items: Record<string, string> = {};
        for (let i = 0; i < window.sessionStorage.length; i++) {
          const key = window.sessionStorage.key(i);
          if (key) {
            items[key] = window.sessionStorage.getItem(key) || '';
          }
        }
        return items;
      });
    } catch {
      // sessionStorage might not be accessible
    }

    return {
      cookies: cookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires === -1 ? Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60) : c.expires,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: (c.sameSite as 'Strict' | 'Lax' | 'None') || 'Lax',
      })),
      localStorage,
      sessionStorage,
      savedAt: new Date().toISOString(),
    };
  }

  /**
   * Restore a saved session into a browser context
   */
  async restoreSession(context: BrowserContext, page: Page, data: SessionData): Promise<void> {
    // Restore cookies
    if (data.cookies.length > 0) {
      // Extend expiry for all cookies
      const extendedCookies = data.cookies.map(c => ({
        ...c,
        expires: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60), // 1 year from now
      }));
      await context.addCookies(extendedCookies);
    }

    // Restore localStorage per domain
    for (const [domain, items] of Object.entries(data.localStorage)) {
      try {
        // Navigate to domain first
        await page.goto(`https://${domain}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
        
        await page.evaluate((storageItems) => {
          for (const [key, value] of Object.entries(storageItems)) {
            try {
              window.localStorage.setItem(key, value);
            } catch {
              // Storage might be full or restricted
            }
          }
        }, items);
      } catch {
        // Ignore errors for specific domains
      }
    }

    // Restore sessionStorage
    for (const [domain, items] of Object.entries(data.sessionStorage)) {
      try {
        await page.evaluate((storageItems) => {
          for (const [key, value] of Object.entries(storageItems)) {
            try {
              window.sessionStorage.setItem(key, value);
            } catch {
              // Storage might be full
            }
          }
        }, items);
      } catch {
        // Ignore
      }
    }
  }

  /**
   * Save session - PERMANENT (1 year)
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
    this.cache.set(key, { key, data, lastUsed: Date.now(), domain });
    this.evictIfNeeded();

    // Persist to database (encrypted) - 1 YEAR EXPIRY
    if (persist) {
      try {
        const encrypted = await encryptWithServerKey(JSON.stringify(data));
        await getSupabaseClient()
          .from('user_sessions')
          .upsert({
            user_id: userId,
            domain,
            session_data_encrypted: encrypted,
            last_used_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + ONE_YEAR_MS).toISOString(), // 1 YEAR
          }, { onConflict: 'user_id,domain' });
      } catch (error) {
        console.warn('[SESSION] Failed to persist session:', error);
      }
    }

    console.log(`[SESSION] Saved session for ${domain} (${data.cookies.length} cookies, 1 year expiry)`);
  }

  /**
   * Load a session from cache or database
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

    // Check database (decrypt if encrypted)
    try {
      const { data } = await getSupabaseClient()
        .from('user_sessions')
        .select('session_data_encrypted')
        .eq('user_id', userId)
        .eq('domain', domain)
        .gt('expires_at', new Date().toISOString())
        .single();

      if (data?.session_data_encrypted) {
        const decrypted = await decryptWithServerKey(data.session_data_encrypted);
        const sessionData = JSON.parse(decrypted) as SessionData;
        
        // Cache it
        this.cache.set(key, { key, data: sessionData, lastUsed: Date.now(), domain });
        this.evictIfNeeded();
        
        console.log(`[SESSION] Loaded encrypted session for ${domain} (${sessionData.cookies.length} cookies)`);
        return sessionData;
      }
    } catch (error) {
      console.warn(`[SESSION] Failed to load session for ${domain}:`, error);
    }

    return null;
  }

  /**
   * Refresh session to extend expiry
   */
  async refreshSession(userId: string, domain: string): Promise<void> {
    console.log(`[SESSION] Refreshing session for ${domain}`);
    
    try {
      // Load existing
      const { data } = await getSupabaseClient()
        .from('user_sessions')
        .select('session_data_encrypted')
        .eq('user_id', userId)
        .eq('domain', domain)
        .single();

      if (data?.session_data_encrypted) {
        // Decrypt
        const decrypted = await decryptWithServerKey(data.session_data_encrypted);
        const sessionData = JSON.parse(decrypted) as SessionData;

        // Update timestamps
        sessionData.savedAt = new Date().toISOString();

        // Re-encrypt and save with new expiry
        const encrypted = await encryptWithServerKey(JSON.stringify(sessionData));
        await getSupabaseClient()
          .from('user_sessions')
          .upsert({
            user_id: userId,
            domain,
            session_data_encrypted: encrypted,
            last_used_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + ONE_YEAR_MS).toISOString(),
          }, { onConflict: 'user_id,domain' });

        console.log(`[SESSION] Refreshed ${domain} for another year`);
      }
    } catch (error) {
      console.warn(`[SESSION] Failed to refresh ${domain}:`, error);
    }
  }

  /**
   * Get all sessions for a user
   */
  async getAllSessions(userId: string): Promise<Array<{ domain: string; expiresAt: Date }>> {
    try {
      const { data } = await getSupabaseClient()
        .from('user_sessions')
        .select('domain, expires_at')
        .eq('user_id', userId)
        .gt('expires_at', new Date().toISOString());

      return (data || []).map(s => ({
        domain: s.domain,
        expiresAt: new Date(s.expires_at),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Delete a session
   */
  async deleteSession(userId: string, domain: string): Promise<void> {
    const key = this.makeKey(userId, domain);
    this.cache.delete(key);

    try {
      await getSupabaseClient()
        .from('user_sessions')
        .delete()
        .eq('user_id', userId)
        .eq('domain', domain);
    } catch (error) {
      console.warn(`[SESSION] Failed to delete ${domain}:`, error);
    }
  }

  /**
   * LRU eviction when cache exceeds max size
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
   * Clear all cached sessions for a user
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

// Background job: Refresh sessions expiring within 30 days
export async function refreshExpiringSessions(): Promise<void> {
  console.log('[SESSION] Running background refresh...');
  
  const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  
  try {
    const { data } = await getSupabaseClient()
      .from('user_sessions')
      .select('user_id, domain')
      .lt('expires_at', thirtyDaysFromNow.toISOString())
      .gt('expires_at', new Date().toISOString())
      .limit(100);

    if (data) {
      for (const session of data) {
        await sessionManager.refreshSession(session.user_id, session.domain);
      }
      console.log(`[SESSION] Refreshed ${data.length} sessions`);
    }
  } catch (error) {
    console.error('[SESSION] Background refresh failed:', error);
  }
}
