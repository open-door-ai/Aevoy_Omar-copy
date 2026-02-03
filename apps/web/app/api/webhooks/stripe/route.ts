import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || ""
  );
}

// Verify Stripe webhook signature without importing Stripe SDK types
function verifyStripeSignature(payload: string, sigHeader: string, secret: string): boolean {
  const parts = sigHeader.split(",");
  const timestamp = parts.find(p => p.startsWith("t="))?.slice(2);
  const signature = parts.find(p => p.startsWith("v1="))?.slice(3);
  if (!timestamp || !signature) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const expected = createHmac("sha256", secret).update(signedPayload).digest("hex");
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  // Verify signature if secret is configured
  if (process.env.STRIPE_WEBHOOK_SECRET) {
    if (!verifyStripeSignature(body, signature, process.env.STRIPE_WEBHOOK_SECRET)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  } else if (process.env.SKIP_PAYMENT_CHECKS !== "true") {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const obj = event.data.object;

    switch (event.type) {
      case "checkout.session.completed": {
        const email = obj.customer_email as string;
        const customerId = obj.customer as string;
        if (email) {
          await getSupabase().from("profiles").update({
            stripe_customer_id: customerId,
            subscription_status: "active",
            subscription_tier: "pro",
            messages_limit: 1000,
            subscription_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
          }).eq("email", email);
        }
        break;
      }
      case "customer.subscription.updated": {
        const customerId = obj.customer as string;
        const status = obj.status as string;
        let subStatus = "active";
        if (status === "past_due") subStatus = "past_due";
        else if (status === "canceled") subStatus = "cancelled";
        else if (status === "unpaid") subStatus = "unpaid";
        const periodEnd = new Date((obj.current_period_end as number) * 1000);
        await getSupabase().from("profiles").update({
          subscription_status: subStatus,
          subscription_ends_at: periodEnd.toISOString()
        }).eq("stripe_customer_id", customerId);
        break;
      }
      case "customer.subscription.deleted": {
        const customerId = obj.customer as string;
        await getSupabase().from("profiles").update({
          subscription_status: "cancelled", subscription_tier: "free", messages_limit: 20
        }).eq("stripe_customer_id", customerId);
        break;
      }
      case "invoice.payment_failed": {
        const customerId = obj.customer as string;
        await getSupabase().from("profiles").update({ subscription_status: "past_due" }).eq("stripe_customer_id", customerId);
        break;
      }
      case "invoice.paid": {
        const customerId = obj.customer as string;
        await getSupabase().from("profiles").update({ subscription_status: "active", messages_used: 0 }).eq("stripe_customer_id", customerId);
        break;
      }
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[STRIPE] Webhook error:", error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
