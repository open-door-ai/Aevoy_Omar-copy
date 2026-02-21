import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/inbox/settings - Get user's inbox management settings
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: settings } = await supabase
      .from("inbox_settings")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (!settings) {
      // Return default settings
      return NextResponse.json({
        autonomy_level: 0,
        enabled: false,
        check_interval_minutes: 30,
        monitor_inbox: false,
        delete_spam: false,
        respond_to_simple: false,
        schedule_meetings: false,
        call_for_complex: false,
        ai_signature_enabled: true,
        ai_signature_text: "Sent by your AI assistant",
        user_rules: [],
        notify_daily_digest: true,
        notify_urgent_immediately: true,
        quiet_hours_start: "22:00",
        quiet_hours_end: "07:00",
        max_emails_per_day: 50,
      });
    }

    return NextResponse.json(settings);
  } catch (error) {
    console.error("[INBOX_SETTINGS] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PUT /api/inbox/settings - Update inbox management settings
 */
export async function PUT(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    
    // Validate autonomy level
    if (body.autonomyLevel !== undefined && (body.autonomyLevel < 0 || body.autonomyLevel > 100)) {
      return NextResponse.json({ error: "Invalid autonomy level" }, { status: 400 });
    }

    // Derive settings from autonomy level if provided
    const autonomyLevel = body.autonomyLevel ?? 0;
    const derivedSettings = {
      monitorInbox: autonomyLevel >= 0,
      deleteSpam: autonomyLevel >= 25,
      respondToSimple: autonomyLevel >= 50,
      scheduleMeetings: autonomyLevel >= 50,
      callForComplex: autonomyLevel >= 75,
    };

    // Validate check interval
    const validIntervals = [15, 30, 60, 120];
    const checkIntervalMinutes = validIntervals.includes(body.checkIntervalMinutes)
      ? body.checkIntervalMinutes
      : 30;

    const updateData = {
      user_id: user.id,
      autonomy_level: autonomyLevel,
      enabled: body.enabled ?? false,
      check_interval_minutes: checkIntervalMinutes,
      ...derivedSettings,
      ai_signature_enabled: body.aiSignatureEnabled ?? true,
      ai_signature_text: body.aiSignatureText ?? "Sent by your AI assistant",
      user_rules: body.userRules ?? [],
      notify_daily_digest: body.notifyDailyDigest ?? true,
      notify_urgent_immediately: body.notifyUrgentImmediately ?? true,
      quiet_hours_start: body.quietHoursStart ?? "22:00",
      quiet_hours_end: body.quietHoursEnd ?? "07:00",
      max_emails_per_day: body.maxEmailsPerDay ?? 50,
    };

    // Upsert settings
    const { data: settings, error } = await supabase
      .from("inbox_settings")
      .upsert(updateData, { onConflict: "user_id" })
      .select()
      .single();

    if (error) {
      console.error("[INBOX_SETTINGS] Upsert error:", error);
      return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
    }

    return NextResponse.json(settings);
  } catch (error) {
    console.error("[INBOX_SETTINGS] PUT error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/inbox/settings - Disable inbox management
 */
export async function DELETE() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await supabase
      .from("inbox_settings")
      .update({ enabled: false })
      .eq("user_id", user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[INBOX_SETTINGS] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
