import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface ShortcutMetric {
  type: string;
  value: number;
  unit: string;
  recorded_at: string;
}

interface ShortcutsBody {
  metrics: ShortcutMetric[];
}

/**
 * POST /api/health/shortcuts?token={health_webhook_token}
 *
 * Apple Shortcuts webhook — receives daily health data from the user's iPhone.
 * Authentication is via the health_webhook_token query parameter (token = auth).
 * No session cookie needed.
 */
export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get("token");

    if (!token) {
      return NextResponse.json(
        { error: "Missing webhook token" },
        { status: 401 }
      );
    }

    // Use service-role client so we can query profiles without a user session
    // createClient() will use the anon key by default — we need service role to
    // find any user's profile by token. We use the supabase server client here
    // with a filter; RLS is bypassed only if SUPABASE_SERVICE_ROLE_KEY is set
    // as the auth secret. For safety we still validate the token precisely.
    const supabase = await createClient();

    // Find the user whose health_webhook_token matches the provided token
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("health_webhook_token", token)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { error: "Invalid or unknown webhook token" },
        { status: 401 }
      );
    }

    const userId = profile.id;

    // Parse and validate request body
    let body: ShortcutsBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    if (!body.metrics || !Array.isArray(body.metrics) || body.metrics.length === 0) {
      return NextResponse.json(
        { error: "Body must contain a non-empty metrics array" },
        { status: 400 }
      );
    }

    // Validate each metric
    const validatedMetrics = body.metrics
      .filter(
        (m) =>
          typeof m.type === "string" &&
          m.type.trim().length > 0 &&
          typeof m.value === "number" &&
          isFinite(m.value) &&
          typeof m.unit === "string"
      )
      .map((m) => ({
        user_id: userId,
        source: "apple_shortcuts",
        metric_type: m.type.trim().toLowerCase().replace(/\s+/g, "_"),
        value: m.value,
        unit: m.unit.trim(),
        recorded_at: m.recorded_at
          ? new Date(m.recorded_at).toISOString()
          : new Date().toISOString(),
        raw_data: m,
      }));

    if (validatedMetrics.length === 0) {
      return NextResponse.json(
        { error: "No valid metrics found in request" },
        { status: 400 }
      );
    }

    // Bulk insert into health_metrics
    const { error: insertError } = await supabase
      .from("health_metrics")
      .insert(validatedMetrics);

    if (insertError) {
      console.error("[SHORTCUTS] Insert error:", insertError);
      return NextResponse.json(
        { error: "Failed to store metrics" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      count: validatedMetrics.length,
    });
  } catch (err) {
    console.error("[SHORTCUTS] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
