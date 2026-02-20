import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/health/insights?limit=5
 *
 * Returns the latest AI-generated health insights for the authenticated user.
 * Results are ordered by generated_at DESC.
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
    const limit = Math.min(
      50,
      Math.max(1, parseInt(url.searchParams.get("limit") || "5", 10) || 5)
    );

    const { data: insights, error: queryError } = await supabase
      .from("health_insights")
      .select(
        "id, insight_text, anomalies, severity, data_summary, generated_at, notified"
      )
      .eq("user_id", user.id)
      .order("generated_at", { ascending: false })
      .limit(limit);

    if (queryError) {
      console.error("[HEALTH INSIGHTS] Query error:", queryError);
      return NextResponse.json(
        { error: "Failed to fetch insights" },
        { status: 500 }
      );
    }

    return NextResponse.json({ insights: insights || [] });
  } catch (err) {
    console.error("[HEALTH INSIGHTS] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
