/**
 * Browser Takeover WebSocket Server
 *
 * Streams live screenshots from an active browser session to the dashboard,
 * and proxies user input (click, type, scroll) back to the browser page.
 *
 * Protocol (Server → Client):
 *   { type: 'screenshot', data: base64, url, title, timestamp }
 *   { type: 'status', connected: bool, message: string }
 *   { type: 'error', message: string }
 *
 * Protocol (Client → Server):
 *   { type: 'click', x, y }
 *   { type: 'dblclick', x, y }
 *   { type: 'type', text }
 *   { type: 'press', key }
 *   { type: 'scroll', deltaX, deltaY }
 *   { type: 'navigate', url }
 */

import type { WebSocket } from 'ws';
import type { Page } from 'patchright';
import { getEngine, setTakeoverActive } from '../utils/task-engine-registry.js';
import { getSupabaseClient } from '../utils/supabase.js';

const FRAME_INTERVAL_MS = 333; // ~3 FPS
const MAX_SESSION_MS = 30 * 60 * 1000; // 30 minutes
const MAX_EVENTS_PER_SEC = 20;
const MAX_TEXT_LENGTH = 1000;
const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 800;

// Allowed special keys for 'press' action
const ALLOWED_KEYS = new Set([
  'Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'Space',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown',
  'Control+a', 'Control+c', 'Control+v', 'Control+x', 'Control+z',
]);

interface TakeoverMessage {
  type: string;
  x?: number;
  y?: number;
  text?: string;
  key?: string;
  deltaX?: number;
  deltaY?: number;
  url?: string;
}

function validateCoords(x: unknown, y: unknown): { x: number; y: number } | null {
  const nx = Number(x);
  const ny = Number(y);
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;
  if (nx < 0 || nx > VIEWPORT_WIDTH || ny < 0 || ny > VIEWPORT_HEIGHT) return null;
  return { x: Math.round(nx), y: Math.round(ny) };
}

function isUrlSafe(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.0\.0\.0|localhost)/i.test(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

export async function handleBrowserTakeoverWs(
  ws: WebSocket,
  taskId: string,
  token: string
): Promise<void> {
  const sessionStart = Date.now();
  let frameTimer: ReturnType<typeof setInterval> | null = null;
  let eventCount = 0;
  let eventResetTimer: ReturnType<typeof setInterval> | null = null;
  let isSending = false;

  // Validate token
  let validatedUserId: string | null = null;
  try {
    const { data: tokenRow } = await getSupabaseClient()
      .from('takeover_tokens')
      .select('user_id, task_id, expires_at, used')
      .eq('token', token)
      .single();

    if (!tokenRow || tokenRow.used || tokenRow.task_id !== taskId) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid or expired token' }));
      ws.close(4001, 'Invalid token');
      return;
    }
    if (new Date(tokenRow.expires_at) < new Date()) {
      ws.send(JSON.stringify({ type: 'error', message: 'Token expired' }));
      ws.close(4001, 'Token expired');
      return;
    }

    // Mark token as used (single-use)
    await getSupabaseClient()
      .from('takeover_tokens')
      .update({ used: true })
      .eq('token', token);

    validatedUserId = tokenRow.user_id;
  } catch (err) {
    console.error('[TAKEOVER-WS] Token validation failed:', err);
    ws.send(JSON.stringify({ type: 'error', message: 'Authentication failed' }));
    ws.close(4001, 'Auth failed');
    return;
  }

  // Look up engine
  const entry = getEngine(taskId);
  if (!entry) {
    ws.send(JSON.stringify({ type: 'error', message: 'No active browser session for this task' }));
    ws.close(4004, 'No engine');
    return;
  }

  // Verify ownership
  if (entry.userId !== validatedUserId) {
    ws.send(JSON.stringify({ type: 'error', message: 'Task does not belong to you' }));
    ws.close(4003, 'Forbidden');
    return;
  }

  const page: Page | null = entry.engine.getPage();
  if (!page) {
    ws.send(JSON.stringify({ type: 'error', message: 'Browser page not available' }));
    ws.close(4004, 'No page');
    return;
  }

  // Pause the vision agent so user has exclusive browser control
  setTakeoverActive(taskId, true);

  console.log(`[TAKEOVER-WS] Session started for task ${taskId.slice(0, 8)}`);
  ws.send(JSON.stringify({ type: 'status', connected: true, message: 'Connected to browser session' }));

  // Rate limiting reset
  eventResetTimer = setInterval(() => { eventCount = 0; }, 1000);

  // Screenshot streaming
  const sendFrame = async () => {
    if (isSending || ws.readyState !== 1) return;
    isSending = true;
    try {
      const p = entry.engine.getPage();
      if (!p || p.isClosed()) {
        ws.send(JSON.stringify({ type: 'status', connected: false, message: 'Browser session ended' }));
        cleanup();
        return;
      }
      const buf = await p.screenshot({ type: 'jpeg', quality: 50, clip: { x: 0, y: 0, width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT } });
      const msg = JSON.stringify({
        type: 'screenshot',
        data: buf.toString('base64'),
        url: p.url(),
        title: await p.title().catch(() => ''),
        timestamp: Date.now(),
      });
      if (ws.readyState === 1) ws.send(msg);
    } catch {
      // Page may have navigated — skip frame
    } finally {
      isSending = false;
    }
  };

  frameTimer = setInterval(sendFrame, FRAME_INTERVAL_MS);
  // Send first frame immediately
  void sendFrame();

  // Handle input from client
  ws.on('message', async (raw) => {
    // Session timeout
    if (Date.now() - sessionStart > MAX_SESSION_MS) {
      ws.send(JSON.stringify({ type: 'error', message: 'Session timed out (30 min max)' }));
      cleanup();
      return;
    }

    // Rate limit
    eventCount++;
    if (eventCount > MAX_EVENTS_PER_SEC) return;

    let msg: TakeoverMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const p = entry.engine.getPage();
    if (!p || p.isClosed()) return;

    try {
      switch (msg.type) {
        case 'click': {
          const coords = validateCoords(msg.x, msg.y);
          if (!coords) return;
          await p.mouse.click(coords.x, coords.y);
          break;
        }
        case 'dblclick': {
          const coords = validateCoords(msg.x, msg.y);
          if (!coords) return;
          await p.mouse.dblclick(coords.x, coords.y);
          break;
        }
        case 'type': {
          if (!msg.text || typeof msg.text !== 'string') return;
          const text = msg.text.slice(0, MAX_TEXT_LENGTH);
          await p.keyboard.type(text);
          break;
        }
        case 'press': {
          if (!msg.key || !ALLOWED_KEYS.has(msg.key)) return;
          await p.keyboard.press(msg.key);
          break;
        }
        case 'scroll': {
          const dx = Number(msg.deltaX) || 0;
          const dy = Number(msg.deltaY) || 0;
          const clampedDx = Math.max(-1000, Math.min(1000, dx));
          const clampedDy = Math.max(-1000, Math.min(1000, dy));
          await p.mouse.wheel(clampedDx, clampedDy);
          break;
        }
        case 'navigate': {
          if (!msg.url || typeof msg.url !== 'string' || !isUrlSafe(msg.url)) return;
          await p.goto(msg.url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          break;
        }
      }
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: `Action failed: ${err instanceof Error ? err.message : 'unknown'}` }));
    }
  });

  function cleanup() {
    if (frameTimer) { clearInterval(frameTimer); frameTimer = null; }
    if (eventResetTimer) { clearInterval(eventResetTimer); eventResetTimer = null; }
    // Release the vision agent so it can resume
    setTakeoverActive(taskId, false);
    if (ws.readyState <= 1) ws.close();
    console.log(`[TAKEOVER-WS] Session ended for task ${taskId.slice(0, 8)}`);
  }

  ws.on('close', cleanup);
  ws.on('error', cleanup);

  // Auto-close after max session time
  setTimeout(() => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'status', connected: false, message: 'Session timed out' }));
      cleanup();
    }
  }, MAX_SESSION_MS);
}
