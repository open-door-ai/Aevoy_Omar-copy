import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    // In Beta: mock payment — mark as verified immediately
    // Production: verify Stripe payment_intent_id from request body
    const body = await request.json().catch(() => ({}));
    const { bio, website, github_url } = body;

    const safeWebsite = website && (website.startsWith("https://") || website.startsWith("http://")) ? website : null;
    const safeGithub = github_url && github_url.startsWith("https://github.com/") ? github_url : null;

    const { error } = await supabase.from("developer_profiles").upsert({
      user_id: user.id,
      verified: true,
      verification_paid_at: new Date().toISOString(),
      verification_payment_id: `beta-mock-${Date.now()}`,
      bio: bio?.slice(0, 500) || null,
      website: safeWebsite,
      github_url: safeGithub,
    }, { onConflict: "user_id" });

    if (error) throw error;
    return NextResponse.json({ success: true, message: "Developer account verified" });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
