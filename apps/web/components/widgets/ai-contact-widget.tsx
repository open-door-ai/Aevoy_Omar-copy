"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { GlassCard } from "@/components/ui/motion";

export function AiContactWidget() {
  const [data, setData] = useState<{ aiEmail: string; phone?: string; botName?: string } | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from("profiles").select("username, twilio_number, bot_name").eq("id", user.id).single();
      const username = profile?.username || user.email?.split("@")[0] || "user";
      setData({ aiEmail: `${username}@aevoy.com`, phone: profile?.twilio_number || undefined, botName: profile?.bot_name || undefined });
    })();
  }, []);

  if (!data) return <div className="h-32 animate-pulse bg-muted/40 rounded-xl" />;

  return (
    <div className="grid md:grid-cols-2 gap-3 w-full">
      <GlassCard className="p-5">
        <p className="text-xs font-medium text-muted-foreground mb-1">{data.botName ? `${data.botName}'s Email` : "Your AI Email"}</p>
        <p className="text-xs text-muted-foreground/70 mb-3">Send tasks via email</p>
        <div className="text-base font-mono bg-muted p-3 rounded-lg border border-border truncate">{data.aiEmail}</div>
      </GlassCard>
      {data.phone && (
        <GlassCard className="p-5">
          <p className="text-xs font-medium text-muted-foreground mb-1">Your AI Phone</p>
          <p className="text-xs text-muted-foreground/70 mb-3">Call or text tasks</p>
          <div className="text-base font-mono bg-muted p-3 rounded-lg border border-border">{data.phone}</div>
        </GlassCard>
      )}
    </div>
  );
}
