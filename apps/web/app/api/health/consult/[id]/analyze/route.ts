import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = "claude-haiku-4-5-20251001";

const ANALYSIS_SYSTEM_PROMPT = `You are a health information assistant (not a licensed physician). Analyze the provided image and user's description.
Describe what you observe (colors, patterns, size estimates if visible).
List 2-4 conditions this COULD resemble (educational only, not a diagnosis).
Rate urgency: 'routine' (can wait for next appointment), 'monitor' (watch closely), or 'seek_care' (see a doctor soon).
Always end with: 'Please consult a healthcare professional for proper diagnosis and treatment.'
Keep response under 200 words. Format as JSON: { "observations": string[], "conditions": string[], "urgency": "routine" | "monitor" | "seek_care", "advice": string }`;

interface AnalyzeBody {
  imageBase64: string;
  symptoms: string;
  includeMetrics?: boolean;
}

interface ClaudeAnalysisResult {
  observations: string[];
  conditions: string[];
  urgency: "routine" | "monitor" | "seek_care";
  advice: string;
}

/**
 * POST /api/health/consult/[id]/analyze
 *
 * Performs real-time visual analysis of an image (e.g. skin condition photo)
 * during an active health consultation session.
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

    if (!body.imageBase64 || typeof body.imageBase64 !== "string") {
      return NextResponse.json(
        { error: "imageBase64 is required" },
        { status: 400 }
      );
    }

    if (!body.symptoms || typeof body.symptoms !== "string") {
      return NextResponse.json(
        { error: "symptoms description is required" },
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
        metricsContext = `\n\nUser's recent health metrics (last 3 days):\n${summaryLines.join("\n")}`;
      }
    }

    // Detect image media type from base64 prefix or default to jpeg
    let mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" =
      "image/jpeg";
    if (body.imageBase64.startsWith("data:")) {
      const mimeMatch = body.imageBase64.match(/^data:(image\/\w+);base64,/);
      if (mimeMatch) {
        const mime = mimeMatch[1];
        if (
          mime === "image/png" ||
          mime === "image/gif" ||
          mime === "image/webp"
        ) {
          mediaType = mime;
        }
      }
    }

    // Strip data URI prefix if present
    const imageData = body.imageBase64.replace(/^data:image\/\w+;base64,/, "");

    const userMessage = `User describes: ${body.symptoms}${metricsContext}

Please analyze the image and provide your health information observations in the requested JSON format.`;

    // Call Claude Vision API
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 512,
        system: ANALYSIS_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: imageData,
                },
              },
              {
                type: "text",
                text: userMessage,
              },
            ],
          },
        ],
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

    const rawText = claudeData.content?.[0]?.text || "";

    // Parse Claude's JSON response
    let analysis: ClaudeAnalysisResult;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in response");
      analysis = JSON.parse(jsonMatch[0]);
    } catch {
      // Fallback: treat raw text as advice
      analysis = {
        observations: [rawText],
        conditions: [],
        urgency: "routine",
        advice:
          "Please consult a healthcare professional for proper diagnosis and treatment.",
      };
    }

    const disclaimer =
      "This is NOT a medical diagnosis. The observations above are for informational purposes only. Always consult a licensed healthcare professional for medical advice, diagnosis, or treatment.";

    // Append analysis to consultation transcript (best-effort)
    const transcriptEntry = {
      timestamp: new Date().toISOString(),
      type: "image_analysis",
      symptoms: body.symptoms,
      analysis,
    };

    const existingTranscript = Array.isArray(consult.transcript)
      ? consult.transcript
      : [];

    await supabase
      .from("health_consultations")
      .update({
        transcript: [...existingTranscript, transcriptEntry],
      })
      .eq("id", id)
      .eq("user_id", user.id);

    return NextResponse.json({
      observations: analysis.observations || [],
      urgency: analysis.urgency || "routine",
      conditions: analysis.conditions || [],
      response: analysis.advice || "",
      disclaimer,
    });
  } catch (err) {
    console.error("[CONSULT ANALYZE] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
