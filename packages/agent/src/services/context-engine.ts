/**
 * Context Engine — Aurora's Intelligence Core
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

const MIN_MESSAGE_LENGTH = 5;
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.1-8b-instant"; // Fast, free
const EXTRACTION_TIMEOUT_MS = 15_000; // 15s max for extraction

const EXTRACTION_PROMPT = `You are analyzing a message from a user to their AI assistant Aurora.
Extract structured data. Be thorough — capture implied, not just stated.
Include subtext, humor, stress signals, indirect commitments.

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

  // Batch upsert — for each item, try to update if exists, insert if not
  for (const item of upserts) {
    try {
      // Try to find existing
      const { data: existing } = await supabase
        .from("user_context")
        .select("id, times_observed, confidence")
        .eq("user_id", item.user_id)
        .eq("context_type", item.context_type)
        .eq("key", item.key)
        .single();

      if (existing) {
        // Update: increase confidence with EMA, increment observation count
        const newConfidence = Math.min(
          1.0,
          existing.confidence * 0.7 + item.confidence * 0.3 + 0.02
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
      } else {
        // Insert new
        await supabase.from("user_context").insert({
          user_id: item.user_id,
          context_type: item.context_type,
          key: item.key,
          value: item.value,
          confidence: parseFloat(item.confidence.toFixed(2)),
          source: item.source,
        });
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
      const { data: existing } = await supabase
        .from("channel_preferences")
        .select("id, times_observed, confidence")
        .eq("user_id", userId)
        .eq("info_type", infoType)
        .single();

      if (existing) {
        // If same channel as preferred, boost confidence; otherwise decay
        const { data: currentPref } = await supabase
          .from("channel_preferences")
          .select("preferred_channel")
          .eq("id", existing.id)
          .single();

        const sameChannel = currentPref?.preferred_channel === channel;
        const newConfidence = sameChannel
          ? Math.min(1.0, existing.confidence * 0.8 + 0.2)
          : Math.max(0.1, existing.confidence * 0.9);

        await supabase
          .from("channel_preferences")
          .update({
            preferred_channel: sameChannel ? channel : (existing.times_observed > 5 ? currentPref?.preferred_channel : channel),
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
 * Extract context from a user message.
 *
 * This is the main entry point — called after every user message.
 * Runs asynchronously and never throws (all errors are caught internally).
 *
 * @param message - The user's message content
 * @param userId - The user's ID
 * @param channel - The channel the message came from (sms, email, web, etc.)
 */
export async function extractContext(
  message: string,
  userId: string,
  channel: string
): Promise<void> {
  // Skip very short messages — not worth the extraction cost
  if (!message || message.trim().length < MIN_MESSAGE_LENGTH) {
    return;
  }

  // Skip obvious non-content messages
  const trimmed = message.trim().toLowerCase();
  const skipPatterns = ["ok", "yes", "no", "thanks", "thank you", "sure", "yep", "nope", "k", "ty", "thx"];
  if (skipPatterns.includes(trimmed)) {
    return;
  }

  try {
    // Step 1: Call LLM for extraction
    const extraction = await callGroqForExtraction(message);
    if (!extraction) {
      // LLM unavailable — still store raw context without extraction
      await storeConversationContext(userId, channel, message, {
        people_mentioned: [],
        commitments: [],
        tasks_implied: [],
        dates_referenced: [],
        preferences_expressed: [],
        emotions_detected: [],
        locations_mentioned: [],
        topics: [],
        sentiment: "neutral",
      });
      return;
    }

    // Step 2: Store raw conversation context
    await storeConversationContext(userId, channel, message, extraction);

    // Step 3: Merge extracted data into user_context (upsert)
    await mergeUserContext(userId, extraction);

    // Step 4: Store any detected commitments
    await storeCommitments(userId, extraction.commitments, channel);

    // Step 5: Track channel preferences
    await trackChannelUsage(userId, channel, extraction.topics);

    const totalExtracted =
      (extraction.people_mentioned?.length || 0) +
      (extraction.commitments?.length || 0) +
      (extraction.preferences_expressed?.length || 0) +
      (extraction.emotions_detected?.length || 0) +
      (extraction.locations_mentioned?.length || 0) +
      (extraction.topics?.length || 0);

    if (totalExtracted > 0) {
      logger.debug(
        "[CONTEXT] Extracted %d items for user %s via %s (sentiment: %s)",
        totalExtracted,
        userId.substring(0, 8),
        channel,
        extraction.sentiment
      );
    }
  } catch (err) {
    // Never throw — this runs in background
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[CONTEXT] Extraction failed for user %s",
      userId.substring(0, 8)
    );
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
