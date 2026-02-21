"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Heart } from "lucide-react";
import Link from "next/link";

export function HealthSummaryWidget() {
  const [data, setData] = useState<{ insight?: string; severity?: string; metrics?: Array<{type: string; value: number; unit: string}> } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const [{ data: insight }, { data: metrics }] = await Promise.all([
        supabase.from("health_insights").select("insight_text, severity").eq("user_id", user.id).order("generated_at", { ascending: false }).limit(1).single(),
        supabase.from("health_metrics").select("metric_type, value, unit").eq("user_id", user.id).order("recorded_at", { ascending: false }).limit(5),
      ]);
      setData({ insight: insight?.insight_text, severity: insight?.severity, metrics: metrics?.map(m => ({ type: m.metric_type, value: m.value, unit: m.unit })) });
      setLoading(false);
    })();
  }, []);

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2"><Heart className="h-4 w-4 text-rose-500" /> Health Summary</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? <div className="space-y-2"><div className="h-4 bg-muted animate-pulse rounded w-3/4" /><div className="h-4 bg-muted animate-pulse rounded w-1/2" /></div>
        : !data?.metrics?.length ? (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground mb-2">No health data yet</p>
            <Link href="/dashboard/health" className="text-xs text-primary hover:underline">Set up Health →</Link>
          </div>
        ) : (
          <div className="space-y-2">
            {data.insight && <p className="text-xs text-muted-foreground line-clamp-2">{data.insight}</p>}
            <div className="flex flex-wrap gap-2">
              {data.metrics?.slice(0, 3).map(m => (
                <span key={m.type} className="text-xs bg-muted px-2 py-0.5 rounded-full capitalize">{m.type.replace(/_/g, " ")}: <strong>{m.value} {m.unit}</strong></span>
              ))}
            </div>
            <Link href="/dashboard/health" className="text-xs text-primary hover:underline">View all →</Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
