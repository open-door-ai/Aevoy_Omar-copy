"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Send as SendIcon, Loader2, AlertTriangle } from "lucide-react";

/* ─────────────────────────── Types ─────────────────────────── */
interface ChatMessage {
  id: string;
  role: "user" | "aurora";
  text: string;
  status: string;
  created_at: string;
}

/* ─────────────────────────── Helpers ─────────────────────────── */
function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  if (diffMs < 60_000) return "Just now";
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/* ─────────────────────────── Component ─────────────────────────── */
export default function AuroraFeed() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const supabase = createClient();

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  /* ─── Load initial messages ─── */
  const loadMessages = useCallback(async () => {
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
        .order("created_at", { ascending: true })
        .limit(100);

      if (tasksError) throw tasksError;

      const chatMessages: ChatMessage[] = [];

      (tasks || []).forEach((t) => {
        // User message
        if (t.email_subject) {
          chatMessages.push({
            id: `${t.id}-user`,
            role: "user",
            text: t.email_subject,
            status: t.status,
            created_at: t.created_at,
          });
        }

        // Aurora response
        if (t.response_text) {
          chatMessages.push({
            id: `${t.id}-aurora`,
            role: "aurora",
            text: t.response_text,
            status: t.status,
            created_at: t.created_at,
          });
        } else if (t.status === "processing") {
          chatMessages.push({
            id: `${t.id}-aurora`,
            role: "aurora",
            text: "",
            status: "processing",
            created_at: t.created_at,
          });
        }
      });

      setMessages(chatMessages);
      setLoading(false);
      setTimeout(scrollToBottom, 100);
    } catch (err) {
      console.error("Feed load error:", err);
      setError("Something went wrong loading your messages.");
      setLoading(false);
    }
  }, [supabase, scrollToBottom]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

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

          const taskId = t.id as string;
          const subject = (t.email_subject as string) || null;
          const response = (t.response_text as string) || null;
          const status = (t.status as string) || "pending";
          const createdAt =
            (t.created_at as string) || new Date().toISOString();

          setMessages((prev) => {
            const updated = [...prev];

            // Update or add user message
            if (subject) {
              const userIdx = updated.findIndex(
                (m) => m.id === `${taskId}-user`
              );
              if (userIdx >= 0) {
                updated[userIdx] = {
                  ...updated[userIdx],
                  text: subject,
                  status,
                };
              }
            }

            // Update or add aurora response
            const auroraIdx = updated.findIndex(
              (m) => m.id === `${taskId}-aurora`
            );
            if (auroraIdx >= 0) {
              updated[auroraIdx] = {
                ...updated[auroraIdx],
                text: response || "",
                status,
              };
            } else if (response) {
              // Find pending message and replace, or add new
              const pendingIdx = updated.findIndex(
                (m) =>
                  m.id.startsWith("pending-") &&
                  m.role === "aurora" &&
                  m.status === "processing"
              );
              if (pendingIdx >= 0) {
                updated[pendingIdx] = {
                  id: `${taskId}-aurora`,
                  role: "aurora",
                  text: response,
                  status,
                  created_at: createdAt,
                };
              } else {
                updated.push({
                  id: `${taskId}-aurora`,
                  role: "aurora",
                  text: response,
                  status,
                  created_at: createdAt,
                });
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
    setMessages((prev) => [
      ...prev,
      {
        id: `${pendingId}-user`,
        role: "user",
        text,
        status: "processing",
        created_at: now,
      },
      {
        id: `${pendingId}-aurora`,
        role: "aurora",
        text: "",
        status: "processing",
        created_at: now,
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
        setMessages((prev) =>
          prev.map((m) =>
            m.id === `${pendingId}-aurora`
              ? { ...m, text: data.response, status: "completed" }
              : m
          )
        );
      }
    } catch (err) {
      console.error("Send error:", err);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === `${pendingId}-aurora`
            ? {
                ...m,
                text: "Couldn't reach Aurora. Try again in a moment.",
                status: "failed",
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

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="w-8 h-8 rounded-full border-2 border-white/10 border-t-white/40 animate-spin" />
            <p className="text-sm text-white/20">Loading...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-12 h-12 rounded-full bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
              <span className="text-lg text-white/10">A</span>
            </div>
            <p className="text-sm text-white/30 text-center max-w-xs">
              This is the start of your conversation with Aurora.
            </p>
            <p className="text-xs text-white/15">
              Type something below to begin.
            </p>
          </div>
        ) : (
          <div className="space-y-4 max-w-3xl mx-auto">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div className="flex flex-col gap-1 max-w-[85%] sm:max-w-[75%]">
                  <div
                    className={`px-4 py-2.5 text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "bg-white text-[#0a0a0a] rounded-2xl rounded-br-md"
                        : "bg-white/[0.06] text-white/80 rounded-2xl rounded-bl-md"
                    }`}
                  >
                    {msg.status === "processing" && !msg.text ? (
                      <div className="flex gap-1.5 py-0.5">
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-white/30 animate-bounce"
                          style={{ animationDelay: "0ms" }}
                        />
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-white/30 animate-bounce"
                          style={{ animationDelay: "150ms" }}
                        />
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-white/30 animate-bounce"
                          style={{ animationDelay: "300ms" }}
                        />
                      </div>
                    ) : (
                      <span className="whitespace-pre-wrap">{msg.text}</span>
                    )}
                  </div>
                  <span
                    className={`text-[10px] text-white/15 px-1 ${msg.role === "user" ? "text-right" : "text-left"}`}
                  >
                    {formatTime(msg.created_at)}
                  </span>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="border-t border-white/[0.06] bg-[#0a0a0a] px-4 sm:px-6 py-4">
        <div className="max-w-3xl mx-auto">
          <div className="relative flex items-center">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message Aurora..."
              className="w-full h-11 px-4 pr-12 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-white/20 outline-none focus:border-white/15 focus:bg-white/[0.06] focus:ring-1 focus:ring-white/[0.06] transition-all"
              autoComplete="off"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || sending}
              className="absolute right-1.5 p-2 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/[0.06] disabled:opacity-20 disabled:hover:bg-transparent transition-all"
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
