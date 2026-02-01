import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// This route handles Stripe webhooks for subscription management
// Set up in Stripe dashboard: https://dashboard.stripe.com/webhooks

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  // Get the raw body for signature verification
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");
  
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }
  
  // In production, verify the webhook signature using Stripe SDK
  // For now, we'll parse the event directly
  let event;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  
  console.log(`[STRIPE] Received event: ${event.type}`);
  
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        // User completed checkout - activate subscription
        const session = event.data.object;
        const email = session.customer_email;
        const customerId = session.customer;
        
        if (email) {
          await supabase
            .from("profiles")
            .update({
              stripe_customer_id: customerId,
              subscription_status: "active",
              subscription_tier: "pro",
              messages_limit: 1000, // Pro tier gets more messages
              subscription_ends_at: new Date(
                Date.now() + 30 * 24 * 60 * 60 * 1000
              ).toISOString() // 30 days from now
            })
            .eq("email", email);
          
          console.log(`[STRIPE] Activated subscription for ${email}`);
        }
        break;
      }
      
      case "customer.subscription.updated": {
        // Subscription was updated (renewal, plan change, etc.)
        const subscription = event.data.object;
        const customerId = subscription.customer;
        const status = subscription.status;
        
        let subscriptionStatus = "active";
        if (status === "past_due") subscriptionStatus = "past_due";
        else if (status === "canceled") subscriptionStatus = "cancelled";
        else if (status === "unpaid") subscriptionStatus = "unpaid";
        
        // Get the current period end
        const periodEnd = new Date(subscription.current_period_end * 1000);
        
        await supabase
          .from("profiles")
          .update({
            subscription_status: subscriptionStatus,
            subscription_ends_at: periodEnd.toISOString()
          })
          .eq("stripe_customer_id", customerId);
        
        console.log(`[STRIPE] Updated subscription for customer ${customerId}: ${subscriptionStatus}`);
        break;
      }
      
      case "customer.subscription.deleted": {
        // Subscription was cancelled
        const subscription = event.data.object;
        const customerId = subscription.customer;
        
        await supabase
          .from("profiles")
          .update({
            subscription_status: "cancelled",
            subscription_tier: "free",
            messages_limit: 20 // Back to free tier
          })
          .eq("stripe_customer_id", customerId);
        
        console.log(`[STRIPE] Cancelled subscription for customer ${customerId}`);
        break;
      }
      
      case "invoice.payment_failed": {
        // Payment failed - mark subscription as past due
        const invoice = event.data.object;
        const customerId = invoice.customer;
        
        await supabase
          .from("profiles")
          .update({ subscription_status: "past_due" })
          .eq("stripe_customer_id", customerId);
        
        console.log(`[STRIPE] Payment failed for customer ${customerId}`);
        break;
      }
      
      case "invoice.paid": {
        // Payment succeeded - ensure subscription is active
        const invoice = event.data.object;
        const customerId = invoice.customer;
        
        await supabase
          .from("profiles")
          .update({
            subscription_status: "active",
            messages_used: 0 // Reset monthly usage
          })
          .eq("stripe_customer_id", customerId);
        
        console.log(`[STRIPE] Payment succeeded for customer ${customerId}`);
        break;
      }
      
      default:
        console.log(`[STRIPE] Unhandled event type: ${event.type}`);
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
