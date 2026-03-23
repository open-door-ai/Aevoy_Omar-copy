"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import {
  Loader2, Phone, MessageSquare, CheckCircle,
  ArrowRight, Send as SendIcon,
} from "lucide-react";

/* ─────────────────────────── Types ─────────────────────────── */
type OnboardingPhase = "calling" | "missed" | "texting" | "complete";

interface LearnedItem {
  label: string;
  value: string;
}

/* ─────────────────────────── Component ─────────────────────────── */
export default function AuroraOnboarding() {
  const router = useRouter();
  const supabase = createClient();

  const [phase, setPhase] = useState<OnboardingPhase>("calling");
  const [callElapsed, setCallElapsed] = useState(0);
  const [textInput, setTextInput] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<Array<{ role: "user" | "aurora"; text: string }>>([]);
  const [learned, setLearned] = useState<LearnedItem[]>([]);
  const [onboardingComplete, setOnboardingComplete] = useState(false);

  /* ─── Check if onboarding is already done ─── */
  useEffect(() => {
    async function check() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("onboarding_completed, display_name, timezone, phone_number")
        .eq("id", user.id)
        .single();

      if (profile?.onboarding_completed) {
        setOnboardingComplete(true);
        setPhase("complete");

        // Build learned items from profile
        const items: LearnedItem[] = [];
        if (profile.display_name) items.push({ label: "Name", value: profile.display_name });
        if (profile.timezone) items.push({ label: "Timezone", value: profile.timezone });
        if (profile.phone_number) items.push({ label: "Phone", value: profile.phone_number });
        setLearned(items);
      }
    }
    check();
  }, [supabase]);

  /* ─── Simulated call timer ─── */
  useEffect(() => {
    if (phase !== "calling") return;

    const interval = setInterval(() => {
      setCallElapsed((prev) => {
        // After 30 seconds, switch to missed state
        if (prev >= 30) {
          setPhase("missed");
          return prev;
        }
        return prev + 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [phase]);

  /* ─── Switch to text mode ─── */
  const switchToText = useCallback(() => {
    setPhase("texting");
    setMessages([
      {
        role: "aurora",
        text: "Hey! Since the call didn't work out, let's do this here. I just need to learn a few things about you. What's your name?",
      },
    ]);
  }, []);

  /* ─── Send text message ─── */
  const handleSendText = async () => {
    if (!textInput.trim() || sending) return;
    const text = textInput.trim();
    setTextInput("");
    setSending(true);

    setMessages((prev) => [...prev, { role: "user", text }]);

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
          context: "onboarding",
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.response) {
          setMessages((prev) => [...prev, { role: "aurora", text: data.response }]);
        }

        // Check if onboarding is now complete
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("onboarding_completed, display_name, timezone, phone_number")
            .eq("id", user.id)
            .single();

          if (profile?.onboarding_completed) {
            const items: LearnedItem[] = [];
            if (profile.display_name) items.push({ label: "Name", value: profile.display_name });
            if (profile.timezone) items.push({ label: "Timezone", value: profile.timezone });
            if (profile.phone_number) items.push({ label: "Phone", value: profile.phone_number });
            setLearned(items);
            setTimeout(() => setPhase("complete"), 1500);
          }
        }
      }
    } catch (err) {
      console.error("Onboarding send error:", err);
      setMessages((prev) => [
        ...prev,
        { role: "aurora", text: "Something went sideways. Try again?" },
      ]);
    }

    setSending(false);
  };

  const handleTextKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendText();
    }
  };

  /* ─── Calling Phase ─── */
  if (phase === "calling") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-8">
        {/* Phone animation */}
        <div className="relative">
          <div className="w-20 h-20 rounded-full bg-white/[0.03] flex items-center justify-center animate-phone-ring">
            <Phone className="h-8 w-8 text-white/40" />
          </div>
          {/* Ripple rings */}
          <div className="absolute inset-0 rounded-full border border-white/10 animate-ripple" />
          <div className="absolute inset-0 rounded-full border border-white/5 animate-ripple-delayed" />
        </div>

        <div className="text-center space-y-2">
          <h2 className="text-lg font-semibold">Aurora is calling you now...</h2>
          <p className="text-sm text-white/30">
            Pick up. It&apos;ll be quick. Probably.
          </p>
          <p className="text-xs text-white/15 mt-4 tabular-nums">
            {Math.floor(callElapsed / 60)}:{String(callElapsed % 60).padStart(2, "0")}
          </p>
        </div>

        <button
          onClick={switchToText}
          className="text-sm text-white/30 hover:text-white/60 transition-all underline underline-offset-4"
        >
          Can&apos;t take a call right now? Do this over text instead.
        </button>

        {/* CSS-only phone ring animation */}
        <style jsx>{`
          @keyframes phone-ring {
            0%, 100% { transform: rotate(0deg); }
            10% { transform: rotate(-15deg); }
            20% { transform: rotate(15deg); }
            30% { transform: rotate(-10deg); }
            40% { transform: rotate(10deg); }
            50% { transform: rotate(0deg); }
          }
          @keyframes ripple {
            0% { transform: scale(1); opacity: 0.4; }
            100% { transform: scale(2.5); opacity: 0; }
          }
          @keyframes ripple-delayed {
            0% { transform: scale(1); opacity: 0.2; }
            100% { transform: scale(3); opacity: 0; }
          }
          .animate-phone-ring {
            animation: phone-ring 2s ease-in-out infinite;
          }
          .animate-ripple {
            animation: ripple 2s ease-out infinite;
          }
          .animate-ripple-delayed {
            animation: ripple-delayed 2s ease-out 0.5s infinite;
          }
        `}</style>
      </div>
    );
  }

  /* ─── Missed Call Phase ─── */
  if (phase === "missed") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
        <div className="w-16 h-16 rounded-full bg-white/[0.03] flex items-center justify-center">
          <Phone className="h-7 w-7 text-white/20" />
        </div>

        <div className="text-center space-y-2 max-w-sm">
          <h2 className="text-lg font-semibold">I tried calling.</h2>
          <p className="text-sm text-white/40">
            No worries. Let&apos;s do this over text instead. Same questions, fewer awkward silences.
          </p>
        </div>

        <button
          onClick={switchToText}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-black text-sm font-medium hover:bg-white/90 transition-all"
        >
          <MessageSquare className="h-4 w-4" />
          Continue over text
        </button>
      </div>
    );
  }

  /* ─── Texting Phase ─── */
  if (phase === "texting") {
    return (
      <div className="flex flex-col min-h-[60vh]">
        <div className="mb-6">
          <h2 className="text-lg font-semibold">Getting to know you</h2>
          <p className="text-sm text-white/30 mt-1">
            This won&apos;t take long. Aurora just needs the basics.
          </p>
        </div>

        {/* Messages */}
        <div className="flex-1 space-y-3 mb-6">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-white text-black rounded-br-md"
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
        </div>

        {/* Text input */}
        <div className="sticky bottom-0 pt-4 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a] to-transparent">
          <div className="relative">
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={handleTextKeyDown}
              placeholder="Type your answer..."
              className="w-full px-4 py-3 pr-12 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-white/20 outline-none focus:border-white/20 transition-all"
            />
            <button
              onClick={handleSendText}
              disabled={!textInput.trim() || sending}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg text-white/30 hover:text-white/60 disabled:opacity-20 transition-all"
            >
              <SendIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ─── Complete Phase ─── */
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
      <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
        <CheckCircle className="h-7 w-7 text-emerald-400" />
      </div>

      <div className="text-center space-y-2 max-w-sm">
        <h2 className="text-lg font-semibold">Here&apos;s what I learned</h2>
        <p className="text-sm text-white/40">
          Not bad for a first conversation. I&apos;ll get better at this.
        </p>
      </div>

      {/* Summary Card */}
      {learned.length > 0 && (
        <div className="w-full max-w-sm rounded-xl bg-white/[0.03] border border-white/[0.06] overflow-hidden">
          {learned.map((item, i) => (
            <div
              key={i}
              className={`flex items-center justify-between px-4 py-3 ${
                i < learned.length - 1 ? "border-b border-white/[0.04]" : ""
              }`}
            >
              <span className="text-xs text-white/30">{item.label}</span>
              <span className="text-sm text-white/80">{item.value}</span>
            </div>
          ))}
        </div>
      )}

      {learned.length === 0 && (
        <div className="w-full max-w-sm rounded-xl bg-white/[0.03] border border-white/[0.06] px-4 py-6 text-center">
          <p className="text-sm text-white/30">
            Profile data is being processed. Check back in a moment.
          </p>
        </div>
      )}

      <button
        onClick={() => router.push("/aurora")}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-black text-sm font-medium hover:bg-white/90 transition-all"
      >
        Go to your feed
        <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}
