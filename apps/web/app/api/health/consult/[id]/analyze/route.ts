import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// ─── AI provider config ────────────────────────────────────────────────────────
// Tries providers in order — whichever key is set in env vars wins.
const AI_PROVIDERS = [
  {
    name: "Groq",
    key: process.env.GROQ_API_KEY,
    url: "https://api.groq.com/openai/v1/chat/completions",
    textModel: "llama-3.3-70b-versatile",
    visionModel: "llama-3.2-90b-vision-preview",
  },
  {
    name: "DeepSeek",
    key: process.env.DEEPSEEK_API_KEY,
    url: "https://api.deepseek.com/v1/chat/completions",
    textModel: "deepseek-chat",
    visionModel: "deepseek-chat", // no native vision, falls back to text
  },
  {
    name: "Kimi",
    key: process.env.KIMI_API_KEY,
    url: "https://api.moonshot.cn/v1/chat/completions",
    textModel: "moonshot-v1-8k",
    visionModel: "moonshot-v1-8k",
  },
] as const;

// ─── Doctor system prompt ─────────────────────────────────────────────────────
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
- React briefly before analyzing: start with "Hm.", "Okay so", "Right," or "Yeah."

BANNED PHRASES:
- Never start with: "Certainly!", "Absolutely!", "Of course!", "Great question!", "I'd be happy to..."
- Never say: "I understand your concern"
- Never say: "It's important to note", "It's worth mentioning", "This underscores"
- Never use: "Furthermore", "Moreover", "In addition", "In summary", "In conclusion"
- Never use: "delve", "leverage", "utilize", "commence", "endeavor", "illuminate"
- Don't narrate empathy: not "That sounds really difficult." Instead: "How long has this been going on?"

WHAT REAL DOCTORS DO ON VIDEO CALLS:
- React before analyzing: "Hm, okay." then the clinical thought
- Ask one question at a time
- Give a verdict with invitation to push back: "Sounds like tension headaches — does that track?"
- Use "could be", "my read is", "I'd want to know more before saying"

MEDICAL APPROACH:
- Give real clinical thinking: what it could be, what would rule things out, what to watch for.
- Mention when to seek urgent care if symptoms warrant it.
- If shown an image: describe clinically, give 2-3 differential possibilities, ask clarifying questions.
- Never sound more certain than you are.

RESPONSE FORMAT:
- Plain sentences only — no JSON, no lists, no formatting
- Weave the disclaimer in once naturally: "worth seeing someone in person if this doesn't clear up"
- End most responses with exactly one specific follow-up question
- BAD: "Can you tell me more?" | GOOD: "Is the pain constant or does it come and go?"

DISCLAIMER: Work in once naturally that this is informational and not a formal medical diagnosis.`;

interface AnalyzeBody {
  imageBase64?: string;
  symptoms?: string;
  message?: string;
  includeMetrics?: boolean;
  conversationHistory?: Array<{ role: "ai" | "user"; text: string }>;
}

type MessageContent =
  | string
  | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: MessageContent;
}

async function callAI(messages: ChatMessage[], hasImage: boolean): Promise<string> {
  // Try each provider in order until one works
  const errors: string[] = [];

  for (const provider of AI_PROVIDERS) {
    if (!provider.key) continue;

    const model = hasImage && provider.visionModel !== provider.textModel
      ? provider.visionModel
      : provider.textModel;

    try {
      const res = await fetch(provider.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${provider.key}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 400,
          temperature: 0.7,
          messages,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        errors.push(`${provider.name}: HTTP ${res.status} — ${errText.slice(0, 100)}`);
        console.warn(`[CONSULT ANALYZE] ${provider.name} failed: ${res.status}`);
        continue;
      }

      const data = await res.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const text = data.choices?.[0]?.message?.content?.trim() || "";
      if (text) return text;

      errors.push(`${provider.name}: empty response`);
    } catch (err) {
      errors.push(`${provider.name}: ${String(err).slice(0, 100)}`);
      console.warn(`[CONSULT ANALYZE] ${provider.name} threw:`, err);
    }
  }

  console.error("[CONSULT ANALYZE] All AI providers failed:", errors);
  throw new Error("All AI providers failed: " + errors.join("; "));
}

/**
 * POST /api/health/consult/[id]/analyze
 *
 * Handles both:
 * 1. Visual analysis: imageBase64 + symptoms text
 * 2. Text-only chat: symptoms/message text
 * 3. Conversation history forwarded for multi-turn context
 *
 * AI providers tried in order: Groq → DeepSeek → Kimi
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

    const { data: consult, error: consultError } = await supabase
      .from("health_consultations")
      .select("id, status, transcript")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (consultError || !consult) {
      return NextResponse.json({ error: "Consultation not found" }, { status: 404 });
    }

    if (consult.status === "completed" || consult.status === "cancelled") {
      return NextResponse.json({ error: "Consultation is no longer active" }, { status: 400 });
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

    // Check at least one AI key is configured
    const hasAnyKey = AI_PROVIDERS.some((p) => !!p.key);
    if (!hasAnyKey) {
      return NextResponse.json({ error: "AI analysis not configured" }, { status: 503 });
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
        metricsContext = `\n\nPatient's recent health metrics:\n${metrics
          .map((m) => `${m.metric_type}: ${m.value} ${m.unit} (${new Date(m.recorded_at).toLocaleDateString()})`)
          .join("\n")}`;
      }
    }

    // Build messages (OpenAI/Groq format)
    const messages: ChatMessage[] = [{ role: "system", content: DOCTOR_SYSTEM_PROMPT }];

    // Conversation history (last 6 messages for 3-turn context)
    if (body.conversationHistory && body.conversationHistory.length > 0) {
      for (const msg of body.conversationHistory.slice(-6)) {
        messages.push({
          role: msg.role === "ai" ? "assistant" : "user",
          content: msg.text,
        });
      }
    }

    // Build user message content
    const textContent = [
      userText ? `Patient says: ${userText}` : "[Patient shared an image]",
      metricsContext,
    ]
      .filter(Boolean)
      .join("\n");

    let userContent: MessageContent;
    if (hasImage) {
      const rawBase64 = body.imageBase64!;
      const dataUrl = rawBase64.startsWith("data:") ? rawBase64 : `data:image/jpeg;base64,${rawBase64}`;
      userContent = [
        { type: "image_url" as const, image_url: { url: dataUrl } },
        { type: "text" as const, text: textContent },
      ];
    } else {
      userContent = textContent;
    }

    messages.push({ role: "user", content: userContent });

    // Call AI (with provider fallback chain)
    let response: string;
    try {
      response = await callAI(messages, hasImage);
    } catch {
      return NextResponse.json({ error: "AI analysis temporarily unavailable" }, { status: 503 });
    }

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
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
