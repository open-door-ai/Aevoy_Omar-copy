/**
 * V3 Budget Manager
 *
 * Tracks cost and communicates budget constraints to AI as context.
 */

import { checkUserBudget, trackServiceCost } from '../services/ai.js';

export class BudgetManager {
  private spent: number = 0;
  private limit: number;
  private userId: string;
  private taskId: string;

  constructor(userId: string, taskId: string, limit: number = 5.0) {
    this.userId = userId;
    this.taskId = taskId;
    this.limit = limit;
  }

  /** Initialize budget from user's wallet */
  async initialize(): Promise<void> {
    const budget = await checkUserBudget(this.userId);
    // Use the lower of wallet balance and per-task limit
    this.limit = Math.min(this.limit, budget.remaining);
  }

  /** Record a cost */
  addCost(cost: number): void {
    this.spent += cost;
  }

  /** Track cost in the database */
  async trackCost(provider: string, model: string, cost: number, purpose: string): Promise<void> {
    if (cost > 0) {
      this.addCost(cost);
      await trackServiceCost(this.userId, provider, model, cost, purpose, this.taskId);
    }
  }

  /** Check if budget is exceeded */
  isExceeded(): boolean {
    return this.spent >= this.limit;
  }

  /** Get remaining budget */
  get remaining(): number {
    return Math.max(0, this.limit - this.spent);
  }

  /** Get total spent */
  get totalSpent(): number {
    return this.spent;
  }

  /** Format budget status for AI context */
  formatForPrompt(): string {
    const pct = this.limit > 0 ? Math.round((this.spent / this.limit) * 100) : 0;
    return [
      `BUDGET: $${this.spent.toFixed(3)} spent / $${this.limit.toFixed(2)} limit (${pct}% used)`,
      this.remaining < 0.50 ? 'LOW BUDGET — prefer free models and direct API calls over browser sessions.' : '',
    ].filter(Boolean).join('\n');
  }
}
