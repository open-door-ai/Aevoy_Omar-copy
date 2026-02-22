"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart2, TrendingUp, TrendingDown } from "lucide-react";
import Link from "next/link";

export function CostChartWidget() {
  const [data, setData] = useState<{ thisMonth: number; lastMonth: number; breakdown: Array<{label: string; cents: number}> } | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const now = new Date();
      const thisMonth = now.toISOString().slice(0, 7);
      const lastDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonth = lastDate.toISOString().slice(0, 7);
      
      const [{ data: thisUsage }, { data: lastUsage }] = await Promise.all([
        supabase.from("usage").select("ai_cost_cents, browser_tasks, simple_tasks, sms_count").eq("user_id", user.id).eq("month", thisMonth).single(),
        supabase.from("usage").select("ai_cost_cents").eq("user_id", user.id).eq("month", lastMonth).single(),
      ]);

      setData({
        thisMonth: thisUsage?.ai_cost_cents || 0,
        lastMonth: lastUsage?.ai_cost_cents || 0,
        breakdown: [
          { label: "AI Processing", cents: thisUsage?.ai_cost_cents || 0 },
          { label: "Browser Tasks", cents: (thisUsage?.browser_tasks || 0) * 2 },
          { label: "SMS", cents: (thisUsage?.sms_count || 0) * 1 },
        ],
      });
    })();
  }, []);

  const trend = data ? data.thisMonth - data.lastMonth : 0;
  const trendPct = data && data.lastMonth > 0 ? Math.round((trend / data.lastMonth) * 100) : 0;

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <BarChart2 className="h-4 w-4 text-emerald-500" /> Cost Analytics
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!data ? (
          <div className="space-y-2"><div className="h-8 bg-muted animate-pulse rounded" /><div className="h-4 bg-muted animate-pulse rounded w-2/3" /></div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-2xl font-bold">${(data.thisMonth / 100).toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">This month</p>
              </div>
              {data.lastMonth > 0 && (
                <div className={`flex items-center gap-1 text-xs ${trend <= 0 ? "text-green-600" : "text-red-600"}`}>
                  {trend <= 0 ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
                  {Math.abs(trendPct)}% vs last month
                </div>
              )}
            </div>
            <div className="space-y-1">
              {data.breakdown.filter(b => b.cents > 0).map(b => (
                <div key={b.label} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{b.label}</span>
                  <span className="font-medium">${(b.cents / 100).toFixed(2)}</span>
                </div>
              ))}
            </div>
            <Link href="/dashboard/cost-analytics" className="text-xs text-primary hover:underline block">Full breakdown →</Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
