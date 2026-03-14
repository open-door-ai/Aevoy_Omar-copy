/**
 * V3 Browser Tool
 *
 * High-level browser session tool that wraps the existing vision-agent.ts.
 * The AI calls this as a single tool to perform browser-based tasks.
 * All 4200+ lines of battle-tested browser automation are preserved.
 */

import { registerTool } from '../tool-registry.js';
import { ExecutionEngine } from '../../execution/engine.js';
import { runVisionAgent } from '../../execution/vision-agent.js';
import { createLockedIntent, getTaskTypeFromClassification } from '../../security/intent-lock.js';
import type { ToolCallResult, TaskContext } from '../types.js';

/** Browser session tool — launches the full vision agent */
registerTool({
  name: 'browser_session',
  description: 'Navigate to a website and perform a task using a browser. Use this for: searching the web, signing up for services, filling forms, adding items to cart, booking reservations, researching products/prices, cancelling subscriptions, or any task that requires interacting with a website. Describe the full task you want to accomplish.',
  category: 'browser',
  parameters: {
    url: { type: 'string', description: 'Starting URL (e.g. "https://www.google.com"). If unsure, use Google search URL with the query.' },
    task: { type: 'string', description: 'Detailed description of what to accomplish in the browser session' },
  },
  required: ['url', 'task'],
  async execute(params, ctx): Promise<ToolCallResult> {
    const url = String(params.url);
    const task = String(params.task);

    // Validate URL
    if (!url || url.length > 2048) {
      return { success: false, error: 'Invalid URL', cost: 0 };
    }
    if (/^(javascript|data|blob|file|chrome|devtools|about):/i.test(url)) {
      return { success: false, error: 'Blocked URL scheme', cost: 0 };
    }
    if (/^https?:\/\/(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.0\.0\.0|localhost)/i.test(url)) {
      return { success: false, error: 'Private network URLs are not allowed', cost: 0 };
    }

    let engine: ExecutionEngine | null = null;
    try {
      // Extract domain for engine initialization
      let domain = 'unknown';
      try {
        domain = new URL(url).hostname;
      } catch { /* use default */ }

      // Create locked intent for security
      const lockedIntent = createLockedIntent({
        userId: ctx.userId,
        taskType: getTaskTypeFromClassification('browser_action'),
        goal: task,
        allowedDomains: [domain],
        allowedActions: ['browse', 'fill_form', 'click', 'screenshot', 'extract'],
      });

      // Initialize browser engine
      engine = new ExecutionEngine(lockedIntent);
      await engine.initialize(ctx.userId, domain, ctx.taskId);
      const page = engine.getPage();
      if (!page) {
        return { success: false, error: 'Failed to initialize browser', cost: 0 };
      }

      // Navigate to URL
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch (navErr) {
        // Navigation timeout is not fatal — page may still be usable
        console.warn(`[V3-BROWSER] Navigation warning for ${url}:`, navErr instanceof Error ? navErr.message : navErr);
      }

      // Get user's phone number for the vision agent (used for verification codes)
      let phoneNumber: string | undefined;
      if (ctx.profile.phone) {
        phoneNumber = ctx.profile.phone;
      }

      // Run the vision agent (4200+ lines of battle-tested browser automation)
      const result = await runVisionAgent(
        page,
        task,
        ctx.userId,
        ctx.taskId,
        ctx.username,
        phoneNumber
      );

      // Cleanup
      await engine.cleanup();
      engine = null;

      if (result.success) {
        return {
          success: true,
          data: result.result || 'Browser task completed successfully.',
          cost: result.cost,
        };
      } else {
        // Even on failure, return any page data that was collected
        const errorInfo = result.error || 'Browser task did not complete successfully.';
        const pageData = result.pageData
          ? `\n\nPage data collected before failure:\n${result.pageData.substring(0, 1000)}`
          : '';
        return {
          success: false,
          error: errorInfo + pageData,
          cost: result.cost,
        };
      }
    } catch (err) {
      // Ensure cleanup on error
      if (engine) {
        try { await engine.cleanup(); } catch { /* ignore cleanup error */ }
      }

      const errorMsg = err instanceof Error ? err.message : 'Unknown browser error';
      console.error(`[V3-BROWSER] Session error:`, errorMsg);
      return {
        success: false,
        error: `Browser session failed: ${errorMsg}`,
        cost: 0,
      };
    }
  },
});
