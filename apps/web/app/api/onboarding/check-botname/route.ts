import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    // Single name check
    if (body.name) {
      const name = body.name.trim();
      if (!name) {
        return NextResponse.json({ available: false, reason: "Name is required" });
      }

      const { data: existing } = await supabase
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
      const { data: taken } = await supabase
        .from("profiles")
        .select("bot_name")
        .neq("id", user.id)
        .in("bot_name", names);

      const takenSet = new Set((taken || []).map((r) => r.bot_name?.toLowerCase()));
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
