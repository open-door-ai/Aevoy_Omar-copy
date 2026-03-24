/**
 * Pattern Engine — Behavioral Pattern Detection for Aurora
 *
 * Detects recurring patterns from accumulated user context:
 * - daily_routine: same actions at similar times (EMA smoothing)
 * - weekly_cycle: recurring weekly patterns
 * - trigger_response: when X happens, user always does Y
 * - preference: consistent choices
 * - relationship: frequently mentioned people and contexts
 * - financial: spending patterns
 * - emotional: mood patterns
 *
 * Uses simple heuristics during the first week (lower thresholds)
 * and EMA (exponential moving average) for long-term patterns.
 *
 * Runs periodically via the scheduler — not on every message.
 */

import { getSupabaseClient } from "../utils/supabase.js";
import { logger } from "../utils/logger.js";

// ---- Types ----

type PatternType =
  | "daily_routine"
  | "weekly_cycle"
  | "trigger_response"
  | "preference"
  | "relationship"
  | "financial"
  | "emotional";

interface DetectedPatternRecord {
  user_id: string;
  pattern_type: PatternType;
  description: string;
  trigger_conditions: Record<string, unknown>;
  confidence: number;
}

interface ContextRow {
  context_type: string;
  key: string;
  value: Record<string, unknown>;
  confidence: number;
  times_observed: number;
  first_seen_at: string;
  last_confirmed_at: string;
  created_at: string;
}

interface ConversationRow {
  channel: string;
  sentiment: string | null;
  created_at: string;
  extracted_intents: Array<{ description?: string; urgency?: string }> | null;
}

// ---- Constants ----

/** Minimum observations before we consider something a pattern */
const MIN_OBSERVATIONS_EARLY = 2;  // First week: lower threshold
const MIN_OBSERVATIONS_MATURE = 4; // After first week

/** Minimum confidence for a pattern to be stored */
const MIN_PATTERN_CONFIDENCE = 0.5;

/** EMA smoothing factor (0-1, higher = more weight on recent data) */
const EMA_ALPHA = 0.3;

// ---- Dedup Helpers ----

/**
 * Determine if a newly detected pattern is "similar enough" to an existing one
 * to be considered the same pattern (and thus updated instead of duplicated).
 *
 * Matching rules:
 * - daily_routine / weekly_cycle: time windows within 2 hours of each other,
 *   or same channel, or same day_of_week
 * - preference: same key + category in trigger_conditions
 * - relationship: same person_name
 * - emotional: same emotion
 * - trigger_response / financial: same key or description prefix
 */
function isSimilarPattern(
  incoming: DetectedPatternRecord,
  existing: { trigger_conditions: Record<string, unknown> | null; description: string }
): boolean {
  const a = incoming.trigger_conditions;
  const b = existing.trigger_conditions ?? {};

  switch (incoming.pattern_type) {
    case "daily_routine": {
      // Same channel → same pattern
      if (a.channel && b.channel && a.channel === b.channel) return true;
      // Both have time windows → check if within 2 hours
      if (
        typeof a.time_window_start === "number" &&
        typeof b.time_window_start === "number"
      ) {
        const diff = Math.abs(
          (a.time_window_start as number) - (b.time_window_start as number)
        );
        // Handle wraparound (e.g., 23 and 1 are 2 apart)
        return diff <= 2 || diff >= 22;
      }
      // Same typical_hour within 2 hours
      if (
        typeof a.typical_hour === "number" &&
        typeof b.typical_hour === "number"
      ) {
        const diff = Math.abs(
          (a.typical_hour as number) - (b.typical_hour as number)
        );
        return diff <= 2 || diff >= 22;
      }
      return false;
    }

    case "weekly_cycle": {
      return (
        typeof a.day_of_week === "number" &&
        a.day_of_week === b.day_of_week
      );
    }

    case "preference": {
      return (
        a.key === b.key &&
        a.category === b.category
      );
    }

    case "relationship": {
      return (
        typeof a.person_name === "string" &&
        a.person_name === b.person_name
      );
    }

    case "emotional": {
      return (
        typeof a.emotion === "string" &&
        a.emotion === b.emotion
      );
    }

    default: {
      // Fallback: match if descriptions share a meaningful prefix (first 40 chars)
      return (
        incoming.description.substring(0, 40) ===
        existing.description.substring(0, 40)
      );
    }
  }
}

// ---- Analysis Functions ----

/**
 * Determine if user is in "early" phase (< 7 days of data).
 */
function isEarlyPhase(contexts: ContextRow[]): boolean {
  if (contexts.length === 0) return true;
  const earliest = new Date(contexts[0].created_at);
  const daysSinceFirst = (Date.now() - earliest.getTime()) / (24 * 60 * 60 * 1000);
  return daysSinceFirst < 7;
}

/**
 * Calculate EMA-smoothed confidence from observation history.
 */
function emaConfidence(
  currentConfidence: number,
  observations: number,
  maxExpected: number
): number {
  const observationRatio = Math.min(1.0, observations / maxExpected);
  return currentConfidence * (1 - EMA_ALPHA) + observationRatio * EMA_ALPHA;
}

/**
 * Detect preference patterns from consistent choices.
 */
function detectPreferencePatterns(
  userId: string,
  contexts: ContextRow[],
  minObs: number
): DetectedPatternRecord[] {
  const patterns: DetectedPatternRecord[] = [];

  const preferences = contexts.filter(c => c.context_type === "preference");
  for (const pref of preferences) {
    if (pref.times_observed >= minObs && pref.confidence >= MIN_PATTERN_CONFIDENCE) {
      const value = pref.value as { category?: string; preference?: string };
      patterns.push({
        user_id: userId,
        pattern_type: "preference",
        description: `User consistently prefers: ${value.preference ?? pref.key} (category: ${value.category ?? "general"})`,
        trigger_conditions: {
          context_type: "preference",
          key: pref.key,
          category: value.category ?? "general",
        },
        confidence: parseFloat(
          emaConfidence(pref.confidence, pref.times_observed, 10).toFixed(2)
        ),
      });
    }
  }

  return patterns;
}

/**
 * Detect relationship patterns from frequently mentioned people.
 */
function detectRelationshipPatterns(
  userId: string,
  contexts: ContextRow[],
  minObs: number
): DetectedPatternRecord[] {
  const patterns: DetectedPatternRecord[] = [];

  const relationships = contexts.filter(c => c.context_type === "relationship");
  for (const rel of relationships) {
    if (rel.times_observed >= minObs && rel.confidence >= MIN_PATTERN_CONFIDENCE) {
      const value = rel.value as { name?: string; relationship?: string; context?: string };
      patterns.push({
        user_id: userId,
        pattern_type: "relationship",
        description: `Frequently mentions ${value.name ?? rel.key} (${value.relationship ?? "unknown"})`,
        trigger_conditions: {
          person_name: value.name ?? rel.key,
          relationship: value.relationship ?? "unknown",
        },
        confidence: parseFloat(
          emaConfidence(rel.confidence, rel.times_observed, 8).toFixed(2)
        ),
      });
    }
  }

  return patterns;
}

/**
 * Detect emotional patterns from mood tracking.
 */
function detectEmotionalPatterns(
  userId: string,
  contexts: ContextRow[]
): DetectedPatternRecord[] {
  const patterns: DetectedPatternRecord[] = [];

  const emotions = contexts.filter(c => c.context_type === "emotion");
  if (emotions.length < 3) return patterns;

  // Group by emotion type
  const emotionGroups = new Map<string, { count: number; totalConfidence: number; triggers: string[] }>();
  for (const emo of emotions) {
    const value = emo.value as { emotion?: string; trigger?: string };
    const emotionName = value.emotion?.toLowerCase() ?? "unknown";
    const group = emotionGroups.get(emotionName) || { count: 0, totalConfidence: 0, triggers: [] };
    group.count += emo.times_observed;
    group.totalConfidence += emo.confidence;
    if (value.trigger) group.triggers.push(value.trigger);
    emotionGroups.set(emotionName, group);
  }

  // Find dominant emotions
  for (const [emotion, group] of emotionGroups) {
    if (group.count >= 3) {
      const avgConfidence = group.totalConfidence / emotions.filter(e =>
        (e.value as { emotion?: string }).emotion?.toLowerCase() === emotion
      ).length;
      const uniqueTriggers = [...new Set(group.triggers)].slice(0, 5);

      patterns.push({
        user_id: userId,
        pattern_type: "emotional",
        description: `Frequently experiences ${emotion} (${group.count} observations)${
          uniqueTriggers.length > 0 ? `. Common triggers: ${uniqueTriggers.join(", ")}` : ""
        }`,
        trigger_conditions: {
          emotion,
          observation_count: group.count,
          common_triggers: uniqueTriggers,
        },
        confidence: parseFloat(Math.min(0.95, avgConfidence + 0.1).toFixed(2)),
      });
    }
  }

  return patterns;
}

/**
 * Detect daily routine patterns from conversation timing.
 */
async function detectDailyRoutines(
  userId: string
): Promise<DetectedPatternRecord[]> {
  const patterns: DetectedPatternRecord[] = [];

  try {
    // Get recent conversation timestamps
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: conversations } = await getSupabaseClient()
      .from("conversation_context")
      .select("channel, sentiment, created_at, extracted_intents")
      .eq("user_id", userId)
      .eq("role", "user")
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: true });

    if (!conversations || conversations.length < 5) return patterns;

    // Group by hour of day
    const hourCounts = new Map<number, number>();
    for (const conv of conversations as ConversationRow[]) {
      const hour = new Date(conv.created_at).getHours();
      hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
    }

    // Find peak hours (> 30% of messages in a 2-hour window)
    const totalMessages = conversations.length;
    for (let hour = 0; hour < 24; hour++) {
      const windowCount =
        (hourCounts.get(hour) || 0) +
        (hourCounts.get((hour + 1) % 24) || 0);
      const ratio = windowCount / totalMessages;

      if (ratio >= 0.3 && windowCount >= 3) {
        patterns.push({
          user_id: userId,
          pattern_type: "daily_routine",
          description: `User is most active around ${hour}:00-${(hour + 2) % 24}:00 (${Math.round(ratio * 100)}% of messages)`,
          trigger_conditions: {
            time_window_start: hour,
            time_window_end: (hour + 2) % 24,
            activity_ratio: parseFloat(ratio.toFixed(2)),
          },
          confidence: parseFloat(Math.min(0.95, 0.5 + ratio).toFixed(2)),
        });
      }
    }

    // Detect channel patterns by time of day
    const channelByHour = new Map<string, number[]>();
    for (const conv of conversations as ConversationRow[]) {
      const hour = new Date(conv.created_at).getHours();
      const hours = channelByHour.get(conv.channel) || [];
      hours.push(hour);
      channelByHour.set(conv.channel, hours);
    }

    for (const [channel, hours] of channelByHour) {
      if (hours.length < 3) continue;
      const avgHour = hours.reduce((a, b) => a + b, 0) / hours.length;
      const variance = hours.reduce((sum, h) => sum + Math.pow(h - avgHour, 2), 0) / hours.length;

      // Low variance = consistent time usage
      if (variance < 6) {
        patterns.push({
          user_id: userId,
          pattern_type: "daily_routine",
          description: `User typically uses ${channel} around ${Math.round(avgHour)}:00`,
          trigger_conditions: {
            channel,
            typical_hour: Math.round(avgHour),
            variance: parseFloat(variance.toFixed(2)),
          },
          confidence: parseFloat(Math.min(0.9, 0.4 + (1 / (1 + variance))).toFixed(2)),
        });
      }
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[PATTERN] Daily routine detection error");
  }

  return patterns;
}

/**
 * Detect weekly cycle patterns.
 */
async function detectWeeklyCycles(
  userId: string
): Promise<DetectedPatternRecord[]> {
  const patterns: DetectedPatternRecord[] = [];

  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: conversations } = await getSupabaseClient()
      .from("conversation_context")
      .select("created_at")
      .eq("user_id", userId)
      .eq("role", "user")
      .gte("created_at", thirtyDaysAgo);

    if (!conversations || conversations.length < 10) return patterns;

    // Group by day of week (0=Sunday, 6=Saturday)
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayCounts = new Array<number>(7).fill(0);
    for (const conv of conversations) {
      const day = new Date(conv.created_at).getDay();
      dayCounts[day]++;
    }

    const total = conversations.length;
    const avgPerDay = total / 7;

    // Find days with significantly more/less activity
    for (let day = 0; day < 7; day++) {
      const ratio = dayCounts[day] / avgPerDay;
      if (ratio >= 1.8 && dayCounts[day] >= 3) {
        patterns.push({
          user_id: userId,
          pattern_type: "weekly_cycle",
          description: `User is ${Math.round(ratio)}x more active on ${dayNames[day]}s`,
          trigger_conditions: {
            day_of_week: day,
            day_name: dayNames[day],
            activity_ratio: parseFloat(ratio.toFixed(2)),
          },
          confidence: parseFloat(Math.min(0.9, 0.4 + (ratio - 1) * 0.25).toFixed(2)),
        });
      }
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[PATTERN] Weekly cycle detection error");
  }

  return patterns;
}

// ---- Main Entry Point ----

/**
 * Analyze patterns for a specific user.
 * Queries user_context and conversation_context, runs detectors,
 * and stores/updates the detected_patterns table.
 *
 * @returns Array of newly detected patterns
 */
export async function analyzePatterns(
  userId: string
): Promise<DetectedPatternRecord[]> {
  const allNewPatterns: DetectedPatternRecord[] = [];

  try {
    // Fetch user context data
    const { data: contexts, error } = await getSupabaseClient()
      .from("user_context")
      .select("context_type, key, value, confidence, times_observed, first_seen_at, last_confirmed_at, created_at")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (error) {
      logger.warn({ error: error.message }, "[PATTERN] Failed to fetch user context");
      return [];
    }

    const rows = (contexts || []) as ContextRow[];
    if (rows.length === 0) return [];

    const early = isEarlyPhase(rows);
    const minObs = early ? MIN_OBSERVATIONS_EARLY : MIN_OBSERVATIONS_MATURE;

    // Run all pattern detectors
    const detectorResults = await Promise.allSettled([
      Promise.resolve(detectPreferencePatterns(userId, rows, minObs)),
      Promise.resolve(detectRelationshipPatterns(userId, rows, minObs)),
      Promise.resolve(detectEmotionalPatterns(userId, rows)),
      detectDailyRoutines(userId),
      detectWeeklyCycles(userId),
    ]);

    for (const result of detectorResults) {
      if (result.status === "fulfilled") {
        allNewPatterns.push(...result.value);
      }
    }

    // Filter by minimum confidence
    const qualifiedPatterns = allNewPatterns.filter(p => p.confidence >= MIN_PATTERN_CONFIDENCE);

    // Store/update patterns in DB (dedup by user_id + pattern_type + similar trigger_conditions)
    const supabase = getSupabaseClient();
    for (const pattern of qualifiedPatterns) {
      try {
        // Fetch all existing patterns of this type for the user to find similar ones
        const { data: existingPatterns } = await supabase
          .from("detected_patterns")
          .select("id, times_matched, confidence, trigger_conditions, description")
          .eq("user_id", userId)
          .eq("pattern_type", pattern.pattern_type);

        // Find a similar existing pattern using loose matching on trigger_conditions
        const similar = existingPatterns?.find(ep => isSimilarPattern(pattern, ep));

        if (similar) {
          // Update existing pattern instead of creating a duplicate
          const updatedConfidence = parseFloat(
            (similar.confidence * 0.6 + pattern.confidence * 0.4).toFixed(2)
          );
          await supabase
            .from("detected_patterns")
            .update({
              confidence: updatedConfidence,
              times_matched: (similar.times_matched || 0) + 1,
              last_matched_at: new Date().toISOString(),
              trigger_conditions: pattern.trigger_conditions,
              description: pattern.description,
              updated_at: new Date().toISOString(),
            })
            .eq("id", similar.id);
        } else {
          // Insert new pattern — no similar one exists
          await supabase.from("detected_patterns").insert({
            user_id: userId,
            pattern_type: pattern.pattern_type,
            description: pattern.description,
            trigger_conditions: pattern.trigger_conditions,
            confidence: pattern.confidence,
            times_matched: 1,
            last_matched_at: new Date().toISOString(),
            is_active: true,
          });
        }
      } catch (err) {
        logger.debug(
          { err: err instanceof Error ? err.message : String(err) },
          "[PATTERN] Failed to store pattern: %s",
          pattern.description.substring(0, 60)
        );
      }
    }

    if (qualifiedPatterns.length > 0) {
      logger.info(
        "[PATTERN] Detected %d patterns for user %s",
        qualifiedPatterns.length,
        userId.substring(0, 8)
      );
    }

    return qualifiedPatterns;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[PATTERN] Analysis failed for user %s",
      userId.substring(0, 8)
    );
    return [];
  }
}

/**
 * Run pattern analysis for all active users.
 * Called by the scheduler periodically.
 */
export async function analyzeAllUserPatterns(): Promise<number> {
  let patternsFound = 0;

  try {
    // Get users with recent context data (active in last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: activeUsers } = await getSupabaseClient()
      .from("conversation_context")
      .select("user_id")
      .gte("created_at", sevenDaysAgo)
      .limit(500);

    if (!activeUsers || activeUsers.length === 0) return 0;

    const uniqueUserIds = [...new Set(activeUsers.map(u => u.user_id as string))];
    logger.info("[PATTERN] Running analysis for %d users", uniqueUserIds.length);

    for (const userId of uniqueUserIds) {
      try {
        const patterns = await analyzePatterns(userId);
        patternsFound += patterns.length;
      } catch {
        // Continue to next user
      }
    }
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "[PATTERN] Batch analysis failed");
  }

  return patternsFound;
}
