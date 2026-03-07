import { NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, secureResponse, secureError } from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth) return auth.error;

    const supabase = getAdminClient();
    const { searchParams } = new URL(request.url);
    const days = Math.min(90, Math.max(1, parseInt(searchParams.get("days") || "30")));
    const userId = searchParams.get("user_id") || "";

    const since = new Date(Date.now() - days * 86400000).toISOString();

    let costQuery = supabase
      .from("ai_cost_log")
      .select("user_id, provider, model, cost_usd, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false });

    if (userId && /^[0-9a-f-]{36}$/i.test(userId)) costQuery = costQuery.eq("user_id", userId);

    // V27 fix: documented cap, bounded query
    const { data: costs } = await costQuery.limit(5000);

    const dailyCosts: Record<string, number> = {};
    const providerCosts: Record<string, number> = {};
    const userCosts: Record<string, number> = {};
    let totalCost = 0;

    for (const c of costs || []) {
      const day = c.created_at.split("T")[0];
      const cost = parseFloat(c.cost_usd || "0");
      dailyCosts[day] = (dailyCosts[day] || 0) + cost;
      providerCosts[c.provider] = (providerCosts[c.provider] || 0) + cost;
      if (c.user_id) userCosts[c.user_id] = (userCosts[c.user_id] || 0) + cost;
      totalCost += cost;
    }

    const topSpenders = Object.entries(userCosts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10);

    const spenderIds = topSpenders.map(([id]) => id);
    const spenderNames: Record<string, string> = {};
    if (spenderIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, username, email")
        .in("id", spenderIds);
      if (profiles) {
        for (const p of profiles) spenderNames[p.id] = p.username || p.email;
      }
    }

    const { count: totalUsers } = await supabase.from("profiles").select("*", { count: "exact", head: true });
    const { count: totalTasks } = await supabase.from("tasks").select("*", { count: "exact", head: true });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { count: activeToday } = await supabase
      .from("tasks")
      .select("*", { count: "exact", head: true })
      .gte("created_at", todayStart.toISOString());

    return secureResponse({
      totalCost,
      totalUsers: totalUsers || 0,
      totalTasks: totalTasks || 0,
      activeToday: activeToday || 0,
      dailyCosts: Object.entries(dailyCosts)
        .map(([date, cost]) => ({ date, cost }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      providerCosts: Object.entries(providerCosts).map(([provider, cost]) => ({ provider, cost })),
      topSpenders: topSpenders.map(([id, cost]) => ({
        user_id: id,
        username: spenderNames[id] || "unknown",
        cost,
      })),
      days,
    });
  } catch (err) {
    console.error("Admin costs error:", err instanceof Error ? err.message : "unknown");
    return secureError("internal_error", 500);
  }
}
