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
    task_budget_cents: 500,
    max_task_iterations: 15,
    master_timeout_minutes: 15,
    clarification_timeout_ms: 300000,
    monitoring_interval_ms: 300000,
    dashboard_tour_seen: false,
    report_frequency: "weekly",
    full_send_mode: false,
    full_send_auto_reply: true,
    full_send_draft_threshold: "medium",
    greeting_style: "casual",
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

    // Validate task_budget_cents
    if (body.task_budget_cents !== undefined) {
      const v = parseInt(body.task_budget_cents);
      if (isNaN(v)) {
        return NextResponse.json({ error: "Invalid task_budget_cents" }, { status: 400 });
      }
      body.task_budget_cents = Math.max(100, Math.min(5000, v));
    }

    // Validate max_task_iterations
    if (body.max_task_iterations !== undefined) {
      const v = parseInt(body.max_task_iterations);
      if (isNaN(v)) {
        return NextResponse.json({ error: "Invalid max_task_iterations" }, { status: 400 });
      }
      body.max_task_iterations = Math.max(5, Math.min(30, v));
    }

    // Validate master_timeout_minutes
    if (body.master_timeout_minutes !== undefined) {
      const v = parseInt(body.master_timeout_minutes);
      if (isNaN(v)) {
        return NextResponse.json({ error: "Invalid master_timeout_minutes" }, { status: 400 });
      }
      body.master_timeout_minutes = Math.max(5, Math.min(480, v));
    }

    // Validate clarification_timeout_ms
    if (body.clarification_timeout_ms !== undefined) {
      const v = parseInt(body.clarification_timeout_ms);
      if (isNaN(v)) {
        return NextResponse.json({ error: "Invalid clarification_timeout_ms" }, { status: 400 });
      }
      body.clarification_timeout_ms = Math.max(30000, Math.min(3600000, v));
    }

    // Validate monitoring_interval_ms
    if (body.monitoring_interval_ms !== undefined) {
      const v = parseInt(body.monitoring_interval_ms);
      if (isNaN(v)) {
        return NextResponse.json({ error: "Invalid monitoring_interval_ms" }, { status: 400 });
      }
      body.monitoring_interval_ms = Math.max(60000, Math.min(3600000, v));
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
    if (body.task_budget_cents !== undefined) updatePayload.task_budget_cents = body.task_budget_cents;
    if (body.max_task_iterations !== undefined) updatePayload.max_task_iterations = body.max_task_iterations;
    if (body.master_timeout_minutes !== undefined) updatePayload.master_timeout_minutes = body.master_timeout_minutes;
    if (body.clarification_timeout_ms !== undefined) updatePayload.clarification_timeout_ms = body.clarification_timeout_ms;
    if (body.monitoring_interval_ms !== undefined) updatePayload.monitoring_interval_ms = body.monitoring_interval_ms;
    if (body.dashboard_tour_seen !== undefined) updatePayload.dashboard_tour_seen = body.dashboard_tour_seen;
    if (body.voice_preference !== undefined) updatePayload.voice_preference = body.voice_preference;
    if (body.report_frequency !== undefined) {
      const validFreqs = ["daily", "weekly", "never"];
      if (!validFreqs.includes(body.report_frequency)) {
        return NextResponse.json({ error: "Invalid report_frequency" }, { status: 400 });
      }
      updatePayload.report_frequency = body.report_frequency;
    }
    if (body.proactive_channel !== undefined) {
      const validChannels = ["sms", "email", "telegram", "whatsapp", "voice"];
      if (!validChannels.includes(body.proactive_channel)) {
        return NextResponse.json({ error: "Invalid proactive_channel" }, { status: 400 });
      }
      updatePayload.proactive_channel = body.proactive_channel;
    }
    if (body.proactive_enabled !== undefined) updatePayload.proactive_enabled = body.proactive_enabled;
    if (body.greeting_style !== undefined) {
      const validStyles = ["casual", "jarvis"];
      if (!validStyles.includes(body.greeting_style)) {
        return NextResponse.json({ error: "Invalid greeting_style" }, { status: 400 });
      }
      updatePayload.greeting_style = body.greeting_style;
    }

    // Full Send Mode
    if (body.full_send_mode !== undefined) updatePayload.full_send_mode = !!body.full_send_mode;
    if (body.full_send_auto_reply !== undefined) updatePayload.full_send_auto_reply = !!body.full_send_auto_reply;
    if (body.full_send_draft_threshold !== undefined) {
      const validThresholds = ["all", "medium", "high"];
      if (!validThresholds.includes(body.full_send_draft_threshold)) {
        return NextResponse.json({ error: "Invalid full_send_draft_threshold" }, { status: 400 });
      }
      updatePayload.full_send_draft_threshold = body.full_send_draft_threshold;
    }

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
