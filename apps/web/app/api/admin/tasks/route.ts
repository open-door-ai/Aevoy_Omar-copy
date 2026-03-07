import { NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, sanitizeSearch, secureResponse, secureError } from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth) return auth.error;

    const supabase = getAdminClient();
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50")));
    const status = searchParams.get("status") || "";
    const channel = searchParams.get("channel") || "";
    const userId = searchParams.get("user_id") || "";
    const search = sanitizeSearch(searchParams.get("search") || ""); // V01 fix
    const offset = (page - 1) * limit;

    // V37 fix: validate status/channel values
    const validStatuses = ["completed", "processing", "pending", "failed", "needs_review", ""];
    const validChannels = ["email", "sms", "voice", "web", "chat", "telegram", "whatsapp", ""];

    let query = supabase
      .from("tasks")
      .select(
        "id, user_id, status, type, email_subject, input_channel, created_at, started_at, completed_at, cost_usd, error_message, response_text, tokens_used",
        { count: "exact" },
      );

    if (status && validStatuses.includes(status)) query = query.eq("status", status);
    if (channel && validChannels.includes(channel)) query = query.eq("input_channel", channel);
    if (userId && /^[0-9a-f-]{36}$/i.test(userId)) query = query.eq("user_id", userId);
    if (search) query = query.or(`email_subject.ilike.%${search}%,response_text.ilike.%${search}%`);

    const { data: tasks, count, error } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("Admin tasks query:", error.message);
      return secureError("query_failed", 500);
    }

    // Enrich with usernames
    const userIds = [...new Set((tasks || []).map((t: { user_id: string }) => t.user_id).filter(Boolean))];
    const userMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, username, email")
        .in("id", userIds);
      if (profiles) {
        for (const p of profiles) userMap[p.id] = p.username || p.email;
      }
    }

    const enrichedTasks = (tasks || []).map((t: { user_id: string }) => ({
      ...t,
      username: userMap[t.user_id] || "unknown",
    }));

    return secureResponse({
      tasks: enrichedTasks,
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    });
  } catch (err) {
    console.error("Admin tasks error:", err instanceof Error ? err.message : "unknown");
    return secureError("internal_error", 500);
  }
}
