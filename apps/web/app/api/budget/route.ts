import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/budget
 * Returns user's current budget status
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

    const billingEnabled = process.env.BILLING_ENABLED === "true";
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM

    // Get current month's usage
    const { data: usage, error: usageError } = await supabase
      .from("usage")
      .select("ai_cost_cents")
      .eq("user_id", user.id)
      .eq("month", month)
      .single();

    // Get user's subscription tier
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("subscription_tier")
      .eq("id", user.id)
      .single();

    if (profileError) {
      return NextResponse.json({ error: "Failed to fetch profile" }, { status: 500 });
    }

    // Tier limits (cents)
    const tierLimits = {
      free: 400, // $4
      beta: 5000, // $50
      paid: Infinity,
    } as const;

    const tier = (profile?.subscription_tier || "free") as keyof typeof tierLimits;
    const limitCents = tierLimits[tier] || tierLimits.free;
    const usedCents = usage?.ai_cost_cents || 0;
    const remainingCents = Math.max(0, limitCents - usedCents);
    const percentageUsed = limitCents > 0 && limitCents !== Infinity
      ? (usedCents / limitCents) * 100
      : 0;

    return NextResponse.json({
      billing_enabled: billingEnabled,
      tier,
      used_usd: usedCents / 100,
      limit_usd: limitCents === Infinity ? null : limitCents / 100,
      remaining_usd: limitCents === Infinity ? null : remainingCents / 100,
      percentage_used: Math.min(100, Math.round(percentageUsed)),
      is_over_budget: billingEnabled && usedCents >= limitCents,
      warning_threshold_reached: billingEnabled && usedCents >= limitCents * 0.8,
    });
  } catch (error) {
    console.error("[BUDGET-API] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
