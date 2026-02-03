import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-12-18.acacia" })
  : null;

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  // Verify webhook signature cryptographically
  let event: Stripe.Event;
  try {
    if (stripe && process.env.STRIPE_WEBHOOK_SECRET) {
      event = stripe.webhooks.constructEvent(
        body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } else if (process.env.SKIP_PAYMENT_CHECKS === "true") {
      // Only allow unverified events in test mode
      event = JSON.parse(body) as Stripe.Event;
      console.warn("[STRIPE] Running in test mode — signature not verified");
    } else {
      return NextResponse.json(
        { error: "Stripe not configured" },
        { status: 500 }
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[STRIPE] Signature verification failed:", message);
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 401 }
    );
  }

  console.log(`[STRIPE] Verified event: ${event.type}`);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const email = session.customer_email;
        const customerId = session.customer as string;

        if (email) {
          await supabase
            .from("profiles")
            .update({
              stripe_customer_id: customerId,
              subscription_status: "active",
              subscription_tier: "pro",
              messages_limit: 1000,
              subscription_ends_at: new Date(
                Date.now() + 30 * 24 * 60 * 60 * 1000
              ).toISOString()
            })
            .eq("email", email);
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const status = subscription.status;

        let subscriptionStatus = "active";
        if (status === "past_due") subscriptionStatus = "past_due";
        else if (status === "canceled") subscriptionStatus = "cancelled";
        else if (status === "unpaid") subscriptionStatus = "unpaid";

        const periodEnd = new Date(subscription.current_period_end * 1000);

        await supabase
          .from("profiles")
          .update({
            subscription_status: subscriptionStatus,
            subscription_ends_at: periodEnd.toISOString()
          })
          .eq("stripe_customer_id", customerId);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        await supabase
          .from("profiles")
          .update({
            subscription_status: "cancelled",
            subscription_tier: "free",
            messages_limit: 20
          })
          .eq("stripe_customer_id", customerId);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        await supabase
          .from("profiles")
          .update({ subscription_status: "past_due" })
          .eq("stripe_customer_id", customerId);
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        await supabase
          .from("profiles")
          .update({
            subscription_status: "active",
            messages_used: 0
          })
          .eq("stripe_customer_id", customerId);
        break;
      }

      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[STRIPE] Error processing webhook:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
