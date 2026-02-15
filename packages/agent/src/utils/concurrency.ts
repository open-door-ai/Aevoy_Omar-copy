/**
 * Browser task concurrency tracking
 * Separate module to avoid circular dependencies
 */

let activeBrowserTasks = 0;
const MAX_CONCURRENT_BROWSER_TASKS = 10; // Increased from 3 to prevent deadlocks on complex task batches

// Per-user browser context tracking
const userBrowserContexts = new Map<string, number>();
const MAX_BROWSER_CONTEXTS_PER_USER = 3;

// Per-user task queue tracking
const userTaskQueues = new Map<string, number>();
const MAX_TASK_QUEUE_SIZE = 100;

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
  return true;
}

export function decrementUserBrowserContext(userId: string): void {
  const current = userBrowserContexts.get(userId) || 0;
  if (current > 0) {
    userBrowserContexts.set(userId, current - 1);
  }
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
  return true;
}

export function decrementUserTaskQueue(userId: string): void {
  const current = userTaskQueues.get(userId) || 0;
  if (current > 0) {
    userTaskQueues.set(userId, current - 1);
  }
}

export function getUserTaskQueueSize(userId: string): number {
  return userTaskQueues.get(userId) || 0;
}
