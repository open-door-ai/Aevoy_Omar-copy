"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Send as SendIcon, Loader2, AlertTriangle } from "lucide-react";
import { MicButton } from "@/components/aurora/MicButton";
import { FeedCard } from "@/components/aurora/FeedCard";
import { formatTaskForFeed } from "@/lib/feed-formatter";
import type { FeedItem } from "@/lib/feed-formatter";

/* ─────────────────────────── Component ─────────────────────────── */
export default function AuroraFeed() {
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const feedEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const supabase = createClient();

  const scrollToBottom = useCallback(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  /* ─── Load initial feed ─── */
  const loadFeed = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      const { data: tasks, error: tasksError } = await supabase
        .from("tasks")
        .select(
          "id, email_subject, response_text, input_channel, status, created_at"
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (tasksError) throw tasksError;

      const items: FeedItem[] = [];
      // Reverse to get chronological order for display (oldest first)
      const ordered = [...(tasks || [])].reverse();
      for (const task of ordered) {
        items.push(...formatTaskForFeed(task));
      }

      setFeedItems(items);
      setLoading(false);
      setTimeout(scrollToBottom, 100);
    } catch (err) {
      console.error("Feed load error:", err);
      setError("Something went wrong loading your feed.");
      setLoading(false);
    }
  }, [supabase, scrollToBottom]);

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

          const newItems = formatTaskForFeed({
            id: t.id as string,
            email_subject: (t.email_subject as string) || undefined,
            response_text: (t.response_text as string) || undefined,
            input_channel: (t.input_channel as string) || undefined,
            status: (t.status as string) || "pending",
            created_at:
              (t.created_at as string) || new Date().toISOString(),
          });

          setFeedItems((prev) => {
            const updated = [...prev];

            for (const newItem of newItems) {
              const existingIdx = updated.findIndex(
                (m) => m.id === newItem.id
              );
              if (existingIdx >= 0) {
                updated[existingIdx] = newItem;
              } else {
                // Check for pending placeholder
                const pendingIdx = updated.findIndex(
                  (m) =>
                    m.id.startsWith("pending-") &&
                    m.id.endsWith("-aurora") &&
                    m.status === "processing"
                );
                if (
                  pendingIdx >= 0 &&
                  newItem.id.endsWith("-aurora")
                ) {
                  updated[pendingIdx] = newItem;
                } else {
                  updated.push(newItem);
                }
              }
            }

            return updated;
          });

          setTimeout(scrollToBottom, 100);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, supabase, scrollToBottom]);

  /* ─── Send message via proxy ─── */
  const handleSend = async () => {
    if (!input.trim() || sending) return;
    const text = input.trim();
    setInput("");
    setSending(true);

    const now = new Date().toISOString();
    const pendingId = `pending-${Date.now()}`;

    // Optimistic: add user message + processing indicator
    setFeedItems((prev) => [
      ...prev,
      {
        id: `${pendingId}-user`,
        summary: text,
        channel: "web",
        status: "processing",
        timestamp: now,
      },
      {
        id: `${pendingId}-aurora`,
        summary: "",
        channel: "web",
        status: "processing",
        timestamp: now,
      },
    ]);
    setTimeout(scrollToBottom, 100);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const res = await fetch("/api/aurora/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ message: text }),
      });

      if (!res.ok) {
        throw new Error(`Failed to send: ${res.status}`);
      }

      const data = await res.json();

      // If we got an immediate response, update the pending aurora message
      if (data.response) {
        setFeedItems((prev) =>
          prev.map((m) =>
            m.id === `${pendingId}-aurora`
              ? { ...m, summary: data.response, status: "completed" as const }
              : m
          )
        );
      }
    } catch (err) {
      console.error("Send error:", err);
      setFeedItems((prev) =>
        prev.map((m) =>
          m.id === `${pendingId}-aurora`
            ? {
                ...m,
                summary: "Couldn't reach Aurora. Try again in a moment.",
                status: "failed" as const,
              }
            : m
        )
      );
      setError("Couldn't reach Aurora. Try again.");
      setTimeout(() => setError(null), 4000);
    }

    setSending(false);
    inputRef.current?.focus();
    setTimeout(scrollToBottom, 100);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  };

  /* ─── Render ─── */
  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Error Banner */}
      {error && (
        <div className="mx-4 mt-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 scrollbar-hide">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="w-8 h-8 rounded-full border-2 border-[--aurora-card-border] border-t-[#6C5CE7] animate-spin" />
            <p className="text-sm text-[--aurora-text-secondary]">
              Loading...
            </p>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-8">
            {/* Mic Button — the centerpiece */}
            <div className="flex justify-center pt-4 pb-2">
              <MicButton onListeningChange={setListening} />
            </div>

            {/* Feed heading */}
            {feedItems.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-xs font-medium uppercase tracking-wider text-[--aurora-text-secondary] px-1">
                  Recent Activity
                </h2>

                {/* Feed cards */}
                <div className="space-y-2.5">
                  {feedItems.map((item) => (
                    <FeedCard key={item.id} item={item} />
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {feedItems.length === 0 && !listening && (
              <div className="flex flex-col items-center gap-3 pt-4">
                <p className="text-sm text-[--aurora-text-secondary] text-center max-w-xs">
                  No activity yet. Tap the mic or type below to start.
                </p>
              </div>
            )}

            <div ref={feedEndRef} />
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="border-t border-[--aurora-card-border] bg-[--aurora-bg] px-4 sm:px-6 py-4">
        <div className="max-w-2xl mx-auto">
          <div className="relative flex items-center">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message Aurora..."
              className="w-full h-11 px-4 pr-12 rounded-xl bg-[--aurora-card] border border-[--aurora-card-border] text-sm text-[--aurora-text] placeholder:text-[--aurora-text-secondary]/60 outline-none focus:border-[#6C5CE7]/50 focus:ring-2 focus:ring-[#6C5CE7]/20 transition-all"
              autoComplete="off"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || sending}
              className="absolute right-1.5 p-2 rounded-lg text-[--aurora-text-secondary] hover:text-[--aurora-text]/60 hover:bg-[#6C5CE7]/10 disabled:opacity-20 disabled:hover:bg-transparent transition-all"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <SendIcon className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
