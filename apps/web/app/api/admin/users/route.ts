import { NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, sanitizeSearch, secureResponse, secureError } from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth) return auth.error;

    const supabase = getAdminClient();
    const { searchParams } = new URL(request.url);
    const search = sanitizeSearch(searchParams.get("search") || ""); // V01 fix
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50")));
    const sortBy = searchParams.get("sort") || "created_at";
    const sortDir = searchParams.get("dir") === "asc";
    const offset = (page - 1) * limit;

    let query = supabase
      .from("profiles")
      .select(
        "id, username, email, display_name, timezone, subscription_tier, created_at, last_active_at, onboarding_completed, messages_used, messages_limit",
        { count: "exact" },
      );

    if (search) {
      query = query.or(`username.ilike.%${search}%,email.ilike.%${search}%,display_name.ilike.%${search}%`);
    }

    const validSorts = ["created_at", "last_active_at", "username", "email", "messages_used"];
    const col = validSorts.includes(sortBy) ? sortBy : "created_at";

    const { data: users, count, error } = await query
      .order(col, { ascending: sortDir })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("Admin users query:", error.message); // V33 fix
      return secureError("query_failed", 500);
    }

    // Fetch task counts + total cost — V28 fix: add limit
    const userIds = (users || []).map((u: { id: string }) => u.id);
    const taskStats: Record<string, { task_count: number; total_cost: number }> = {};

    if (userIds.length > 0) {
      const { data: tasks } = await supabase
        .from("tasks")
        .select("user_id, cost_usd")
        .in("user_id", userIds)
        .limit(5000); // V28 fix: bounded query
      if (tasks) {
        for (const t of tasks) {
          if (!taskStats[t.user_id]) taskStats[t.user_id] = { task_count: 0, total_cost: 0 };
          taskStats[t.user_id].task_count++;
          taskStats[t.user_id].total_cost += parseFloat(t.cost_usd || "0");
        }
      }
    }

    const enrichedUsers = (users || []).map((u: { id: string }) => ({
      ...u,
      task_count: taskStats[u.id]?.task_count || 0,
      total_cost_usd: taskStats[u.id]?.total_cost || 0,
    }));

    return secureResponse({
      users: enrichedUsers,
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    });
  } catch (err) {
    console.error("Admin users error:", err instanceof Error ? err.message : "unknown");
    return secureError("internal_error", 500);
  }
}
