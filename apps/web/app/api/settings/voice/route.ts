import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const ALLOWED_VOICES = [
  'Google.en-US-Neural2-H',
  'Google.en-US-Neural2-D',
  'Google.en-US-Neural2-F',
  'Google.en-US-Neural2-A',
  'Google.en-US-Neural2-C',
  'Google.en-US-Neural2-J',
  'Polly.Matthew-Neural',
  'Polly.Joanna-Neural',
  'Polly.Stephen-Neural',
  'Polly.Amy-Neural',
];

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await supabase
    .from("user_settings")
    .select("voice_preference")
    .eq("user_id", user.id)
    .single();

  return NextResponse.json({
    voice: data?.voice_preference || "Google.en-US-Neural2-H",
    available: ALLOWED_VOICES,
  });
}

export async function PUT(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { voice } = await req.json();

  if (!voice || !ALLOWED_VOICES.includes(voice)) {
    return NextResponse.json({ error: "Invalid voice selection" }, { status: 400 });
  }

  const { error } = await supabase
    .from("user_settings")
    .update({ voice_preference: voice })
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }

  return NextResponse.json({ success: true, voice });
}
