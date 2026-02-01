import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get user's agent card
  const { data: card, error } = await supabase
    .from("agent_cards")
    .select("id, last_four, balance_cents, is_frozen, created_at")
    .eq("user_id", user.id)
    .single();

  if (error && error.code !== "PGRST116") {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(card || null);
}

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const action = body.action;

    switch (action) {
      case "create": {
        // Check if user already has a card
        const { data: existing } = await supabase
          .from("agent_cards")
          .select("id")
          .eq("user_id", user.id)
          .single();

        if (existing) {
          return NextResponse.json(
            { error: "You already have an agent card" },
            { status: 400 }
          );
        }

        // Create a mock card (in production, this would call Privacy.com API)
        const mockLastFour = Math.floor(1000 + Math.random() * 9000).toString();
        const mockCardId = `card_${Date.now()}_${Math.random().toString(36).slice(2)}`;

        const { data: card, error } = await supabase
          .from("agent_cards")
          .insert({
            user_id: user.id,
            card_id: mockCardId,
            last_four: mockLastFour,
            balance_cents: 0,
            is_frozen: false,
          })
          .select("id, last_four, balance_cents, is_frozen, created_at")
          .single();

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }

        // Update user settings
        await supabase.from("user_settings").upsert(
          {
            user_id: user.id,
            agent_card_enabled: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );

        return NextResponse.json(card);
      }

      case "fund": {
        const amount = body.amount;
        if (!amount || amount <= 0) {
          return NextResponse.json(
            { error: "Invalid amount" },
            { status: 400 }
          );
        }

        // Get current card
        const { data: card, error: cardError } = await supabase
          .from("agent_cards")
          .select("*")
          .eq("user_id", user.id)
          .single();

        if (cardError || !card) {
          return NextResponse.json(
            { error: "No agent card found" },
            { status: 404 }
          );
        }

        // In production: charge user's Stripe payment method first
        // For now, just add to balance
        const newBalance = card.balance_cents + Math.round(amount * 100);

        const { error: updateError } = await supabase
          .from("agent_cards")
          .update({ balance_cents: newBalance })
          .eq("id", card.id);

        if (updateError) {
          return NextResponse.json(
            { error: updateError.message },
            { status: 500 }
          );
        }

        return NextResponse.json({ success: true, newBalance });
      }

      case "freeze": {
        const { error } = await supabase
          .from("agent_cards")
          .update({ is_frozen: true })
          .eq("user_id", user.id);

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true });
      }

      case "unfreeze": {
        const { error } = await supabase
          .from("agent_cards")
          .update({ is_frozen: false })
          .eq("user_id", user.id);

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true });
      }

      case "delete": {
        const { error } = await supabase
          .from("agent_cards")
          .delete()
          .eq("user_id", user.id);

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }

        // Update user settings
        await supabase
          .from("user_settings")
          .update({
            agent_card_enabled: false,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", user.id);

        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json(
          { error: "Invalid action" },
          { status: 400 }
        );
    }
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}
