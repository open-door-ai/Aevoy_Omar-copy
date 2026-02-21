import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/health/consult/[id]
 * Fetch a single consultation by ID.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const { data, error } = await supabase
      .from("health_consultations")
      .select("id, status, scheduled_at, started_at, ended_at, ai_notes, transcript, created_at")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Consultation not found" }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("[CONSULT GET] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/health/consult/[id]
 * Update consultation status (e.g. mark completed/cancelled) and optional notes.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Verify ownership
    const { data: consult, error: consultError } = await supabase
      .from("health_consultations")
      .select("id, status")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (consultError || !consult) {
      return NextResponse.json({ error: "Consultation not found" }, { status: 404 });
    }

    let body: { status?: string; ended_at?: string; ai_notes?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const allowed = ["completed", "cancelled", "active", "scheduled"];
    const updates: Record<string, unknown> = {};

    if (body.status && allowed.includes(body.status)) {
      updates.status = body.status;
    }

    if (body.ended_at) {
      updates.ended_at = body.ended_at;
    }

    if (body.ai_notes && typeof body.ai_notes === "string") {
      updates.ai_notes = body.ai_notes.slice(0, 5000);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const { data: updated, error: updateError } = await supabase
      .from("health_consultations")
      .update(updates)
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id, status, ended_at, ai_notes")
      .single();

    if (updateError) {
      console.error("[CONSULT PATCH] Update error:", updateError);
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error("[CONSULT PATCH] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
