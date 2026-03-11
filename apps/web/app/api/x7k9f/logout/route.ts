import { NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { logAdminAction, verifyAdminSession, secureResponse } from "@/lib/admin-auth";

export async function POST(request: NextRequest) {
  const supabase = getAdminClient();
  const session = await verifyAdminSession(request);

  if (session) {
    await logAdminAction(session.id, "logout");
    await supabase.from("admin_sessions").delete().eq("id", session.id);
  }

  const response = secureResponse({ success: true });
  // V45 fix: Match cookie attributes for proper deletion
  response.cookies.set("admin-session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 0,
    path: "/",
  });
  return response;
}
