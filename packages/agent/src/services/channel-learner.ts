/**
 * Channel Learner — learns which communication channels work best per user
 *
 * Tracks response times, positive/negative signals, and info-type affinity
 * to build per-user channel preference profiles.
 *
 * Uses the channel_preferences table.
 */

import { getSupabaseClient } from "../utils/supabase.js";

// ---- Types ----

export type LearnableChannel = 'sms' | 'voice' | 'whatsapp' | 'email' | 'telegram' | 'in_app';

export interface ChannelPreference {
  channel: LearnableChannel;
  confidence: number; // 0.0 - 1.0
}

interface ChannelPreferenceRow {
  id: string;
  user_id: string;
  preferred_channel: string;
  info_type: string;
  response_count: number;
  avg_response_time_seconds: number;
  positive_count: number;
  negative_count: number;
  confidence: number;
  updated_at: string;
}

// ---- In-memory cache ----

interface PreferenceCacheEntry {
  preference: ChannelPreference;
  cachedAt: number;
}

const preferenceCache = new Map<string, PreferenceCacheEntry>();
const CACHE_TTL_MS = 300_000; // 5 minutes

// ---- Public API ----

/**
 * Record a user's response to a message sent on a given channel.
 *
 * Call this after every user interaction that was triggered by a proactive message.
 *
 * @param userId - User ID
 * @param channel - The channel the proactive message was sent on
 * @param infoType - Category of the message (e.g., "reminder", "digest", "alert", "weather")
 * @param responseTimeSeconds - How long (in seconds) before the user responded. 0 if no response tracked.
 * @param wasPositive - Whether the user's response was positive (engaged, thanked, acted) vs negative (dismissed, complained)
 */
export async function recordChannelResponse(
  userId: string,
  channel: LearnableChannel,
  infoType: string,
  responseTimeSeconds: number,
  wasPositive: boolean
): Promise<void> {
  const supabase = getSupabaseClient();

  try {
    // Check for existing preference row
    const { data: existing } = await supabase
      .from('channel_preferences')
      .select('id, response_count, avg_response_time_seconds, positive_count, negative_count, confidence')
      .eq('user_id', userId)
      .eq('preferred_channel', channel)
      .eq('info_type', infoType)
      .single();

    if (existing) {
      const newCount = (existing.response_count || 0) + 1;
      const oldAvg = existing.avg_response_time_seconds || 0;
      const newAvg = responseTimeSeconds > 0
        ? (oldAvg * (existing.response_count || 0) + responseTimeSeconds) / newCount
        : oldAvg;
      const newPositive = (existing.positive_count || 0) + (wasPositive ? 1 : 0);
      const newNegative = (existing.negative_count || 0) + (wasPositive ? 0 : 1);

      // Confidence = ratio of positive to total, weighted by sample size
      // More data points = higher confidence ceiling
      const positiveRatio = newPositive / (newPositive + newNegative);
      const sampleWeight = Math.min(newCount / 10, 1.0); // Full confidence after 10 interactions
      const newConfidence = positiveRatio * sampleWeight;

      await supabase
        .from('channel_preferences')
        .update({
          response_count: newCount,
          avg_response_time_seconds: Math.round(newAvg),
          positive_count: newPositive,
          negative_count: newNegative,
          confidence: Math.round(newConfidence * 100) / 100, // 2 decimal places
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      // Create new preference record
      const initialConfidence = wasPositive ? 0.1 : 0.0; // Low confidence with 1 data point

      await supabase
        .from('channel_preferences')
        .insert({
          user_id: userId,
          preferred_channel: channel,
          info_type: infoType,
          response_count: 1,
          avg_response_time_seconds: responseTimeSeconds > 0 ? Math.round(responseTimeSeconds) : 0,
          positive_count: wasPositive ? 1 : 0,
          negative_count: wasPositive ? 0 : 1,
          confidence: initialConfidence,
          updated_at: new Date().toISOString(),
        });
    }

    // Invalidate cache for this user + info_type
    preferenceCache.delete(`${userId}:${infoType}`);
    preferenceCache.delete(`${userId}:*`); // Also invalidate wildcard
  } catch (err) {
    console.error('[CHANNEL-LEARNER] recordChannelResponse error:', err);
  }
}

/**
 * Get the best channel for a given user and info type, based on learned preferences.
 *
 * Falls back to user's default preferred_channel from user_settings if no learned data.
 *
 * @param userId - User ID
 * @param infoType - Category of the message (e.g., "reminder", "digest", "alert")
 * @returns The preferred channel and confidence level
 */
export async function getPreferredChannel(
  userId: string,
  infoType: string
): Promise<ChannelPreference> {
  // Check cache
  const cacheKey = `${userId}:${infoType}`;
  const cached = preferenceCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.preference;
  }

  try {
    const supabase = getSupabaseClient();

    // Query channel_preferences for this user + info_type, ordered by confidence
    const { data: preferences } = await supabase
      .from('channel_preferences')
      .select('preferred_channel, confidence, avg_response_time_seconds, response_count')
      .eq('user_id', userId)
      .eq('info_type', infoType)
      .order('confidence', { ascending: false })
      .limit(1);

    if (preferences && preferences.length > 0 && preferences[0].confidence > 0.2) {
      const result: ChannelPreference = {
        channel: preferences[0].preferred_channel as LearnableChannel,
        confidence: preferences[0].confidence,
      };

      preferenceCache.set(cacheKey, { preference: result, cachedAt: Date.now() });
      return result;
    }

    // No learned preference — try wildcard (any info_type for this channel)
    const { data: anyPrefs } = await supabase
      .from('channel_preferences')
      .select('preferred_channel, confidence')
      .eq('user_id', userId)
      .order('confidence', { ascending: false })
      .limit(1);

    if (anyPrefs && anyPrefs.length > 0 && anyPrefs[0].confidence > 0.3) {
      const result: ChannelPreference = {
        channel: anyPrefs[0].preferred_channel as LearnableChannel,
        confidence: anyPrefs[0].confidence * 0.7, // Discount because it's not info-type-specific
      };

      preferenceCache.set(cacheKey, { preference: result, cachedAt: Date.now() });
      return result;
    }

    // Fall back to user_settings preferred channel
    const fallback = await getUserDefaultChannel(userId);
    const result: ChannelPreference = {
      channel: fallback,
      confidence: 0.0, // No learned data
    };

    preferenceCache.set(cacheKey, { preference: result, cachedAt: Date.now() });
    return result;
  } catch (err) {
    console.error('[CHANNEL-LEARNER] getPreferredChannel error:', err);
    // Absolute fallback
    return { channel: 'email', confidence: 0.0 };
  }
}

// ---- Internal Helpers ----

/**
 * Get user's default preferred channel from user_settings.
 */
async function getUserDefaultChannel(userId: string): Promise<LearnableChannel> {
  try {
    const { data } = await getSupabaseClient()
      .from('user_settings')
      .select('proactive_channel')
      .eq('user_id', userId)
      .single();

    const channel = data?.proactive_channel;
    if (channel && isValidChannel(channel)) {
      return channel as LearnableChannel;
    }
    return 'email'; // Safe default
  } catch {
    return 'email';
  }
}

function isValidChannel(channel: string): channel is LearnableChannel {
  return ['sms', 'voice', 'whatsapp', 'email', 'telegram', 'in_app'].includes(channel);
}
