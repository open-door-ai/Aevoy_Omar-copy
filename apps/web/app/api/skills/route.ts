import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function deriveCategory(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("gmail") || lower.includes("email") || lower.includes("mail")) return "email";
  if (lower.includes("calendar")) return "calendar";
  if (lower.includes("drive") || lower.includes("onedrive") || lower.includes("file")) return "data";
  if (lower.includes("sheets") || lower.includes("spreadsheet") || lower.includes("excel")) return "spreadsheet";
  if (lower.includes("slack") || lower.includes("teams") || lower.includes("chat")) return "communication";
  if (lower.includes("google") || lower.includes("microsoft") || lower.includes("notion")) return "productivity";
  return "automation";
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const q = url.searchParams.get("q") || "";
    const category = url.searchParams.get("category") || "";

    let query = supabase.from("skills").select("*");

    if (q) {
      query = query.or(`name.ilike.%${q}%,description.ilike.%${q}%`);
    }

    const { data: skills, error } = await query;

    if (error) {
      console.error("[SKILLS-API] Query error:", error);
      return NextResponse.json({ error: "Failed to fetch skills" }, { status: 500 });
    }

    let mapped = (skills || []).map((s) => {
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
      };
    });

    if (category && category !== "all") {
      mapped = mapped.filter((s) => s.category === category);
    }

    return NextResponse.json({
      skills: mapped,
      totalCount: mapped.length,
      sources: { curated: mapped.length, mcp: 0, n8n: 0 },
    });
  } catch (err) {
    console.error("[SKILLS-API] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
