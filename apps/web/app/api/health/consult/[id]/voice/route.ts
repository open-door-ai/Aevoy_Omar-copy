import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const DEFAULT_VOICE_ID =
  process.env.ELEVENLABS_DEFAULT_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";

interface VoiceBody {
  text: string;
  voiceId?: string;
}

/**
 * POST /api/health/consult/[id]/voice
 *
 * Generates AI doctor TTS audio for a health consultation session.
 * Uses ElevenLabs Turbo v2 and streams audio/mpeg back to the client.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Verify the consultation belongs to this user
    const { data: consult, error: consultError } = await supabase
      .from("health_consultations")
      .select("id, status")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (consultError || !consult) {
      return NextResponse.json(
        { error: "Consultation not found" },
        { status: 404 }
      );
    }

    let body: VoiceBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (!body.text || typeof body.text !== "string" || !body.text.trim()) {
      return NextResponse.json(
        { error: "text is required" },
        { status: 400 }
      );
    }

    if (!ELEVENLABS_API_KEY) {
      return NextResponse.json(
        { error: "TTS service not configured" },
        { status: 503 }
      );
    }

    const voiceId = body.voiceId || DEFAULT_VOICE_ID;

    // Sanitize text — strip any HTML/markdown for cleaner TTS output
    const cleanText = body.text
      .replace(/<[^>]*>/g, "")
      .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
      .replace(/_{1,2}([^_]+)_{1,2}/g, "$1")
      .trim()
      .slice(0, 5000); // ElevenLabs max character limit

    // Call ElevenLabs TTS REST API
    const ttsRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": ELEVENLABS_API_KEY,
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: cleanText,
          model_id: "eleven_turbo_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.8,
            speed: 0.9,
          },
        }),
      }
    );

    if (!ttsRes.ok) {
      console.error(`[CONSULT VOICE] ElevenLabs error: HTTP ${ttsRes.status}`);
      return NextResponse.json(
        { error: "TTS generation failed" },
        { status: 502 }
      );
    }

    // Stream audio back to client
    const audioBuffer = await ttsRes.arrayBuffer();

    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audioBuffer.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[CONSULT VOICE] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
