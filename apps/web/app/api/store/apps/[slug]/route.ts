import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const supabase = await createClient();
    const { slug } = await params;

    const { data: app, error } = await supabase
      .from("marketplace_apps")
      .select(`
        id, name, slug, description, long_description, icon_url, screenshots,
        category_id, tags, version, price_type, price_cents, install_count,
        rating_avg, rating_count, is_featured, is_builtin, widget_manifest,
        created_at, updated_at,
        developer:developer_id(id, bio, website, github_url)
      `)
      .eq("slug", slug)
      .eq("status", "approved")
      .single();

    if (error || !app) return NextResponse.json({ error: "not_found" }, { status: 404 });

    // Get reviews
    const { data: reviews } = await supabase
      .from("marketplace_reviews")
      .select("id, rating, comment, created_at, user_id")
      .eq("app_id", app.id)
      .order("created_at", { ascending: false })
      .limit(10);

    // Check if current user has installed
    const { data: { user } } = await supabase.auth.getUser();
    let isInstalled = false;
    let userReview = null;
    if (user) {
      const { data: install } = await supabase.from("marketplace_installs").select("id").eq("user_id", user.id).eq("app_id", app.id).single();
      isInstalled = !!install;
      const { data: rev } = await supabase.from("marketplace_reviews").select("rating, comment").eq("user_id", user.id).eq("app_id", app.id).single();
      userReview = rev;
    }

    return NextResponse.json({ app, reviews: reviews || [], isInstalled, userReview });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
