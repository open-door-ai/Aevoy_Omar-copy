"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Loader2,
  Save,
  CheckCircle,
  Clock,
  Volume2,
  DollarSign,
  Mail,
  MessageSquare,
  Phone,
  Zap,
  Smile,
} from "lucide-react";

/* ─────────────────────────── Types ─────────────────────────── */
interface AuroraSettings {
  morning_checkin_time: string;
  autonomous_mode: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  preferred_channel: string;
  daily_digest: boolean;
  daily_spend_cap: number;
  humor_level: string;
}

const DEFAULT_SETTINGS: AuroraSettings = {
  morning_checkin_time: "08:00",
  autonomous_mode: false,
  quiet_hours_start: "22:00",
  quiet_hours_end: "07:00",
  preferred_channel: "sms",
  daily_digest: true,
  daily_spend_cap: 5.0,
  humor_level: "medium",
};

const CHANNEL_OPTIONS = [
  { value: "sms", label: "SMS", icon: MessageSquare },
  { value: "email", label: "Email", icon: Mail },
  { value: "voice", label: "Call", icon: Phone },
  { value: "whatsapp", label: "WhatsApp", icon: MessageSquare },
  { value: "telegram", label: "Telegram", icon: Zap },
];

const HUMOR_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

/* ─────────────────────────── Component ─────────────────────────── */
export default function AuroraSettingsPage() {
  const [settings, setSettings] = useState<AuroraSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

  /* ─── Load settings ─── */
  const loadSettings = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: userSettings } = await supabase
        .from("user_settings")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (userSettings) {
        setSettings({
          morning_checkin_time:
            userSettings.morning_checkin_time ||
            DEFAULT_SETTINGS.morning_checkin_time,
          autonomous_mode:
            userSettings.autonomous_mode ??
            DEFAULT_SETTINGS.autonomous_mode,
          quiet_hours_start:
            userSettings.quiet_hours_start ||
            DEFAULT_SETTINGS.quiet_hours_start,
          quiet_hours_end:
            userSettings.quiet_hours_end ||
            DEFAULT_SETTINGS.quiet_hours_end,
          preferred_channel:
            userSettings.proactive_channel ||
            DEFAULT_SETTINGS.preferred_channel,
          daily_digest:
            userSettings.daily_digest ?? DEFAULT_SETTINGS.daily_digest,
          daily_spend_cap:
            userSettings.daily_spend_cap ??
            DEFAULT_SETTINGS.daily_spend_cap,
          humor_level:
            userSettings.humor_level ?? DEFAULT_SETTINGS.humor_level,
        });
      }
    } catch (err) {
      console.error("Settings load error:", err);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  /* ─── Save settings ─── */
  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("user_settings").upsert({
          user_id: user.id,
          morning_checkin_time: settings.morning_checkin_time,
          autonomous_mode: settings.autonomous_mode,
          quiet_hours_start: settings.quiet_hours_start,
          quiet_hours_end: settings.quiet_hours_end,
          proactive_channel: settings.preferred_channel,
          daily_digest: settings.daily_digest,
          daily_spend_cap: settings.daily_spend_cap,
          humor_level: settings.humor_level,
        });
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error("Save error:", err);
      setError("Couldn't save your settings. Try again.");
      setTimeout(() => setError(null), 4000);
    }

    setSaving(false);
  };

  const updateSetting = <K extends keyof AuroraSettings>(
    key: K,
    value: AuroraSettings[K]
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-6 w-6 text-[--aurora-text-secondary] animate-spin" />
          <p className="text-sm text-[--aurora-text-secondary]">
            Loading preferences...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-10 pb-28">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[--aurora-text]">
          Settings
        </h1>
        <p className="text-sm text-[--aurora-text-secondary] mt-2">
          Control how Aurora communicates with you.
        </p>
      </div>

      {/* Settings Sections */}
      <div className="space-y-3">
        {/* 1. Morning Check-in */}
        <SettingCard
          icon={Clock}
          title="Morning check-in"
          description="When Aurora should send your daily briefing."
        >
          <input
            type="time"
            value={settings.morning_checkin_time}
            onChange={(e) =>
              updateSetting("morning_checkin_time", e.target.value)
            }
            className="px-3 py-2 rounded-lg bg-[--aurora-card] border border-[--aurora-card-border] text-sm text-[--aurora-text] outline-none focus:border-[#6C5CE7]/50 focus:ring-2 focus:ring-[#6C5CE7]/20 transition-all"
          />
        </SettingCard>

        {/* 2. Autonomous Mode */}
        <SettingCard
          icon={Zap}
          title="Autonomous mode"
          description="Let Aurora take actions without asking for confirmation first."
        >
          <Toggle
            checked={settings.autonomous_mode}
            onChange={(checked) =>
              updateSetting("autonomous_mode", checked)
            }
          />
        </SettingCard>

        {/* 3. Quiet Hours */}
        <SettingCard
          icon={Volume2}
          title="Quiet hours"
          description="Aurora won't send proactive messages during these hours."
        >
          <div className="flex items-center gap-2">
            <input
              type="time"
              value={settings.quiet_hours_start}
              onChange={(e) =>
                updateSetting("quiet_hours_start", e.target.value)
              }
              className="px-3 py-2 rounded-lg bg-[--aurora-card] border border-[--aurora-card-border] text-sm text-[--aurora-text] outline-none focus:border-[#6C5CE7]/50 focus:ring-2 focus:ring-[#6C5CE7]/20 transition-all w-[120px]"
            />
            <span className="text-[--aurora-text-secondary] text-sm">
              to
            </span>
            <input
              type="time"
              value={settings.quiet_hours_end}
              onChange={(e) =>
                updateSetting("quiet_hours_end", e.target.value)
              }
              className="px-3 py-2 rounded-lg bg-[--aurora-card] border border-[--aurora-card-border] text-sm text-[--aurora-text] outline-none focus:border-[#6C5CE7]/50 focus:ring-2 focus:ring-[#6C5CE7]/20 transition-all w-[120px]"
            />
          </div>
        </SettingCard>

        {/* 4. Preferred Channel */}
        <SettingCard
          icon={MessageSquare}
          title="Preferred channel"
          description="How Aurora reaches you for proactive messages and alerts."
        >
          <div className="flex flex-wrap gap-2">
            {CHANNEL_OPTIONS.map((ch) => {
              const isActive = settings.preferred_channel === ch.value;
              return (
                <button
                  key={ch.value}
                  onClick={() =>
                    updateSetting("preferred_channel", ch.value)
                  }
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    isActive
                      ? "bg-[#6C5CE7] text-white border border-[#6C5CE7]"
                      : "bg-[--aurora-card] text-[--aurora-text-secondary] border border-[--aurora-card-border] hover:border-[#6C5CE7]/30 hover:text-[--aurora-text]"
                  }`}
                >
                  <ch.icon className="h-3 w-3" />
                  {ch.label}
                </button>
              );
            })}
          </div>
        </SettingCard>

        {/* 5. Daily Digest */}
        <SettingCard
          icon={Mail}
          title="Daily digest"
          description="Receive a daily summary of Aurora's activity and insights."
        >
          <Toggle
            checked={settings.daily_digest}
            onChange={(checked) =>
              updateSetting("daily_digest", checked)
            }
          />
        </SettingCard>

        {/* 6. Daily Spend Cap */}
        <SettingCard
          icon={DollarSign}
          title="Daily spend cap"
          description="Maximum amount Aurora can spend on your behalf per day."
        >
          <div className="flex items-center gap-2">
            <span className="text-sm text-[--aurora-text-secondary]">
              $
            </span>
            <input
              type="number"
              min="0.50"
              max="100"
              step="0.50"
              value={settings.daily_spend_cap}
              onChange={(e) =>
                updateSetting(
                  "daily_spend_cap",
                  parseFloat(e.target.value) || 0
                )
              }
              className="w-24 px-3 py-2 rounded-lg bg-[--aurora-card] border border-[--aurora-card-border] text-sm text-[--aurora-text] outline-none focus:border-[#6C5CE7]/50 focus:ring-2 focus:ring-[#6C5CE7]/20 transition-all"
            />
            <span className="text-xs text-[--aurora-text-secondary]">
              / day
            </span>
          </div>
        </SettingCard>

        {/* 7. Humor Level */}
        <SettingCard
          icon={Smile}
          title="Humor level"
          description="How much personality Aurora puts into responses."
        >
          <div className="flex gap-1 rounded-lg border border-[--aurora-card-border] p-0.5">
            {HUMOR_OPTIONS.map((opt) => {
              const isActive = settings.humor_level === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() =>
                    updateSetting("humor_level", opt.value)
                  }
                  className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
                    isActive
                      ? "bg-[#6C5CE7] text-white"
                      : "text-[--aurora-text-secondary] hover:text-[--aurora-text]"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </SettingCard>
      </div>

      {/* Footer hint */}
      <p className="text-xs text-[--aurora-text-secondary]/70 text-center">
        You can also change these by messaging Aurora directly.
      </p>

      {/* Save Bar */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-full max-w-xl px-4 z-50">
        <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-[--aurora-card] border border-[--aurora-card-border] backdrop-blur-xl shadow-2xl">
          <div className="flex items-center gap-2">
            {saved && (
              <>
                <CheckCircle className="h-4 w-4 text-emerald-400" />
                <span className="text-sm text-emerald-400">Saved</span>
              </>
            )}
            {error && (
              <span className="text-sm text-red-400">{error}</span>
            )}
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#6C5CE7] text-white text-sm font-medium hover:bg-[#6C5CE7]/90 disabled:opacity-40 transition-all"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Toggle ─────────────────────────── */
function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? "bg-[#6C5CE7]" : "bg-[--aurora-card-border]"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

/* ─────────────────────────── Setting Card ─────────────────────────── */
function SettingCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Clock;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-5 py-5 rounded-xl bg-[--aurora-card] border border-[--aurora-card-border] hover:border-[#6C5CE7]/15 transition-all">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 w-9 h-9 rounded-lg bg-[#6C5CE7]/10 flex items-center justify-center shrink-0">
            <Icon className="h-4 w-4 text-[#6C5CE7]" />
          </div>
          <div>
            <h3 className="text-[15px] font-medium text-[--aurora-text]">
              {title}
            </h3>
            <p className="text-[13px] text-[--aurora-text-secondary] mt-1 leading-relaxed max-w-md">
              {description}
            </p>
          </div>
        </div>
        <div className="sm:ml-auto shrink-0">{children}</div>
      </div>
    </div>
  );
}
