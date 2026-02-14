/**
 * Browser task concurrency tracking
 * Separate module to avoid circular dependencies
 */

let activeBrowserTasks = 0;
const MAX_CONCURRENT_BROWSER_TASKS = 10; // Increased from 3 to prevent deadlocks on complex task batches

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
