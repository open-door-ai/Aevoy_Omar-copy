import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

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

    // Update profile with onboarding data
    const profileUpdate: Record<string, unknown> = {
      onboarding_completed: true,
    };

    // Username change (if provided and different)
    if (body.username) {
      const username = body.username.trim().toLowerCase();
      if (/^[a-z0-9_-]{3,20}$/.test(username)) {
        // Verify still available
        const { data: existing } = await supabase
          .from("profiles")
          .select("id")
          .eq("username", username)
          .neq("id", user.id)
          .maybeSingle();

        if (!existing) {
          profileUpdate.username = username;
        }
      }
    }

    // Main uses
    if (Array.isArray(body.main_uses)) {
      profileUpdate.main_uses = body.main_uses;
    }

    // Daily check-in preferences
    if (typeof body.daily_checkin_enabled === "boolean") {
      profileUpdate.daily_checkin_enabled = body.daily_checkin_enabled;
    }
    if (body.daily_checkin_time) {
      profileUpdate.daily_checkin_time = body.daily_checkin_time;
    }

    // Interview status
    if (body.interview_method) {
      const validMethods = ["phone_call", "email_questionnaire", "quick_basics", "skipped"];
      if (validMethods.includes(body.interview_method)) {
        profileUpdate.onboarding_interview_status = body.interview_method;
      }
    }

    const { error: profileError } = await supabase
      .from("profiles")
      .update(profileUpdate)
      .eq("id", user.id);

    if (profileError) {
      console.error("Onboarding profile update error:", profileError);
      return NextResponse.json(
        { error: "internal_error", message: "An unexpected error occurred" },
        { status: 500 }
      );
    }

    // Upsert user settings (confirmation mode, verification method, agent card)
    if (body.confirmation_mode || body.verification_method || body.agent_card_enabled !== undefined) {
      const settingsData: Record<string, unknown> = {
        user_id: user.id,
        updated_at: new Date().toISOString(),
      };

      const validModes = ["always", "unclear", "risky", "never"];
      if (body.confirmation_mode && validModes.includes(body.confirmation_mode)) {
        settingsData.confirmation_mode = body.confirmation_mode;
      }

      const validVerification = ["forward", "virtual_number"];
      if (body.verification_method && validVerification.includes(body.verification_method)) {
        settingsData.verification_method = body.verification_method;
      }

      if (typeof body.agent_card_enabled === "boolean") {
        settingsData.agent_card_enabled = body.agent_card_enabled;
      }

      await supabase
        .from("user_settings")
        .upsert(settingsData, { onConflict: "user_id" });
    }

    // Create agent card if requested
    if (body.agent_card_enabled) {
      const { data: existingCard } = await supabase
        .from("agent_cards")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!existingCard) {
        await supabase.from("agent_cards").insert({
          user_id: user.id,
          balance_cents: 0,
          is_frozen: false,
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}
