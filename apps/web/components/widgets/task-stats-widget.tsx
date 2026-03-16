"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

interface StatsData {
  today: number;
  week: number;
  successRate: number | null;
  completed: number | undefined;
  balanceCents: number;
  balanceUsd: string;
}

export function TaskStatsWidget() {
  const [data, setData] = useState<StatsData | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const todayStart = new Date(); todayStart.setHours(0,0,0,0);
      const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay()); weekStart.setHours(0,0,0,0);
      const [{ count: todayCount }, { count: weekCount }, { data: stats }] = await Promise.all([
        supabase.from("tasks").select("*", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", todayStart.toISOString()),
        supabase.from("tasks").select("*", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", weekStart.toISOString()),
        supabase.from("user_task_stats").select("success_rate_7d, completed_last_7d").eq("user_id", user.id).maybeSingle(),
      ]);

      // Fetch credit balance
      let balanceCents = 0;
      let balanceUsd = "0.00";
      try {
        const res = await fetch("/api/billing/balance");
        if (res.ok) {
          const billing = await res.json();
          balanceCents = billing.balance_cents || 0;
          balanceUsd = billing.balance_usd || "0.00";
        }
      } catch { /* ignore */ }

      setData({
        today: todayCount || 0,
        week: weekCount || 0,
        successRate: stats?.success_rate_7d ?? null,
        completed: stats?.completed_last_7d,
        balanceCents,
        balanceUsd,
      });
    })();
  }, []);

  // Don't show anything for brand new users with no tasks
  if (data && data.week === 0 && data.today === 0 && data.successRate === null && data.balanceCents <= 0) {
    return null;
  }

  // Loading state
  if (!data) {
    return <div className="h-10 animate-pulse bg-muted/40 rounded-xl" />;
  }

  const rate = data.successRate;

  // Low balance warning — subtle yellow bar
  const showLowBalance = data.balanceCents > 0 && data.balanceCents < 50;
  const showNoBalance = data.balanceCents <= 0;

  return (
    <div className="space-y-2 w-full">
      {/* Low/no balance alert */}
      {(showLowBalance || showNoBalance) && (
        <Link href="/dashboard/billing">
          <div className={`flex items-center justify-between px-4 py-2.5 rounded-xl text-sm transition-colors cursor-pointer ${
            showNoBalance
              ? "bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/30"
              : "bg-yellow-50 dark:bg-yellow-950/20 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-100 dark:hover:bg-yellow-950/30"
          }`}>
            <span>
              {showNoBalance ? "Add credits to keep your AI running" : "Running low on credits"}
            </span>
            <span className="text-xs font-medium opacity-70">Top up &rarr;</span>
          </div>
        </Link>
      )}

      {/* Compact stats bar */}
      {(data.week > 0 || data.today > 0) && (
        <div className="flex items-center gap-4 px-1 flex-wrap">
          {data.today > 0 && (
            <span className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{data.today}</span> today
            </span>
          )}
          {data.week > 0 && (
            <span className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{data.week}</span> this week
            </span>
          )}
          {rate !== null && (
            <span className="text-xs text-muted-foreground">
              <span className={`font-medium ${rate >= 80 ? "text-green-600 dark:text-green-400" : rate >= 50 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400"}`}>
                {rate}%
              </span> success
            </span>
          )}
          {data.balanceCents > 50 && (
            <Link href="/dashboard/billing" className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-auto">
              <span className="font-medium text-foreground">${data.balanceUsd}</span> credits
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
