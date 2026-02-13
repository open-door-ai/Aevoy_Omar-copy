/**
 * Planning Service - Simplified for Omar's Personal AI Assistant
 *
 * Generates execution plans from task descriptions.
 */
export interface ExecutionPlan {
    taskId: string;
    goal: string;
    steps: ExecutionStep[];
}
export interface ExecutionStep {
    order: number;
    type: 'navigate' | 'login' | 'fill' | 'click' | 'select' | 'wait' | 'extract' | 'screenshot';
    description: string;
    target?: string;
    value?: string;
    expectedOutcome: string;
    canSkip: boolean;
}
/**
 * Generate a simple execution plan from a task description.
 * In the future, this will use AI to generate better plans.
 */
export declare function generateExecutionPlan(taskDescription: string): Promise<ExecutionPlan>;
