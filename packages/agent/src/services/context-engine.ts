/**
 * Context Engine — Anticipy's Intelligence Core
 *
 * Runs LLM extraction on every user message to build a deep
 * understanding of the user over time. Extracts people, commitments,
 * preferences, emotions, locations, and topics — then merges into
 * the persistent user_context and commitments tables.
 *
 * Design principles:
 * - Runs asynchronously (never blocks the response to the user)
 * - Uses Groq (free) first; silently skips on rate-limit — never pays
 *   for routine extraction
 * - Short messages (<5 chars) are skipped entirely
 * - All writes go through Supabase with proper error handling
 */

import { getSupabaseClient } from "../utils/supabase.js";
import { logger } from "../utils/logger.js";

// ---- Types ----

interface PersonMentioned {
  name: string;
  relationship: string;
  context: string;
}

interface CommitmentExtracted {
  description: string;
  who: string;
  to_whom: string;
  due: string;
  confidence: number;
}

interface TaskImplied {
  description: string;
  urgency: "low" | "medium" | "high";
  confidence: number;
}

interface DateReferenced {
  date: string;
  context: string;
}

interface PreferenceExpressed {
  category: string;
  preference: string;
  confidence: number;
}

interface EmotionDetected {
  emotion: string;
  intensity: "low" | "medium" | "high";
  trigger: string;
}

interface LocationMentioned {
  place: string;
  context: string;
}

type Sentiment = "positive" | "neutral" | "negative" | "urgent" | "stressed" | "excited";

interface ExtractionResult {
  people_mentioned: PersonMentioned[];
  commitments: CommitmentExtracted[];
  tasks_implied: TaskImplied[];
  dates_referenced: DateReferenced[];
  preferences_expressed: PreferenceExpressed[];
  emotions_detected: EmotionDetected[];
  locations_mentioned: LocationMentioned[];
  topics: string[];
  sentiment: Sentiment;
}

type ContextType = "routine" | "preference" | "relationship" | "commitment" |
  "location" | "habit" | "emotion" | "financial" | "work" | "health";

// ---- Constants ----

const MIN_MESSAGE_LENGTH = 8; // Messages under 8 chars are too short to be actionable
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.1-8b-instant"; // Fast, free
const EXTRACTION_TIMEOUT_MS = 15_000; // 15s max for extraction
const MAX_MESSAGE_LENGTH_FOR_LLM = 2000; // Truncate before sending to extraction LLM
const MAX_EXTRACTIONS_PER_USER_PER_MINUTE = 5;

// ---- Skip set for trivial messages ----
// These are never worth sending to the LLM for extraction.
// Action detection (FIX 1) runs separately and handles its own filtering.
const SKIP_MESSAGES = new Set([
  'ok', 'okay', 'k', 'yes', 'no', 'yep', 'nope', 'yeah', 'nah',
  'sure', 'thanks', 'thank you', 'ty', 'thx', 'cool', 'nice',
  'got it', 'sounds good', 'good', 'great', 'awesome', 'perfect',
  'haha', 'lol', 'lmao', 'hm', 'hmm', 'mm', 'mhm', 'uh huh',
  'hi', 'hey', 'hello', 'yo', 'sup', 'bye', 'later', 'gn',
  'idk', 'idc', 'nvm', 'nm', 'nothing', 'nevermind',
]);

// ---- Communication Style Extraction (FREE — regex only, no LLM) ----
// Detects HOW the user communicates so Anticipy can mirror their style over time.

async function extractCommunicationStyle(message: string, userId: string): Promise<void> {
  // Only analyze messages long enough to show style (>20 chars)
  if (message.length < 20) return;

  // Simple style detection (no LLM needed)
  const style: Record<string, string> = {};

  // Formality
  const informal = /\b(gonna|wanna|gotta|ya|u|ur|lol|haha|nah|yep|nope|cuz|tho)\b/i;
  const formal = /\b(therefore|however|furthermore|regarding|accordingly|sincerely)\b/i;
  if (informal.test(message)) style['formality'] = 'casual';
  else if (formal.test(message)) style['formality'] = 'formal';

  // Verbosity
  const wordCount = message.split(/\s+/).length;
  if (wordCount > 30) style['verbosity'] = 'detailed';
  else if (wordCount < 8) style['verbosity'] = 'brief';

  // Uses emojis
  if (/[\u{1F300}-\u{1F9FF}]/u.test(message)) style['uses_emoji'] = 'yes';

  // Directness
  if (/^(do|get|send|book|find|make|call|email|text)\b/i.test(message.trim())) {
    style['directness'] = 'direct_commands';
  }

  // Nothing detected — skip the DB writes
  if (Object.keys(style).length === 0) return;

  // Store each detected style trait
  const supabase = getSupabaseClient();
  for (const [key, value] of Object.entries(style)) {
    try {
      // Try insert first; on conflict, update with observation count bump
      const { error: insertError } = await supabase.from('user_context').insert({
        user_id: userId,
        context_type: 'preference' as ContextType,
        key: `communication_style:${key}`,
        value: { trait: key, observed: value },
        confidence: 0.60,
        source: 'observed',
      });

      if (insertError && insertError.code === '23505') {
        // Row exists — bump times_observed and confidence
        const { data: existing } = await supabase
          .from('user_context')
          .select('id, times_observed, confidence')
          .eq('user_id', userId)
          .eq('context_type', 'preference')
          .eq('key', `communication_style:${key}`)
          .single();

        if (existing) {
          const newConfidence = Math.min(1.0, existing.confidence * 0.95 + 0.15);
          await supabase
            .from('user_context')
            .update({
              value: { trait: key, observed: value },
              confidence: parseFloat(newConfidence.toFixed(2)),
              times_observed: (existing.times_observed || 1) + 1,
              last_confirmed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id);
        }
      } else if (insertError) {
        logger.debug('[CONTEXT] Style insert failed for %s: %s', key, insertError.message);
      }
    } catch (err) {
      logger.debug({ err: err instanceof Error ? err.message : String(err) },
        '[CONTEXT] Style extraction failed for %s', key);
    }
  }
}

// ---- Regex-based intent detection REMOVED ----
// All intent detection is now handled by the LLM-based intent-detector.ts module.
// The rolling conversation buffer + Groq 70B provides contextual understanding
// that regex could never achieve. See: packages/agent/src/services/intent-detector.ts

// ---- Per-user extraction rate limiter ----

const extractionTimestamps = new Map<string, number[]>();

function isExtractionRateLimited(userId: string): boolean {
  const now = Date.now();
  const oneMinuteAgo = now - 60_000;

  let timestamps = extractionTimestamps.get(userId);
  if (!timestamps) {
    timestamps = [];
    extractionTimestamps.set(userId, timestamps);
  }

  // Remove timestamps older than 1 minute
  const recent = timestamps.filter(t => t > oneMinuteAgo);
  extractionTimestamps.set(userId, recent);

  if (recent.length >= MAX_EXTRACTIONS_PER_USER_PER_MINUTE) {
    return true;
  }

  recent.push(now);
  return false;
}

const EXTRACTION_PROMPT = `You are analyzing AMBIENT SPEECH — the user is talking to ANOTHER PERSON, not to you. You are listening passively to extract useful context.

CRITICAL RULES FOR AMBIENT DETECTION:
1. The speaker is NOT giving you commands. They are talking to someone else.
2. Distinguish REAL intent from fictional, hypothetical, or past-tense narration.
3. "I should cancel my gym membership" = REAL intent (actionable, confidence >= 0.7)
4. "In the movie, the guy cancels his subscription" = FICTION (not actionable, confidence = 0)
5. "I was thinking about maybe switching phone plans someday" = TOO VAGUE (confidence < 0.3)
6. "My boss moved the deadline to Friday" = REAL event that needs calendar action (actionable)
7. "They denied my insurance claim, number 47291" = REAL event, extract details (claim number)
8. Only flag tasks_implied with confidence >= 0.7 if the speaker expressed genuine personal intent or reported a real event that requires action.

Extract structured data. Be thorough but PRECISE — only flag genuine intents.

Return ONLY valid JSON (no markdown, no code fences):
{
  "people_mentioned": [{"name": "...", "relationship": "...", "context": "..."}],
  "commitments": [{"description": "...", "who": "user|other", "to_whom": "...", "due": "ISO date or empty", "confidence": 0.0-1.0}],
  "tasks_implied": [{"description": "...", "urgency": "low|medium|high", "confidence": 0.0-1.0}],
  "dates_referenced": [{"date": "ISO date", "context": "..."}],
  "preferences_expressed": [{"category": "food|music|work|communication|schedule|other", "preference": "...", "confidence": 0.0-1.0}],
  "emotions_detected": [{"emotion": "...", "intensity": "low|medium|high", "trigger": "..."}],
  "locations_mentioned": [{"place": "...", "context": "..."}],
  "topics": ["topic1", "topic2"],
  "sentiment": "positive|neutral|negative|urgent|stressed|excited"
}

If nothing meaningful can be extracted, return:
{"people_mentioned":[],"commitments":[],"tasks_implied":[],"dates_referenced":[],"preferences_expressed":[],"emotions_detected":[],"locations_mentioned":[],"topics":[],"sentiment":"neutral"}`;

// ---- Groq Direct Caller ----

/**
 * Calls Groq API directly via fetch. Returns null on rate-limit or error.
 * We never retry or pay — extraction is best-effort background work.
 */
async function callGroqForExtraction(message: string): Promise<ExtractionResult | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    logger.debug("[CONTEXT] No GROQ_API_KEY — skipping extraction");
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXTRACTION_TIMEOUT_MS);

  try {
    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: EXTRACTION_PROMPT },
          { role: "user", content: message },
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
        logger.debug("[CONTEXT] Groq rate-limited (%d) — skipping extraction", status);
      } else {
        logger.warn("[CONTEXT] Groq extraction failed with status %d", status);
      }
      return null;
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content) as ExtractionResult;

    // Validate top-level structure
    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.topics)) parsed.topics = [];
    if (!parsed.sentiment) parsed.sentiment = "neutral";

    return parsed;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      logger.debug("[CONTEXT] Groq extraction timed out");
    } else {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[CONTEXT] Groq extraction error");
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ---- Storage Functions ----

/**
 * Store raw conversation context in the conversation_context table.
 */
async function storeConversationContext(
  userId: string,
  channel: string,
  message: string,
  extraction: ExtractionResult
): Promise<string | null> {
  try {
    const { data, error } = await getSupabaseClient()
      .from("conversation_context")
      .insert({
        user_id: userId,
        channel,
        role: "user",
        content: message.substring(0, 5000), // Cap storage
        extracted_intents: extraction.tasks_implied,
        extracted_entities: {
          people: extraction.people_mentioned,
          locations: extraction.locations_mentioned,
          dates: extraction.dates_referenced,
        },
        extracted_commitments: extraction.commitments,
        sentiment: extraction.sentiment,
        confidence: 0.8,
        processed: true,
      })
      .select("id")
      .single();

    if (error) {
      logger.warn({ error: error.message }, "[CONTEXT] Failed to store conversation context");
      return null;
    }
    return data?.id ?? null;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[CONTEXT] Conversation context storage error");
    return null;
  }
}

/**
 * Merge extracted context into the user_context table.
 * Uses upsert with (user_id, context_type, key) uniqueness.
 */
async function mergeUserContext(
  userId: string,
  extraction: ExtractionResult
): Promise<void> {
  const supabase = getSupabaseClient();
  const upserts: Array<{
    user_id: string;
    context_type: ContextType;
    key: string;
    value: Record<string, unknown>;
    confidence: number;
    source: "inferred";
  }> = [];

  // People → relationship context
  for (const person of extraction.people_mentioned || []) {
    if (!person.name) continue;
    upserts.push({
      user_id: userId,
      context_type: "relationship",
      key: person.name.toLowerCase().trim(),
      value: { name: person.name, relationship: person.relationship, context: person.context },
      confidence: 0.7,
      source: "inferred",
    });
  }

  // Preferences
  for (const pref of extraction.preferences_expressed || []) {
    if (!pref.category || !pref.preference) continue;
    upserts.push({
      user_id: userId,
      context_type: "preference",
      key: `${pref.category}:${pref.preference.toLowerCase().substring(0, 50)}`,
      value: { category: pref.category, preference: pref.preference },
      confidence: pref.confidence ?? 0.6,
      source: "inferred",
    });
  }

  // Locations
  for (const loc of extraction.locations_mentioned || []) {
    if (!loc.place) continue;
    upserts.push({
      user_id: userId,
      context_type: "location",
      key: loc.place.toLowerCase().trim(),
      value: { place: loc.place, context: loc.context },
      confidence: 0.8,
      source: "inferred",
    });
  }

  // Emotions → emotional context
  for (const emo of extraction.emotions_detected || []) {
    if (!emo.emotion) continue;
    upserts.push({
      user_id: userId,
      context_type: "emotion",
      key: `current:${emo.emotion.toLowerCase()}`,
      value: { emotion: emo.emotion, intensity: emo.intensity, trigger: emo.trigger },
      confidence: 0.6,
      source: "inferred",
    });
  }

  // Topics → work/habit context
  for (const topic of extraction.topics || []) {
    if (!topic || topic.length < 2) continue;
    upserts.push({
      user_id: userId,
      context_type: "work",
      key: `topic:${topic.toLowerCase().substring(0, 50)}`,
      value: { topic },
      confidence: 0.5,
      source: "inferred",
    });
  }

  // Batch upsert — for each item, use ON CONFLICT upsert to avoid race conditions.
  // Also applies time-based confidence decay: confidence = LEAST(existing * 0.95 + new * 0.3, 1.0)
  // The +0.02 always-increase term is removed to allow confidence to decay over time.
  for (const item of upserts) {
    try {
      // Attempt atomic upsert via Supabase
      // First try insert — if it conflicts, we update with decay
      const { error: insertError } = await supabase
        .from("user_context")
        .insert({
          user_id: item.user_id,
          context_type: item.context_type,
          key: item.key,
          value: item.value,
          confidence: parseFloat(item.confidence.toFixed(2)),
          source: item.source,
        });

      if (insertError && insertError.code === '23505') {
        // Conflict: row exists — update with confidence decay formula
        const { data: existing } = await supabase
          .from("user_context")
          .select("id, times_observed, confidence")
          .eq("user_id", item.user_id)
          .eq("context_type", item.context_type)
          .eq("key", item.key)
          .single();

        if (existing) {
          // Confidence decay: existing * 0.95 + new * 0.3, capped at 1.0
          // The 0.95 factor means confidence decays each time we re-observe,
          // converging to a stable value rather than always increasing.
          const newConfidence = Math.min(
            1.0,
            existing.confidence * 0.95 + item.confidence * 0.3
          );
          await supabase
            .from("user_context")
            .update({
              value: item.value,
              confidence: parseFloat(newConfidence.toFixed(2)),
              times_observed: (existing.times_observed || 1) + 1,
              last_confirmed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", existing.id);
        }
      } else if (insertError) {
        logger.debug({ error: insertError.message }, "[CONTEXT] Insert failed for %s/%s", item.context_type, item.key);
      }
    } catch (err) {
      // Non-critical — log and continue
      logger.debug({ err: err instanceof Error ? err.message : String(err) }, "[CONTEXT] Upsert failed for %s/%s", item.context_type, item.key);
    }
  }
}

/**
 * Store extracted commitments in the commitments table.
 */
async function storeCommitments(
  userId: string,
  commitments: CommitmentExtracted[],
  channel: string
): Promise<void> {
  if (!commitments || commitments.length === 0) return;

  const supabase = getSupabaseClient();

  for (const commitment of commitments) {
    if (!commitment.description || (commitment.confidence ?? 0) < 0.5) continue;

    try {
      // Deduplicate: skip if a very similar commitment exists in the last 24h
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: existing } = await supabase
        .from("commitments")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "pending")
        .gte("created_at", oneDayAgo)
        .ilike("description", `%${commitment.description.substring(0, 30)}%`)
        .limit(1);

      if (existing && existing.length > 0) continue;

      let dueDate: string | null = null;
      if (commitment.due && commitment.due.length > 0) {
        try {
          const parsed = new Date(commitment.due);
          if (!isNaN(parsed.getTime())) {
            dueDate = parsed.toISOString();
          }
        } catch {
          // Invalid date — leave null
        }
      }

      await supabase.from("commitments").insert({
        user_id: userId,
        description: commitment.description.substring(0, 500),
        who_committed: commitment.who === "other" ? "other" : "user",
        committed_to: commitment.to_whom || null,
        due_date: dueDate,
        due_date_confidence: commitment.confidence ?? 0.5,
        status: "pending",
        source_channel: channel,
      });
    } catch (err) {
      logger.debug({ err: err instanceof Error ? err.message : String(err) }, "[CONTEXT] Commitment storage failed");
    }
  }
}

/**
 * Track channel usage for channel preference learning.
 */
async function trackChannelUsage(
  userId: string,
  channel: string,
  topics: string[]
): Promise<void> {
  if (!topics || topics.length === 0) return;

  const supabase = getSupabaseClient();

  // For each topic, track which channel was used
  for (const topic of topics.slice(0, 3)) { // Max 3 topics per message
    const infoType = topic.toLowerCase().substring(0, 50);
    try {
      // Check if we already have a record for this user+info_type+channel
      const { data: existing } = await supabase
        .from("channel_preferences")
        .select("id, times_observed, confidence")
        .eq("user_id", userId)
        .eq("info_type", infoType)
        .eq("preferred_channel", channel)
        .single();

      if (existing) {
        // Same channel used again — boost confidence
        const newConfidence = Math.min(1.0, existing.confidence * 0.8 + 0.2);

        await supabase
          .from("channel_preferences")
          .update({
            confidence: parseFloat(newConfidence.toFixed(2)),
            times_observed: (existing.times_observed || 1) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      } else {
        await supabase.from("channel_preferences").insert({
          user_id: userId,
          info_type: infoType,
          preferred_channel: channel,
          confidence: 0.3,
          times_observed: 1,
        });
      }
    } catch {
      // Non-critical
    }
  }
}

// ---- Main Entry Point ----

/**
 * Extract context from a user message (background learning only).
 *
 * This is the context LEARNING engine — it extracts people, commitments,
 * preferences, emotions, etc. to build understanding of the user over time.
 *
 * NOTE: This function does NOT detect actionable intents. Intent detection
 * is handled entirely by intent-detector.ts via the rolling conversation buffer.
 */
export async function extractContext(
  message: string,
  userId: string,
  channel: string
): Promise<void> {
  if (!message || message.trim().length < 3) return;

  // Communication style extraction (regex only, zero LLM cost)
  try {
    await extractCommunicationStyle(message, userId);
  } catch (err) {
    logger.debug({ err: err instanceof Error ? err.message : String(err) }, "[CONTEXT] Style extraction error");
  }

  // Skip trivial messages for LLM extraction
  const normalized = message.trim().toLowerCase().replace(/[.!?,]+$/g, '');
  if (SKIP_MESSAGES.has(normalized)) return;
  if (message.trim().length < MIN_MESSAGE_LENGTH) return;

  // Per-user rate limit
  if (isExtractionRateLimited(userId)) return;

  try {
    const truncatedMessage = message.length > MAX_MESSAGE_LENGTH_FOR_LLM
      ? message.substring(0, MAX_MESSAGE_LENGTH_FOR_LLM)
      : message;
    const extraction = await callGroqForExtraction(truncatedMessage);
    if (!extraction) {
      await storeConversationContext(userId, channel, message, {
        people_mentioned: [], commitments: [], tasks_implied: [],
        dates_referenced: [], preferences_expressed: [], emotions_detected: [],
        locations_mentioned: [], topics: [], sentiment: "neutral",
      });
      return;
    }

    await storeConversationContext(userId, channel, message, extraction);
    await mergeUserContext(userId, extraction);
    await storeCommitments(userId, extraction.commitments, channel);
    await trackChannelUsage(userId, channel, extraction.topics);

    const totalExtracted =
      (extraction.people_mentioned?.length || 0) +
      (extraction.commitments?.length || 0) +
      (extraction.preferences_expressed?.length || 0) +
      (extraction.emotions_detected?.length || 0) +
      (extraction.locations_mentioned?.length || 0) +
      (extraction.topics?.length || 0);

    if (totalExtracted > 0) {
      logger.debug("[CONTEXT] Extracted %d items for user %s via %s", totalExtracted, userId.substring(0, 8), channel);
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[CONTEXT] Extraction failed for user %s", userId.substring(0, 8));
  }
}

/**
 * Get accumulated context for a user.
 * Useful for enriching prompts with user knowledge.
 */
export async function getUserContext(
  userId: string,
  contextTypes?: ContextType[]
): Promise<Array<{ context_type: string; key: string; value: Record<string, unknown>; confidence: number }>> {
  try {
    let query = getSupabaseClient()
      .from("user_context")
      .select("context_type, key, value, confidence, times_observed")
      .eq("user_id", userId)
      .eq("is_active", true)
      .gte("confidence", 0.4)
      .order("confidence", { ascending: false })
      .limit(100);

    if (contextTypes && contextTypes.length > 0) {
      query = query.in("context_type", contextTypes);
    }

    const { data, error } = await query;
    if (error) {
      logger.warn({ error: error.message }, "[CONTEXT] Failed to get user context");
      return [];
    }

    return (data || []).map(row => ({
      context_type: row.context_type as string,
      key: row.key as string,
      value: row.value as Record<string, unknown>,
      confidence: row.confidence as number,
    }));
  } catch {
    return [];
  }
}

/**
 * Cleanup old context data to prevent unbounded table growth.
 * Runs once daily via the scheduler.
 *
 * - Deletes conversation_context older than 90 days
 * - Deletes user_context with confidence < 0.3 and last_confirmed_at > 60 days ago
 */
export async function cleanupOldContext(): Promise<void> {
  const supabase = getSupabaseClient();
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

  try {
    // Delete conversation_context older than 90 days
    const { error: ccError } = await supabase
      .from("conversation_context")
      .delete()
      .lt("created_at", ninetyDaysAgo);

    if (ccError) {
      logger.warn({ error: ccError.message }, "[CONTEXT] Failed to cleanup old conversation_context");
    } else {
      logger.info("[CONTEXT] Cleaned up conversation_context older than 90 days");
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[CONTEXT] conversation_context cleanup error");
  }

  try {
    // Delete low-confidence user_context that hasn't been confirmed in 60 days
    const { error: ucError } = await supabase
      .from("user_context")
      .delete()
      .lt("confidence", 0.3)
      .lt("last_confirmed_at", sixtyDaysAgo);

    if (ucError) {
      logger.warn({ error: ucError.message }, "[CONTEXT] Failed to cleanup stale user_context");
    } else {
      logger.info("[CONTEXT] Cleaned up low-confidence user_context older than 60 days");
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[CONTEXT] user_context cleanup error");
  }
}
