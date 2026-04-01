/**
 * Intent Detector — LLM-based ambient intent detection for Anticipy
 *
 * Replaces all regex-based intent detection. Uses a rolling conversation
 * buffer + LLM to understand CONTEXT and detect actionable intents
 * from ambient speech.
 *
 * The LLM sees the FULL conversation so far (up to 10 min / ~5000 words),
 * so it can connect dots across multiple sentences and understand nuance
 * that regex never could.
 */

import { logger } from "../utils/logger.js";

// ---- Constants ----

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_INTENT_MODEL = "llama-3.3-70b-versatile"; // Stronger model for nuanced reasoning
const INTENT_TIMEOUT_MS = 10_000; // 10s max
const BUFFER_MAX_WORDS = 5000; // ~10 min of conversation
const MIN_WORDS_FOR_DETECTION = 8; // Don't bother LLM with tiny fragments
const COOLDOWN_MS = 5_000; // Don't re-analyze within 5s of last detection

// Track what we already detected to avoid duplicates within a session
const sessionDetections = new Map<string, { lastDetectionAt: number; detectedActions: Set<string> }>();

// ---- Types ----

export interface DetectedIntent {
  action: string;
  details: Record<string, unknown>;
  confidence: number;
  reasoning: string;
}

interface LLMResponse {
  actionable: boolean;
  actions?: Array<{
    action: string;
    details: Record<string, unknown>;
    confidence: number;
    reasoning: string;
  }>;
  action?: string;
  details?: Record<string, unknown>;
  confidence?: number;
  reasoning?: string;
}

// ---- System Prompt ----

const INTENT_SYSTEM_PROMPT = `You are an intelligent ambient assistant. You are listening to a live conversation. You see the full transcript so far. Your job: identify if the speaker mentioned something that should be acted on — even though they did NOT ask you to do anything.

Look for:
- Tasks they mentioned needing to do
- Deadlines that changed
- Subscriptions to cancel
- People to email or call
- Appointments to make
- Disputes to file
- Bills that are due
- Commitments they made to others
- Calendar changes mentioned in passing

Extract the specific action, any details (names, dates, numbers, amounts), and your confidence level (0-1).

CRITICAL RULES:
1. The speaker is talking to ANOTHER PERSON, not to you. They won't say "hey assistant do X."
2. Do NOT flag vague wishes ("maybe someday I'll..."), hypotheticals ("what if we..."), or references to fiction/movies/TV/podcasts/books.
3. Do NOT flag things that already happened in the past ("I canceled it last week").
4. Do NOT flag things someone ELSE needs to do ("my mom needs to book..." or "he said he needs to...").
5. Only flag things the SPEAKER personally needs/wants/should do, or real events that require the speaker's action.
6. If there are MULTIPLE actionable items, return them ALL as an array.
7. If confidence is below 0.7, do NOT include it.

Respond ONLY with valid JSON. Two possible formats:

Nothing actionable:
{"actionable": false}

One or more actionable items:
{"actionable": true, "actions": [{"action": "description of what to do", "details": {"key": "value"}, "confidence": 0.X, "reasoning": "why this is actionable"}]}`;

// ---- Rolling Buffer ----

export class ConversationBuffer {
  private chunks: string[] = [];
  private totalWords = 0;

  append(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;

    this.chunks.push(trimmed);
    this.totalWords += trimmed.split(/\s+/).length;

    // Trim from beginning if over max
    while (this.totalWords > BUFFER_MAX_WORDS && this.chunks.length > 1) {
      const removed = this.chunks.shift()!;
      this.totalWords -= removed.split(/\s+/).length;
    }
  }

  getFullTranscript(): string {
    return this.chunks.join(' ');
  }

  getWordCount(): number {
    return this.totalWords;
  }

  clear(): void {
    this.chunks = [];
    this.totalWords = 0;
  }
}

// ---- LLM Intent Detection ----

/**
 * Send the full conversation buffer to the LLM for intent detection.
 * Returns detected intents (if any) with confidence > 0.7.
 */
export async function detectIntentsFromBuffer(
  buffer: ConversationBuffer,
  sessionId: string
): Promise<DetectedIntent[]> {
  const transcript = buffer.getFullTranscript();
  const wordCount = buffer.getWordCount();

  // Don't bother with tiny fragments
  if (wordCount < MIN_WORDS_FOR_DETECTION) {
    return [];
  }

  // Cooldown: don't re-analyze too frequently
  const session = sessionDetections.get(sessionId);
  if (session && Date.now() - session.lastDetectionAt < COOLDOWN_MS) {
    return [];
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    logger.debug("[INTENT] No GROQ_API_KEY — skipping detection");
    return [];
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INTENT_TIMEOUT_MS);

  try {
    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_INTENT_MODEL,
        messages: [
          { role: "system", content: INTENT_SYSTEM_PROMPT },
          { role: "user", content: `FULL CONVERSATION TRANSCRIPT SO FAR:\n\n${transcript}` },
        ],
        temperature: 0.1,
        max_tokens: 1024,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 429 || status === 402) {
        logger.debug("[INTENT] Groq rate-limited (%d) — skipping", status);
      } else {
        logger.warn("[INTENT] Groq intent detection failed with status %d", status);
      }
      return [];
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) return [];

    const parsed = JSON.parse(content) as LLMResponse;

    if (!parsed || !parsed.actionable) return [];

    // Normalize: support both single-action and multi-action formats
    let actions: Array<{ action: string; details: Record<string, unknown>; confidence: number; reasoning: string }> = [];

    if (parsed.actions && Array.isArray(parsed.actions)) {
      actions = parsed.actions;
    } else if (parsed.action) {
      actions = [{
        action: parsed.action,
        details: parsed.details || {},
        confidence: parsed.confidence || 0,
        reasoning: parsed.reasoning || '',
      }];
    }

    // Filter by confidence threshold and deduplicate within session
    const sessionData = sessionDetections.get(sessionId) || {
      lastDetectionAt: 0,
      detectedActions: new Set<string>(),
    };

    const newIntents: DetectedIntent[] = [];

    for (const a of actions) {
      if (a.confidence < 0.7) continue;

      // Deduplicate: skip if we already detected something very similar
      const actionKey = a.action.toLowerCase().substring(0, 50);
      if (sessionData.detectedActions.has(actionKey)) continue;

      sessionData.detectedActions.add(actionKey);
      newIntents.push({
        action: a.action,
        details: a.details || {},
        confidence: a.confidence,
        reasoning: a.reasoning || '',
      });
    }

    sessionData.lastDetectionAt = Date.now();
    sessionDetections.set(sessionId, sessionData);

    if (newIntents.length > 0) {
      logger.info(
        { sessionId: sessionId.substring(0, 8), count: newIntents.length },
        "[INTENT] Detected %d actionable intent(s) from %d-word buffer",
        newIntents.length,
        wordCount
      );
    }

    return newIntents;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      logger.debug("[INTENT] Detection timed out");
    } else {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "[INTENT] Detection error"
      );
    }
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/** Clean up session tracking when a listening session ends */
export function clearSessionDetections(sessionId: string): void {
  sessionDetections.delete(sessionId);
}

/**
 * Exported for testing — run intent detection on raw text
 * without needing a ConversationBuffer or session.
 */
export async function detectIntentsFromText(text: string): Promise<DetectedIntent[]> {
  const buffer = new ConversationBuffer();
  buffer.append(text);
  return detectIntentsFromBuffer(buffer, `test-${Date.now()}`);
}
