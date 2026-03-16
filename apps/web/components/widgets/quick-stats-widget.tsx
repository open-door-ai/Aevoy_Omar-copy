"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function QuickStatsWidget() {
  const [activeTasks, setActiveTasks] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { count } = await supabase
        .from("tasks")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .in("status", ["pending", "processing"]);
      setActiveTasks(count || 0);
    })();
  }, []);

  // Only show when there are active tasks — no zero states
  if (activeTasks === null || activeTasks === 0) return null;

  return (
    <div className="flex items-center gap-2 px-1">
      <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
      <span className="text-sm text-foreground">
        <span className="font-medium">{activeTasks}</span>{" "}
        {activeTasks === 1 ? "task" : "tasks"} in progress
      </span>
    </div>
  );
}
