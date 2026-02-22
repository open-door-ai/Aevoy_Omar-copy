"use client";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plug, CheckCircle, XCircle } from "lucide-react";
import Link from "next/link";

interface Integration { name: string; connected: boolean; icon: string; }

export function ConnectedAppsWidget() {
  const [integrations, setIntegrations] = useState<Integration[] | null>(null);

  useEffect(() => {
    (async () => {
      const providers = [
        { key: "gmail", name: "Google", icon: "G" },
        { key: "microsoft", name: "Microsoft", icon: "M" },
        { key: "twitter", name: "Twitter/X", icon: "X" },
        { key: "telegram", name: "Telegram", icon: "T" },
        { key: "fitbit", name: "Fitbit", icon: "F" },
      ];
      const results = await Promise.allSettled(
        providers.map(async (p) => {
          const res = await fetch(`/api/integrations/${p.key}`);
          if (!res.ok) return { ...p, connected: false };
          const data = await res.json();
          return { ...p, connected: !!data.connected };
        })
      );
      setIntegrations(
        results.map((r, i) => r.status === "fulfilled" ? r.value : { ...providers[i], connected: false })
      );
    })();
  }, []);

  const connectedCount = integrations?.filter(i => i.connected).length || 0;

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Plug className="h-4 w-4 text-violet-500" /> Connected Apps
          {integrations && <span className="text-xs font-normal text-muted-foreground ml-auto">{connectedCount} active</span>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!integrations ? (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-7 bg-muted animate-pulse rounded" />)}</div>
        ) : (
          <div className="space-y-1.5">
            {integrations.map(int => (
              <div key={int.name} className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-muted flex items-center justify-center text-[10px] font-bold">{int.icon}</div>
                  <span className="text-xs">{int.name}</span>
                </div>
                {int.connected 
                  ? <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                  : <XCircle className="h-3.5 w-3.5 text-muted-foreground/30" />
                }
              </div>
            ))}
            <Link href="/dashboard/apps" className="text-xs text-primary hover:underline block mt-2">Manage →</Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
