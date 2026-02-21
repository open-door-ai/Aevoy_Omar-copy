import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const { data } = await supabase.from("developer_profiles").select("*").eq("user_id", user.id).single();
    return NextResponse.json({ profile: data || null });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = await request.json();
    const { bio, website, github_url } = body;

    // Sanitize URLs
    const safeWebsite = website && (website.startsWith("https://") || website.startsWith("http://")) ? website : null;
    const safeGithub = github_url && github_url.startsWith("https://github.com/") ? github_url : null;

    const { error } = await supabase.from("developer_profiles").upsert(
      { user_id: user.id, bio: bio?.slice(0, 500) || null, website: safeWebsite, github_url: safeGithub },
      { onConflict: "user_id" }
    );

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
