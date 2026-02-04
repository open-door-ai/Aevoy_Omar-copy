/**
 * Retry & Recovery System
 *
 * Exponential backoff with jitter, circuit breakers, and escalated timeouts.
 */

import { delay } from '../utils/timeout.js';

/**
 * Retry policy with exponential backoff and jitter.
 */
export class RetryPolicy {
  private maxRetries: number;
  private baseDelayMs: number;
  private maxDelayMs: number;
  private jitterFactor: number;

  constructor(options?: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    jitterFactor?: number;
  }) {
    this.maxRetries = options?.maxRetries ?? 3;
    this.baseDelayMs = options?.baseDelayMs ?? 1000;
    this.maxDelayMs = options?.maxDelayMs ?? 30000;
    this.jitterFactor = options?.jitterFactor ?? 0.3;
  }

  /**
   * Execute a function with retry logic.
   */
  async execute<T>(
    fn: (attempt: number) => Promise<T>,
    label: string = 'operation'
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn(attempt);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < this.maxRetries) {
          const delayMs = this.getDelay(attempt);
          console.log(`[RETRY] ${label} attempt ${attempt + 1}/${this.maxRetries + 1} failed: ${lastError.message}. Retrying in ${delayMs}ms`);
          await delay(delayMs);
        }
      }
    }

    throw lastError || new Error(`${label} failed after ${this.maxRetries + 1} attempts`);
  }

  private getDelay(attempt: number): number {
    const exponentialDelay = this.baseDelayMs * Math.pow(2, attempt);
    const capped = Math.min(exponentialDelay, this.maxDelayMs);
    // Add jitter: ±jitterFactor of the delay
    const jitter = capped * this.jitterFactor * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(capped + jitter));
  }
}

/**
 * Circuit breaker to prevent cascading failures.
 * Opens after threshold failures, half-opens after cooldown.
 */
export class CircuitBreaker {
  private failureCount = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private threshold: number;
  private windowMs: number;
  private cooldownMs: number;
  private successesInHalfOpen = 0;
  private requiredSuccesses: number;

  constructor(options?: {
    threshold?: number;
    windowMs?: number;
    cooldownMs?: number;
    requiredSuccesses?: number;
  }) {
    this.threshold = options?.threshold ?? 5;
    this.windowMs = options?.windowMs ?? 600000; // 10 minutes
    this.cooldownMs = options?.cooldownMs ?? 60000; // 1 minute
    this.requiredSuccesses = options?.requiredSuccesses ?? 2;
  }

  /**
   * Check if the circuit allows a request.
   */
  canExecute(): boolean {
    this.maybeReset();

    switch (this.state) {
      case 'closed':
        return true;
      case 'open':
        // Check if cooldown has elapsed
        if (Date.now() - this.lastFailureTime > this.cooldownMs) {
          this.state = 'half-open';
          this.successesInHalfOpen = 0;
          console.log('[CIRCUIT] Half-open: allowing test request');
          return true;
        }
        return false;
      case 'half-open':
        return true;
    }
  }

  /**
   * Record a successful execution.
   */
  recordSuccess(): void {
    if (this.state === 'half-open') {
      this.successesInHalfOpen++;
      if (this.successesInHalfOpen >= this.requiredSuccesses) {
        this.state = 'closed';
        this.failureCount = 0;
        console.log('[CIRCUIT] Closed: service recovered');
      }
    } else {
      // Reset failure count on success in closed state
      this.failureCount = Math.max(0, this.failureCount - 1);
    }
  }

  /**
   * Record a failed execution.
   */
  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half-open') {
      this.state = 'open';
      console.log('[CIRCUIT] Open: test request failed');
      return;
    }

    if (this.failureCount >= this.threshold) {
      this.state = 'open';
      console.log(`[CIRCUIT] Open: ${this.failureCount} failures in window`);
    }
  }

  /**
   * Get current circuit state.
   */
  getState(): 'closed' | 'open' | 'half-open' {
    this.maybeReset();
    return this.state;
  }

  private maybeReset(): void {
    // Reset failure count if the window has passed
    if (
      this.state === 'closed' &&
      this.failureCount > 0 &&
      Date.now() - this.lastFailureTime > this.windowMs
    ) {
      this.failureCount = 0;
    }
  }
}

/**
 * Execute with both retry policy and circuit breaker.
 */
export async function executeWithResilience<T>(
  fn: (attempt: number) => Promise<T>,
  label: string,
  retryPolicy: RetryPolicy,
  circuitBreaker: CircuitBreaker
): Promise<T> {
  if (!circuitBreaker.canExecute()) {
    throw new Error(`${label}: circuit breaker is open`);
  }

  try {
    const result = await retryPolicy.execute(fn, label);
    circuitBreaker.recordSuccess();
    return result;
  } catch (error) {
    circuitBreaker.recordFailure();
    throw error;
  }
}
