import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface ConsultBody {
  scheduled_at?: string;
  acknowledged_disclaimer: boolean;
}

/**
 * POST /api/health/consult
 *
 * Start or schedule a new health consultation session.
 * The user MUST acknowledge the medical disclaimer before a session is created.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: ConsultBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (!body.acknowledged_disclaimer) {
      return NextResponse.json(
        {
          error:
            "Medical disclaimer must be acknowledged before starting a consultation",
        },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const scheduledAt = body.scheduled_at
      ? new Date(body.scheduled_at).toISOString()
      : null;
    const status = scheduledAt ? "scheduled" : "active";

    // Create the consultation row
    const { data: consult, error: insertError } = await supabase
      .from("health_consultations")
      .insert({
        user_id: user.id,
        status,
        scheduled_at: scheduledAt,
        started_at: status === "active" ? now : null,
        disclaimer_acknowledged_at: now,
      })
      .select("id, status, scheduled_at, started_at, created_at")
      .single();

    if (insertError || !consult) {
      console.error("[CONSULT] Insert error:", insertError);
      return NextResponse.json(
        { error: "Failed to create consultation" },
        { status: 500 }
      );
    }

    // Mark the disclaimer as acknowledged in user_settings (best-effort)
    await supabase
      .from("user_settings")
      .update({ health_disclaimer_acknowledged: true })
      .eq("user_id", user.id);

    return NextResponse.json({
      id: consult.id,
      status: consult.status,
      scheduled_at: consult.scheduled_at,
    });
  } catch (err) {
    console.error("[CONSULT] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/health/consult
 *
 * Returns the 10 most recent health consultations for the authenticated user.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: consultations, error: queryError } = await supabase
      .from("health_consultations")
      .select(
        "id, status, scheduled_at, started_at, ended_at, ai_notes, created_at"
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(10);

    if (queryError) {
      console.error("[CONSULT] Query error:", queryError);
      return NextResponse.json(
        { error: "Failed to fetch consultations" },
        { status: 500 }
      );
    }

    return NextResponse.json({ consultations: consultations || [] });
  } catch (err) {
    console.error("[CONSULT] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
