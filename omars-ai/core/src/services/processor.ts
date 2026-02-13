import { callAI } from './ai.js';
import { getMemory } from './memory.js';
import { chromium } from 'playwright';
import { generateExecutionPlan } from '../../execution/dist/planning.js';
import { AutonomousExecutor } from '../../execution/dist/autonomous-executor.js';
import { verify3Step } from './verification.js';
import fs from 'fs/promises';
import path from 'path';

interface TaskRequest {
  userId: string;
  username: string;
  channel: string;
  from: string;
  body: string;
  subject?: string;
}

interface TaskResult {
  success: boolean;
  message: string;
  model?: string;
  cost?: number;
  tokens?: number;
}

const MEMORY_DIR = process.env.MEMORY_DIR || '/home/omars-ai/assistant/memory';

async function loadPersonality(): Promise<string> {
  try {
    const soulPath = path.join(MEMORY_DIR, 'SOUL.md');
    const soul = await fs.readFile(soulPath, 'utf-8');
    return soul;
  } catch {
    return `You are Omar's personal AI assistant. Be direct, efficient, and proactive.
Never use corporate speak or unnecessary formality.
Keep responses concise unless asked for details.
You can control a browser, send emails, manage calendar, and automate tasks.`;
  }
}

async function loadUserContext(): Promise<string> {
  try {
    const userPath = path.join(MEMORY_DIR, 'USER.md');
    const user = await fs.readFile(userPath, 'utf-8');
    return user;
  } catch {
    return '';
  }
}

function classifyTask(body: string): 'simple' | 'research' | 'browser' | 'email' | 'schedule' {
  const lower = body.toLowerCase();

  if (lower.includes('browse') || lower.includes('go to') || lower.includes('search for') ||
      lower.includes('look up') || lower.includes('find on') || lower.includes('check website') ||
      lower.includes('order') || lower.includes('book') || lower.includes('buy') ||
      lower.includes('flight') || lower.includes('hotel') || lower.includes('google') ||
      lower.includes('booking.com') || lower.includes('amazon')) {
    return 'browser';
  }

  if (lower.includes('email') || lower.includes('send') || lower.includes('reply') || lower.includes('forward')) {
    return 'email';
  }

  if (lower.includes('schedule') || lower.includes('remind') || lower.includes('alarm') || lower.includes('calendar')) {
    return 'schedule';
  }

  if (lower.includes('research') || lower.includes('compare') || lower.includes('analyze') || lower.includes('summarize')) {
    return 'research';
  }

  return 'simple';
}

export async function processTask(request: TaskRequest): Promise<TaskResult> {
  const startTime = Date.now();

  console.log(`[PROCESSOR] Processing task from ${request.channel}: "${request.body.substring(0, 80)}"`);

  // Load personality and user context
  const personality = await loadPersonality();
  const userContext = await loadUserContext();

  // Classify task
  const taskType = classifyTask(request.body);
  console.log(`[PROCESSOR] Task type: ${taskType}`);

  // Handle browser tasks with REAL execution
  if (taskType === 'browser') {
    console.log('[PROCESSOR] 🌐 Launching browser for real execution...');

    let browser = null;
    let page = null;

    try {
      // Launch browser
      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      });

      page = await context.newPage();

      // Generate execution plan using AI
      console.log('[PROCESSOR] Generating execution plan...');
      const plan = await generateExecutionPlan(request.body);
      console.log(`[PROCESSOR] Plan generated: ${plan.steps.length} steps`);

      // Execute plan
      const executor = new AutonomousExecutor();
      const result = await executor.execute(page, plan);

      // Capture screenshot for verification
      let screenshot: string | undefined;
      try {
        const buffer = await page.screenshot({ type: 'png' });
        screenshot = buffer.toString('base64');
      } catch {
        // Screenshot optional
      }

      // 3-Step Verification (OpenClaw feature)
      const verification = await verify3Step(request.body, result.result, screenshot);
      console.log(`[PROCESSOR] Verification: ${verification.confidence}% confidence`);

      // Close browser
      await browser.close();

      const duration = Date.now() - startTime;

      if (result.success && verification.verified) {
        console.log(`[PROCESSOR] ✅ Browser task completed & verified in ${duration}ms (${result.stepsExecuted} steps)`);

        return {
          success: true,
          message: result.result?.answer || `Task completed successfully. ${JSON.stringify(result.result || {})}`,
        };
      } else if (result.success && !verification.verified) {
        console.log(`[PROCESSOR] ⚠️ Task completed but verification failed (${verification.confidence}% confidence)`);

        return {
          success: false,
          message: `I completed the task but I'm not ${verification.confidence}% confident. ${verification.evidence.join('. ')}`,
        };
      } else {
        console.log(`[PROCESSOR] ❌ Browser task failed: ${result.error}`);

        return {
          success: false,
          message: `I tried to execute this in the browser but encountered an issue: ${result.error}. Let me try answering directly instead.`,
        };
      }
    } catch (error: any) {
      console.error(`[PROCESSOR] ❌ Browser error:`, error.message);

      if (browser) {
        await browser.close().catch(() => {});
      }

      // Fallback to AI-only response
      console.log('[PROCESSOR] Falling back to AI-only response...');
    }
  }

  // For non-browser tasks OR browser fallback, use AI
  const systemPrompt = `${personality}

${userContext ? `## User Context\n${userContext}\n` : ''}

## Current Time
${new Date().toISOString()}

## Task Channel
${request.channel} from ${request.from}

## Instructions
Respond to the user's request. Be helpful and concise.
NEVER mention that you're an AI or apologize. Just answer the question.
If you cannot perform a task, say so directly without excuses.`;

  try {
    // Determine AI task type for model routing
    const aiTaskType = taskType === 'simple' ? 'respond' : taskType === 'browser' ? 'plan' : 'reason';

    const aiResponse = await callAI(request.body, systemPrompt, aiTaskType);

    const duration = Date.now() - startTime;
    console.log(`[PROCESSOR] ✅ Task completed in ${duration}ms (${aiResponse.model}, $${aiResponse.cost?.toFixed(6)})`);

    return {
      success: true,
      message: aiResponse.content,
      model: aiResponse.model,
      cost: aiResponse.cost,
      tokens: aiResponse.tokens,
    };
  } catch (error: any) {
    console.error(`[PROCESSOR] ❌ All AI models failed:`, error.message);

    return {
      success: false,
      message: 'I hit a snag with all AI providers. This is unusual - I\'ll try again shortly.',
    };
  }
}
