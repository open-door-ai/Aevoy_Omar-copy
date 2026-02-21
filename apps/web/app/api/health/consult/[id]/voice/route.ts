import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

// Dr. Nova's dedicated voice — "Daniel" (ElevenLabs Deep British Male, authoritative but warm)
// Fallback chain: user env → Daniel → Rachel
const DOCTOR_VOICE_ID =
  process.env.ELEVENLABS_DOCTOR_VOICE_ID ||
  process.env.ELEVENLABS_DEFAULT_VOICE_ID ||
  "onwK4e9ZLuTAKqWW03F9"; // Daniel — British male, warm + authoritative

// ElevenLabs model: turbo_v2_5 is faster + higher quality than turbo_v2
const TTS_MODEL = "eleven_turbo_v2_5";

interface VoiceBody {
  text: string;
  voiceId?: string;
}

/**
 * POST /api/health/consult/[id]/voice
 *
 * Generates ElevenLabs TTS audio for the AI doctor's response.
 * Uses tuned voice settings to sound natural and human — not robotic.
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

    const voiceId = body.voiceId || DOCTOR_VOICE_ID;

    // Sanitize text — strip HTML/markdown, normalize spacing for cleaner TTS
    const cleanText = body.text
      .replace(/<[^>]*>/g, "")                    // strip HTML tags
      .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")   // strip bold/italic markdown
      .replace(/_{1,2}([^_]+)_{1,2}/g, "$1")      // strip underline markdown
      .replace(/#{1,6}\s+/g, "")                   // strip headers
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")    // links → just text
      .replace(/—/g, ",")                          // em dashes → pause
      .replace(/\s+/g, " ")                        // normalize whitespace
      .trim()
      .slice(0, 3000); // keep it concise for voice

    // ElevenLabs voice settings tuned for natural, human-sounding doctor speech:
    // - stability 0.35: enough variation to sound alive, not monotone
    // - similarity_boost 0.75: preserve voice character without artifacting
    // - style 0.4: adds natural expressiveness (turbo_v2_5 feature)
    // - use_speaker_boost: improves clarity on medical terminology
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
          model_id: TTS_MODEL,
          voice_settings: {
            stability: 0.35,
            similarity_boost: 0.75,
            style: 0.4,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!ttsRes.ok) {
      const errText = await ttsRes.text().catch(() => "");
      console.error(`[CONSULT VOICE] ElevenLabs error: HTTP ${ttsRes.status} — ${errText}`);
      return NextResponse.json(
        { error: "TTS generation failed" },
        { status: 502 }
      );
    }

    // Return audio stream to client
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
