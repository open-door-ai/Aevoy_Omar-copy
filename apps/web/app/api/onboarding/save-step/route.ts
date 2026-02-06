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
    const { step, data } = await request.json();

    if (!step || !data) {
      return NextResponse.json(
        { error: "Step and data are required" },
        { status: 400 }
      );
    }

    // Save data based on step number
    switch (step) {
      case 4: // Use cases
        if (data.main_uses && Array.isArray(data.main_uses)) {
          const { error } = await supabase
            .from("profiles")
            .update({ main_uses: data.main_uses })
            .eq("id", user.id);

          if (error) throw error;
        }
        break;

      case 5: // AI Behavior sliders
        {
          // Save to both profiles and user_settings
          const updates: Record<string, any> = {};

          if (data.risk_tolerance !== undefined) {
            updates.risk_tolerance = data.risk_tolerance;
          }

          if (Object.keys(updates).length > 0) {
            const { error: profileError } = await supabase
              .from("profiles")
              .update(updates)
              .eq("id", user.id);

            if (profileError) throw profileError;
          }

          // Map autonomy to confirmation_mode
          let confirmation_mode = "unclear";
          if (data.autonomy_level !== undefined) {
            if (data.autonomy_level <= 30) confirmation_mode = "always";
            else if (data.autonomy_level <= 60) confirmation_mode = "unclear";
            else if (data.autonomy_level <= 85) confirmation_mode = "risky";
            else confirmation_mode = "never";
          }

          const settingsData: Record<string, any> = {
            user_id: user.id,
            updated_at: new Date().toISOString(),
          };

          if (data.autonomy_level !== undefined) {
            settingsData.confirmation_mode = confirmation_mode;
          }

          if (data.proactive_daily_limit !== undefined) {
            settingsData.proactive_daily_limit = data.proactive_daily_limit;
          }

          const { error: settingsError } = await supabase
            .from("user_settings")
            .upsert(settingsData, { onConflict: "user_id" });

          if (settingsError) throw settingsError;
        }
        break;

      case 6: // Timezone & schedule
        {
          const profileUpdates: Record<string, any> = {};

          if (data.timezone) {
            profileUpdates.timezone = data.timezone;
          }

          if (data.daily_checkin_enabled !== undefined) {
            profileUpdates.daily_checkin_enabled = data.daily_checkin_enabled;
          }

          if (data.daily_checkin_time) {
            profileUpdates.daily_checkin_time = data.daily_checkin_time;
          }

          if (Object.keys(profileUpdates).length > 0) {
            const { error } = await supabase
              .from("profiles")
              .update(profileUpdates)
              .eq("id", user.id);

            if (error) throw error;
          }
        }
        break;

      case 7: // Verification setup
        if (data.verification_method) {
          const { error } = await supabase
            .from("user_settings")
            .upsert(
              {
                user_id: user.id,
                verification_method: data.verification_method,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "user_id" }
            );

          if (error) throw error;
        }
        break;

      case 8: // Legal & guardrails
        {
          const profileUpdates: Record<string, any> = {
            legal_accepted_at: new Date().toISOString(),
          };

          if (data.allow_agent_venting !== undefined) {
            profileUpdates.allow_agent_venting = data.allow_agent_venting;
          }

          const { error } = await supabase
            .from("profiles")
            .update(profileUpdates)
            .eq("id", user.id);

          if (error) throw error;
        }
        break;

      default:
        return NextResponse.json(
          { error: "Invalid step number" },
          { status: 400 }
        );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Save step error:", error);
    return NextResponse.json(
      {
        error: "Failed to save step data",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
