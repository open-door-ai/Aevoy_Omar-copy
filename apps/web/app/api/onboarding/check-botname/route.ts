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

      // Check BOTH username (email prefix) AND bot_name (display name)
      // Username is what creates the @aevoy.com email address
      const { data: byUsername } = await admin
        .from("profiles")
        .select("id")
        .ilike("username", name)
        .neq("id", user.id)
        .maybeSingle();

      if (byUsername) {
        return NextResponse.json({ available: false, reason: `${name}@aevoy.com is already taken` });
      }

      const { data: byBotName } = await admin
        .from("profiles")
        .select("id")
        .ilike("bot_name", name)
        .neq("id", user.id)
        .maybeSingle();

      if (byBotName) {
        return NextResponse.json({ available: false, reason: `"${name}" is already used as an agent name` });
      }

      return NextResponse.json({ available: true });
    }

    // Batch check for quick picks — check both username and bot_name
    if (body.names && Array.isArray(body.names)) {
      const names: string[] = body.names.slice(0, 50);

      const { data: takenByUsername } = await admin
        .from("profiles")
        .select("username")
        .neq("id", user.id)
        .in("username", names.map(n => n.toLowerCase()));

      const { data: takenByBotName } = await admin
        .from("profiles")
        .select("bot_name")
        .neq("id", user.id)
        .in("bot_name", names);

      const takenSet = new Set([
        ...(takenByUsername || []).map((r: { username?: string }) => r.username?.toLowerCase()),
        ...(takenByBotName || []).map((r: { bot_name?: string }) => r.bot_name?.toLowerCase()),
      ]);

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
