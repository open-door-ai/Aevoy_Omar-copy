/**
 * Timeout Utility
 *
 * Reusable timeout wrapper for promises. Used by engine, AI, and Stagehand.
 */

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Race a promise against a timeout.
 * Throws TimeoutError if the promise doesn't resolve in time.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string = 'Operation'
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new TimeoutError(label, ms));
    }, ms);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

/**
 * Wait for a specified duration.
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get escalated timeout for retry attempts.
 * Each attempt gets 50% more time (15s → 22s → 33s → 50s → 60s max).
 */
export function getEscalatedTimeout(attempt: number, baseMs: number = 15000, maxMs: number = 60000): number {
  return Math.min(baseMs * Math.pow(1.5, attempt), maxMs);
}
