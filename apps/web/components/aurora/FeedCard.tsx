"use client";

import { useState } from "react";
import type { FeedItem } from "@/lib/feed-formatter";
import {
  Mail,
  MessageSquare,
  Phone,
  Globe,
  Radio,
  Mic,
  Zap,
  RotateCcw,
} from "lucide-react";

const CHANNEL_ICONS: Record<
  string,
  { icon: typeof Mail; label: string }
> = {
  email: { icon: Mail, label: "Email" },
  sms: { icon: MessageSquare, label: "SMS" },
  voice: { icon: Phone, label: "Call" },
  web: { icon: Globe, label: "Web" },
  telegram: { icon: Radio, label: "Telegram" },
  whatsapp: { icon: MessageSquare, label: "WhatsApp" },
  microphone: { icon: Mic, label: "Listening" },
  proactive: { icon: Zap, label: "Aurora" },
};

const TRUNCATE_LENGTH = 280;

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  // < 1 min
  if (diff < 60_000) return "Just now";

  // 1-59 min
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;

  // 1-23 hr
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hr ago`;

  // Yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear()
  ) {
    return `Yesterday at ${date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })}`;
  }

  // 2-6 days ago
  if (diff < 604_800_000) {
    const dayName = date.toLocaleDateString("en-US", { weekday: "long" });
    const time = date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return `${dayName} at ${time}`;
  }

  // 7+ days
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function FeedCard({
  item,
  onRetry,
}: {
  item: FeedItem;
  onRetry?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isUser = item.isUser === true;
  const channel = CHANNEL_ICONS[item.channel] || CHANNEL_ICONS.web;
  const Icon = channel.icon;

  const isLong = item.summary.length > TRUNCATE_LENGTH;
  const displayText =
    isLong && !expanded
      ? item.summary.slice(0, TRUNCATE_LENGTH) + "..."
      : item.summary;

  // User message: lighter background, no channel icon
  if (isUser) {
    return (
      <div className="rounded-xl bg-[--aurora-card]/50 border border-[--aurora-card-border]/50 p-4 transition-all">
        <p className="text-[15px] leading-relaxed text-[--aurora-text]/80">
          {displayText}
        </p>
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[13px] text-[#6C5CE7] mt-1 hover:underline"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
        <div className="flex items-center gap-2 mt-2">
          <span className="text-[13px] text-[--aurora-text-secondary]">
            {formatTime(item.timestamp)}
          </span>
        </div>
      </div>
    );
  }

  // Aurora response: card styling with channel icon
  return (
    <div className="rounded-xl border border-[--aurora-card-border] bg-[--aurora-card] p-4 transition-all hover:border-[#6C5CE7]/20">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 p-1.5 rounded-lg bg-[#6C5CE7]/10 shrink-0">
          <Icon className="w-3.5 h-3.5 text-[#6C5CE7]" />
        </div>
        <div className="flex-1 min-w-0">
          {/* Processing state: three pulsing dots */}
          {item.status === "processing" && !item.summary ? (
            <div className="flex gap-1.5 py-1">
              <span
                className="w-1.5 h-1.5 rounded-full bg-[#8E8E93] animate-bounce"
                style={{ animationDelay: "0ms" }}
              />
              <span
                className="w-1.5 h-1.5 rounded-full bg-[#8E8E93] animate-bounce"
                style={{ animationDelay: "150ms" }}
              />
              <span
                className="w-1.5 h-1.5 rounded-full bg-[#8E8E93] animate-bounce"
                style={{ animationDelay: "300ms" }}
              />
            </div>
          ) : (
            <>
              <p className="text-[15px] leading-relaxed text-[--aurora-text]">
                {displayText}
              </p>
              {isLong && (
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="text-[13px] text-[#6C5CE7] mt-1 hover:underline"
                >
                  {expanded ? "Show less" : "Show more"}
                </button>
              )}
            </>
          )}
          <div className="flex items-center gap-2 mt-2">
            <span className="text-[13px] text-[--aurora-text-secondary]">
              {formatTime(item.timestamp)}
            </span>
            {item.status === "completed" && (
              <span className="text-[13px] text-emerald-500">&#10003;</span>
            )}
            {item.status === "failed" && (
              <button
                onClick={onRetry}
                className="inline-flex items-center gap-1 text-[13px] text-red-400 hover:text-red-300 transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                Tap to retry
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Skeleton Card for Loading State ─── */
export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-[--aurora-card-border] bg-[--aurora-card] p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 w-[30px] h-[30px] rounded-lg bg-[--aurora-card-border] animate-shimmer" />
        <div className="flex-1 space-y-2.5">
          <div className="h-4 w-3/4 rounded bg-[--aurora-card-border] animate-shimmer" />
          <div className="h-4 w-1/2 rounded bg-[--aurora-card-border] animate-shimmer" />
          <div className="h-3 w-1/4 rounded bg-[--aurora-card-border] animate-shimmer" />
        </div>
      </div>
    </div>
  );
}
