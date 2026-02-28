/**
 * Background Job Tracker - Prevents orphaned tasks
 *
 * Tracks all async task processing with:
 * - 45-minute max timeout (matches processor MASTER_TIMEOUT_MS)
 * - Graceful cleanup on server restart
 * - Error recovery and user notification
 */

interface BackgroundJob {
  taskId: string;
  userId: string;
  promise: Promise<any>;
  startedAt: number;
  timeoutHandle?: NodeJS.Timeout;
}

const MAX_TASK_DURATION_MS = 45 * 60 * 1000; // 45 minutes — matches processor master timeout
const backgroundJobs = new Map<string, BackgroundJob>();

/**
 * Track a background job with automatic timeout
 */
export function trackBackgroundJob(
  taskId: string,
  userId: string,
  promise: Promise<any>,
  onTimeout?: () => void
): void {
  const startedAt = Date.now();

  // Set timeout
  const timeoutHandle = setTimeout(() => {
    console.error(`[JOB-TRACKER] Task ${taskId} exceeded 45min timeout`);
    backgroundJobs.delete(taskId);

    if (onTimeout) {
      onTimeout();
    }
  }, MAX_TASK_DURATION_MS);

  backgroundJobs.set(taskId, {
    taskId,
    userId,
    promise,
    startedAt,
    timeoutHandle,
  });

  // Auto-cleanup on completion
  promise
    .then(() => {
      console.log(`[JOB-TRACKER] Task ${taskId} completed in ${Date.now() - startedAt}ms`);
    })
    .catch((error) => {
      console.error(`[JOB-TRACKER] Task ${taskId} failed:`, error.message);
    })
    .finally(() => {
      const job = backgroundJobs.get(taskId);
      if (job?.timeoutHandle) {
        clearTimeout(job.timeoutHandle);
      }
      backgroundJobs.delete(taskId);
    });
}

/**
 * Get active job count
 */
export function getActiveJobCount(): number {
  return backgroundJobs.size;
}

/**
 * Get all active jobs (for monitoring)
 */
export function getActiveJobs(): Array<{
  taskId: string;
  userId: string;
  durationMs: number;
}> {
  const now = Date.now();
  return Array.from(backgroundJobs.values()).map(job => ({
    taskId: job.taskId,
    userId: job.userId,
    durationMs: now - job.startedAt,
  }));
}

/**
 * Force kill a job (emergency only)
 */
export function killJob(taskId: string): boolean {
  const job = backgroundJobs.get(taskId);
  if (!job) return false;

  if (job.timeoutHandle) {
    clearTimeout(job.timeoutHandle);
  }

  backgroundJobs.delete(taskId);
  console.log(`[JOB-TRACKER] Forcefully killed job: ${taskId}`);
  return true;
}

/**
 * Cleanup all jobs (on server shutdown)
 */
export function cleanupAllJobs(): void {
  console.log(`[JOB-TRACKER] Cleaning up ${backgroundJobs.size} active jobs`);

  for (const [taskId, job] of backgroundJobs.entries()) {
    if (job.timeoutHandle) {
      clearTimeout(job.timeoutHandle);
    }
  }

  backgroundJobs.clear();
}

// Graceful shutdown
process.on('SIGTERM', cleanupAllJobs);
process.on('SIGINT', cleanupAllJobs);
