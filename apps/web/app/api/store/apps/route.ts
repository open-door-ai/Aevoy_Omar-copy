import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category");
    const search = searchParams.get("q");
    const sort = searchParams.get("sort") || "newest"; // newest | top_rated | most_installed
    const limit = Math.min(parseInt(searchParams.get("limit") || "24"), 50);
    const offset = parseInt(searchParams.get("offset") || "0");

    let query = supabase
      .from("marketplace_apps")
      .select(`
        id, name, slug, description, icon_url, category_id, tags,
        price_type, price_cents, install_count, rating_avg, rating_count,
        is_featured, is_builtin, version, created_at,
        developer:developer_id(id)
      `)
      .eq("status", "approved");

    if (category) query = query.eq("category_id", category);
    if (search) query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);

    if (sort === "top_rated") query = query.order("rating_avg", { ascending: false });
    else if (sort === "most_installed") query = query.order("install_count", { ascending: false });
    else query = query.order("created_at", { ascending: false });

    const { data: apps, error, count } = await query.range(offset, offset + limit - 1);
    if (error) throw error;

    return NextResponse.json({ apps: apps || [], total: count });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
