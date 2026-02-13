/**
 * Execution Engine - Main Entry Point
 *
 * Orchestrates browser automation for Omar's Personal AI Assistant.
 * Simplified version based on Aevoy's proven engine.
 */

import { Page } from 'playwright';
import { createPage, closeBrowser } from './browser-client.js';
import { generateExecutionPlan } from './planning.js';
import { createAutonomousExecutor, ExecutionResult } from './autonomous-executor.js';

export interface BrowserTaskRequest {
  task: string;
  userId?: string;
}

export interface BrowserTaskResult {
  success: boolean;
  message: string;
  data?: any;
  cost: number;
}

/**
 * Main execution function - called by Core Agent
 */
export async function executeBrowser(request: BrowserTaskRequest): Promise<BrowserTaskResult> {
  let page: Page | null = null;

  try {
    console.log('[ENGINE] Creating browser page...');
    page = await createPage();

    console.log('[ENGINE] Generating execution plan...');
    const plan = await generateExecutionPlan(request.task);

    console.log('[ENGINE] Running autonomous execution...');
    const executor = createAutonomousExecutor();
    const result: ExecutionResult = await executor.execute(page, plan);

    if (result.success) {
      return {
        success: true,
        message: 'Task completed successfully',
        data: result.result,
        cost: 0, // Cost tracking not implemented yet
      };
    } else {
      return {
        success: false,
        message: result.error || 'Task failed',
        cost: 0,
      };
    }

  } catch (error: any) {
    console.error('[ENGINE] Execution error:', error);
    return {
      success: false,
      message: `Error: ${error.message}`,
      cost: 0,
    };
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }
}

/**
 * Cleanup function - should be called on shutdown
 */
export async function cleanup(): Promise<void> {
  await closeBrowser();
}
