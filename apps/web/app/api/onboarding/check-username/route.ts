import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// Service-role client bypasses RLS — needed to check usernames across ALL users
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
    const username = body.username?.trim().toLowerCase();

    if (!username) {
      return NextResponse.json(
        { error: "Username is required" },
        { status: 400 }
      );
    }

    // Validate format: alphanumeric, hyphens, underscores, 3-20 chars
    if (!/^[a-z0-9_-]{3,20}$/.test(username)) {
      return NextResponse.json(
        {
          available: false,
          reason:
            "Username must be 3-20 characters, letters, numbers, hyphens, or underscores only",
        },
        { status: 200 }
      );
    }

    // Reserved words
    const reserved = [
      "admin",
      "support",
      "help",
      "info",
      "noreply",
      "no-reply",
      "postmaster",
      "abuse",
      "security",
      "root",
      "system",
      "aevoy",
      "team",
      "billing",
      "sales",
    ];
    if (reserved.includes(username)) {
      return NextResponse.json(
        { available: false, reason: "This username is reserved" },
        { status: 200 }
      );
    }

    // Check if taken by another user — use admin client to bypass RLS
    // RLS blocks cross-user queries, so user's client can't see other profiles
    const { data: existing } = await admin
      .from("profiles")
      .select("id")
      .ilike("username", username)
      .neq("id", user.id)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { available: false, reason: `${username}@aevoy.com is already taken` },
        { status: 200 }
      );
    }

    return NextResponse.json({ available: true }, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}
