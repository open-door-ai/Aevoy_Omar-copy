"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Mail, MessageSquare, Phone, Globe, Send as SendIcon,
  Loader2, AlertTriangle, Clock, CheckCircle, XCircle,
  Zap, Bot,
} from "lucide-react";

/* ─────────────────────────── Types ─────────────────────────── */
interface FeedItem {
  id: string;
  type: "task" | "proactive" | "context";
  title: string;
  detail: string | null;
  channel: string | null;
  status: string;
  created_at: string;
  cost_usd: number | null;
}

/* ─────────────────────────── Helpers ─────────────────────────── */
function channelBadge(channel: string | null) {
  const map: Record<string, { icon: typeof Mail; label: string; color: string }> = {
    email: { icon: Mail, label: "Email", color: "bg-blue-500/10 text-blue-400" },
    sms: { icon: MessageSquare, label: "SMS", color: "bg-green-500/10 text-green-400" },
    voice: { icon: Phone, label: "Voice", color: "bg-purple-500/10 text-purple-400" },
    web: { icon: Globe, label: "Web", color: "bg-white/5 text-white/50" },
    chat: { icon: Globe, label: "Chat", color: "bg-white/5 text-white/50" },
    telegram: { icon: SendIcon, label: "Telegram", color: "bg-sky-500/10 text-sky-400" },
    whatsapp: { icon: MessageSquare, label: "WhatsApp", color: "bg-emerald-500/10 text-emerald-400" },
    proactive: { icon: Zap, label: "Proactive", color: "bg-amber-500/10 text-amber-400" },
  };
  const info = map[channel || "web"] || map.web;
  const Icon = info.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${info.color}`}>
      <Icon className="h-3 w-3" />
      {info.label}
    </span>
  );
}

function statusIndicator(status: string) {
  switch (status) {
    case "completed":
      return <CheckCircle className="h-3.5 w-3.5 text-emerald-400 shrink-0" />;
    case "processing":
      return <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin shrink-0" />;
    case "failed":
    case "internal_error":
      return <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />;
    case "pending":
      return <Clock className="h-3.5 w-3.5 text-amber-400 shrink-0" />;
    default:
      return <Clock className="h-3.5 w-3.5 text-white/20 shrink-0" />;
  }
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  if (diffMs < 60_000) return "Just now";
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  if (diffMs < 604_800_000) return `${Math.floor(diffMs / 86_400_000)}d ago`;

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ─────────────────────────── Component ─────────────────────────── */
export default function AuroraFeed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const feedEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const supabase = createClient();

  /* ─── Load initial feed ─── */
  const loadFeed = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      // Fetch recent tasks as feed items
      const { data: tasks, error: tasksError } = await supabase
        .from("tasks")
        .select("id, email_subject, response_text, input_channel, status, created_at, cost_usd")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (tasksError) throw tasksError;

      const feedItems: FeedItem[] = (tasks || []).map((t) => ({
        id: t.id,
        type: "task" as const,
        title: t.email_subject || "Task",
        detail: t.response_text,
        channel: t.input_channel,
        status: t.status,
        created_at: t.created_at,
        cost_usd: t.cost_usd ? parseFloat(t.cost_usd) : null,
      }));

      // Also fetch proactive queue items if the table exists
      try {
        const { data: proactive } = await supabase
          .from("proactive_queue")
          .select("id, action_type, message, status, created_at, channel")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(20);

        if (proactive) {
          proactive.forEach((p) => {
            feedItems.push({
              id: `proactive-${p.id}`,
              type: "proactive",
              title: p.action_type || "Aurora noticed something",
              detail: p.message,
              channel: p.channel || "proactive",
              status: p.status || "completed",
              created_at: p.created_at,
              cost_usd: null,
            });
          });
        }
      } catch {
        // proactive_queue table may not exist yet — that's fine
      }

      // Sort everything by date, newest first
      feedItems.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setItems(feedItems);
      setLoading(false);
    } catch (err) {
      console.error("Feed load error:", err);
      setError("Something broke. Aurora is still working in the background.");
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  /* ─── Realtime subscriptions ─── */
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel("aurora-feed")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tasks",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const t = payload.new as Record<string, unknown>;
          if (!t || !t.id) return;

          const newItem: FeedItem = {
            id: t.id as string,
            type: "task",
            title: (t.email_subject as string) || "Task",
            detail: (t.response_text as string) || null,
            channel: (t.input_channel as string) || null,
            status: (t.status as string) || "pending",
            created_at: (t.created_at as string) || new Date().toISOString(),
            cost_usd: t.cost_usd ? parseFloat(t.cost_usd as string) : null,
          };

          setItems((prev) => {
            const idx = prev.findIndex((i) => i.id === newItem.id);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = newItem;
              return updated;
            }
            return [newItem, ...prev];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, supabase]);

  /* ─── Send message ─── */
  const handleSend = async () => {
    if (!message.trim() || sending) return;
    const text = message.trim();
    setMessage("");
    setSending(true);

    try {
      const agentUrl = process.env.NEXT_PUBLIC_AGENT_URL || "https://agent-production-1339.up.railway.app";
      const { data: { session } } = await supabase.auth.getSession();

      const res = await fetch(`${agentUrl}/task/v2`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token && { Authorization: `Bearer ${session.access_token}` }),
        },
        body: JSON.stringify({
          task: text,
          channel: "web",
        }),
      });

      if (!res.ok) {
        throw new Error(`Failed to send: ${res.status}`);
      }

      // Optimistic add
      setItems((prev) => [
        {
          id: `pending-${Date.now()}`,
          type: "task",
          title: text,
          detail: null,
          channel: "web",
          status: "processing",
          created_at: new Date().toISOString(),
          cost_usd: null,
        },
        ...prev,
      ]);
    } catch (err) {
      console.error("Send error:", err);
      setError("Couldn't reach Aurora. She's probably busy. Try again in a sec.");
      setTimeout(() => setError(null), 4000);
    }

    setSending(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  /* ─── Render ─── */
  return (
    <div className="flex flex-col min-h-[calc(100vh-7rem)]">
      {/* Feed Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Activity</h1>
        <p className="text-sm text-white/30 mt-1">
          Everything Aurora has done, is doing, and is thinking about.
        </p>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Feed Content */}
      <div className="flex-1 space-y-2">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="relative">
              <div className="w-10 h-10 rounded-full border-2 border-white/10 border-t-white/40 animate-spin" />
            </div>
            <p className="text-sm text-white/20">Aurora is thinking. That&apos;s a good sign.</p>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
              <Bot className="h-7 w-7 text-white/15" />
            </div>
            <div className="text-center max-w-sm">
              <p className="text-sm text-white/40">
                Aurora is learning about you. Give it a moment — or give it something to work with.
              </p>
              <p className="text-xs text-white/15 mt-2">
                Try typing something below. Literally anything.
              </p>
            </div>
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="group px-4 py-3.5 rounded-xl bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.04] hover:border-white/[0.08] transition-all"
            >
              <div className="flex items-start gap-3">
                {/* Status indicator */}
                <div className="mt-0.5">
                  {statusIndicator(item.status)}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white/90 truncate">
                      {item.title}
                    </span>
                    {channelBadge(item.channel)}
                    {item.type === "proactive" && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-400">
                        <Zap className="h-3 w-3" />
                        Proactive
                      </span>
                    )}
                  </div>

                  {item.detail && (
                    <p className="text-sm text-white/40 mt-1.5 line-clamp-3 leading-relaxed">
                      {item.detail}
                    </p>
                  )}

                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-[11px] text-white/20">
                      {formatTime(item.created_at)}
                    </span>
                    {item.cost_usd !== null && item.cost_usd > 0 && (
                      <span className="text-[11px] text-white/15">
                        ${item.cost_usd.toFixed(3)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={feedEndRef} />
      </div>

      {/* Message Input — Sticky Bottom */}
      <div className="sticky bottom-0 pt-4 pb-2 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a] to-transparent">
        <div className="relative">
          <textarea
            ref={inputRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Talk to Aurora..."
            rows={1}
            className="w-full px-4 py-3 pr-12 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-white/20 outline-none focus:border-white/20 focus:bg-white/[0.06] transition-all resize-none"
          />
          <button
            onClick={handleSend}
            disabled={!message.trim() || sending}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/[0.06] disabled:opacity-20 disabled:hover:bg-transparent transition-all"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <SendIcon className="h-4 w-4" />
            )}
          </button>
        </div>
        <p className="text-[11px] text-white/10 text-center mt-2">
          Press Enter to send. Shift+Enter for a new line.
        </p>
      </div>
    </div>
  );
}
