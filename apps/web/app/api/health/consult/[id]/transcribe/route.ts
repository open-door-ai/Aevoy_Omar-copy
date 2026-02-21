import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const GROQ_API_KEY = process.env.GROQ_API_KEY;

/**
 * POST /api/health/consult/[id]/transcribe
 *
 * Transcribes audio using Groq Whisper (whisper-large-v3-turbo).
 * Receives multipart/form-data with an "audio" file field.
 * Returns { text: "..." }
 *
 * Works cross-browser (MediaRecorder produces webm/mp4 — both accepted by Whisper).
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

    // Verify consultation ownership
    const { data: consult, error: consultError } = await supabase
      .from("health_consultations")
      .select("id, status")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (consultError || !consult) {
      return NextResponse.json({ error: "Consultation not found" }, { status: 404 });
    }

    if (!GROQ_API_KEY) {
      return NextResponse.json({ error: "Transcription not configured" }, { status: 503 });
    }

    // Read the multipart body
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File | null;

    if (!audioFile) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
    }

    // Groq Whisper accepts: flac, mp3, mp4, mpeg, mpga, m4a, ogg, opus, wav, webm
    const audioBuffer = await audioFile.arrayBuffer();
    const fileName = audioFile.name || "audio.webm";

    // Forward to Groq Whisper
    const groqForm = new FormData();
    groqForm.append("file", new Blob([audioBuffer], { type: audioFile.type || "audio/webm" }), fileName);
    groqForm.append("model", "whisper-large-v3-turbo");
    groqForm.append("response_format", "json");
    groqForm.append("language", "en");

    const whisperRes = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${GROQ_API_KEY}` },
      body: groqForm,
    });

    if (!whisperRes.ok) {
      const errText = await whisperRes.text().catch(() => "");
      console.error(`[TRANSCRIBE] Groq Whisper error: ${whisperRes.status} — ${errText.slice(0, 200)}`);
      return NextResponse.json({ error: "Transcription failed" }, { status: 502 });
    }

    const result = await whisperRes.json() as { text?: string };
    const text = (result.text || "").trim();

    if (!text) {
      return NextResponse.json({ error: "No speech detected" }, { status: 400 });
    }

    return NextResponse.json({ text });
  } catch (err) {
    console.error("[TRANSCRIBE] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
