/**
 * Twilio Usage Reconciliation
 *
 * Runs daily to compare what Twilio actually billed vs what we logged in ai_cost_log.
 * Alerts on discrepancies > 20%.
 *
 * Wired into scheduler.ts — runs once at startup (after 60s delay) then every 24h.
 */

import { getSupabaseClient } from '../utils/supabase.js';

const TWILIO_BASE_URL = 'https://api.twilio.com/2010-04-01';

export async function runTwilioReconciliation(): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    console.warn('[RECONCILE] Twilio credentials not available');
    return;
  }

  try {
    // Fetch Twilio usage for the last 24 hours
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const startDate = yesterday.toISOString().split('T')[0];

    const url = `${TWILIO_BASE_URL}/Accounts/${accountSid}/Usage/Records.json?StartDate=${startDate}&PageSize=100`;
    const response = await fetch(url, {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.warn(`[RECONCILE] Twilio API error: ${response.status}`);
      return;
    }

    const data = await response.json() as { usage_records?: Array<{ category: string; price: string; count: string }> };
    const records = data.usage_records || [];

    // Total Twilio actual cost
    const twilioActualTotal = records.reduce((sum, r) => sum + parseFloat(r.price || '0'), 0);

    // What we logged in ai_cost_log for same period
    const supabase = getSupabaseClient();
    const { data: logged } = await supabase
      .from('ai_cost_log')
      .select('cost_usd')
      .eq('provider', 'twilio')
      .gte('created_at', `${startDate}T00:00:00.000Z`);

    const loggedTotal = (logged || []).reduce((sum, r) => sum + (r.cost_usd || 0), 0);

    // Discrepancy check
    const discrepancyPct = twilioActualTotal > 0
      ? Math.abs(twilioActualTotal - loggedTotal) / twilioActualTotal * 100
      : 0;

    console.log(`[RECONCILE] Twilio actual: $${twilioActualTotal.toFixed(4)}, Logged: $${loggedTotal.toFixed(4)}, Discrepancy: ${discrepancyPct.toFixed(1)}%`);

    // Alert and log untracked gap if > 20% discrepancy on a material amount
    if (discrepancyPct > 20 && twilioActualTotal > 0.50) {
      console.error(`[RECONCILE] ALERT: ${discrepancyPct.toFixed(1)}% discrepancy — Twilio billed $${twilioActualTotal.toFixed(2)}, we logged $${loggedTotal.toFixed(2)}`);
      const gap = twilioActualTotal - loggedTotal;
      if (gap > 0) {
        // Log untracked cost as a platform-level entry (no user_id)
        await supabase.from('ai_cost_log').insert({
          user_id: null,
          provider: 'twilio',
          model: 'reconciliation',
          input_tokens: 0,
          output_tokens: 0,
          cost_usd: gap,
          purpose: 'untracked_reconciliation',
          cached: false,
          created_at: new Date().toISOString(),
        });
      }
    }

    // Audit trail entry (zero-cost marker)
    await supabase.from('ai_cost_log').insert({
      user_id: null,
      provider: 'twilio',
      model: 'daily_reconciliation',
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
      purpose: `reconcile_${startDate}: actual=$${twilioActualTotal.toFixed(4)} logged=$${loggedTotal.toFixed(4)} gap=${discrepancyPct.toFixed(1)}%`,
      cached: false,
      created_at: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[RECONCILE] Failed:', err);
  }
}
