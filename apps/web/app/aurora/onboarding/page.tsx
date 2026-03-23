"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Send as SendIcon, Loader2 } from "lucide-react";

/* ─────────────────────────── Component ─────────────────────────── */
export default function AuroraOnboarding() {
  const router = useRouter();
  const supabase = createClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<"loading" | "ready" | "chatting" | "done">("loading");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<Array<{ role: "user" | "aurora"; text: string }>>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  /* ─── Check if onboarding is already done, then show intro ─── */
  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("onboarding_completed")
        .eq("id", user.id)
        .single();

      if (profile?.onboarding_completed) {
        router.push("/aurora");
        return;
      }

      // Show "Setting up Aurora..." then transition to input
      setTimeout(() => {
        setPhase("ready");
      }, 2500);
    }
    init();
  }, [supabase, router]);

  /* ─── Auto-focus input when ready ─── */
  useEffect(() => {
    if (phase === "ready" || phase === "chatting") {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [phase]);

  /* ─── Scroll to bottom on new messages ─── */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* ─── Send message ─── */
  const handleSend = async () => {
    if (!input.trim() || sending) return;
    const text = input.trim();
    setInput("");
    setSending(true);

    if (phase === "ready") {
      setPhase("chatting");
    }

    setMessages((prev) => [...prev, { role: "user", text }]);

    try {
      const { data: { session } } = await supabase.auth.getSession();

      const res = await fetch("/api/aurora/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ message: text }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.response) {
          setMessages((prev) => [...prev, { role: "aurora", text: data.response }]);
        }
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "aurora", text: "Something went wrong. Try again?" },
        ]);
      }

      // Check if onboarding is now complete
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("onboarding_completed")
          .eq("id", user.id)
          .single();

        if (profile?.onboarding_completed) {
          setPhase("done");
          setTimeout(() => router.push("/aurora"), 2000);
        }
      }
    } catch (err) {
      console.error("Onboarding send error:", err);
      setMessages((prev) => [
        ...prev,
        { role: "aurora", text: "Couldn't connect. Try again." },
      ]);
    }

    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  };

  /* ─── Loading phase ─── */
  if (phase === "loading") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] gap-6">
        <div className="relative">
          <div className="w-10 h-10 rounded-full border-2 border-white/10 border-t-white/40 animate-spin" />
        </div>
        <p className="text-sm text-white/30 animate-pulse">Setting up Aurora...</p>
      </div>
    );
  }

  /* ─── Done phase ─── */
  if (phase === "done") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] gap-4">
        <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
          <span className="text-emerald-400 text-lg">&#10003;</span>
        </div>
        <p className="text-sm text-white/40">All set. Redirecting...</p>
      </div>
    );
  }

  /* ─── Ready / Chatting phase ─── */
  return (
    <div className="flex flex-col min-h-[70vh]">
      {/* Messages */}
      <div className="flex-1 space-y-4 mb-8">
        {phase === "ready" && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center pt-20 gap-4">
            <div className="w-12 h-12 rounded-full bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
              <span className="text-lg text-white/10">A</span>
            </div>
            <p className="text-sm text-white/40 text-center max-w-xs">
              Tell Aurora about yourself. Name, what you do, how you like to be reached.
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-white text-[#0a0a0a] rounded-br-md"
                  : "bg-white/[0.06] text-white/80 rounded-bl-md"
              }`}
            >
              {msg.text}
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="px-4 py-2.5 rounded-2xl rounded-bl-md bg-white/[0.06]">
              <div className="flex gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="sticky bottom-0 pt-4 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a] to-transparent">
        <div className="relative flex items-center">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Tell Aurora about yourself..."
            className="w-full h-11 px-4 pr-12 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-white/20 outline-none focus:border-white/15 focus:bg-white/[0.06] focus:ring-1 focus:ring-white/[0.06] transition-all"
            autoComplete="off"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="absolute right-1.5 p-2 rounded-lg text-white/30 hover:text-white/60 disabled:opacity-20 transition-all"
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
  );
}
