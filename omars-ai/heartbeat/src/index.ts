import { checkTimeTriggers } from './triggers/time.js';
import { checkCalendarTriggers } from './triggers/calendar.js';
import { checkInboxTriggers } from './triggers/inbox.js';
import { checkPriceTriggers } from './triggers/price.js';
import { checkHabitTriggers } from './triggers/habit.js';
import { checkCleanupTriggers } from './triggers/cleanup.js';
import { checkBudgetTriggers } from './triggers/budget.js';
import { checkPresenceTriggers } from './triggers/presence.js';
import type { TriggerResult } from './types.js';
import fs from 'fs/promises';
import dotenv from 'dotenv';

dotenv.config();

const HEARTBEAT_MD = process.env.HEARTBEAT_MD || '/home/omars-ai/assistant/memory/heartbeat.md';
const CORE_URL = process.env.CORE_URL || 'http://localhost:3002';
const WEBHOOK_SECRET = process.env.GATEWAY_WEBHOOK_SECRET || '';

interface HeartbeatState {
  presenceMode: 'active' | 'idle' | 'sleep';
  lastCheck: Record<string, number>;
  triggerCount: Record<string, number>;
}

const state: HeartbeatState = {
  presenceMode: 'idle',
  lastCheck: {},
  triggerCount: {},
};

function isQuietHours(): boolean {
  const hour = new Date().getHours();
  const quietStart = Number(process.env.QUIET_START) || 22;
  const quietEnd = Number(process.env.QUIET_END) || 7;

  return hour >= quietStart || hour < quietEnd;
}

function getInterval(): number {
  const activeInterval = Number(process.env.HEARTBEAT_ACTIVE_INTERVAL) || 5;
  const idleInterval = Number(process.env.HEARTBEAT_IDLE_INTERVAL) || 30;
  const sleepInterval = Number(process.env.HEARTBEAT_SLEEP_INTERVAL) || 360;

  switch (state.presenceMode) {
    case 'active': return activeInterval * 60 * 1000;
    case 'idle': return idleInterval * 60 * 1000;
    case 'sleep': return sleepInterval * 60 * 1000;
  }
}

async function runHeartbeat(): Promise<void> {
  console.log(`[HEARTBEAT] Running (mode: ${state.presenceMode}, quiet: ${isQuietHours()})`);

  try {
    await updateHeartbeatContext();

    const triggers = [
      checkTimeTriggers,
      checkCalendarTriggers,
      checkInboxTriggers,
      checkPriceTriggers,
      checkHabitTriggers,
      checkCleanupTriggers,
      checkBudgetTriggers,
      checkPresenceTriggers,
    ];

    for (const trigger of triggers) {
      try {
        const results = await trigger(state);

        for (const result of results) {
          if (result.shouldTrigger) {
            if (isQuietHours() && !result.critical) {
              console.log(`[HEARTBEAT] Skipping (quiet hours): ${result.description}`);
              continue;
            }

            await executeProactiveTask(result);

            state.triggerCount[result.type] = (state.triggerCount[result.type] || 0) + 1;
            state.lastCheck[result.type] = Date.now();
          }
        }
      } catch (error: any) {
        console.error(`[HEARTBEAT] Trigger error:`, error.message);
      }
    }
  } catch (error: any) {
    console.error(`[HEARTBEAT] Error:`, error.message);
  }

  const interval = getInterval();
  setTimeout(runHeartbeat, interval);
  console.log(`[HEARTBEAT] Next run in ${interval / 60000} minutes`);
}

async function updateHeartbeatContext(): Promise<void> {
  const context = `# Heartbeat Context

Last updated: ${new Date().toISOString()}
Mode: ${state.presenceMode}
Quiet hours: ${isQuietHours() ? 'YES' : 'NO'}

## Trigger Counts
${Object.entries(state.triggerCount).map(([k, v]) => `- ${k}: ${v}`).join('\n') || '- No triggers fired yet'}

## Status
System running normally. Monitoring 8 trigger types.
`;

  try {
    await fs.writeFile(HEARTBEAT_MD, context, 'utf-8');
  } catch (error: any) {
    console.error('[HEARTBEAT] Failed to write heartbeat.md:', error.message);
  }
}

async function executeProactiveTask(trigger: TriggerResult): Promise<void> {
  console.log(`[HEARTBEAT] Executing: ${trigger.description}`);

  try {
    const response = await fetch(`${CORE_URL}/task`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        userId: 'omar',
        username: 'omar',
        channel: 'proactive',
        from: 'heartbeat_engine',
        body: trigger.taskDescription,
      }),
    });

    if (response.ok) {
      console.log(`[HEARTBEAT] Task sent successfully`);
    } else {
      console.error(`[HEARTBEAT] Failed to send task: ${response.status}`);
    }
  } catch (error: any) {
    console.error(`[HEARTBEAT] Error sending task:`, error.message);
  }
}

// Listen for presence updates (IPC messages from Vision system)
process.on('message', (msg: any) => {
  if (msg.type === 'presence') {
    state.presenceMode = msg.present ? 'active' : 'idle';
    console.log(`[HEARTBEAT] Presence mode: ${state.presenceMode}`);
  }
});

// Start
console.log('[HEARTBEAT] Starting proactive engine...');
console.log(`[HEARTBEAT] Initial mode: ${state.presenceMode}`);
console.log(`[HEARTBEAT] Quiet hours: ${process.env.QUIET_START || 22}:00 - ${process.env.QUIET_END || 7}:00`);
runHeartbeat();
