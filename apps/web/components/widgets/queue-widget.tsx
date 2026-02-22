"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, CheckCircle, Loader2 } from "lucide-react";
import Link from "next/link";

interface QueueTask { id: string; status: string; type: string | null; created_at: string; email_subject: string | null; }

export function QueueWidget() {
  const [tasks, setTasks] = useState<QueueTask[] | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("tasks")
        .select("id, status, type, created_at, email_subject")
        .eq("user_id", user.id)
        .in("status", ["pending", "processing"])
        .order("created_at", { ascending: false })
        .limit(5);
      setTasks(data || []);
    })();
  }, []);

  const statusIcon = (s: string) => s === "processing" 
    ? <Loader2 className="h-3 w-3 text-blue-500 animate-spin" /> 
    : <Clock className="h-3 w-3 text-amber-500" />;

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Clock className="h-4 w-4 text-amber-500" /> Task Queue
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!tasks ? (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-8 bg-muted animate-pulse rounded" />)}</div>
        ) : tasks.length === 0 ? (
          <div className="text-center py-4">
            <CheckCircle className="h-8 w-8 mx-auto text-green-500/30 mb-2" />
            <p className="text-sm text-muted-foreground">Queue is clear</p>
          </div>
        ) : (
          <div className="space-y-2">
            {tasks.map(t => (
              <div key={t.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                {statusIcon(t.status)}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{t.email_subject || t.type || "Task"}</p>
                  <p className="text-[10px] text-muted-foreground">{new Date(t.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${t.status === "processing" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"}`}>
                  {t.status}
                </span>
              </div>
            ))}
            <Link href="/dashboard/queue" className="text-xs text-primary hover:underline block mt-1">View all →</Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
