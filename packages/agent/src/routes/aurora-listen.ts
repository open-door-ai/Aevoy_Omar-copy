/**
 * Aurora Listen — Deepgram WebSocket Proxy
 *
 * Browser mic sends audio chunks to `/aurora/listen/ws`.
 * This module proxies them to Deepgram for real-time transcription,
 * then feeds final transcripts into the context engine so Aurora
 * learns from ambient speech.
 *
 * Budget: 120 listening-minutes per user per day (in-memory tracker,
 * resets on process restart — acceptable for an MVP guard).
 */

import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage } from 'http';
import type { Server } from 'http';
import { extractContext } from '../services/context-engine.js';
import { logger } from '../utils/logger.js';

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const MAX_LISTEN_MINUTES = 120; // 2 hours max per user per day

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

// ---- WebSocket setup ----

export function setupListenWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request: IncomingMessage, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);

    if (url.pathname !== '/aurora/listen/ws') {
      // Not our route — let other upgrade handlers deal with it
      return;
    }

    const userId = url.searchParams.get('userId');

    if (!userId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    if (!DEEPGRAM_API_KEY) {
      logger.warn('DEEPGRAM_API_KEY not set — listening disabled');
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }

    if (!checkListeningBudget(userId)) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, userId);
    });
  });

  wss.on('connection', (clientWs: WebSocket, _request: IncomingMessage, userId: string) => {
    logger.info({ userId }, 'Listening session started');

    // Connect to Deepgram Nova-2 streaming endpoint
    const deepgramUrl =
      'wss://api.deepgram.com/v1/listen?' +
      'encoding=linear16&sample_rate=16000&channels=1' +
      '&model=nova-2&punctuate=true&vad_events=true&interim_results=false';

    const deepgramWs = new WebSocket(deepgramUrl, {
      headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` },
    });

    let minuteTimer: ReturnType<typeof setInterval> | null = null;
    let transcriptBuffer = '';

    deepgramWs.on('open', () => {
      logger.info({ userId }, 'Deepgram connection established');

      // Track one listening minute every 60 s
      minuteTimer = setInterval(() => {
        trackListeningMinute(userId);
        if (!checkListeningBudget(userId)) {
          clientWs.send(
            JSON.stringify({ type: 'budget_exceeded', message: 'Listening budget exceeded for today.' })
          );
          clientWs.close();
        }
      }, 60_000);
    });

    deepgramWs.on('message', (data: Buffer) => {
      try {
        const result = JSON.parse(data.toString());

        // Final transcript from Deepgram
        if (result.type === 'Results' && result.is_final) {
          const transcript: string | undefined = result.channel?.alternatives?.[0]?.transcript;
          if (transcript && transcript.trim().length > 0) {
            transcriptBuffer += ' ' + transcript.trim();

            // Echo back to the browser for visual feedback
            clientWs.send(
              JSON.stringify({
                type: 'transcript',
                text: transcript.trim(),
                is_final: true,
              })
            );

            // After ~20+ words, run context extraction
            if (transcriptBuffer.split(' ').length > 20) {
              const textToExtract = transcriptBuffer.trim();
              transcriptBuffer = '';

              // Fire and forget — don't block the audio stream
              extractContext(textToExtract, userId, 'microphone').catch((err) => {
                logger.error({ err, userId }, 'Mic context extraction failed');
              });
            }
          }
        }

        // Forward VAD events for waveform visualization
        if (result.type === 'SpeechStarted' || result.type === 'UtteranceEnd') {
          clientWs.send(JSON.stringify({ type: result.type }));
        }
      } catch {
        // Ignore parse errors from non-JSON Deepgram frames
      }
    });

    deepgramWs.on('error', (err) => {
      logger.error({ err, userId }, 'Deepgram WebSocket error');
      clientWs.send(JSON.stringify({ type: 'error', message: 'Transcription service error' }));
    });

    deepgramWs.on('close', () => {
      logger.info({ userId }, 'Deepgram connection closed');
    });

    // Forward raw audio from browser → Deepgram
    clientWs.on('message', (data: Buffer) => {
      if (deepgramWs.readyState === WebSocket.OPEN) {
        deepgramWs.send(data);
      }
    });

    clientWs.on('close', () => {
      logger.info({ userId }, 'Listening session ended');

      if (minuteTimer) clearInterval(minuteTimer);

      // Flush remaining transcript buffer
      if (transcriptBuffer.trim().length > 5) {
        extractContext(transcriptBuffer.trim(), userId, 'microphone').catch((err) => {
          logger.error({ err, userId }, 'Final mic extraction failed');
        });
        transcriptBuffer = '';
      }

      if (deepgramWs.readyState === WebSocket.OPEN) {
        deepgramWs.close();
      }
    });

    clientWs.on('error', () => {
      if (deepgramWs.readyState === WebSocket.OPEN) {
        deepgramWs.close();
      }
    });
  });
}
