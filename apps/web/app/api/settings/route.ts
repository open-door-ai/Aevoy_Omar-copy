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

  // Get user settings
  const { data: settings, error } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (error && error.code !== "PGRST116") {
    // PGRST116 = no rows found
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Return defaults if no settings exist
  const response = settings || {
    user_id: user.id,
    confirmation_mode: "unclear",
    verification_method: "forward",
    agent_card_enabled: false,
    agent_card_limit_transaction: 5000,
    agent_card_limit_monthly: 20000,
    virtual_phone: null,
  };

  return NextResponse.json(response);
}

export async function PUT(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    // Validate confirmation_mode
    const validModes = ["always", "unclear", "risky", "never"];
    if (body.confirmation_mode && !validModes.includes(body.confirmation_mode)) {
      return NextResponse.json(
        { error: "Invalid confirmation_mode" },
        { status: 400 }
      );
    }

    // Validate verification_method
    const validMethods = ["forward", "virtual_number"];
    if (
      body.verification_method &&
      !validMethods.includes(body.verification_method)
    ) {
      return NextResponse.json(
        { error: "Invalid verification_method" },
        { status: 400 }
      );
    }

    // Upsert settings
    const { data, error } = await supabase
      .from("user_settings")
      .upsert(
        {
          user_id: user.id,
          confirmation_mode: body.confirmation_mode,
          verification_method: body.verification_method,
          agent_card_enabled: body.agent_card_enabled,
          agent_card_limit_transaction: body.agent_card_limit_transaction,
          agent_card_limit_monthly: body.agent_card_limit_monthly,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      )
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}
