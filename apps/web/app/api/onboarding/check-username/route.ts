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

    // Check if taken by another user
    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", username)
      .neq("id", user.id)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { available: false, reason: "This username is already taken" },
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
