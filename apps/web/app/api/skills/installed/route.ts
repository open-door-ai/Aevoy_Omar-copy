import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // For now, return all skills from the database marked as installed
    // In a full implementation, we'd have a user_skills table to track installed skills per user
    const { data: skills, error } = await supabase
      .from("skills")
      .select("*")
      .eq("enabled", true);

    if (error) {
      console.error("[SKILLS-INSTALLED] Query error:", error);
      return NextResponse.json({ error: "Failed to fetch installed skills" }, { status: 500 });
    }

    // Map skills to the format expected by the UI
    const mapped = (skills || []).map((s) => {
      const nameParts = s.name?.split("_") || [];
      return {
        id: s.id,
        name: s.name || "",
        description: s.description || "",
        source: "curated" as const,
        provider: nameParts[0] || s.name || "",
        category: deriveCategory(s.name || ""),
        costPerUse: 0,
        trustLevel: "verified" as const,
        installed: true,
        method: s.method || "GET",
        api_endpoint: s.api_endpoint,
        input_schema: s.input_schema,
        required_scopes: s.required_scopes || [],
      };
    });

    return NextResponse.json({
      skills: mapped,
      count: mapped.length,
    });
  } catch (err) {
    console.error("[SKILLS-INSTALLED] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function deriveCategory(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("gmail") || lower.includes("email") || lower.includes("mail")) return "email";
  if (lower.includes("calendar")) return "calendar";
  if (lower.includes("drive") || lower.includes("onedrive") || lower.includes("file")) return "data";
  if (lower.includes("excel") || lower.includes("spreadsheet")) return "spreadsheet";
  if (lower.includes("powerpoint") || lower.includes("presentation")) return "presentation";
  if (lower.includes("word") || lower.includes("document")) return "document";
  if (lower.includes("pdf")) return "document";
  if (lower.includes("slack") || lower.includes("teams") || lower.includes("chat")) return "communication";
  if (lower.includes("google") || lower.includes("microsoft") || lower.includes("notion")) return "productivity";
  if (lower.includes("aevoy")) return "ai";
  return "automation";
}
