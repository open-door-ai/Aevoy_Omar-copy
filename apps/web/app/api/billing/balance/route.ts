import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/billing/balance
 * Returns user's credit balance and recent transactions.
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get wallet
    const { data: wallet } = await supabase
      .from("credit_wallets")
      .select("balance_cents, lifetime_topup_cents, lifetime_spent_cents, auto_reload_enabled, auto_reload_threshold_cents, auto_reload_amount_cents, free_credits_granted")
      .eq("user_id", user.id)
      .single();

    // Get recent transactions (last 50)
    const { data: transactions } = await supabase
      .from("credit_transactions")
      .select("id, type, amount_cents, balance_after_cents, description, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    // Get this week's spending
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const { data: weekTxs } = await supabase
      .from("credit_transactions")
      .select("amount_cents")
      .eq("user_id", user.id)
      .eq("type", "deduction")
      .gte("created_at", weekAgo.toISOString());

    const weeklySpentCents = (weekTxs || []).reduce(
      (sum, tx) => sum + Math.abs(tx.amount_cents),
      0
    );
    const weeklyTaskCount = weekTxs?.length || 0;

    const balanceCents = wallet?.balance_cents || 0;

    return NextResponse.json({
      balance_cents: balanceCents,
      balance_usd: (balanceCents / 100).toFixed(2),
      lifetime_topup_usd: ((wallet?.lifetime_topup_cents || 0) / 100).toFixed(2),
      lifetime_spent_usd: ((wallet?.lifetime_spent_cents || 0) / 100).toFixed(2),
      auto_reload: {
        enabled: wallet?.auto_reload_enabled || false,
        threshold_cents: wallet?.auto_reload_threshold_cents || 200,
        amount_cents: wallet?.auto_reload_amount_cents || 1000,
      },
      weekly_summary: {
        spent_usd: (weeklySpentCents / 100).toFixed(2),
        task_count: weeklyTaskCount,
        remaining_usd: (balanceCents / 100).toFixed(2),
      },
      transactions: transactions || [],
      stripe_configured: !!process.env.STRIPE_SECRET_KEY,
    });
  } catch (error) {
    console.error("[BILLING-API] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
