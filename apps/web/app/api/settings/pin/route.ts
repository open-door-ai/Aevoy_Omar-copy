import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import crypto from "crypto";

function hashVoicePin(pin: string, userId: string): string {
  return crypto.createHash('sha256').update(`${userId}:${pin}`).digest('hex');
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const newPin = body.pin?.toString();

    if (!newPin || !/^\d{4,6}$/.test(newPin)) {
      return NextResponse.json(
        { error: "PIN must be 4-6 digits" },
        { status: 400 }
      );
    }

    // Hash PIN before storing (SHA-256 with userId salt)
    const hashedPin = hashVoicePin(newPin, user.id);

    // Update PIN and reset lockout
    const { error } = await supabase
      .from("profiles")
      .update({
        voice_pin: hashedPin,
        voice_pin_attempts: 0,
        voice_pin_locked_until: null
      })
      .eq("id", user.id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[SETTINGS] PIN update error:", error);
    return NextResponse.json(
      { error: "Failed to update PIN" },
      { status: 500 }
    );
  }
}
