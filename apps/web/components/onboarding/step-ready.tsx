"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FadeIn, GlassCard, motion, springs } from "@/components/ui/motion";

interface StepReadyProps {
  aiEmail: string;
  botName: string | null;
  onComplete: () => void;
}

const QUICK_START_SUGGESTIONS = [
  {
    text: "Find me a restaurant near downtown tonight",
    icon: "M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z",
  },
  {
    text: "What's on my schedule this week?",
    icon: "M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5",
  },
  {
    text: "Research the best laptop under $1000",
    icon: "M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25A2.25 2.25 0 0 1 5.25 3h13.5A2.25 2.25 0 0 1 21 5.25Z",
  },
];

export default function StepReady({ aiEmail, botName, onComplete }: StepReadyProps) {
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [copiedSuggestion, setCopiedSuggestion] = useState<number | null>(null);

  const handleCopyEmail = () => {
    navigator.clipboard.writeText(aiEmail);
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 2000);
  };

  const handleCopySuggestion = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedSuggestion(index);
    setTimeout(() => setCopiedSuggestion(null), 2000);
  };

  const displayName = botName || "Your AI";

  return (
    <div className="flex flex-col items-center max-w-lg mx-auto px-6">
      {/* Celebration checkmark */}
      <FadeIn delay={0}>
        <div className="flex justify-center mb-6">
          <div className="relative w-20 h-20">
            {/* Animated circle */}
            <svg className="w-20 h-20" viewBox="0 0 80 80">
              <motion.circle
                cx="40"
                cy="40"
                r="36"
                fill="none"
                stroke="#22c55e"
                strokeWidth="3"
                strokeLinecap="round"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.2, ease: "easeOut" }}
              />
              <motion.path
                d="M24 40 L35 51 L56 30"
                fill="none"
                stroke="#22c55e"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.7, ease: "easeOut" }}
              />
            </svg>
            {/* Subtle glow */}
            <motion.div
              className="absolute inset-0 rounded-full bg-green-400/20"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: [0.8, 1.3, 1], opacity: [0, 0.4, 0] }}
              transition={{ duration: 1.2, delay: 0.8 }}
            />
          </div>
        </div>
      </FadeIn>

      {/* Heading */}
      <FadeIn delay={0.3}>
        <h2 className="text-3xl font-bold text-gray-900 mb-2 text-center">
          {botName ? `${botName} is ready!` : "Your AI is ready!"}
        </h2>
        <p className="text-gray-600 mb-8 text-center">
          Send your first task by email, SMS, or voice
        </p>
      </FadeIn>

      {/* AI Email Card */}
      <FadeIn delay={0.5} className="w-full mb-8">
        <GlassCard className="p-6 text-center">
          <p className="text-sm text-gray-500 mb-3 font-medium">
            {displayName}&apos;s email address
          </p>
          <div className="bg-gray-900 rounded-xl px-5 py-4 mb-3">
            <p className="font-mono text-lg md:text-xl text-white tracking-wide break-all">
              {aiEmail}
            </p>
          </div>
          <button
            onClick={handleCopyEmail}
            className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 transition-colors group"
          >
            {copiedEmail ? (
              <>
                <svg
                  className="w-4 h-4 text-green-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                <span className="text-green-600 font-medium">Copied!</span>
              </>
            ) : (
              <>
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184"
                  />
                </svg>
                <span>Copy email address</span>
              </>
            )}
          </button>
          <p className="text-xs text-gray-400 mt-3">
            Send any email to this address to get started
          </p>
        </GlassCard>
      </FadeIn>

      {/* Quick Start Suggestions */}
      <FadeIn delay={0.7} className="w-full mb-8">
        <p className="text-sm font-medium text-gray-500 mb-3 text-center">
          Try sending one of these
        </p>
        <div className="space-y-2">
          {QUICK_START_SUGGESTIONS.map((suggestion, index) => (
            <motion.button
              key={index}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...springs.default, delay: 0.8 + index * 0.1 }}
              onClick={() => handleCopySuggestion(suggestion.text, index)}
              className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50 transition-all text-left group"
            >
              <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center group-hover:bg-gray-200 transition-colors">
                <svg
                  className="w-4.5 h-4.5 text-gray-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d={suggestion.icon} />
                </svg>
              </div>
              <span className="flex-1 text-sm text-gray-700">{suggestion.text}</span>
              <div className="flex-shrink-0">
                {copiedSuggestion === index ? (
                  <svg
                    className="w-4 h-4 text-green-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4.5 12.75l6 6 9-13.5"
                    />
                  </svg>
                ) : (
                  <svg
                    className="w-4 h-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184"
                    />
                  </svg>
                )}
              </div>
            </motion.button>
          ))}
        </div>
      </FadeIn>

      {/* CTA Button */}
      <FadeIn delay={1.1} className="w-full">
        <Button onClick={onComplete} className="w-full" size="lg">
          Go to Dashboard
        </Button>
      </FadeIn>
    </div>
  );
}
