/**
 * Cost Circuit Breaker — Three-layer cost protection
 *
 * Layer 1: Per-user daily spend cap (default $3.00)
 * Layer 2: Per-channel daily caps (SMS $0.50, Voice $2.00, WhatsApp $0.50)
 * Layer 3: Global hourly cap (env CIRCUIT_BREAKER_HOURLY_CENTS, default $10)
 *
 * Uses daily_spend_tracking table for persistent cost tracking.
 */

import { getSupabaseClient } from "../utils/supabase.js";

// ---- Types ----

export type DeliveryChannel = 'sms' | 'voice' | 'whatsapp' | 'email' | 'telegram' | 'in_app';

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
}

// ---- Cost Constants ----

/** Estimated cost per message in cents, by channel */
export const CHANNEL_COSTS: Record<DeliveryChannel, number> = {
  sms: 2,        // $0.02 per SMS
  voice: 15,     // $0.15 per minute (estimate 1 min)
  whatsapp: 5,   // $0.05 per message
  email: 0,      // free via Resend (within quota)
  telegram: 0,   // free
  in_app: 0,     // free
};

/** Per-channel daily cap in cents */
const CHANNEL_DAILY_CAP_CENTS: Record<DeliveryChannel, number> = {
  sms: 50,        // $0.50/day
  voice: 200,     // $2.00/day
  whatsapp: 50,   // $0.50/day
  email: 0,       // no cap (free)
  telegram: 0,    // no cap (free)
  in_app: 0,      // no cap (free)
};

/** Default per-user daily spend cap in cents */
const DEFAULT_USER_DAILY_CAP_CENTS = 300; // $3.00

/** Global hourly cap from env, default $10 */
function getGlobalHourlyCap(): number {
  return parseInt(process.env.CIRCUIT_BREAKER_HOURLY_CENTS || '1000', 10);
}

// ---- In-memory cache for fast path ----

interface SpendCacheEntry {
  date: string;
  totalCents: number;
  channelCents: Record<string, number>;
  cachedAt: number;
}

const spendCache = new Map<string, SpendCacheEntry>();
const CACHE_TTL_MS = 60_000; // 1 minute

function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

// ---- Public API ----

/**
 * Check whether sending a message on a given channel is within budget.
 *
 * Three layers:
 * 1. User daily spend cap
 * 2. Channel-specific daily cap
 * 3. Global hourly circuit breaker
 */
export async function checkBudget(
  userId: string,
  channel: DeliveryChannel,
  estimatedCostCents?: number
): Promise<BudgetCheckResult> {
  const cost = estimatedCostCents ?? CHANNEL_COSTS[channel];

  // Free channels always allowed
  if (cost === 0) {
    return { allowed: true };
  }

  const today = getTodayDate();

  try {
    // Get current spend from cache or DB
    const spend = await getUserDailySpend(userId, today);

    // Layer 1: User daily cap
    const userCap = await getUserDailyCap(userId);
    if (spend.totalCents + cost > userCap) {
      return {
        allowed: false,
        reason: `Daily spend cap reached ($${(userCap / 100).toFixed(2)}). Spent: $${(spend.totalCents / 100).toFixed(2)}`,
      };
    }

    // Layer 2: Channel-specific cap
    const channelCap = CHANNEL_DAILY_CAP_CENTS[channel];
    if (channelCap > 0) {
      const channelSpent = spend.channelCents[channel] || 0;
      if (channelSpent + cost > channelCap) {
        return {
          allowed: false,
          reason: `${channel} daily cap reached ($${(channelCap / 100).toFixed(2)}). Spent: $${(channelSpent / 100).toFixed(2)}`,
        };
      }
    }

    // Layer 3: Global hourly circuit breaker
    const globalHourlySpend = await getGlobalHourlySpend();
    const hourlyCap = getGlobalHourlyCap();
    if (globalHourlySpend + cost > hourlyCap) {
      return {
        allowed: false,
        reason: `Global hourly circuit breaker tripped ($${(hourlyCap / 100).toFixed(2)} cap). Current: $${(globalHourlySpend / 100).toFixed(2)}`,
      };
    }

    return { allowed: true };
  } catch (err) {
    // On DB error, allow free channels, block paid ones as a safety measure
    console.error('[COST-BREAKER] Budget check error:', err);
    if (cost === 0) return { allowed: true };
    return { allowed: false, reason: 'Budget check unavailable — blocking paid channel as precaution' };
  }
}

/**
 * Record spend after a message is sent.
 * Upserts into daily_spend_tracking for the current day.
 */
export async function trackSpend(
  userId: string,
  channel: DeliveryChannel,
  costCents: number
): Promise<void> {
  if (costCents <= 0) return;

  const today = getTodayDate();
  const supabase = getSupabaseClient();

  try {
    // Map channel to DB column name (only paid channels have columns)
    const CHANNEL_COLUMN_MAP: Partial<Record<DeliveryChannel, string>> = {
      sms: 'sms_spend_cents',
      voice: 'voice_spend_cents',
      whatsapp: 'whatsapp_spend_cents',
    };
    const channelColumn = CHANNEL_COLUMN_MAP[channel];

    // Try to get existing record
    const { data: existing } = await supabase
      .from('daily_spend_tracking')
      .select('id, total_spend_cents, sms_spend_cents, voice_spend_cents, whatsapp_spend_cents')
      .eq('user_id', userId)
      .eq('date', today)
      .single();

    if (existing) {
      // Update existing record
      const updateData: Record<string, number> = {
        total_spend_cents: (existing.total_spend_cents || 0) + costCents,
      };
      if (channelColumn) {
        const currentChannelCents = (existing as Record<string, number>)[channelColumn] || 0;
        updateData[channelColumn] = currentChannelCents + costCents;
      }

      await supabase
        .from('daily_spend_tracking')
        .update(updateData)
        .eq('id', existing.id);
    } else {
      // Insert new record for today
      const insertData: Record<string, string | number> = {
        user_id: userId,
        date: today,
        total_spend_cents: costCents,
        sms_spend_cents: 0,
        voice_spend_cents: 0,
        whatsapp_spend_cents: 0,
        ai_spend_cents: 0,
        browser_spend_cents: 0,
      };
      if (channelColumn) {
        insertData[channelColumn] = costCents;
      }

      await supabase
        .from('daily_spend_tracking')
        .insert(insertData);
    }

    // Invalidate cache
    spendCache.delete(`${userId}:${today}`);
  } catch (err) {
    console.error('[COST-BREAKER] trackSpend error:', err);
  }
}

/**
 * Get total global spend in the last hour across all users.
 * Used for the circuit breaker (Layer 3).
 */
export async function getGlobalHourlySpend(): Promise<number> {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const supabase = getSupabaseClient();

    // Sum recent cost from ai_cost_log (most accurate real-time source)
    const { data } = await supabase
      .from('ai_cost_log')
      .select('cost_usd')
      .gte('created_at', oneHourAgo);

    if (!data || data.length === 0) return 0;

    const totalUsd = data.reduce((sum: number, row: { cost_usd: number }) => sum + (row.cost_usd || 0), 0);
    return Math.round(totalUsd * 100); // Convert to cents
  } catch (err) {
    console.error('[COST-BREAKER] getGlobalHourlySpend error:', err);
    return 0; // On error, don't block
  }
}

// ---- Internal Helpers ----

/**
 * Get user's daily spend from cache or DB.
 */
async function getUserDailySpend(
  userId: string,
  today: string
): Promise<{ totalCents: number; channelCents: Record<string, number> }> {
  const cacheKey = `${userId}:${today}`;
  const cached = spendCache.get(cacheKey);

  if (cached && cached.date === today && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return { totalCents: cached.totalCents, channelCents: cached.channelCents };
  }

  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('daily_spend_tracking')
    .select('total_spend_cents, sms_spend_cents, voice_spend_cents, whatsapp_spend_cents')
    .eq('user_id', userId)
    .eq('date', today)
    .single();

  const result = {
    totalCents: data?.total_spend_cents || 0,
    channelCents: {
      sms: data?.sms_spend_cents || 0,
      voice: data?.voice_spend_cents || 0,
      whatsapp: data?.whatsapp_spend_cents || 0,
      email: 0, // free channel, no DB tracking
      telegram: 0, // free channel, no DB tracking
    } as Record<string, number>,
  };

  // Cache the result
  spendCache.set(cacheKey, {
    date: today,
    totalCents: result.totalCents,
    channelCents: result.channelCents,
    cachedAt: Date.now(),
  });

  return result;
}

/**
 * Get user's daily spend cap from user_settings, falling back to default.
 */
async function getUserDailyCap(userId: string): Promise<number> {
  try {
    const { data } = await getSupabaseClient()
      .from('user_settings')
      .select('daily_spend_cap_cents')
      .eq('user_id', userId)
      .single();

    return data?.daily_spend_cap_cents || DEFAULT_USER_DAILY_CAP_CENTS;
  } catch {
    return DEFAULT_USER_DAILY_CAP_CENTS;
  }
}
