import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

function getServiceSupabase() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || ""
  );
}

/**
 * POST /api/billing/topup
 * Creates a Stripe PaymentIntent for credit top-up.
 * If Stripe is not configured, returns beta mode info.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const amountCents = body.amount_cents;

    // Validate amount
    if (!amountCents || typeof amountCents !== "number" || amountCents < 100 || amountCents > 50000) {
      return NextResponse.json(
        { error: "Amount must be between $1.00 and $500.00" },
        { status: 400 }
      );
    }

    // Check if Stripe is configured
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({
        beta_mode: true,
        message: "Payment processing is coming soon. Your costs are tracked and your free credits are active.",
      });
    }

    // Dynamic import of Stripe
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    // Get or create Stripe customer
    const serviceDb = getServiceSupabase();
    const { data: wallet } = await serviceDb
      .from("credit_wallets")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .single();

    let customerId = wallet?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;

      await serviceDb
        .from("credit_wallets")
        .update({ stripe_customer_id: customerId })
        .eq("user_id", user.id);
    }

    // Create PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      customer: customerId,
      metadata: {
        user_id: user.id,
        type: "credit_topup",
        amount_cents: amountCents.toString(),
      },
      automatic_payment_methods: { enabled: true },
    });

    return NextResponse.json({
      client_secret: paymentIntent.client_secret,
      amount_cents: amountCents,
    });
  } catch (error) {
    console.error("[BILLING-TOPUP] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
