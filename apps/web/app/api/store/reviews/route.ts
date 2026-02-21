import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = await request.json();
    const { appId, rating, comment } = body;

    if (!appId || !rating || typeof rating !== "number" || rating < 1 || rating > 5) {
      return NextResponse.json({ error: "bad_request", message: "appId and rating (1-5) required" }, { status: 400 });
    }

    // Must have installed the app
    const { data: install } = await supabase.from("marketplace_installs").select("id").eq("user_id", user.id).eq("app_id", appId).single();
    if (!install) return NextResponse.json({ error: "forbidden", message: "You must install the app before reviewing it" }, { status: 403 });

    const { error } = await supabase.from("marketplace_reviews").upsert(
      { user_id: user.id, app_id: appId, rating, comment: comment || null },
      { onConflict: "user_id,app_id" }
    );

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
