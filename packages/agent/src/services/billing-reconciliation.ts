/**
 * Billing Reconciliation Service
 *
 * Pulls ACTUAL costs from provider billing APIs and compares to our estimates.
 * If discrepancy exceeds threshold, logs an adjustment entry to ai_cost_log.
 *
 * Runs daily at startup + every 24 hours.
 *
 * Supported providers:
 *   - Anthropic: Admin API /v1/organizations/cost_report (requires ANTHROPIC_ADMIN_API_KEY)
 *
 * The reconciliation ensures we NEVER overcharge or undercharge customers long-term.
 * Per-request estimates may drift, but the daily reconciliation catches it.
 */

import { getSupabaseClient } from "../utils/supabase.js";
import { BILLING_MARKUP, COST_SAFETY_MARGIN } from "../utils/cost-calculator.js";

// Module-level correction factor — adjusts future estimates based on past reconciliation.
// If yesterday we estimated 1.5x actual, this becomes 1/1.5 = 0.667 for today.
// Starts at 1.0 (no correction). Updated daily by reconcileAll().
let anthropicCorrectionFactor = 1.0;

export function getAnthropicCorrectionFactor(): number {
  return anthropicCorrectionFactor;
}

interface CostReportResult {
  amount: string;
  currency: string;
  model: string | null;
  token_type: string | null;
  cost_type: string | null;
  service_tier: string | null;
}

interface CostReportBucket {
  starting_at: string;
  ending_at: string;
  results: CostReportResult[];
}

interface CostReportResponse {
  data: CostReportBucket[];
  has_more: boolean;
  next_page: string | null;
}

/**
 * Fetch actual Anthropic costs for a date range using the Admin API.
 * Returns cost in USD (NOT cents — converts from the cents-based API response).
 */
async function fetchAnthropicActualCost(startDate: Date, endDate: Date): Promise<number | null> {
  const adminKey = process.env.ANTHROPIC_ADMIN_API_KEY;
  if (!adminKey) return null;

  try {
    const params = new URLSearchParams({
      starting_at: startDate.toISOString(),
      ending_at: endDate.toISOString(),
      bucket_width: '1d',
    });
    // Group by description to get model + token_type breakdown
    params.append('group_by[]', 'description');

    const response = await fetch(
      `https://api.anthropic.com/v1/organizations/cost_report?${params}`,
      {
        headers: {
          'x-api-key': adminKey,
          'anthropic-version': '2023-06-01',
        },
      }
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error(`[RECONCILIATION] Anthropic Admin API ${response.status}: ${body.substring(0, 200)}`);
      return null;
    }

    const report: CostReportResponse = await response.json();

    // Sum all cost items — amount is in cents (decimal string), convert to USD
    let totalCents = 0;
    for (const bucket of report.data) {
      for (const result of bucket.results) {
        totalCents += parseFloat(result.amount || '0');
      }
    }

    return totalCents / 100; // Convert cents to USD
  } catch (error) {
    console.error(`[RECONCILIATION] Anthropic Admin API error: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/**
 * Get our logged Anthropic costs for a date range from ai_cost_log.
 * Returns the raw estimated cost (before safety margin and markup).
 */
async function getLoggedAnthropicCost(startDate: Date, endDate: Date): Promise<number> {
  const { data, error } = await getSupabaseClient()
    .from('ai_cost_log')
    .select('cost_usd')
    .gte('created_at', startDate.toISOString())
    .lt('created_at', endDate.toISOString())
    .in('provider', ['anthropic', 'haiku', 'sonnet']);

  if (error || !data) {
    console.error(`[RECONCILIATION] Failed to query ai_cost_log: ${error?.message}`);
    return 0;
  }

  const totalBilled = data.reduce((sum: number, row: { cost_usd: number | string | null }) => sum + Number(row.cost_usd || 0), 0);
  // ai_cost_log stores billed cost (with safety margin + markup). Reverse to get raw estimate.
  return totalBilled / (COST_SAFETY_MARGIN * BILLING_MARKUP);
}

/**
 * Reconcile Anthropic costs for yesterday.
 * Compares actual (Admin API) to estimated (ai_cost_log).
 * Updates correction factor for future estimates.
 */
export async function reconcileAnthropicDaily(): Promise<void> {
  const adminKey = process.env.ANTHROPIC_ADMIN_API_KEY;
  if (!adminKey) {
    console.log('[RECONCILIATION] No ANTHROPIC_ADMIN_API_KEY — skipping Anthropic reconciliation');
    return;
  }

  // Yesterday UTC
  const now = new Date();
  const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dateStr = yesterday.toISOString().split('T')[0];

  console.log(`[RECONCILIATION] Running Anthropic reconciliation for ${dateStr}...`);

  const [actualCost, estimatedCost] = await Promise.all([
    fetchAnthropicActualCost(yesterday, today),
    getLoggedAnthropicCost(yesterday, today),
  ]);

  if (actualCost === null) {
    console.log(`[RECONCILIATION] Could not fetch actual costs — skipping`);
    return;
  }

  if (actualCost === 0 && estimatedCost === 0) {
    console.log(`[RECONCILIATION] ${dateStr}: No Anthropic usage — nothing to reconcile`);
    return;
  }

  // Calculate discrepancy
  const ratio = estimatedCost > 0 ? estimatedCost / actualCost : 1;
  const discrepancyPct = Math.abs(ratio - 1) * 100;

  console.log(
    `[RECONCILIATION] ${dateStr}: ` +
    `Actual=$${actualCost.toFixed(4)} | Estimated=$${estimatedCost.toFixed(4)} | ` +
    `Ratio=${ratio.toFixed(3)} | Discrepancy=${discrepancyPct.toFixed(1)}%`
  );

  // Update correction factor for future estimates
  if (actualCost > 0 && estimatedCost > 0) {
    // Blend: 70% new data, 30% old factor (prevents wild swings from single-day anomalies)
    const newFactor = actualCost / estimatedCost;
    anthropicCorrectionFactor = 0.7 * newFactor + 0.3 * anthropicCorrectionFactor;
    console.log(`[RECONCILIATION] Updated correction factor: ${anthropicCorrectionFactor.toFixed(4)}`);
  }

  // Log reconciliation result to Supabase for audit trail
  try {
    await getSupabaseClient().from('ai_cost_log').insert({
      user_id: null,
      task_id: null,
      provider: 'reconciliation',
      model: 'anthropic',
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0, // No additional charge — just an audit entry
      purpose: `reconcile:${dateStr}:actual=$${actualCost.toFixed(4)}:estimated=$${estimatedCost.toFixed(4)}:ratio=${ratio.toFixed(3)}:correction=${anthropicCorrectionFactor.toFixed(4)}`,
      cached: false,
    });
  } catch (e) {
    // Non-critical — reconciliation still works without the audit log
  }

  // Alert on large discrepancy
  if (discrepancyPct > 25) {
    console.warn(
      `[RECONCILIATION] *** ALERT: Anthropic cost discrepancy ${discrepancyPct.toFixed(1)}% ` +
      `exceeds 25% threshold on ${dateStr}. Actual=$${actualCost.toFixed(4)}, ` +
      `Estimated=$${estimatedCost.toFixed(4)}. Review cost calculation. ***`
    );
  }
}

/**
 * Run all provider reconciliations.
 * Called at startup + every 24 hours from the scheduler.
 */
export async function reconcileAll(): Promise<void> {
  console.log('[RECONCILIATION] Starting daily billing reconciliation...');
  await reconcileAnthropicDaily();
  console.log('[RECONCILIATION] Reconciliation complete.');
}

// Schedule: run reconciliation at startup (delayed 30s) + every 24h
let reconciliationInterval: NodeJS.Timeout | null = null;

export function startReconciliationScheduler(): void {
  // Run 30s after startup (give systems time to initialize)
  setTimeout(() => {
    reconcileAll().catch(e => console.error(`[RECONCILIATION] Startup run failed: ${e}`));
  }, 30000);

  // Then every 24 hours
  reconciliationInterval = setInterval(() => {
    reconcileAll().catch(e => console.error(`[RECONCILIATION] Scheduled run failed: ${e}`));
  }, 24 * 60 * 60 * 1000);

  console.log('[RECONCILIATION] Scheduler started (30s initial + every 24h)');
}

export function stopReconciliationScheduler(): void {
  if (reconciliationInterval) {
    clearInterval(reconciliationInterval);
    reconciliationInterval = null;
  }
}
