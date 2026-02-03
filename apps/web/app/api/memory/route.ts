import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const memoryType = url.searchParams.get("type");
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get("limit") || "20") || 20), 100);

  // Validate memory type parameter
  const validTypes = ["working", "long_term", "episodic"];
  if (memoryType && !validTypes.includes(memoryType)) {
    return NextResponse.json(
      { error: `Invalid type. Must be one of: ${validTypes.join(", ")}` },
      { status: 400 }
    );
  }

  let query = supabase
    .from("user_memory")
    .select("id, memory_type, encrypted_data, importance, created_at, updated_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (memoryType) {
    query = query.eq("memory_type", memoryType);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Note: encrypted_data is returned as-is. Client-side decryption would be needed
  // for a privacy-first approach. For dashboard display, we return metadata only.
  const memories = (data || []).map((m) => ({
    id: m.id,
    type: m.memory_type,
    importance: m.importance,
    createdAt: m.created_at,
    updatedAt: m.updated_at,
    // Don't expose encrypted_data to client for security
    hasContent: !!m.encrypted_data,
  }));

  return NextResponse.json({ memories });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { type, content } = body;

  if (!type || !content) {
    return NextResponse.json(
      { error: "Missing type or content" },
      { status: 400 }
    );
  }

  const validTypes = ["working", "long_term", "episodic"];
  if (!validTypes.includes(type)) {
    return NextResponse.json(
      { error: `Invalid type. Must be one of: ${validTypes.join(", ")}` },
      { status: 400 }
    );
  }

  // Note: In production, content should be encrypted before storage.
  // The agent server handles encryption. This API is for basic CRUD.
  const { data, error } = await supabase.from("user_memory").insert({
    user_id: user.id,
    memory_type: type,
    encrypted_data: content, // Should be encrypted by caller
    importance: body.importance || 0.5,
  }).select().single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    id: data.id,
    type: data.memory_type,
    createdAt: data.created_at,
  });
}
