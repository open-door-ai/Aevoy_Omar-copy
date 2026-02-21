"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { RecentActivity } from "@/components/recent-activity";

export function RecentActivityWidget() {
  const [state, setState] = useState<{ aiEmail: string; tasks: unknown[] } | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from("profiles").select("username, email").eq("id", user.id).single();
      const username = profile?.username || user.email?.split("@")[0] || "user";
      const { data: tasks } = await supabase.from("tasks").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(10);
      setState({ aiEmail: `${username}@aevoy.com`, tasks: tasks || [] });
    })();
  }, []);

  if (!state) return <div className="h-48 animate-pulse bg-muted/40 rounded-xl" />;
  return <RecentActivity aiEmail={state.aiEmail} initialTasks={state.tasks as Parameters<typeof RecentActivity>[0]["initialTasks"]} />;
}
