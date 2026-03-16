"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Copy, Check } from "lucide-react";

export function AiContactWidget() {
  const [data, setData] = useState<{ aiEmail: string; phone?: string; botName?: string } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

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

  const handleCopy = async (value: string, field: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch { /* ignore */ }
  };

  if (!data) return <div className="h-12 animate-pulse bg-muted/40 rounded-xl" />;

  return (
    <div className="w-full">
      <p className="text-xs text-muted-foreground mb-2.5">
        You can also send tasks by email{data.phone ? " or phone" : ""}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => handleCopy(data.aiEmail, "email")}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/60 hover:bg-muted text-sm font-mono text-foreground/80 transition-colors group"
        >
          {data.aiEmail}
          {copiedField === "email" ? (
            <Check className="w-3 h-3 text-green-500" />
          ) : (
            <Copy className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          )}
        </button>
        {data.phone && (
          <button
            onClick={() => handleCopy(data.phone!, "phone")}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/60 hover:bg-muted text-sm font-mono text-foreground/80 transition-colors group"
          >
            {data.phone}
            {copiedField === "phone" ? (
              <Check className="w-3 h-3 text-green-500" />
            ) : (
              <Copy className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
