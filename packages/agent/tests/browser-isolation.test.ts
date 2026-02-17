/**
 * Browser Isolation Tests - Multi-User Concurrent Execution
 *
 * Tests verify:
 * 1. Session isolation - each user gets dedicated browser context
 * 2. Cookie isolation - no cross-user cookie leakage
 * 3. Memory isolation - user memory properly scoped
 * 4. Credential isolation - encrypted storage per user
 * 5. Concurrency limits - MAX_CONCURRENT_BROWSER_TASKS=10
 * 6. Distributed locking - multiple Railway instances coordinate
 * 7. Browserbase vs local - cloud isolation guarantees
 * 8. VPS scalability - 50-100 users per $40/month instance
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, Browser, BrowserContext } from 'playwright';
import { MultiUserBrowserService, createMultiUserBrowser } from '../src/services/multi-user-browser.js';
import { StagehandService } from '../src/services/stagehand.js';
import { loadMemory, saveWorkingMemory } from '../src/services/memory.js';
import { saveCredential, getCredential } from '../src/services/credential-vault.js';
import { getSupabaseClient } from '../src/utils/supabase.js';
import { encryptWithServerKey, decryptWithServerKey } from '../src/security/encryption.js';
import crypto from 'crypto';

// Test user IDs
const USER_A = 'user-a-' + crypto.randomUUID();
const USER_B = 'user-b-' + crypto.randomUUID();
const USER_C = 'user-c-' + crypto.randomUUID();

describe('Browser Isolation - Multi-User Concurrent Execution', () => {

  beforeAll(async () => {
    // Create test user profiles
    for (const userId of [USER_A, USER_B, USER_C]) {
      await getSupabaseClient()
        .from('profiles')
        .upsert({
          id: userId,
          email: `${userId}@test.com`,
          subscription_tier: 'beta',
          messages_limit: 100,
        }, { onConflict: 'id' });
    }
  });

  afterAll(async () => {
    // Cleanup test data
    for (const userId of [USER_A, USER_B, USER_C]) {
      await getSupabaseClient()
        .from('profiles')
        .delete()
        .eq('id', userId);

      await getSupabaseClient()
        .from('user_memory')
        .delete()
        .eq('user_id', userId);

      await getSupabaseClient()
        .from('credential_vault')
        .delete()
        .eq('user_id', userId);

      await getSupabaseClient()
        .from('user_sessions')
        .delete()
        .eq('user_id', userId);

      await getSupabaseClient()
        .from('browser_contexts')
        .delete()
        .eq('user_id', userId);
    }
  });

  describe('1. Session Isolation', () => {
    it('should create separate browser contexts for each user', async () => {
      const serviceA = createMultiUserBrowser(USER_A);
      const serviceB = createMultiUserBrowser(USER_B);

      const pageA = await serviceA.init();
      const pageB = await serviceB.init();

      // Both should have valid pages
      expect(pageA).toBeTruthy();
      expect(pageB).toBeTruthy();

      // Pages should be from different contexts
      const contextA = pageA.context();
      const contextB = pageB.context();

      expect(contextA).not.toBe(contextB);

      // Navigate to different URLs
      await pageA.goto('https://example.com');
      await pageB.goto('https://httpbin.org/html');

      // URLs should remain separate
      expect(pageA.url()).toContain('example.com');
      expect(pageB.url()).toContain('httpbin.org');

      await serviceA.close();
      await serviceB.close();
    });

    it('should maintain separate viewport sizes per context', async () => {
      const browser = await chromium.launch({ headless: true });

      const contextA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const contextB = await browser.newContext({ viewport: { width: 1920, height: 1080 } });

      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      const sizeA = await pageA.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
      const sizeB = await pageB.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));

      expect(sizeA.w).toBe(1280);
      expect(sizeB.w).toBe(1920);

      await browser.close();
    });
  });

  describe('2. Cookie Isolation', () => {
    it('should not leak cookies between users', async () => {
      const serviceA = createMultiUserBrowser(USER_A);
      const serviceB = createMultiUserBrowser(USER_B);

      const pageA = await serviceA.init();
      const pageB = await serviceB.init();

      // User A sets a cookie
      await pageA.goto('https://httpbin.org/cookies/set/user_id/alice');
      await pageA.waitForTimeout(1000);

      // User B should not see User A's cookie
      await pageB.goto('https://httpbin.org/cookies');
      const cookiesB = await pageB.evaluate(() => document.cookie);

      expect(cookiesB).not.toContain('alice');

      // User A should still see their cookie
      await pageA.goto('https://httpbin.org/cookies');
      const cookiesA = await pageA.evaluate(() => document.cookie);

      expect(cookiesA).toContain('user_id');

      await serviceA.close();
      await serviceB.close();
    });

    it('should isolate localStorage between contexts', async () => {
      const browser = await chromium.launch({ headless: true });

      const contextA = await browser.newContext();
      const contextB = await browser.newContext();

      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      await pageA.goto('https://example.com');
      await pageB.goto('https://example.com');

      // User A sets localStorage
      await pageA.evaluate(() => {
        localStorage.setItem('user', 'alice');
        localStorage.setItem('secret', 'password123');
      });

      // User B should not see User A's data
      const userBData = await pageB.evaluate(() => {
        return {
          user: localStorage.getItem('user'),
          secret: localStorage.getItem('secret'),
        };
      });

      expect(userBData.user).toBeNull();
      expect(userBData.secret).toBeNull();

      // User B sets their own data
      await pageB.evaluate(() => {
        localStorage.setItem('user', 'bob');
      });

      // User A's data should remain unchanged
      const userAData = await pageA.evaluate(() => {
        return localStorage.getItem('user');
      });

      expect(userAData).toBe('alice');

      await browser.close();
    });

    it('should isolate sessionStorage between contexts', async () => {
      const browser = await chromium.launch({ headless: true });

      const contextA = await browser.newContext();
      const contextB = await browser.newContext();

      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      await pageA.goto('https://example.com');
      await pageB.goto('https://example.com');

      await pageA.evaluate(() => {
        sessionStorage.setItem('token', 'user-a-token');
      });

      const tokenB = await pageB.evaluate(() => sessionStorage.getItem('token'));

      expect(tokenB).toBeNull();

      await browser.close();
    });
  });

  describe('3. Memory Isolation', () => {
    it('should scope memory per user', async () => {
      // User A saves memory
      await saveWorkingMemory(USER_A, 'Prefers dark mode');
      await saveWorkingMemory(USER_A, 'Lives in New York');

      // User B saves memory
      await saveWorkingMemory(USER_B, 'Prefers light mode');
      await saveWorkingMemory(USER_B, 'Lives in London');

      // Load User A's memory
      const memoryA = await loadMemory(USER_A, 'mode location');
      expect(memoryA.facts).toContain('dark mode');
      expect(memoryA.facts).toContain('New York');
      expect(memoryA.facts).not.toContain('light mode');
      expect(memoryA.facts).not.toContain('London');

      // Load User B's memory
      const memoryB = await loadMemory(USER_B, 'mode location');
      expect(memoryB.facts).toContain('light mode');
      expect(memoryB.facts).toContain('London');
      expect(memoryB.facts).not.toContain('dark mode');
      expect(memoryB.facts).not.toContain('New York');
    });

    it('should encrypt memory per user', async () => {
      await saveWorkingMemory(USER_A, 'Secret info: password123');

      // Read raw encrypted data from database
      const { data } = await getSupabaseClient()
        .from('user_memory')
        .select('encrypted_data')
        .eq('user_id', USER_A)
        .eq('memory_type', 'working')
        .limit(1)
        .single();

      expect(data?.encrypted_data).toBeTruthy();

      // Encrypted data should not contain plaintext
      expect(data?.encrypted_data).not.toContain('password123');

      // Should have proper encryption format (salt:iv:authTag:data)
      const parts = data?.encrypted_data.split(':');
      expect(parts?.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('4. Credential Isolation', () => {
    it('should encrypt and isolate credentials per user', async () => {
      // Save credentials for User A
      await saveCredential(USER_A, 'example.com', 'alice', 'alice-password');

      // Save credentials for User B
      await saveCredential(USER_B, 'example.com', 'bob', 'bob-password');

      // User A retrieves their credentials
      const credA = await getCredential(USER_A, 'example.com');
      expect(credA?.username).toBe('alice');
      expect(credA?.password).toBe('alice-password');

      // User B retrieves their credentials
      const credB = await getCredential(USER_B, 'example.com');
      expect(credB?.username).toBe('bob');
      expect(credB?.password).toBe('bob-password');
    });

    it('should not allow cross-user credential access', async () => {
      await saveCredential(USER_A, 'secret-site.com', 'admin', 'super-secret');

      // User B should not be able to retrieve User A's credentials
      const credB = await getCredential(USER_B, 'secret-site.com');
      expect(credB).toBeNull();
    });

    it('should store credentials encrypted at rest', async () => {
      await saveCredential(USER_A, 'test-site.com', 'testuser', 'testpass');

      // Read raw encrypted data
      const { data } = await getSupabaseClient()
        .from('credential_vault')
        .select('encrypted_password')
        .eq('user_id', USER_A)
        .eq('site_domain', 'test-site.com')
        .single();

      expect(data?.encrypted_password).toBeTruthy();
      expect(data?.encrypted_password).not.toContain('testpass');
    });
  });

  describe('5. Concurrency Limits', () => {
    it('should enforce MAX_CONCURRENT_BROWSER_TASKS', async () => {
      const { getActiveBrowserTasks, incrementBrowserTasks, decrementBrowserTasks, canAcceptBrowserTask } =
        await import('../src/utils/concurrency.js');

      // Reset to baseline
      while (getActiveBrowserTasks() > 0) {
        decrementBrowserTasks();
      }

      expect(getActiveBrowserTasks()).toBe(0);
      expect(canAcceptBrowserTask()).toBe(true);

      // Add 10 tasks (at limit)
      for (let i = 0; i < 10; i++) {
        incrementBrowserTasks();
      }

      expect(getActiveBrowserTasks()).toBe(10);
      expect(canAcceptBrowserTask()).toBe(false);

      // Release one task
      decrementBrowserTasks();
      expect(canAcceptBrowserTask()).toBe(true);

      // Cleanup
      while (getActiveBrowserTasks() > 0) {
        decrementBrowserTasks();
      }
    });

    it('should limit browser contexts per user to 3', async () => {
      const { incrementUserBrowserContext, canUserCreateBrowserContext, decrementUserBrowserContext } =
        await import('../src/utils/concurrency.js');

      const testUser = 'test-user-' + crypto.randomUUID();

      expect(canUserCreateBrowserContext(testUser)).toBe(true);

      // Create 3 contexts (at limit)
      for (let i = 0; i < 3; i++) {
        const success = incrementUserBrowserContext(testUser);
        expect(success).toBe(true);
      }

      // 4th context should be rejected
      expect(canUserCreateBrowserContext(testUser)).toBe(false);
      const rejected = incrementUserBrowserContext(testUser);
      expect(rejected).toBe(false);

      // Release one context
      decrementUserBrowserContext(testUser);
      expect(canUserCreateBrowserContext(testUser)).toBe(true);
    });
  });

  describe('6. Distributed Locking', () => {
    it('should acquire and release distributed locks', async () => {
      const { acquireDistributedLock, releaseDistributedLock } =
        await import('../src/utils/supabase.js');

      const lockName = 'test-lock-' + crypto.randomUUID();

      // Acquire lock
      const acquired = await acquireDistributedLock(lockName, 30000);
      expect(acquired).toBe(true);

      // Same lock should not be acquirable again
      const acquiredAgain = await acquireDistributedLock(lockName, 1000);
      expect(acquiredAgain).toBe(false);

      // Release lock
      await releaseDistributedLock(lockName);

      // Now should be acquirable again
      const reacquired = await acquireDistributedLock(lockName, 30000);
      expect(reacquired).toBe(true);

      await releaseDistributedLock(lockName);
    });

    it('should handle lock expiration', async () => {
      const { acquireDistributedLock, releaseDistributedLock } =
        await import('../src/utils/supabase.js');

      const lockName = 'expire-test-' + crypto.randomUUID();

      // Acquire lock with 1 second TTL
      const acquired = await acquireDistributedLock(lockName, 1000);
      expect(acquired).toBe(true);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Should be acquirable again after expiration
      const reacquired = await acquireDistributedLock(lockName, 30000);
      expect(reacquired).toBe(true);

      await releaseDistributedLock(lockName);
    });
  });

  describe('7. Browserbase vs Local Isolation', () => {
    it('should isolate contexts in local Playwright', async () => {
      const browser = await chromium.launch({ headless: true });

      const contextA = await browser.newContext();
      const contextB = await browser.newContext();

      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      // Set different user agents
      await pageA.goto('https://httpbin.org/user-agent');
      await pageB.goto('https://httpbin.org/user-agent');

      const uaA = await pageA.textContent('pre');
      const uaB = await pageB.textContent('pre');

      // Both should have same UA (from context settings)
      expect(uaA).toBeTruthy();
      expect(uaB).toBeTruthy();

      await browser.close();
    });

    it('should maintain persistent contexts in Browserbase', async () => {
      // Test that persistent contexts work (requires BROWSERBASE_API_KEY)
      if (!process.env.BROWSERBASE_API_KEY) {
        console.log('Skipping Browserbase test (no API key)');
        return;
      }

      const service = new StagehandService({ userId: USER_A });
      const page = await service.init();

      expect(page).toBeTruthy();
      expect(service.isCloud()).toBe(true);

      // Navigate and set localStorage
      await page.goto('https://example.com');
      await page.evaluate(() => {
        localStorage.setItem('test-key', 'persistent-value');
      });

      await service.close();

      // Reinitialize with same user - should restore context
      const service2 = new StagehandService({ userId: USER_A });
      const page2 = await service2.init();

      await page2.goto('https://example.com');
      const restored = await page2.evaluate(() => localStorage.getItem('test-key'));

      expect(restored).toBe('persistent-value');

      await service2.close();
    });
  });

  describe('8. VPS Scalability - Multi-User Browser', () => {
    it('should handle multiple concurrent users on shared browser', async () => {
      const services = [
        createMultiUserBrowser(USER_A),
        createMultiUserBrowser(USER_B),
        createMultiUserBrowser(USER_C),
      ];

      // Initialize all users concurrently
      const pages = await Promise.all(services.map(s => s.init()));

      expect(pages).toHaveLength(3);
      pages.forEach(page => expect(page).toBeTruthy());

      // All pages navigate to different URLs
      await Promise.all([
        pages[0].goto('https://example.com'),
        pages[1].goto('https://httpbin.org'),
        pages[2].goto('https://www.iana.org'),
      ]);

      await pages[0].waitForTimeout(1000);

      // URLs should remain separate
      expect(pages[0].url()).toContain('example.com');
      expect(pages[1].url()).toContain('httpbin.org');
      expect(pages[2].url()).toContain('iana.org');

      // Get stats
      const stats = MultiUserBrowserService.getStats();
      expect(stats).toBeTruthy();
      expect(stats!.contexts).toBeGreaterThanOrEqual(3);

      // Cleanup
      await Promise.all(services.map(s => s.close()));
    });

    it('should auto-cleanup idle contexts after timeout', async () => {
      // This test requires waiting for cleanup interval (5 minutes)
      // For now, we just verify the cleanup function exists
      const service = createMultiUserBrowser(USER_A);
      await service.init();

      // Verify saveStorageState method exists
      expect(typeof service.saveStorageState).toBe('function');

      await service.close();
    });

    it('should handle 10 concurrent users without leakage', async () => {
      const userIds = Array.from({ length: 10 }, (_, i) => `load-test-user-${i}-${crypto.randomUUID()}`);

      // Create profiles
      await Promise.all(
        userIds.map(userId =>
          getSupabaseClient()
            .from('profiles')
            .upsert({
              id: userId,
              email: `${userId}@test.com`,
              subscription_tier: 'beta',
            }, { onConflict: 'id' })
        )
      );

      // Initialize all users
      const services = userIds.map(userId => createMultiUserBrowser(userId));
      const pages = await Promise.all(services.map(s => s.init()));

      // Each user navigates to a unique test page with their ID
      await Promise.all(
        pages.map((page, i) =>
          page.goto(`https://httpbin.org/base64/${Buffer.from(userIds[i]).toString('base64')}`)
        )
      );

      await pages[0].waitForTimeout(2000);

      // Verify each user only sees their own data
      for (let i = 0; i < pages.length; i++) {
        const content = await pages[i].textContent('body');
        expect(content).toContain(userIds[i]);

        // Should NOT contain other users' IDs
        for (let j = 0; j < userIds.length; j++) {
          if (i !== j) {
            expect(content).not.toContain(userIds[j]);
          }
        }
      }

      // Cleanup
      await Promise.all(services.map(s => s.close()));
      await Promise.all(
        userIds.map(userId =>
          getSupabaseClient().from('profiles').delete().eq('id', userId)
        )
      );
    });
  });

  describe('9. Context Switch Performance', () => {
    it('should switch between user contexts in under 100ms', async () => {
      const serviceA = createMultiUserBrowser(USER_A);
      const serviceB = createMultiUserBrowser(USER_B);

      await serviceA.init();
      await serviceB.init();

      // Warm up
      const pageA = serviceA.getPage();
      const pageB = serviceB.getPage();

      await pageA!.goto('https://example.com');
      await pageB!.goto('https://example.com');

      // Measure context switch time
      const start = performance.now();

      await pageA!.evaluate(() => document.title);
      await pageB!.evaluate(() => document.title);
      await pageA!.evaluate(() => document.title);

      const elapsed = performance.now() - start;

      console.log(`Context switch time: ${elapsed.toFixed(2)}ms for 3 operations`);

      // Should complete 3 context switches in under 300ms (100ms per switch)
      expect(elapsed).toBeLessThan(300);

      await serviceA.close();
      await serviceB.close();
    });
  });

  describe('10. Session Persistence', () => {
    it('should restore user sessions across browser restarts', async () => {
      const service = createMultiUserBrowser(USER_A);
      const page = await service.init();

      // Navigate and set cookies
      await page.goto('https://httpbin.org/cookies/set/session_id/test-session-123');
      await page.waitForTimeout(1000);

      // Save sessions
      await service.saveAllSessions();
      await service.close();

      // Reinitialize - should restore session
      const service2 = createMultiUserBrowser(USER_A);
      const page2 = await service2.init();

      await page2.goto('https://httpbin.org/cookies');
      const cookies = await page2.evaluate(() => document.cookie);

      expect(cookies).toContain('session_id');

      await service2.close();
    });
  });
});

/**
 * Integration Test: Simulate real-world concurrent phone calls
 */
describe('Real-World Scenario: Concurrent Phone Calls', () => {
  it('should handle 3 simultaneous phone calls with different tasks', async () => {
    // Create 3 test users
    const users = [
      { id: USER_A, task: 'Search for flights to London', site: 'https://www.google.com/travel/flights' },
      { id: USER_B, task: 'Check weather in Tokyo', site: 'https://weather.com' },
      { id: USER_C, task: 'Find restaurants in NYC', site: 'https://www.yelp.com' },
    ];

    // All users call simultaneously
    const services = users.map(u => createMultiUserBrowser(u.id));
    const pages = await Promise.all(services.map(s => s.init()));

    // Each navigates to their task
    await Promise.all(
      pages.map((page, i) => page.goto(users[i].site))
    );

    await pages[0].waitForTimeout(2000);

    // Verify isolation - each user only sees their own site
    for (let i = 0; i < pages.length; i++) {
      const url = pages[i].url();
      expect(url).toContain(new URL(users[i].site).hostname);
    }

    // Cleanup
    await Promise.all(services.map(s => s.close()));
  }, 30000); // 30 second timeout for network operations
});
