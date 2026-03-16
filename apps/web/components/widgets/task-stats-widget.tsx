"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { BudgetWidget } from "@/components/budget-widget";

export function TaskStatsWidget() {
  const [data, setData] = useState<{ today?: number; week?: number; successRate?: number | null; completed?: number } | null>(null);

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
      setData({ today: todayCount || 0, week: weekCount || 0, successRate: stats?.success_rate_7d ?? null, completed: stats?.completed_last_7d });
    })();
  }, []);

  const rate = data?.successRate;
  const rateColor = rate == null ? "" : rate >= 80 ? "text-green-600 dark:text-green-400" : rate >= 50 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400";

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full">
      <Card><CardContent className="pt-4 pb-4"><p className="text-xs text-muted-foreground">Tasks Today</p><p className="text-2xl font-bold mt-1">{data ? data.today : <span className="animate-pulse bg-muted rounded h-7 w-8 inline-block" />}</p></CardContent></Card>
      <Card><CardContent className="pt-4 pb-4"><p className="text-xs text-muted-foreground">This Week</p><p className="text-2xl font-bold mt-1">{data ? data.week : <span className="animate-pulse bg-muted rounded h-7 w-8 inline-block" />}</p></CardContent></Card>
      <Card><CardContent className="pt-4 pb-4">
        <p className="text-xs text-muted-foreground">7-Day Success Rate</p>
        {!data ? <span className="animate-pulse bg-muted rounded h-7 w-16 inline-block mt-1" /> :
          rate !== null ? <div className="flex items-end gap-1 mt-1"><p className={`text-2xl font-bold ${rateColor}`}>{rate}%</p><p className="text-xs text-muted-foreground mb-1">({data.completed} done)</p></div>
          : <div className="mt-1"><p className="text-lg font-semibold text-muted-foreground">No tasks yet</p><p className="text-xs text-muted-foreground">Complete your first task to see stats</p></div>}
      </CardContent></Card>
      <BudgetWidget />
    </div>
  );
}
