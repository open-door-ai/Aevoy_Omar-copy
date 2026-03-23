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
      return NextResponse.json(
        { error: "Payment processing is not configured. Please contact support." },
        { status: 503 }
      );
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

    // Create Stripe Checkout Session (hosted payment page — no frontend SDK needed)
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: {
            name: `Aurora Credit Top-Up — $${(amountCents / 100).toFixed(2)}`,
            description: `Add $${(amountCents / 100).toFixed(2)} credits to your Aurora account`,
          },
          unit_amount: amountCents,
        },
        quantity: 1,
      }],
      payment_intent_data: {
        metadata: {
          user_id: user.id,
          type: "credit_topup",
          amount_cents: amountCents.toString(),
        },
      },
      success_url: `${process.env.NEXT_PUBLIC_APP_URL || "https://www.aevoy.com"}/dashboard/billing?topup=success`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL || "https://www.aevoy.com"}/dashboard/billing?topup=cancelled`,
    });

    return NextResponse.json({
      checkout_url: session.url,
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
