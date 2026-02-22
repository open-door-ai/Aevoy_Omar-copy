"use client";
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Store, Package, Star, Trash2, ExternalLink } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

interface InstalledApp {
  app_id: string; installed_at: string;
  app: { id: string; name: string; slug: string; description: string; icon_url: string | null; rating_avg: number; version: string; };
}

export default function MyAppsPage() {
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data } = await supabase
      .from("marketplace_installs")
      .select("app_id, installed_at, app:marketplace_apps(id, name, slug, description, icon_url, rating_avg, version)")
      .eq("user_id", user.id)
      .order("installed_at", { ascending: false });
    setApps((data || []) as unknown as InstalledApp[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleUninstall = async (appId: string, appName: string) => {
    if (!confirm(`Uninstall "${appName}"? This will remove it from your dashboard.`)) return;
    await fetch("/api/store/install", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appId }) });
    setApps(prev => prev.filter(a => a.app_id !== appId));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Store className="h-6 w-6" /> My Apps</h1>
          <p className="text-sm text-muted-foreground">Manage your installed marketplace apps</p>
        </div>
        <Link href="/store" className="flex items-center gap-1.5 text-sm text-primary hover:underline font-medium">
          Browse Store <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>

      {loading ? (
        <div className="grid md:grid-cols-2 gap-4">{[1,2,3].map(i => <div key={i} className="h-24 bg-muted animate-pulse rounded-xl" />)}</div>
      ) : apps.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Package className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
            <p className="font-medium mb-1">No apps installed</p>
            <p className="text-sm text-muted-foreground mb-4">Discover widgets and integrations in the App Store</p>
            <Link href="/store" className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
              Browse Store
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {apps.map(({ app_id, app, installed_at }) => (
            <Card key={app_id} className="group hover:shadow-md transition-shadow">
              <CardContent className="p-4 flex items-start gap-3">
                <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center text-xl shrink-0">
                  {app.icon_url ? <img src={app.icon_url} alt="" className="w-8 h-8 rounded" /> : "📦"}
                </div>
                <div className="flex-1 min-w-0">
                  <Link href={`/store/${app.slug}`} className="font-semibold text-sm hover:text-primary transition-colors">{app.name}</Link>
                  <p className="text-xs text-muted-foreground line-clamp-1">{app.description}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="flex items-center gap-0.5"><Star className="h-3 w-3 text-amber-400 fill-amber-400" /><span className="text-xs">{app.rating_avg > 0 ? Number(app.rating_avg).toFixed(1) : "—"}</span></div>
                    <span className="text-[10px] text-muted-foreground">v{app.version}</span>
                    <span className="text-[10px] text-muted-foreground">Installed {new Date(installed_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <button onClick={() => handleUninstall(app_id, app.name)} className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition-all" title="Uninstall">
                  <Trash2 className="h-4 w-4 text-red-500" />
                </button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
