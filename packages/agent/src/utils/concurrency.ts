/**
 * Browser task concurrency tracking
 * Separate module to avoid circular dependencies
 */

let activeBrowserTasks = 0;
const MAX_CONCURRENT_BROWSER_TASKS = 3; // Railway 2GB+ — each Chromium uses 200-400MB with cleanup

// Per-user browser context tracking
const userBrowserContexts = new Map<string, number>();
const MAX_BROWSER_CONTEXTS_PER_USER = 3;

// Per-user task queue tracking
const userTaskQueues = new Map<string, number>();
const MAX_TASK_QUEUE_SIZE = 100;

// Track when each user entry last changed so we can clean up stale idle entries
const userLastActivity = new Map<string, number>();

const CLEANUP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const IDLE_THRESHOLD_MS = 30 * 60 * 1000;   // 30 minutes

export function incrementBrowserTasks(): void {
  activeBrowserTasks++;
  console.log(`[CONCURRENCY] Browser tasks: ${activeBrowserTasks}/${MAX_CONCURRENT_BROWSER_TASKS}`);
}

export function decrementBrowserTasks(): void {
  activeBrowserTasks = Math.max(0, activeBrowserTasks - 1);
  console.log(`[CONCURRENCY] Browser tasks: ${activeBrowserTasks}/${MAX_CONCURRENT_BROWSER_TASKS}`);
}

export function getActiveBrowserTasks(): number {
  return activeBrowserTasks;
}

export function canAcceptBrowserTask(): boolean {
  return activeBrowserTasks < MAX_CONCURRENT_BROWSER_TASKS;
}

// ============================================================================
// PER-USER BROWSER CONTEXT TRACKING
// ============================================================================

export function incrementUserBrowserContext(userId: string): boolean {
  const current = userBrowserContexts.get(userId) || 0;
  if (current >= MAX_BROWSER_CONTEXTS_PER_USER) {
    return false;
  }
  userBrowserContexts.set(userId, current + 1);
  userLastActivity.set(userId, Date.now());
  return true;
}

export function decrementUserBrowserContext(userId: string): void {
  const current = userBrowserContexts.get(userId) || 0;
  if (current > 0) {
    userBrowserContexts.set(userId, current - 1);
  }
  userLastActivity.set(userId, Date.now());
}

export function canUserCreateBrowserContext(userId: string): boolean {
  const current = userBrowserContexts.get(userId) || 0;
  return current < MAX_BROWSER_CONTEXTS_PER_USER;
}

// ============================================================================
// PER-USER TASK QUEUE TRACKING
// ============================================================================

export function incrementUserTaskQueue(userId: string): boolean {
  const current = userTaskQueues.get(userId) || 0;
  if (current >= MAX_TASK_QUEUE_SIZE) {
    return false;
  }
  userTaskQueues.set(userId, current + 1);
  userLastActivity.set(userId, Date.now());
  return true;
}

export function decrementUserTaskQueue(userId: string): void {
  const current = userTaskQueues.get(userId) || 0;
  if (current > 0) {
    userTaskQueues.set(userId, current - 1);
  }
  userLastActivity.set(userId, Date.now());
}

export function getUserTaskQueueSize(userId: string): number {
  return userTaskQueues.get(userId) || 0;
}

// ============================================================================
// CLEANUP & CRASH RECOVERY
// ============================================================================

/**
 * Remove map entries for users that have been idle (count === 0) for longer
 * than IDLE_THRESHOLD_MS.  This prevents the Maps from growing unbounded
 * when many unique users hit the system over time.
 */
export function cleanupIdleEntries(): number {
  const now = Date.now();
  let removed = 0;

  for (const [userId, lastActive] of userLastActivity.entries()) {
    if (now - lastActive < IDLE_THRESHOLD_MS) continue;

    const browserCount = userBrowserContexts.get(userId) || 0;
    const taskCount = userTaskQueues.get(userId) || 0;

    // Only remove if both counters are at zero (idle)
    if (browserCount === 0 && taskCount === 0) {
      userBrowserContexts.delete(userId);
      userTaskQueues.delete(userId);
      userLastActivity.delete(userId);
      removed++;
    }
  }

  if (removed > 0) {
    console.log(
      `[CONCURRENCY] Cleanup: removed ${removed} idle user entries. ` +
      `Remaining: ${userBrowserContexts.size} browser, ${userTaskQueues.size} task queue`
    );
  }

  return removed;
}

/**
 * Reset a specific user's concurrency counters to 0.
 * Useful for crash recovery when a user's tasks terminated abnormally
 * and the counters were never decremented.
 */
export function resetUserCounters(userId: string): void {
  const hadBrowser = userBrowserContexts.has(userId);
  const hadTask = userTaskQueues.has(userId);

  userBrowserContexts.set(userId, 0);
  userTaskQueues.set(userId, 0);
  userLastActivity.set(userId, Date.now());

  if (hadBrowser || hadTask) {
    console.log(
      `[CONCURRENCY] Reset counters for user ${userId} ` +
      `(browser: ${hadBrowser ? 'cleared' : 'none'}, task: ${hadTask ? 'cleared' : 'none'})`
    );
  }
}

// Run cleanup every 15 minutes to prevent unbounded Map growth
const _cleanupInterval = setInterval(cleanupIdleEntries, CLEANUP_INTERVAL_MS);
// Allow the Node.js process to exit even if this timer is pending
if (_cleanupInterval.unref) {
  _cleanupInterval.unref();
}
