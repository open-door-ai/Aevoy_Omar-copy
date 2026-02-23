import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function PUT(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const phoneNumber = body.phone_number?.trim();

    if (!phoneNumber) {
      return NextResponse.json({ error: "Phone number is required" }, { status: 400 });
    }

    // Basic E.164 validation
    if (!/^\+\d{10,15}$/.test(phoneNumber)) {
      return NextResponse.json({ error: "Invalid phone number format" }, { status: 400 });
    }

    const { error } = await supabase
      .from("profiles")
      .update({ phone_number: phoneNumber })
      .eq("id", user.id);

    if (error) {
      console.error("[PROFILE] Phone update error:", error);
      return NextResponse.json({ error: "Failed to save phone number" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
