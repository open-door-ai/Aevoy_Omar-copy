"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail } from "lucide-react";
import Link from "next/link";

interface InboxItem { id: string; subject: string; from_address: string; received_at: string; ai_classification: string; }

export function InboxPreviewWidget() {
  const [items, setItems] = useState<InboxItem[] | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("inbox_queue").select("id, subject, from_address, received_at, ai_classification").eq("user_id", user.id).order("received_at", { ascending: false }).limit(5);
      setItems(data || []);
    })();
  }, []);

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2"><Mail className="h-4 w-4 text-blue-500" /> Inbox Preview</CardTitle>
      </CardHeader>
      <CardContent>
        {!items ? <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}</div>
        : items.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground mb-2">Inbox is empty</p>
            <Link href="/dashboard/inbox" className="text-xs text-primary hover:underline">Go to Inbox →</Link>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map(item => (
              <div key={item.id} className="flex items-start gap-2 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{item.subject || "(no subject)"}</p>
                  <p className="text-xs text-muted-foreground truncate">{item.from_address}</p>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${item.ai_classification === "urgent" ? "bg-red-100 text-red-700" : "bg-muted text-muted-foreground"}`}>{item.ai_classification || "new"}</span>
              </div>
            ))}
            <Link href="/dashboard/inbox" className="text-xs text-primary hover:underline block mt-1">View all →</Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
