/**
 * V3 Task Ledger
 *
 * Tracks progress through a multi-step task.
 * Replaces all hardcoded gates (hollow response, browser interaction, signup completion, etc.)
 * with a simple data structure the AI reads.
 */

import type { Observation, LedgerState, ToolCallResult } from './types.js';

const MAX_ITERATIONS = 15;
const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export class TaskLedger {
  private state: LedgerState;
  private startTime: number;
  private maxIterations: number;
  private timeoutMs: number;

  constructor(taskId: string, opts?: { maxIterations?: number; timeoutMs?: number }) {
    this.startTime = Date.now();
    this.maxIterations = opts?.maxIterations || MAX_ITERATIONS;
    this.timeoutMs = opts?.timeoutMs || TIMEOUT_MS;
    this.state = {
      taskId,
      status: 'executing',
      observations: [],
      totalCost: 0,
      stepsCompleted: 0,
      stepsFailed: 0,
    };
  }

  /** Record a tool call observation */
  recordObservation(toolName: string, params: Record<string, unknown>, result: ToolCallResult): void {
    this.state.observations.push({
      step: this.state.stepsCompleted + this.state.stepsFailed + 1,
      toolName,
      params: this.maskSensitiveParams(params),
      result,
      timestamp: Date.now(),
    });

    if (result.success) {
      this.state.stepsCompleted++;
    } else {
      this.state.stepsFailed++;
    }

    this.state.totalCost += result.cost;
  }

  /** Mark task as complete */
  complete(response: string): void {
    this.state.status = 'complete';
    this.state.finalResponse = response;
  }

  /** Mark task as failed */
  fail(error: string): void {
    this.state.status = 'failed';
    this.state.error = error;
  }

  /** Check if task should stop */
  isComplete(): boolean {
    return this.state.status === 'complete' || this.state.status === 'failed';
  }

  /** Check if budget is exceeded */
  isBudgetExceeded(budgetLimit: number): boolean {
    if (this.state.totalCost >= budgetLimit) {
      this.state.status = 'budget_exceeded';
      return true;
    }
    return false;
  }

  /** Check if task has timed out */
  isTimedOut(): boolean {
    if (Date.now() - this.startTime >= this.timeoutMs) {
      this.state.status = 'timed_out';
      return true;
    }
    return false;
  }

  /** Check if max iterations reached */
  isMaxIterations(): boolean {
    const totalSteps = this.state.stepsCompleted + this.state.stepsFailed;
    return totalSteps >= this.maxIterations;
  }

  /** Should the AI review/replan? Every 5 steps or after 2+ failures */
  shouldReview(): boolean {
    const totalSteps = this.state.stepsCompleted + this.state.stepsFailed;
    return totalSteps % 5 === 0 || this.state.stepsFailed >= 2;
  }

  /** Get compressed history for AI context */
  getSummaryForAI(): string {
    const obs = this.state.observations;
    if (obs.length === 0) return 'No actions taken yet.';

    const lines: string[] = [];
    lines.push(`Steps: ${this.state.stepsCompleted} completed, ${this.state.stepsFailed} failed`);
    lines.push(`Cost: $${this.state.totalCost.toFixed(3)}`);
    lines.push(`Elapsed: ${Math.round((Date.now() - this.startTime) / 1000)}s`);

    // Show last 5 observations in detail
    const recent = obs.slice(-5);
    if (obs.length > 5) {
      const older = obs.slice(0, -5);
      const summary = older.map(o => `${o.toolName}:${o.result.success ? 'ok' : 'fail'}`).join(', ');
      lines.push(`Earlier: ${summary}`);
    }

    lines.push('Recent:');
    for (const o of recent) {
      const status = o.result.success ? 'OK' : `FAIL: ${o.result.error || 'unknown'}`;
      const dataPreview = o.result.data
        ? String(o.result.data).substring(0, 200)
        : '';
      lines.push(`  [${o.step}] ${o.toolName}(${JSON.stringify(o.params).substring(0, 100)}) → ${status}${dataPreview ? ` | ${dataPreview}` : ''}`);
    }

    return lines.join('\n');
  }

  /** Get partial results for budget-exceeded message */
  getPartialResults(): string {
    const successObs = this.state.observations.filter(o => o.result.success && o.result.data);
    if (successObs.length === 0) return 'No results gathered yet.';
    return successObs.map(o => String(o.result.data).substring(0, 500)).join('\n');
  }

  /** Get current state */
  getState(): Readonly<LedgerState> {
    return this.state;
  }

  /** Get the final response */
  getResult(): string {
    return this.state.finalResponse || this.state.error || 'Task did not produce a result.';
  }

  /** Get total cost */
  get totalCost(): number {
    return this.state.totalCost;
  }

  /** Get elapsed time in ms */
  get elapsedMs(): number {
    return Date.now() - this.startTime;
  }

  /** Mask sensitive parameters for logging */
  private maskSensitiveParams(params: Record<string, unknown>): Record<string, unknown> {
    const masked = { ...params };
    for (const key of ['password', 'pin', 'token', 'secret', 'apiKey', 'api_key']) {
      if (key in masked) masked[key] = '***';
    }
    return masked;
  }
}
