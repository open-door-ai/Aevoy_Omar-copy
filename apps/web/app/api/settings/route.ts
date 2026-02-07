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
    console.error("Settings fetch error:", error);
    return NextResponse.json(
      { error: "internal_error", message: "An unexpected error occurred" },
      { status: 500 }
    );
  }

  // Return defaults if no settings exist (omit user_id so onboarding triggers)
  const response = settings || {
    confirmation_mode: "unclear",
    verification_method: "forward",
    agent_card_enabled: false,
    agent_card_limit_transaction: 5000,
    agent_card_limit_monthly: 20000,
    virtual_phone: null,
    proactive_daily_limit: 10,
    auto_install_skills: true,
    auto_acquire_oauth: true,
    auto_signup_free_trial: true,
    parallel_execution: true,
    iterative_deepening: true,
    monthly_budget: 15.0,
    dashboard_tour_seen: false,
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

    // Validate proactive_daily_limit
    if (body.proactive_daily_limit !== undefined) {
      const limit = parseInt(body.proactive_daily_limit);
      if (isNaN(limit) || limit < 0 || limit > 20) {
        return NextResponse.json(
          { error: "Invalid proactive_daily_limit (must be 0-20)" },
          { status: 400 }
        );
      }
    }

    // Validate monthly_budget
    if (body.monthly_budget !== undefined) {
      const budget = parseFloat(body.monthly_budget);
      if (isNaN(budget) || budget < 5 || budget > 100) {
        return NextResponse.json(
          { error: "Invalid monthly_budget (must be 5-100)" },
          { status: 400 }
        );
      }
    }

    // Build update payload — only include fields that were sent
    const updatePayload: Record<string, unknown> = {
      user_id: user.id,
      updated_at: new Date().toISOString(),
    };

    if (body.confirmation_mode !== undefined) updatePayload.confirmation_mode = body.confirmation_mode;
    if (body.verification_method !== undefined) updatePayload.verification_method = body.verification_method;
    if (body.agent_card_enabled !== undefined) updatePayload.agent_card_enabled = body.agent_card_enabled;
    if (body.agent_card_limit_transaction !== undefined) updatePayload.agent_card_limit_transaction = body.agent_card_limit_transaction;
    if (body.agent_card_limit_monthly !== undefined) updatePayload.agent_card_limit_monthly = body.agent_card_limit_monthly;
    if (body.proactive_daily_limit !== undefined) updatePayload.proactive_daily_limit = body.proactive_daily_limit;
    if (body.auto_install_skills !== undefined) updatePayload.auto_install_skills = body.auto_install_skills;
    if (body.auto_acquire_oauth !== undefined) updatePayload.auto_acquire_oauth = body.auto_acquire_oauth;
    if (body.auto_signup_free_trial !== undefined) updatePayload.auto_signup_free_trial = body.auto_signup_free_trial;
    if (body.parallel_execution !== undefined) updatePayload.parallel_execution = body.parallel_execution;
    if (body.iterative_deepening !== undefined) updatePayload.iterative_deepening = body.iterative_deepening;
    if (body.monthly_budget !== undefined) updatePayload.monthly_budget = body.monthly_budget;
    if (body.dashboard_tour_seen !== undefined) updatePayload.dashboard_tour_seen = body.dashboard_tour_seen;

    // Upsert settings
    const { data, error } = await supabase
      .from("user_settings")
      .upsert(updatePayload, { onConflict: "user_id" })
      .select()
      .single();

    if (error) {
      console.error("Settings update error:", error);
      return NextResponse.json(
        { error: "internal_error", message: "An unexpected error occurred" },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}
