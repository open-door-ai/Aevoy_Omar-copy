import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = "claude-haiku-4-5-20251001";

// ─── Doctor system prompt ─────────────────────────────────────────────────────
// Warm, human-sounding. No bullet points, no lists, no "Certainly!" openers.
// Talks like a real doctor would on a video call — concise, direct, empathetic.

const DOCTOR_SYSTEM_PROMPT = `You are Dr. Nova, a GP with a background in internal medicine, conducting a video consultation. You speak exactly how a real doctor does on a video call — warm, direct, conversational, and clinically precise.

PERSONALITY:
- You're genuinely interested in the patient. You ask follow-up questions naturally.
- You use plain language. No medical jargon unless you immediately explain it.
- You're honest about uncertainty — "this could be a few different things."
- You're calm under pressure, occasionally reassuring with dry humor when it fits.
- If something is probably fine, say so directly. Don't hedge everything.

VOICE RULES (this conversation is spoken aloud — TTS will render it):
- Keep responses SHORT: 2-4 sentences max unless the situation genuinely requires more.
- Never use bullet points, numbered lists, headers, or markdown symbols.
- Never use em dashes (—) mid-sentence. Use a comma or break it into two sentences.
- Vary your sentence length: mix short punchy observations with longer explanatory ones.
- React briefly before analyzing: start with "Hm.", "Okay so", "Right," or "Yeah" — sounds live, not pre-written.

BANNED PHRASES (these make you sound like a chatbot, not a doctor):
- Never start with: "Certainly!", "Absolutely!", "Of course!", "Great question!", "I'd be happy to..."
- Never say: "I understand your concern" — call center script, not how doctors talk
- Never say: "It's important to note", "It's worth mentioning", "This underscores"
- Never use: "Furthermore", "Moreover", "In addition", "In summary", "In conclusion"
- Never use inflated words: "delve", "leverage", "utilize", "commence", "endeavor", "illuminate"
- Don't narrate empathy performatively: not "That sounds really difficult." Instead absorb it: "How long has this been going on — has it affected your sleep?"

WHAT REAL DOCTORS DO ON VIDEO CALLS:
- React to what the patient says before analyzing: "Hm, okay." then the clinical thought
- Ask one question at a time — not "tell me about X, Y, and Z"
- Give a verdict with an invitation to push back: "Sounds like it could be tension headaches — does that track with you?"
- Use "could be", "my read is", "I'd want to know more before saying" — real diagnostic uncertainty language
- It's okay to say "let me think about this for a sec" — doctors do this

MEDICAL APPROACH:
- Give real clinical thinking: what it could be, what would rule things out, what to watch for.
- Mention when to seek urgent care if symptoms warrant it.
- If shown an image: describe what you see clinically, give 2-3 differential possibilities, ask clarifying questions.
- Never sound more certain than you are. "Could be a few things" is the honest, appropriate response.

RESPONSE FORMAT:
- Plain sentences only — no JSON, no lists, no formatting
- Weave the disclaimer in once naturally: "worth seeing someone in person if this doesn't clear up"
- End most responses with exactly one specific follow-up question
- BAD: "Can you tell me more about your symptoms?" | GOOD: "Is the pain constant or does it come and go?"

DISCLAIMER: Work in once naturally that this is informational and not a formal medical diagnosis.`;

interface AnalyzeBody {
  imageBase64?: string;  // optional — text-only messages don't include it
  symptoms?: string;
  message?: string;      // alias for symptoms in text-only mode
  includeMetrics?: boolean;
  conversationHistory?: Array<{ role: "ai" | "user"; text: string }>;
}

interface ClaudeAnalysisResult {
  response: string;
  urgency?: "routine" | "monitor" | "seek_care";
}

/**
 * POST /api/health/consult/[id]/analyze
 *
 * Handles both:
 * 1. Visual analysis: imageBase64 + symptoms text
 * 2. Text-only chat: symptoms/message text (no image)
 * 3. Conversation history is forwarded for context
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
      .select("id, status, transcript")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (consultError || !consult) {
      return NextResponse.json(
        { error: "Consultation not found" },
        { status: 404 }
      );
    }

    if (consult.status === "completed" || consult.status === "cancelled") {
      return NextResponse.json(
        { error: "Consultation is no longer active" },
        { status: 400 }
      );
    }

    let body: AnalyzeBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const userText = body.symptoms || body.message || "";
    const hasImage = !!body.imageBase64 && typeof body.imageBase64 === "string";

    if (!userText && !hasImage) {
      return NextResponse.json(
        { error: "Please describe your symptoms or share an image" },
        { status: 400 }
      );
    }

    if (!ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "AI analysis not configured" },
        { status: 503 }
      );
    }

    // Optionally fetch recent health metrics for context
    let metricsContext = "";
    if (body.includeMetrics) {
      const since = new Date();
      since.setDate(since.getDate() - 3);

      const { data: metrics } = await supabase
        .from("health_metrics")
        .select("metric_type, value, unit, recorded_at")
        .eq("user_id", user.id)
        .gte("recorded_at", since.toISOString())
        .order("recorded_at", { ascending: false })
        .limit(20);

      if (metrics && metrics.length > 0) {
        const summaryLines = metrics.map(
          (m) =>
            `${m.metric_type}: ${m.value} ${m.unit} (${new Date(m.recorded_at).toLocaleDateString()})`
        );
        metricsContext = `\n\nPatient's recent health metrics:\n${summaryLines.join("\n")}`;
      }
    }

    // Build conversation history for multi-turn context
    const conversationMessages: Array<{ role: string; content: string }> = [];
    if (body.conversationHistory && body.conversationHistory.length > 0) {
      // Include last 6 messages for context (3 turns)
      const recent = body.conversationHistory.slice(-6);
      for (const msg of recent) {
        conversationMessages.push({
          role: msg.role === "ai" ? "assistant" : "user",
          content: msg.text,
        });
      }
    }

    // Build the user message content
    const userMessageContent: Array<{ type: string; [key: string]: unknown }> = [];

    // Add image if present
    if (hasImage) {
      let mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" = "image/jpeg";
      const rawBase64 = body.imageBase64!;

      if (rawBase64.startsWith("data:")) {
        const mimeMatch = rawBase64.match(/^data:(image\/\w+);base64,/);
        if (mimeMatch) {
          const mime = mimeMatch[1];
          if (mime === "image/png" || mime === "image/gif" || mime === "image/webp") {
            mediaType = mime as typeof mediaType;
          }
        }
      }

      const imageData = rawBase64.replace(/^data:image\/\w+;base64,/, "");

      userMessageContent.push({
        type: "image",
        source: {
          type: "base64",
          media_type: mediaType,
          data: imageData,
        },
      });
    }

    // Add text message
    const textContent = [
      userText ? `Patient says: ${userText}` : "[Patient shared an image]",
      metricsContext,
    ]
      .filter(Boolean)
      .join("\n");

    userMessageContent.push({ type: "text", text: textContent });

    // Build messages array
    const messages: Array<{ role: string; content: unknown }> = [
      ...conversationMessages,
      {
        role: "user",
        content: userMessageContent.length === 1 ? userMessageContent[0].text : userMessageContent,
      },
    ];

    // Call Claude
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 400,
        system: DOCTOR_SYSTEM_PROMPT,
        messages,
      }),
    });

    if (!claudeRes.ok) {
      console.error(`[CONSULT ANALYZE] Claude API error: HTTP ${claudeRes.status}`);
      return NextResponse.json(
        { error: "AI analysis failed" },
        { status: 502 }
      );
    }

    const claudeData = await claudeRes.json() as {
      content?: Array<{ type: string; text?: string }>;
    };

    const rawText = claudeData.content?.[0]?.text?.trim() || "";

    // The doctor responds in plain text — no JSON parsing needed
    const response = rawText || "Let me look into that. Can you describe what you're experiencing in a bit more detail?";

    // Append to consultation transcript (best-effort)
    const transcriptEntry = {
      timestamp: new Date().toISOString(),
      type: hasImage ? "image_analysis" : "text_message",
      userMessage: userText,
      aiResponse: response,
    };

    const existingTranscript = Array.isArray(consult.transcript) ? consult.transcript : [];
    await supabase
      .from("health_consultations")
      .update({ transcript: [...existingTranscript, transcriptEntry] })
      .eq("id", id)
      .eq("user_id", user.id);

    return NextResponse.json({
      response,
      urgency: "routine" as const,
      observations: [],
      conditions: [],
      disclaimer:
        "This is for informational purposes only and is not a medical diagnosis. Always consult a licensed healthcare professional.",
    });
  } catch (err) {
    console.error("[CONSULT ANALYZE] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
