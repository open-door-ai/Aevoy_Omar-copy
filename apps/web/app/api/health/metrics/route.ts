import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/health/metrics?type=heart_rate&days=7
 *
 * Returns health metrics for the authenticated user, suitable for chart rendering.
 * Optionally filtered by metric_type and time range (last N days).
 * Results are ordered by recorded_at ASC for chronological chart display.
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const metricType = url.searchParams.get("type") || null;
    const days = Math.min(
      90,
      Math.max(1, parseInt(url.searchParams.get("days") || "7", 10) || 7)
    );

    // Calculate the cutoff date
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceIso = since.toISOString();

    let query = supabase
      .from("health_metrics")
      .select("id, metric_type, value, unit, recorded_at, source")
      .eq("user_id", user.id)
      .gte("recorded_at", sinceIso)
      .order("recorded_at", { ascending: true });

    if (metricType) {
      query = query.eq("metric_type", metricType);
    }

    const { data: metrics, error: queryError } = await query;

    if (queryError) {
      console.error("[HEALTH METRICS] Query error:", queryError);
      return NextResponse.json(
        { error: "Failed to fetch metrics" },
        { status: 500 }
      );
    }

    return NextResponse.json({ metrics: metrics || [] });
  } catch (err) {
    console.error("[HEALTH METRICS] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
