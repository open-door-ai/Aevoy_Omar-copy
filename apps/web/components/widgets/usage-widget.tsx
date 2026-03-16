"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function UsageWidget() {
  const [data, setData] = useState<{ used: number; limit: number; tier: string } | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from("profiles").select("messages_used, messages_limit, subscription_tier, subscription_status").eq("id", user.id).single();
      setData({
        used: profile?.messages_used || 0,
        limit: profile?.messages_limit || 20,
        tier: profile?.subscription_tier || "free",
      });
    })();
  }, []);

  const pct = data ? Math.min((data.used / data.limit) * 100, 100) : 0;

  return (
    <div className="grid md:grid-cols-2 gap-3 w-full">
      <Card>
        <CardHeader className="pb-2"><CardDescription>Messages Used</CardDescription><CardTitle className="text-3xl">{data ? `${data.used} / ${data.limit}` : "—"}</CardTitle></CardHeader>
        <CardContent><div className="w-full bg-muted rounded-full h-2 overflow-hidden"><div className="bg-primary h-2 rounded-full transition-all duration-700" style={{ width: `${pct}%` }} /></div></CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardDescription>Plan</CardDescription><CardTitle className="text-3xl capitalize">{data?.tier === "beta" ? "Free" : (data?.tier || "Free")}</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">{`${data?.limit || 20} messages/month`}</p></CardContent>
      </Card>
    </div>
  );
}
