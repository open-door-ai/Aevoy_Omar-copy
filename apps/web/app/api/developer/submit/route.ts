import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const MAX_SUBMISSIONS_PER_DAY = 3;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    // Must be verified developer
    const { data: devProfile } = await supabase.from("developer_profiles").select("verified").eq("user_id", user.id).single();
    if (!devProfile?.verified) return NextResponse.json({ error: "forbidden", message: "Developer verification required" }, { status: 403 });

    // Rate limit: 3 submissions per 24h
    const dayAgo = new Date(Date.now() - 86400000).toISOString();
    const { count: recentCount } = await supabase.from("app_submissions")
      .select("*", { count: "exact", head: true })
      .eq("developer_id", user.id)
      .gte("submitted_at", dayAgo);
    if ((recentCount || 0) >= MAX_SUBMISSIONS_PER_DAY) {
      return NextResponse.json({ error: "rate_limited", message: "Maximum 3 submissions per 24 hours" }, { status: 429 });
    }

    const body = await request.json();
    const { appId, version, manifest } = body;

    if (!appId || !version || !manifest) {
      return NextResponse.json({ error: "bad_request", message: "appId, version, manifest required" }, { status: 400 });
    }

    // Verify app belongs to this developer
    const { data: app } = await supabase.from("marketplace_apps").select("id, status").eq("id", appId).eq("developer_id", user.id).single();
    if (!app) return NextResponse.json({ error: "not_found", message: "App not found" }, { status: 404 });

    // Beta: mock bundle path (in production, get from actual upload)
    const bundlePath = `submissions/${user.id}/${appId}/${version}/bundle.zip`;

    // Estimate review cost (Beta: mocked)
    const estimatedCost = 5.00; // $5 flat in Beta
    const billedCost = estimatedCost;

    const { data: submission, error: subError } = await supabase.from("app_submissions").insert({
      app_id: appId,
      developer_id: user.id,
      version,
      code_bundle_storage_path: bundlePath,
      manifest,
      review_status: "queued",
      review_cost_usd: estimatedCost,
      billed_cost_usd: billedCost,
      payment_status: "waived", // Beta: waive payment
    }).select("id").single();

    if (subError) throw subError;

    // Update app status to pending_review
    await supabase.from("marketplace_apps").update({ status: "pending_review", updated_at: new Date().toISOString() }).eq("id", appId);

    return NextResponse.json({ success: true, submissionId: submission.id, estimatedCost });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
