import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const cookies = request.headers.get("cookie") || "";
  const match = cookies.match(/admin-session=([^;]+)/);
  const token = match?.[1];
  if (token) {
    await supabase.from("admin_sessions").delete().eq("session_token", token);
  }
  const response = NextResponse.json({ success: true });
  response.cookies.delete("admin-session");
  return response;
}
