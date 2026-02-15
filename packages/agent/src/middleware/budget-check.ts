/**
 * Budget enforcement middleware
 *
 * Enforces monthly budget limits based on subscription tier.
 * Only active when BILLING_ENABLED=true.
 *
 * Limits:
 * - free: $10/month (1000 cents)
 * - beta: $50/month (5000 cents)
 * - paid: unlimited
 */

import { getSupabaseClient } from '../utils/supabase.js';

interface BudgetCheckResult {
  allowed: boolean;
  remaining_usd: number;
  used_usd: number;
  limit_usd: number;
  tier: string;
  reason?: string;
}

const TIER_LIMITS_CENTS = {
  free: 1000,  // $10
  beta: 5000,  // $50
  paid: Infinity,
} as const;

/**
 * Check if user has budget remaining for task execution
 */
export async function checkBudget(userId: string): Promise<BudgetCheckResult> {
  // Billing disabled = unlimited budget
  if (process.env.BILLING_ENABLED !== 'true') {
    return {
      allowed: true,
      remaining_usd: Infinity,
      used_usd: 0,
      limit_usd: Infinity,
      tier: 'beta',
    };
  }

  try {
    // Get current month usage
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM
    const supabase = getSupabaseClient();

    const { data: usage, error: usageError } = await supabase
      .from('usage')
      .select('ai_cost_cents')
      .eq('user_id', userId)
      .eq('month', month)
      .single();

    if (usageError && usageError.code !== 'PGRST116') { // PGRST116 = no rows
      console.error('[BudgetCheck] Failed to fetch usage:', usageError);
      // On error, allow task (fail open for better UX)
      return {
        allowed: true,
        remaining_usd: 0,
        used_usd: 0,
        limit_usd: 0,
        tier: 'unknown',
        reason: 'Budget check failed, allowing task',
      };
    }

    // Get user's subscription tier
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('subscription_tier')
      .eq('id', userId)
      .single();

    if (profileError) {
      console.error('[BudgetCheck] Failed to fetch profile:', profileError);
      return {
        allowed: true,
        remaining_usd: 0,
        used_usd: 0,
        limit_usd: 0,
        tier: 'unknown',
        reason: 'Profile fetch failed, allowing task',
      };
    }

    const tier = (profile?.subscription_tier || 'free') as keyof typeof TIER_LIMITS_CENTS;
    const limitCents = TIER_LIMITS_CENTS[tier] || TIER_LIMITS_CENTS.free;
    const usedCents = usage?.ai_cost_cents || 0;
    const remainingCents = limitCents - usedCents;

    // Check if over budget
    if (usedCents >= limitCents) {
      return {
        allowed: false,
        remaining_usd: 0,
        used_usd: usedCents / 100,
        limit_usd: limitCents / 100,
        tier,
        reason: `Monthly budget of $${limitCents / 100} exceeded. Current usage: $${(usedCents / 100).toFixed(2)}. Upgrade your plan or wait for next month.`,
      };
    }

    return {
      allowed: true,
      remaining_usd: remainingCents / 100,
      used_usd: usedCents / 100,
      limit_usd: limitCents / 100,
      tier,
    };
  } catch (err) {
    console.error('[BudgetCheck] Unexpected error:', err);
    // Fail open on unexpected errors
    return {
      allowed: true,
      remaining_usd: 0,
      used_usd: 0,
      limit_usd: 0,
      tier: 'unknown',
      reason: 'Budget check error, allowing task',
    };
  }
}

/**
 * Check if user should receive 80% budget warning
 * Returns true if warning should be sent (first time crossing 80% threshold)
 */
export async function shouldSendBudgetWarning(userId: string): Promise<boolean> {
  if (process.env.BILLING_ENABLED !== 'true') {
    return false;
  }

  try {
    const month = new Date().toISOString().slice(0, 7);
    const supabase = getSupabaseClient();

    // Check if warning already sent this month
    const { data: existingWarning } = await supabase
      .from('tasks')
      .select('id')
      .eq('user_id', userId)
      .eq('type', 'budget_alert')
      .gte('created_at', `${month}-01`)
      .single();

    if (existingWarning) {
      return false; // Already warned this month
    }

    // Get current usage
    const { data: usage } = await supabase
      .from('usage')
      .select('ai_cost_cents')
      .eq('user_id', userId)
      .eq('month', month)
      .single();

    const { data: profile } = await supabase
      .from('profiles')
      .select('subscription_tier')
      .eq('id', userId)
      .single();

    const tier = (profile?.subscription_tier || 'free') as keyof typeof TIER_LIMITS_CENTS;
    const limitCents = TIER_LIMITS_CENTS[tier] || TIER_LIMITS_CENTS.free;
    const usedCents = usage?.ai_cost_cents || 0;

    // Send warning if >= 80% and < 100%
    return usedCents >= limitCents * 0.8 && usedCents < limitCents;
  } catch (err) {
    console.error('[BudgetCheck] Warning check error:', err);
    return false;
  }
}

/**
 * Estimate task cost before execution
 * Returns estimated cost in USD
 */
export async function estimateTaskCost(taskDescription: string, taskType?: string): Promise<number> {
  // Simple heuristic-based estimation
  // In production, this could use ML or historical averages

  const lowerTask = taskDescription.toLowerCase();

  // Check for keywords indicating complexity
  const isSimple = !lowerTask.includes('find') &&
                   !lowerTask.includes('search') &&
                   !lowerTask.includes('book') &&
                   !lowerTask.includes('buy') &&
                   taskDescription.length < 100;

  const isBooking = lowerTask.includes('book') ||
                    lowerTask.includes('reserve') ||
                    lowerTask.includes('purchase') ||
                    lowerTask.includes('buy');

  const isResearch = lowerTask.includes('find') ||
                     lowerTask.includes('search') ||
                     lowerTask.includes('compare') ||
                     lowerTask.includes('research');

  if (isSimple) {
    return 0.001; // AI only, ~1000 tokens
  } else if (isBooking) {
    return 0.10; // Browser + potential CAPTCHA + multi-step
  } else if (isResearch) {
    return 0.05; // Browser + AI, ~5 min
  } else {
    return 0.025; // Default moderate complexity
  }
}

/**
 * Get user's current budget status
 * (Useful for dashboard widgets)
 */
export async function getBudgetStatus(userId: string): Promise<{
  used_usd: number;
  limit_usd: number;
  remaining_usd: number;
  percentage_used: number;
  tier: string;
  billing_enabled: boolean;
}> {
  const billingEnabled = process.env.BILLING_ENABLED === 'true';

  if (!billingEnabled) {
    return {
      used_usd: 0,
      limit_usd: Infinity,
      remaining_usd: Infinity,
      percentage_used: 0,
      tier: 'beta',
      billing_enabled: false,
    };
  }

  const budget = await checkBudget(userId);

  return {
    used_usd: budget.used_usd,
    limit_usd: budget.limit_usd,
    remaining_usd: budget.remaining_usd,
    percentage_used: budget.limit_usd > 0 ? (budget.used_usd / budget.limit_usd) * 100 : 0,
    tier: budget.tier,
    billing_enabled: true,
  };
}
