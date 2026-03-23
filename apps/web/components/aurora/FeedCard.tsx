import type { FeedItem } from "@/lib/feed-formatter";
import {
  Mail,
  MessageSquare,
  Phone,
  Globe,
  Radio,
  Mic,
  Zap,
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

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function FeedCard({ item }: { item: FeedItem }) {
  const channel = CHANNEL_ICONS[item.channel] || CHANNEL_ICONS.web;
  const Icon = channel.icon;

  return (
    <div className="rounded-xl border border-[--aurora-card-border] bg-[--aurora-card] p-4 transition-all hover:border-[#6C5CE7]/20">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 p-1.5 rounded-lg bg-[#6C5CE7]/10">
          <Icon className="w-3.5 h-3.5 text-[#6C5CE7]" />
        </div>
        <div className="flex-1 min-w-0">
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
            <p className="text-[15px] leading-relaxed text-[--aurora-text]">
              {item.summary}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2">
            <span className="text-[13px] text-[--aurora-text-secondary]">
              {timeAgo(item.timestamp)}
            </span>
            {item.status === "completed" && (
              <span className="text-[13px] text-emerald-500">
                &#10003;
              </span>
            )}
            {item.status === "failed" && (
              <span className="text-[13px] text-red-400">Failed</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
