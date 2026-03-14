/**
 * V3 Browser Tool
 *
 * High-level browser session tool that wraps the existing vision-agent.ts.
 *
 * Key differences from the naive implementation:
 * 1. SHARED ENGINE — one browser per task, reused across tool calls
 * 2. CREDENTIALS — user email/password/name injected into vision agent task
 * 3. BRIGHTDATA FALLBACK — switches to local browser on slow/disconnect
 */

import { registerTool } from '../tool-registry.js';
import { ExecutionEngine } from '../../execution/engine.js';
import { runVisionAgent } from '../../execution/vision-agent.js';
import { runWithAdaptiveTimeout } from '../../services/vision-supervisor.js';
import { createLockedIntent, getTaskTypeFromClassification } from '../../security/intent-lock.js';
import { getSupabaseClient } from '../../utils/supabase.js';
import type { ToolCallResult, TaskContext } from '../types.js';

// ── Per-task engine cache ──
// Reuses the same browser engine across multiple browser_session calls within one task.
// Prevents reconnecting to BrightData for every tool call (saves 5-10s per call + preserves cookies).
const taskEngines = new Map<string, ExecutionEngine>();

/** Get or create an engine for this task */
async function getOrCreateEngine(ctx: TaskContext, domain: string, task: string): Promise<{ engine: ExecutionEngine; isNew: boolean }> {
  const existing = taskEngines.get(ctx.taskId);
  if (existing) {
    // Verify engine is still alive
    try {
      const page = existing.getPage();
      if (page && !page.isClosed()) {
        return { engine: existing, isNew: false };
      }
    } catch { /* engine dead, create new */ }
    // Cleanup dead engine
    try { await existing.cleanup(); } catch { /* ignore */ }
    taskEngines.delete(ctx.taskId);
  }

  const lockedIntent = createLockedIntent({
    userId: ctx.userId,
    taskType: getTaskTypeFromClassification('browser_action'),
    goal: task,
    allowedDomains: [domain],
    allowedActions: ['browse', 'fill_form', 'click', 'screenshot', 'extract'],
  });

  const engine = new ExecutionEngine(lockedIntent);
  await engine.initialize(ctx.userId, domain, ctx.taskId);
  taskEngines.set(ctx.taskId, engine);
  return { engine, isNew: true };
}

/** Cleanup engine for a task (call when task completes) */
export async function cleanupTaskEngine(taskId: string): Promise<void> {
  const engine = taskEngines.get(taskId);
  if (engine) {
    try { await engine.cleanup(); } catch { /* ignore */ }
    taskEngines.delete(taskId);
  }
}

/** Build the vision agent task string with credentials context */
async function buildVisionTask(
  task: string,
  ctx: TaskContext,
  url: string
): Promise<{ visionTask: string; phoneNumber: string }> {
  // Get user credentials for form filling
  let email = `${ctx.username}@aevoy.com`;
  let password = '';
  let name = ctx.senderName || ctx.username;
  let phone = ctx.profile.phone || '';

  // Get agent-generated password
  try {
    const { getAgentPasswords } = await import('../../services/agent-passwords.js');
    const pw = await getAgentPasswords(ctx.userId);
    password = pw?.primary || generateFallbackPassword();
  } catch {
    password = generateFallbackPassword();
  }

  // Get Twilio number for SMS verification
  if (!phone) {
    try {
      const { data } = await getSupabaseClient()
        .from('user_twilio_numbers')
        .select('phone_number')
        .eq('user_id', ctx.userId)
        .eq('is_active', true)
        .limit(1)
        .single();
      phone = data?.phone_number || '';
    } catch { /* no number */ }
  }

  // Build task with form-filling context
  const isSignup = /\b(sign\s?up|signup|register|create.*account|make.*account|enroll)\b/i.test(task);
  const phoneCtx = phone ? `, phone=${phone}` : '';
  const formCtx = isSignup
    ? `FILL the signup form NOW: email=${email}, password=${password}, name=${name}, last_name=Aevoy${phoneCtx}. Click the Sign Up/Create Account/Register button. DO NOT describe the page. ACTUALLY FILL THE FORM AND CLICK SUBMIT.`
    : `If filling forms use: email=${email}, password=${password}, name=${name}, last_name=Aevoy${phoneCtx}. Complete the task fully on the page.`;

  const visionTask = `${task}\n\n${formCtx}`;
  return { visionTask, phoneNumber: phone };
}

import crypto from 'crypto';

function generateFallbackPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const special = '!@#$%&';
  let pw = '';
  const bytes = crypto.randomBytes(14);
  for (let i = 0; i < 12; i++) pw += chars[bytes[i] % chars.length];
  pw += special[bytes[12] % special.length];
  pw += String(bytes[13] % 10);
  return pw;
}

/** Browser session tool — launches the full vision agent with shared engine */
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

    try {
      let domain = 'unknown';
      try { domain = new URL(url).hostname; } catch { /* use default */ }

      // Get or reuse engine (shared across tool calls within same task)
      const { engine, isNew } = await getOrCreateEngine(ctx, domain, task);
      const page = engine.getPage();
      if (!page || page.isClosed()) {
        return { success: false, error: 'Browser page not available', cost: 0 };
      }

      // Navigate to URL (only if it's a new page or different domain)
      const currentUrl = page.url();
      const needsNavigation = isNew || !currentUrl.includes(domain);
      if (needsNavigation) {
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (navErr) {
          const errMsg = navErr instanceof Error ? navErr.message : '';
          console.warn(`[V3-BROWSER] Navigation warning for ${url}: ${errMsg}`);

          // BrightData compliance block — switch to local browser
          if (errMsg.includes('Forbidden') || errMsg.includes('compliance policy')) {
            console.log(`[V3-BROWSER] BrightData blocked ${domain} — switching to local browser`);
            try {
              engine.forceLocalBrowser?.();
              await engine.cleanup?.();
              await engine.initialize?.(ctx.userId, domain, ctx.taskId);
              const localPage = engine.getPage();
              if (localPage && !localPage.isClosed()) {
                await localPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
              }
            } catch (switchErr) {
              console.warn(`[V3-BROWSER] Local browser switch failed:`, switchErr);
            }
          }
        }
      }

      // Build vision task with credentials
      const { visionTask, phoneNumber } = await buildVisionTask(task, ctx, url);

      // Get the active page (may have changed after engine switch)
      const activePage = engine.getPage() || page;

      // Run vision agent with adaptive timeout (like V1 does)
      const VISION_TIMEOUT_MS = 720000; // 12 minutes
      const result = await runWithAdaptiveTimeout(
        runVisionAgent(activePage, visionTask, ctx.userId, ctx.taskId, ctx.username, phoneNumber),
        ctx.taskId,
        VISION_TIMEOUT_MS,
        task
      );

      console.log(`[V3-BROWSER] Vision result: success=${result.success}, steps=${result.steps}, cost=$${result.cost.toFixed(4)}`);

      // BrightData slow/disconnect — retry with local browser
      if (!result.success && (result.error === 'browser_too_slow' || result.error === 'browser_disconnected')) {
        console.log(`[V3-BROWSER] BrightData ${result.error} — switching to local browser`);
        try {
          engine.forceLocalBrowser?.();
          await engine.cleanup?.();
          await engine.initialize?.(ctx.userId, domain, ctx.taskId);
          const localPage = engine.getPage();
          if (localPage && !localPage.isClosed()) {
            await localPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
            console.log(`[V3-BROWSER] Retrying on local browser`);
            const localResult = await runWithAdaptiveTimeout(
              runVisionAgent(localPage, visionTask, ctx.userId, ctx.taskId, ctx.username, phoneNumber),
              ctx.taskId,
              VISION_TIMEOUT_MS,
              task
            );
            // Use local result
            if (localResult.success || (localResult.steps > result.steps)) {
              return {
                success: localResult.success,
                data: localResult.success ? (localResult.result || 'Task completed.') : undefined,
                error: localResult.success ? undefined : (localResult.error || 'Browser task failed'),
                cost: result.cost + localResult.cost,
              };
            }
          }
        } catch (switchErr) {
          console.warn(`[V3-BROWSER] Local retry failed:`, switchErr);
        }
      }

      // Return result
      if (result.success) {
        return {
          success: true,
          data: result.result || 'Browser task completed successfully.',
          cost: result.cost,
        };
      } else {
        const errorInfo = result.error || 'Browser task did not complete successfully.';
        const pageData = result.pageData
          ? `\n\nPage data collected:\n${result.pageData.substring(0, 1000)}`
          : '';
        return {
          success: false,
          error: errorInfo + pageData,
          cost: result.cost,
        };
      }
    } catch (err) {
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
