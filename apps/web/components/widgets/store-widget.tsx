"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Store, Package } from "lucide-react";
import Link from "next/link";

export function StoreWidget() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { count: installCount } = await supabase
        .from("marketplace_installs")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id);
      setCount(installCount || 0);
    })();
  }, []);

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Store className="h-4 w-4 text-indigo-500" /> App Store
          <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium ml-1">Beta</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-center py-3">
          <Package className="h-8 w-8 mx-auto text-muted-foreground/20 mb-2" />
          <p className="text-lg font-bold">{count ?? "—"}</p>
          <p className="text-xs text-muted-foreground mb-3">{count === 1 ? "app installed" : "apps installed"}</p>
          <div className="flex gap-2 justify-center">
            <Link href="/dashboard/store" className="text-xs bg-muted px-3 py-1.5 rounded-lg hover:bg-muted/80 transition-colors">My Apps</Link>
            <Link href="/store" className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-lg hover:bg-primary/90 transition-colors">Browse Store</Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
