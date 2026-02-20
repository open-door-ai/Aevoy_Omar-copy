import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import bcrypt from "bcryptjs";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("unified_pin_hash")
    .eq("id", user.id)
    .single();

  return NextResponse.json({ hasPin: !!profile?.unified_pin_hash });
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json() as { pin?: string };
  const pin = String(body?.pin || "").trim();

  if (!/^\d{4,6}$/.test(pin)) {
    return NextResponse.json({ error: "PIN must be 4-6 digits" }, { status: 400 });
  }

  const hash = await bcrypt.hash(pin, 12);

  const { error } = await supabase
    .from("profiles")
    .update({ unified_pin_hash: hash })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: "Failed to save PIN" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await supabase
    .from("profiles")
    .update({ unified_pin_hash: null })
    .eq("id", user.id);

  return NextResponse.json({ success: true });
}
