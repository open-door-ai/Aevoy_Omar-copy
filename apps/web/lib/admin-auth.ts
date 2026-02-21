import { createClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";

export async function verifyAdminSession(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get("admin-session")?.value;
  if (!token) return false;

  const supabase = await createClient();
  const now = new Date().toISOString();

  const { data: session } = await supabase
    .from("admin_sessions")
    .select("id, expires_at")
    .eq("session_token", token)
    .gt("expires_at", now)
    .single();

  if (!session) return false;

  // Refresh session expiry on activity
  await supabase.from("admin_sessions").update({
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    last_activity_at: now,
  }).eq("session_token", token);

  return true;
}
