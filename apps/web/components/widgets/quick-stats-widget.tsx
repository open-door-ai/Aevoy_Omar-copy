"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Mail, Phone, Zap, DollarSign } from "lucide-react";

export function QuickStatsWidget() {
  const [data, setData] = useState<{ email?: string; phone?: string; activeTasks?: number; monthlyCost?: string } | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: profile }, { count: activeCount }] = await Promise.all([
        supabase.from("profiles").select("email, twilio_number").eq("id", user.id).single(),
        supabase.from("tasks").select("*", { count: "exact", head: true }).eq("user_id", user.id).in("status", ["pending", "processing"]),
      ]);
      const month = new Date().toISOString().slice(0, 7);
      const { data: usage } = await supabase.from("usage").select("ai_cost_cents").eq("user_id", user.id).eq("month", month).single();
      setData({
        email: profile?.email,
        phone: profile?.twilio_number,
        activeTasks: activeCount || 0,
        monthlyCost: ((usage?.ai_cost_cents || 0) / 100).toFixed(2),
      });
    })();
  }, []);

  const stats = [
    { label: "Your Email", value: data?.email || "—", icon: Mail, truncate: true },
    { label: "Your Phone", value: data?.phone || "Not provisioned", icon: Phone },
    { label: "Active Tasks", value: String(data?.activeTasks ?? "—"), icon: Zap, highlight: true },
    { label: "Monthly Cost", value: data ? `$${data.monthlyCost}` : "—", icon: DollarSign },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full">
      {stats.map((s) => (
        <Card key={s.label} className="hover:shadow-md transition-shadow">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <s.icon className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </div>
            <p className={`font-semibold mt-0.5 ${s.highlight ? "text-xl sm:text-2xl text-blue-600 dark:text-blue-400" : "text-xs sm:text-sm"} ${s.truncate ? "truncate" : ""}`}>
              {!data ? <span className="animate-pulse bg-muted rounded h-4 w-20 inline-block" /> : s.value}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
