"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Send as SendIcon, Loader2, AlertTriangle } from "lucide-react";
import { MicButton } from "@/components/anticipy/MicButton";
import { FeedCard, SkeletonCard } from "@/components/anticipy/FeedCard";
import { formatTaskForFeed } from "@/lib/feed-formatter";
import type { FeedItem } from "@/lib/feed-formatter";

/* ─────────────────────────── Component ─────────────────────────── */
export default function AnticipyFeed() {
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [micVisible, setMicVisible] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [onboardingContext, setOnboardingContext] = useState<string[]>([]);
  const [liveTranscript, setLiveTranscript] = useState<string | null>(null);
  const feedTopRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const micButtonRef = useRef<HTMLDivElement>(null);
  const prevListening = useRef(false);

  const supabase = createClient();

  const scrollToTop = useCallback(() => {
    feedTopRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  /* ─── Load initial feed ─── */
  const loadFeed = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      // Get session token for WebSocket auth (mic -> Deepgram pipeline)
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        setAccessToken(session.access_token);
      }

      const { data: tasks, error: tasksError } = await supabase
        .from("tasks")
        .select(
          "id, email_subject, response_text, input_channel, status, created_at"
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (tasksError) throw tasksError;

      // Newest first — keep the order from the query
      const items: FeedItem[] = [];
      for (const task of tasks || []) {
        items.push(...formatTaskForFeed(task));
      }

      setFeedItems(items);
      setLoading(false);
    } catch (err) {
      console.error("Feed load error:", err);
      setError("Something went wrong loading your feed.");
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  /* ─── First-run onboarding check ─── */
  useEffect(() => {
    async function checkOnboarding() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: settings } = await supabase
        .from("user_settings")
        .select("aurora_onboarded")
        .eq("user_id", user.id)
        .single();

      // If aurora_onboarded is not true, show inline welcome
      if (!settings?.aurora_onboarded) {
        setShowOnboarding(true);
      }
    }
    checkOnboarding();
  }, [supabase]);

  /* ─── Intersection observer: detect when mic scrolls out of view ─── */
  useEffect(() => {
    if (!micButtonRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => setMicVisible(entry.isIntersecting),
      { threshold: 0.5 }
    );
    observer.observe(micButtonRef.current);
    return () => observer.disconnect();
  }, []);

  /* ─── Toast when listening stops ─── */
  useEffect(() => {
    if (prevListening.current && !listening) {
      setLiveTranscript(null);
      // Only show "processing" toast if we had activity
      setToast("Anticipy stopped listening.");
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
    prevListening.current = listening;
  }, [listening]);

  /* ─── Handle real-time transcript from mic ─── */
  const handleTranscript = useCallback((text: string, isFinal: boolean) => {
    if (isFinal) {
      setLiveTranscript(null); // Clear interim, final will show briefly in MicButton
    } else {
      setLiveTranscript(text); // Show interim transcript live
    }
  }, []);

  /* ─── Confirm and execute a detected intent ─── */
  const confirmIntent = useCallback(async (intentId: string, action: string, queueId?: string) => {
    // Update the card to "processing"
    setFeedItems((prev) =>
      prev.map((m) =>
        m.id === intentId
          ? { ...m, summary: `"${action}" — on it.`, status: "processing" as const }
          : m
      )
    );

    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch("/api/anticipy/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ message: action }),
      });
      // Real result arrives via Supabase realtime subscription
    } catch (err) {
      console.error("Confirm intent error:", err);
      setFeedItems((prev) =>
        prev.map((m) =>
          m.id === intentId
            ? { ...m, summary: `Couldn't execute: "${action}"`, status: "failed" as const }
            : m
        )
      );
    }
  }, [supabase]);

  /* ─── Dismiss a detected intent ─── */
  const dismissIntent = useCallback((intentId: string) => {
    setFeedItems((prev) => prev.filter((m) => m.id !== intentId));
  }, []);

  /* ─── Handle intent detected from mic ─── */
  const handleIntentDetected = useCallback((action: string, needsConfirmation?: boolean, queueId?: string) => {
    const now = new Date().toISOString();
    const intentId = `intent-${Date.now()}`;

    if (needsConfirmation) {
      // Show confirmation card — user must approve before we act
      setFeedItems((prev) => [
        {
          id: intentId,
          summary: action,
          channel: "microphone",
          status: "pending" as const,
          timestamp: now,
          isUser: false,
          _confirmAction: action,
          _queueId: queueId,
        } as FeedItem & { _confirmAction: string; _queueId?: string },
        ...prev,
      ]);
    } else {
      // Autonomous mode — show "working on it" immediately
      setFeedItems((prev) => [
        {
          id: intentId,
          summary: `Heard you mention: "${action}" — on it.`,
          channel: "microphone",
          status: "processing" as const,
          timestamp: now,
          isUser: false,
        },
        ...prev,
      ]);
    }
    scrollToTop();

    // For autonomous mode, the real task result will arrive via Supabase realtime
  }, [scrollToTop]);

  /* ─── Post-onboarding: load learned context ─── */
  useEffect(() => {
    if (showOnboarding || !userId) return;
    async function loadOnboardingContext() {
      const { data } = await supabase
        .from("user_memory")
        .select("content")
        .eq("user_id", userId!)
        .eq("source", "onboarding")
        .limit(10);
      if (data && data.length > 0) {
        setOnboardingContext(data.map((d: { content: string }) => d.content));
      }
    }
    loadOnboardingContext();
  }, [showOnboarding, userId, supabase]);

  /* ─── Realtime subscriptions ─── */
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel("anticipy-feed")
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
                    m.id.endsWith("-anticipy") &&
                    m.status === "processing"
                );
                if (
                  pendingIdx >= 0 &&
                  newItem.id.endsWith("-anticipy")
                ) {
                  updated[pendingIdx] = newItem;
                } else {
                  // Insert at the top (newest first)
                  updated.unshift(newItem);
                }
              }
            }

            return updated;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, supabase]);

  /* ─── Send message via proxy ─── */
  const handleSend = async () => {
    if (!input.trim() || sending) return;
    const text = input.trim();
    setInput("");
    setSending(true);

    const now = new Date().toISOString();
    const pendingId = `pending-${Date.now()}`;

    // Optimistic: add user message + processing indicator at TOP (newest first)
    setFeedItems((prev) => [
      {
        id: `${pendingId}-anticipy`,
        summary: "",
        channel: "web",
        status: "processing",
        timestamp: now,
        isUser: false,
      },
      {
        id: `${pendingId}-user`,
        summary: text,
        channel: "web",
        status: "processing",
        timestamp: now,
        isUser: true,
      },
      ...prev,
    ]);
    setTimeout(scrollToTop, 100);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const res = await fetch("/api/anticipy/send", {
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

      // If we got an immediate response, update the pending anticipy message
      if (data.response) {
        setFeedItems((prev) =>
          prev.map((m) =>
            m.id === `${pendingId}-anticipy`
              ? { ...m, summary: data.response, status: "completed" as const }
              : m
          )
        );
      }
    } catch (err) {
      console.error("Send error:", err);
      setFeedItems((prev) =>
        prev.map((m) =>
          m.id === `${pendingId}-anticipy`
            ? {
                ...m,
                summary: "Couldn't reach Anticipy. Try again in a moment.",
                status: "failed" as const,
              }
            : m
        )
      );
      setError("Couldn't reach Anticipy. Try again.");
      setTimeout(() => setError(null), 4000);
    }

    setSending(false);
    inputRef.current?.focus();
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
      {/* Floating "Listening..." pill when mic scrolled out of view */}
      {listening && !micVisible && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-full bg-[#6C5CE7] text-white text-sm font-medium shadow-lg shadow-[#6C5CE7]/25 flex items-center gap-2 animate-fadeIn">
          <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
          Anticipy is listening...
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-30 px-4 py-2.5 rounded-xl bg-[--anticipy-card] border border-[--anticipy-card-border] text-sm text-[--anticipy-text] shadow-lg animate-fadeIn">
          {toast}
        </div>
      )}

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
          /* ─── Skeleton Loading State ─── */
          <div className="max-w-2xl mx-auto space-y-8">
            <div className="flex justify-center pt-4 pb-2">
              <div className="w-[120px] h-[120px] rounded-full bg-[--anticipy-card-border] animate-shimmer" />
            </div>
            <div className="space-y-3">
              <div className="h-3 w-24 rounded bg-[--anticipy-card-border] animate-shimmer" />
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-8">
            <div ref={feedTopRef} />

            {/* First-run inline welcome */}
            {showOnboarding && (
              <div className="bg-gradient-to-br from-[#6C5CE7]/10 to-[#A855F7]/10 border border-[#6C5CE7]/20 rounded-2xl p-6 text-center">
                <h2 className="text-xl font-semibold text-[--anticipy-text] mb-2">
                  Meet Anticipy
                </h2>
                <p className="text-sm text-[--anticipy-text-secondary] mb-4 max-w-md mx-auto">
                  I&apos;m your AI that actually does things. Tap the mic and
                  tell me what&apos;s on your plate — or just start talking. I
                  learn fast.
                </p>
                <button
                  onClick={async () => {
                    setShowOnboarding(false);
                    if (userId) {
                      await supabase
                        .from("user_settings")
                        .upsert(
                          { user_id: userId, aurora_onboarded: true },
                          { onConflict: "user_id" }
                        );
                    }
                  }}
                  className="text-xs text-[#6C5CE7] hover:underline"
                >
                  Got it
                </button>
              </div>
            )}

            {/* Live transcript — shows what Anticipy hears in real-time */}
            {listening && liveTranscript && (
              <div className="text-center px-4 animate-fadeIn">
                <p className="text-sm text-[--anticipy-text-secondary] italic">
                  {liveTranscript}
                </p>
              </div>
            )}

            {/* Mic Button — the centerpiece */}
            <div ref={micButtonRef} className="flex justify-center pt-4 pb-2">
              <MicButton
                onListeningChange={setListening}
                onIntentDetected={handleIntentDetected}
                onTranscript={handleTranscript}
                userId={userId}
                accessToken={accessToken}
              />
            </div>

            {/* Post-onboarding summary: what Anticipy learned */}
            {!showOnboarding && onboardingContext.length > 0 && (
              <div className="bg-gradient-to-br from-[#6C5CE7]/5 to-[#A855F7]/5 border border-[#6C5CE7]/10 rounded-2xl p-5 animate-slideUp">
                <h3 className="text-sm font-semibold text-[--anticipy-text] mb-2">
                  Here&apos;s what Anticipy learned
                </h3>
                <ul className="space-y-1.5">
                  {onboardingContext.map((ctx, i) => (
                    <li key={i} className="text-sm text-[--anticipy-text-secondary] flex items-start gap-2">
                      <span className="text-[#6C5CE7] mt-0.5 shrink-0">&#8226;</span>
                      {ctx}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => setOnboardingContext([])}
                  className="text-xs text-[#6C5CE7] hover:underline mt-3"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Feed */}
            {feedItems.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-xs font-medium uppercase tracking-wider text-[--anticipy-text-secondary] px-1">
                  Recent Activity
                </h2>

                {/* Feed cards — newest first */}
                <div className="space-y-2.5">
                  {feedItems.map((item) => (
                    <FeedCard
                      key={item.id}
                      item={item}
                      onConfirm={confirmIntent}
                      onDismiss={dismissIntent}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Empty state per bible */}
            {feedItems.length === 0 && !listening && (
              <div className="flex flex-col items-center gap-3 pt-4">
                <p className="text-sm italic text-[#8E8E93] text-center">
                  Anticipy is thinking. That&apos;s a good sign.
                </p>
                <p className="text-sm text-[--anticipy-text-secondary] text-center max-w-xs">
                  Start talking, or send a message below. Anticipy will get to
                  work.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="border-t border-[--anticipy-card-border] bg-[--anticipy-bg] px-4 sm:px-6 py-4">
        <div className="max-w-2xl mx-auto">
          <div className="relative flex items-center">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message Anticipy..."
              className="w-full h-11 px-4 pr-12 rounded-xl bg-[--anticipy-card] border border-[--anticipy-card-border] text-sm text-[--anticipy-text] placeholder:text-[--anticipy-text-secondary]/60 outline-none focus:border-[#6C5CE7]/50 focus:ring-2 focus:ring-[#6C5CE7]/20 transition-all"
              autoComplete="off"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || sending}
              className="absolute right-1.5 p-2 rounded-lg text-[--anticipy-text-secondary] hover:text-[--anticipy-text]/60 hover:bg-[#6C5CE7]/10 disabled:opacity-20 disabled:hover:bg-transparent transition-all"
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
