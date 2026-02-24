import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// Service-role client bypasses RLS — needed to check bot names across ALL users
function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getAdminClient();

  try {
    const body = await request.json();

    // Single name check
    if (body.name) {
      const name = body.name.trim();
      if (!name) {
        return NextResponse.json({ available: false, reason: "Name is required" });
      }

      // Use admin client to see ALL profiles (RLS blocks cross-user queries with anon key)
      const { data: existing } = await admin
        .from("profiles")
        .select("id")
        .ilike("bot_name", name)
        .neq("id", user.id)
        .maybeSingle();

      return NextResponse.json({ available: !existing });
    }

    // Batch check for quick picks
    if (body.names && Array.isArray(body.names)) {
      const names: string[] = body.names.slice(0, 50);
      const { data: taken } = await admin
        .from("profiles")
        .select("bot_name")
        .neq("id", user.id)
        .in("bot_name", names);

      const takenSet = new Set((taken || []).map((r: { bot_name?: string }) => r.bot_name?.toLowerCase()));
      const results: Record<string, boolean> = {};
      for (const n of names) {
        results[n] = !takenSet.has(n.toLowerCase());
      }
      return NextResponse.json({ results });
    }

    return NextResponse.json({ error: "Provide 'name' or 'names'" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
