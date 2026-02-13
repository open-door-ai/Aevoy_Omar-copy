/**
 * Autonomous Executor - Iterative Observe-Plan-Act Loop
 *
 * Simplified version for Omar's Personal AI Assistant.
 * Executes tasks with max 5 iterations, 20-minute timeout.
 */
import { Page } from 'playwright';
import { ExecutionPlan } from './planning.js';
export interface ExecutionResult {
    success: boolean;
    completed: boolean;
    result?: any;
    error?: string;
    stepsExecuted: number;
    durationMs: number;
    attempts: number;
}
export declare class AutonomousExecutor {
    private state;
    private startTime;
    execute(page: Page, plan: ExecutionPlan): Promise<ExecutionResult>;
    private executeStep;
    private returnResult;
}
export declare function createAutonomousExecutor(): AutonomousExecutor;
