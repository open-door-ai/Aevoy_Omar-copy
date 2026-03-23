/**
 * Aurora Listen — Deepgram WebSocket Proxy (Hardened)
 *
 * Browser mic sends audio chunks to `/aurora/listen/ws`.
 * This module proxies them to Deepgram for real-time transcription,
 * then feeds final transcripts into the context engine so Aurora
 * learns from ambient speech.
 *
 * Security:
 * - Client must send `{ type: 'auth', userId, token }` as its first message.
 *   Server validates the JWT against Supabase before accepting audio.
 * - Max 1 concurrent session per user (duplicate tabs get an error + close).
 *
 * Resilience:
 * - Deepgram reconnection: 3 retries at 2 s intervals, audio buffered during gap (max 30 s).
 * - Transcript batching: fragments < 3 words are queued and concatenated with the next final.
 * - 4-hour max session length enforced server-side.
 * - Graceful SIGTERM: all clients receive `{ type: 'server_restarting' }` before close.
 *
 * Cost tracking:
 * - ~$0.0077 per listening minute tracked into daily_spend_tracking.ai_spend_cents.
 *
 * Budget: 120 listening-minutes per user per day (in-memory tracker,
 * resets on process restart — acceptable for an MVP guard).
 */

import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage } from 'http';
import type { Server } from 'http';
import { createClient } from '@supabase/supabase-js';
import { extractContext } from '../services/context-engine.js';
import { trackSpend } from '../services/cost-circuit-breaker.js';
import { logger } from '../utils/logger.js';

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const MAX_LISTEN_MINUTES = 120; // 2 hours max per user per day
const MAX_SESSION_MS = 4 * 60 * 60 * 1000; // 4 hours absolute max per session
const DEEPGRAM_RECONNECT_ATTEMPTS = 3;
const DEEPGRAM_RECONNECT_INTERVAL_MS = 2_000;
const AUDIO_BUFFER_MAX_SECONDS = 30;
const AUDIO_BUFFER_MAX_CHUNKS = AUDIO_BUFFER_MAX_SECONDS * (16_000 / 4_096); // ~117 chunks at 16 kHz / 4096 byte frames
const LISTENING_COST_CENTS_PER_MINUTE = 0.77; // $0.0077 ≈ 0.77 cents
const MIN_WORDS_FOR_BATCH = 3;

// ---- Per-user daily listening budget (in-memory) ----

const listeningTracker = new Map<string, { minutes: number; date: string }>();

function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

function checkListeningBudget(userId: string): boolean {
  const today = getTodayDate();
  const tracker = listeningTracker.get(userId);
  if (!tracker || tracker.date !== today) {
    listeningTracker.set(userId, { minutes: 0, date: today });
    return true;
  }
  return tracker.minutes < MAX_LISTEN_MINUTES;
}

function trackListeningMinute(userId: string): void {
  const today = getTodayDate();
  const tracker = listeningTracker.get(userId) || { minutes: 0, date: today };
  if (tracker.date !== today) {
    tracker.minutes = 0;
    tracker.date = today;
  }
  tracker.minutes++;
  listeningTracker.set(userId, tracker);
}

// ---- Per-user session dedup ----

const activeSessions = new Map<string, WebSocket>();

// ---- JWT auth via Supabase ----

let supabaseAuth: ReturnType<typeof createClient> | null = null;

function getSupabaseAuthClient() {
  if (!supabaseAuth) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set for JWT validation');
    }
    supabaseAuth = createClient(url, anonKey);
  }
  return supabaseAuth;
}

async function validateToken(token: string, claimedUserId: string): Promise<boolean> {
  try {
    const client = getSupabaseAuthClient();
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user) return false;
    return data.user.id === claimedUserId;
  } catch {
    return false;
  }
}

// ---- Deepgram URL builder ----

function buildDeepgramUrl(): string {
  return (
    'wss://api.deepgram.com/v1/listen?' +
    'encoding=linear16&sample_rate=16000&channels=1' +
    '&model=nova-2&punctuate=true&vad_events=true&interim_results=false'
  );
}

// ---- Graceful shutdown registry ----

let wssInstance: WebSocketServer | null = null;

function handleGracefulShutdown() {
  if (!wssInstance) return;
  logger.info('[AURORA-LISTEN] SIGTERM received — notifying all listening clients');
  for (const client of wssInstance.clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify({ type: 'server_restarting' }));
        client.close(1012, 'Server restarting');
      } catch { /* best effort */ }
    }
  }
}

// Register once — idempotent via a module-level flag
let shutdownRegistered = false;

// ---- WebSocket setup ----

export function setupListenWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });
  wssInstance = wss;

  if (!shutdownRegistered) {
    process.on('SIGTERM', handleGracefulShutdown);
    process.on('SIGINT', handleGracefulShutdown);
    shutdownRegistered = true;
  }

  server.on('upgrade', (request: IncomingMessage, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);

    if (url.pathname !== '/aurora/listen/ws') {
      // Not our route — let other upgrade handlers deal with it
      return;
    }

    if (!DEEPGRAM_API_KEY) {
      logger.warn('DEEPGRAM_API_KEY not set — listening disabled');
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }

    // Accept the upgrade — auth happens via the first message (JWT)
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (clientWs: WebSocket, _request: IncomingMessage) => {
    let authenticated = false;
    let userId: string | null = null;
    let deepgramWs: WebSocket | null = null;
    let minuteTimer: ReturnType<typeof setInterval> | null = null;
    let sessionTimer: ReturnType<typeof setTimeout> | null = null;
    let transcriptBuffer = '';
    let pendingBatch = ''; // For batching short transcripts (< 3 words)
    let reconnecting = false;
    let audioBuffer: Buffer[] = [];
    let sessionStartMs = 0;
    let totalMinutesTracked = 0;

    // ---- Auth timeout: must authenticate within 10 seconds ----
    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        sendJson(clientWs, { type: 'error', message: 'Authentication timeout' });
        clientWs.close(4001, 'Auth timeout');
      }
    }, 10_000);

    // ---- Helper: send JSON to client ----
    function sendJson(ws: WebSocket, obj: Record<string, unknown>): void {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(obj));
        } catch { /* ignore send errors on closing sockets */ }
      }
    }

    // ---- Deepgram connection factory (supports reconnection) ----
    function connectDeepgram(): WebSocket {
      const dg = new WebSocket(buildDeepgramUrl(), {
        headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` },
      });

      dg.on('open', () => {
        logger.info({ userId }, 'Deepgram connection established');
        reconnecting = false;

        // Flush buffered audio chunks
        if (audioBuffer.length > 0) {
          logger.info({ userId, chunks: audioBuffer.length }, 'Flushing buffered audio after reconnect');
          for (const chunk of audioBuffer) {
            if (dg.readyState === WebSocket.OPEN) {
              dg.send(chunk);
            }
          }
          audioBuffer = [];
        }
      });

      dg.on('message', (data: Buffer) => {
        try {
          const result = JSON.parse(data.toString());

          // Final transcript from Deepgram
          if (result.type === 'Results' && result.is_final) {
            const transcript: string | undefined = result.channel?.alternatives?.[0]?.transcript;
            if (transcript && transcript.trim().length > 0) {
              const trimmed = transcript.trim();
              const wordCount = trimmed.split(/\s+/).length;

              // Batch short transcripts (< MIN_WORDS_FOR_BATCH words)
              if (wordCount < MIN_WORDS_FOR_BATCH) {
                pendingBatch += (pendingBatch ? ' ' : '') + trimmed;
                // Don't echo or process yet — wait for next final to concatenate
                return;
              }

              // Prepend any pending batch
              const fullTranscript = pendingBatch
                ? pendingBatch + ' ' + trimmed
                : trimmed;
              pendingBatch = '';

              transcriptBuffer += ' ' + fullTranscript;

              // Echo back to the browser for visual feedback
              sendJson(clientWs, {
                type: 'transcript',
                text: fullTranscript,
                is_final: true,
              });

              // After ~20+ words, run context extraction
              if (transcriptBuffer.split(' ').length > 20) {
                const textToExtract = transcriptBuffer.trim();
                transcriptBuffer = '';

                // Fire and forget — don't block the audio stream
                extractContext(textToExtract, userId!, 'microphone').catch((err) => {
                  logger.error({ err, userId }, 'Mic context extraction failed');
                });
              }
            }
          }

          // Forward VAD events for waveform visualization
          if (result.type === 'SpeechStarted' || result.type === 'UtteranceEnd') {
            sendJson(clientWs, { type: result.type });
          }
        } catch {
          // Ignore parse errors from non-JSON Deepgram frames
        }
      });

      dg.on('error', (err) => {
        logger.error({ err, userId }, 'Deepgram WebSocket error');
      });

      dg.on('close', (code, reason) => {
        logger.info({ userId, code, reason: reason?.toString() }, 'Deepgram connection closed');

        // Attempt reconnection if the client is still connected and we didn't close intentionally
        if (clientWs.readyState === WebSocket.OPEN && !reconnecting && authenticated) {
          attemptDeepgramReconnect();
        }
      });

      return dg;
    }

    // ---- Deepgram reconnection with audio buffering ----
    function attemptDeepgramReconnect(): void {
      reconnecting = true;
      audioBuffer = [];
      let attempt = 0;

      sendJson(clientWs, { type: 'transcription_paused', message: 'Reconnecting to transcription service...' });

      const tryReconnect = () => {
        attempt++;
        logger.info({ userId, attempt }, 'Attempting Deepgram reconnection');

        const newDg = connectDeepgram();
        const connectTimeout = setTimeout(() => {
          // If not connected within the interval, count as failed
          if (newDg.readyState !== WebSocket.OPEN) {
            newDg.terminate();
            if (attempt < DEEPGRAM_RECONNECT_ATTEMPTS && clientWs.readyState === WebSocket.OPEN) {
              setTimeout(tryReconnect, DEEPGRAM_RECONNECT_INTERVAL_MS);
            } else {
              // All retries exhausted
              reconnecting = false;
              audioBuffer = [];
              sendJson(clientWs, {
                type: 'transcription_paused',
                message: 'Transcription service unavailable. Audio is not being transcribed.',
              });
              logger.warn({ userId, attempts: attempt }, 'Deepgram reconnection failed after all retries');
            }
          }
        }, DEEPGRAM_RECONNECT_INTERVAL_MS);

        newDg.on('open', () => {
          clearTimeout(connectTimeout);
          deepgramWs = newDg;
          // reconnecting flag and buffer flushed inside connectDeepgram's on('open')
        });
      };

      setTimeout(tryReconnect, DEEPGRAM_RECONNECT_INTERVAL_MS);
    }

    // ---- Track listening cost to daily_spend_tracking ----
    async function trackListeningCost(uid: string): Promise<void> {
      try {
        await trackSpend(uid, 'in_app', LISTENING_COST_CENTS_PER_MINUTE);
      } catch (err) {
        logger.error({ err, userId: uid }, 'Failed to track listening cost');
      }
    }

    // ---- Start the actual listening session (post-auth) ----
    function startListeningSession(): void {
      sessionStartMs = Date.now();
      logger.info({ userId }, 'Listening session started (authenticated)');

      // Check session dedup — max 1 concurrent session per user
      const existing = activeSessions.get(userId!);
      if (existing && existing.readyState === WebSocket.OPEN) {
        sendJson(clientWs, { type: 'error', message: 'Already listening in another tab' });
        clientWs.close(4009, 'Duplicate session');
        return;
      }
      activeSessions.set(userId!, clientWs);

      // Check daily budget
      if (!checkListeningBudget(userId!)) {
        sendJson(clientWs, {
          type: 'budget_exceeded',
          message: 'Listening budget exceeded for today.',
        });
        clientWs.close(4029, 'Budget exceeded');
        activeSessions.delete(userId!);
        return;
      }

      // Connect to Deepgram
      deepgramWs = connectDeepgram();

      // Track one listening minute every 60 s
      minuteTimer = setInterval(() => {
        trackListeningMinute(userId!);
        totalMinutesTracked++;

        // Track cost in daily_spend_tracking
        trackListeningCost(userId!);

        if (!checkListeningBudget(userId!)) {
          sendJson(clientWs, {
            type: 'budget_exceeded',
            message: 'Listening budget exceeded for today.',
          });
          clientWs.close(4029, 'Budget exceeded');
        }
      }, 60_000);

      // 4-hour max session enforcement
      sessionTimer = setTimeout(() => {
        sendJson(clientWs, {
          type: 'session_expired',
          message: 'Maximum session length (4 hours) reached. Please reconnect to continue.',
        });
        clientWs.close(4008, 'Session expired');
      }, MAX_SESSION_MS);

      // Confirm auth success
      sendJson(clientWs, { type: 'authenticated' });
    }

    // ---- Message handler (auth + audio) ----
    clientWs.on('message', async (raw: Buffer) => {
      // Before auth: only accept JSON auth messages
      if (!authenticated) {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'auth' && msg.userId && msg.token) {
            const valid = await validateToken(msg.token, msg.userId);
            if (!valid) {
              sendJson(clientWs, { type: 'error', message: 'Invalid or expired token' });
              clientWs.close(4003, 'Auth failed');
              return;
            }

            clearTimeout(authTimeout);
            authenticated = true;
            userId = msg.userId;
            startListeningSession();
          } else {
            sendJson(clientWs, { type: 'error', message: 'First message must be auth' });
            clientWs.close(4001, 'Auth required');
          }
        } catch {
          sendJson(clientWs, { type: 'error', message: 'First message must be JSON auth' });
          clientWs.close(4001, 'Auth required');
        }
        return;
      }

      // After auth: forward raw audio to Deepgram
      if (reconnecting) {
        // Buffer audio during reconnection (up to 30 s)
        if (audioBuffer.length < AUDIO_BUFFER_MAX_CHUNKS) {
          audioBuffer.push(Buffer.from(raw));
        }
        return;
      }

      if (deepgramWs && deepgramWs.readyState === WebSocket.OPEN) {
        deepgramWs.send(raw);
      }
    });

    // ---- Client disconnect ----
    clientWs.on('close', () => {
      logger.info({ userId }, 'Listening session ended');
      clearTimeout(authTimeout);

      if (minuteTimer) clearInterval(minuteTimer);
      if (sessionTimer) clearTimeout(sessionTimer);

      // Clean up session registry
      if (userId) {
        const registered = activeSessions.get(userId);
        if (registered === clientWs) {
          activeSessions.delete(userId);
        }
      }

      // Flush remaining pending batch + transcript buffer
      const remaining = ((pendingBatch ? pendingBatch + ' ' : '') + transcriptBuffer).trim();
      if (remaining.length > 5 && userId) {
        extractContext(remaining, userId, 'microphone').catch((err) => {
          logger.error({ err, userId }, 'Final mic extraction failed');
        });
      }
      pendingBatch = '';
      transcriptBuffer = '';

      if (deepgramWs && deepgramWs.readyState === WebSocket.OPEN) {
        deepgramWs.close();
      }
    });

    clientWs.on('error', (err) => {
      logger.error({ err, userId }, 'Client WebSocket error');
      if (deepgramWs && deepgramWs.readyState === WebSocket.OPEN) {
        deepgramWs.close();
      }
    });
  });
}

/** Exported for testing — number of active listening sessions */
export function getActiveListeningSessions(): number {
  return activeSessions.size;
}
