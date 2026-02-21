import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const { data: apps } = await supabase
      .from("marketplace_apps")
      .select("id, name, slug, status, price_type, price_cents, install_count, rating_avg, created_at, updated_at")
      .eq("developer_id", user.id)
      .order("created_at", { ascending: false });

    return NextResponse.json({ apps: apps || [] });
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

    // Must be a verified developer
    const { data: devProfile } = await supabase.from("developer_profiles").select("verified").eq("user_id", user.id).single();
    if (!devProfile?.verified) return NextResponse.json({ error: "forbidden", message: "Developer verification required" }, { status: 403 });

    const body = await request.json();
    const { name, description, category_id, tags, price_type, price_cents } = body;

    if (!name || !description) return NextResponse.json({ error: "bad_request", message: "name and description required" }, { status: 400 });

    const baseSlug = slugify(name);
    let slug = baseSlug;
    // Ensure unique slug
    const { count } = await supabase.from("marketplace_apps").select("*", { count: "exact", head: true }).like("slug", `${baseSlug}%`);
    if (count && count > 0) slug = `${baseSlug}-${count}`;

    const { data: app, error } = await supabase.from("marketplace_apps").insert({
      developer_id: user.id,
      name: name.slice(0, 100),
      slug,
      description: description.slice(0, 500),
      category_id: category_id || null,
      tags: Array.isArray(tags) ? tags.slice(0, 10).map((t: string) => t.slice(0, 30)) : [],
      price_type: ["free", "one_time", "monthly"].includes(price_type) ? price_type : "free",
      price_cents: typeof price_cents === "number" ? Math.max(0, Math.round(price_cents)) : 0,
      status: "draft",
    }).select("id, slug").single();

    if (error) throw error;
    return NextResponse.json({ success: true, app });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
