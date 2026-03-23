"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Switch } from "@/components/ui/switch";
import {
  Loader2, Save, CheckCircle, Clock, Volume2,
  DollarSign, Mail, MessageSquare, Phone, Zap,
} from "lucide-react";

/* ─────────────────────────── Types ─────────────────────────── */
interface AuroraSettings {
  morning_checkin_time: string;
  autonomous_mode: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  preferred_channel: string;
  daily_digest: boolean;
  humor_level: string;
  daily_spend_cap: number;
}

const DEFAULT_SETTINGS: AuroraSettings = {
  morning_checkin_time: "08:00",
  autonomous_mode: false,
  quiet_hours_start: "22:00",
  quiet_hours_end: "07:00",
  preferred_channel: "sms",
  daily_digest: true,
  humor_level: "high",
  daily_spend_cap: 5.0,
};

const CHANNEL_OPTIONS = [
  { value: "sms", label: "SMS", icon: MessageSquare },
  { value: "email", label: "Email", icon: Mail },
  { value: "voice", label: "Phone call", icon: Phone },
  { value: "whatsapp", label: "WhatsApp", icon: MessageSquare },
  { value: "telegram", label: "Telegram", icon: Zap },
];

const HUMOR_OPTIONS = [
  { value: "low", label: "Professional", desc: "Straight to the point. No jokes." },
  { value: "medium", label: "Balanced", desc: "A little personality. Just enough." },
  { value: "high", label: "Full Aurora", desc: "The way it was meant to be." },
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: userSettings } = await supabase
        .from("user_settings")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (userSettings) {
        setSettings({
          morning_checkin_time: userSettings.morning_checkin_time || DEFAULT_SETTINGS.morning_checkin_time,
          autonomous_mode: userSettings.autonomous_mode ?? DEFAULT_SETTINGS.autonomous_mode,
          quiet_hours_start: userSettings.quiet_hours_start || DEFAULT_SETTINGS.quiet_hours_start,
          quiet_hours_end: userSettings.quiet_hours_end || DEFAULT_SETTINGS.quiet_hours_end,
          preferred_channel: userSettings.proactive_channel || DEFAULT_SETTINGS.preferred_channel,
          daily_digest: userSettings.daily_digest ?? DEFAULT_SETTINGS.daily_digest,
          humor_level: userSettings.humor_level || DEFAULT_SETTINGS.humor_level,
          daily_spend_cap: userSettings.daily_spend_cap ?? DEFAULT_SETTINGS.daily_spend_cap,
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
      const agentUrl = process.env.NEXT_PUBLIC_AGENT_URL || "https://agent-production-1339.up.railway.app";
      const { data: { session } } = await supabase.auth.getSession();

      const res = await fetch(`${agentUrl}/aurora/settings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token && { Authorization: `Bearer ${session.access_token}` }),
        },
        body: JSON.stringify(settings),
      });

      if (!res.ok) {
        // Fallback: save directly to user_settings
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase
            .from("user_settings")
            .upsert({
              user_id: user.id,
              morning_checkin_time: settings.morning_checkin_time,
              autonomous_mode: settings.autonomous_mode,
              quiet_hours_start: settings.quiet_hours_start,
              quiet_hours_end: settings.quiet_hours_end,
              proactive_channel: settings.preferred_channel,
              daily_digest: settings.daily_digest,
              humor_level: settings.humor_level,
              daily_spend_cap: settings.daily_spend_cap,
            });
        }
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error("Save error:", err);
      setError("Couldn't save. Aurora is probably having a moment.");
      setTimeout(() => setError(null), 4000);
    }

    setSaving(false);
  };

  const updateSetting = <K extends keyof AuroraSettings>(key: K, value: AuroraSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-6 w-6 text-white/30 animate-spin" />
          <p className="text-sm text-white/20">Loading your preferences...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-20">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-white/30 mt-1">
          Tell Aurora how to behave. She might listen.
        </p>
      </div>

      {/* Settings Sections */}
      <div className="space-y-3">
        {/* Morning Check-in */}
        <SettingCard
          icon={Clock}
          title="Morning check-in"
          description="When should I wake you up? (Just kidding, I'm calling regardless)"
        >
          <input
            type="time"
            value={settings.morning_checkin_time}
            onChange={(e) => updateSetting("morning_checkin_time", e.target.value)}
            className="px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white outline-none focus:border-white/20 transition-all [color-scheme:dark]"
          />
        </SettingCard>

        {/* Autonomous Mode */}
        <SettingCard
          icon={Zap}
          title="Autonomous mode"
          description="Let Aurora act without asking. Warning: Aurora has good taste but strong opinions."
        >
          <Switch
            checked={settings.autonomous_mode}
            onCheckedChange={(checked) => updateSetting("autonomous_mode", checked)}
          />
        </SettingCard>

        {/* Quiet Hours */}
        <SettingCard
          icon={Volume2}
          title="Quiet hours"
          description="When should I shut up? (I'll still think about you, I just won't say anything)"
        >
          <div className="flex items-center gap-2">
            <input
              type="time"
              value={settings.quiet_hours_start}
              onChange={(e) => updateSetting("quiet_hours_start", e.target.value)}
              className="px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white outline-none focus:border-white/20 transition-all w-[120px] [color-scheme:dark]"
            />
            <span className="text-white/20 text-sm">to</span>
            <input
              type="time"
              value={settings.quiet_hours_end}
              onChange={(e) => updateSetting("quiet_hours_end", e.target.value)}
              className="px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white outline-none focus:border-white/20 transition-all w-[120px] [color-scheme:dark]"
            />
          </div>
        </SettingCard>

        {/* Channel Preference */}
        <SettingCard
          icon={MessageSquare}
          title="Preferred channel"
          description="How do you want me to bug you?"
        >
          <div className="flex flex-wrap gap-2">
            {CHANNEL_OPTIONS.map((ch) => {
              const isActive = settings.preferred_channel === ch.value;
              return (
                <button
                  key={ch.value}
                  onClick={() => updateSetting("preferred_channel", ch.value)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    isActive
                      ? "bg-white/10 text-white border border-white/20"
                      : "bg-white/[0.03] text-white/40 border border-white/[0.06] hover:bg-white/[0.06] hover:text-white/60"
                  }`}
                >
                  <ch.icon className="h-3 w-3" />
                  {ch.label}
                </button>
              );
            })}
          </div>
        </SettingCard>

        {/* Daily Digest */}
        <SettingCard
          icon={Mail}
          title="Daily digest"
          description="Get a summary of everything I did and learned. It's like a report card, but for me."
        >
          <Switch
            checked={settings.daily_digest}
            onCheckedChange={(checked) => updateSetting("daily_digest", checked)}
          />
        </SettingCard>

        {/* Humor Level */}
        <SettingCard
          icon={Volume2}
          title="Humor level"
          description="How much personality do you want? (Spoiler: you want high)"
        >
          <div className="flex flex-col gap-2 w-full sm:w-auto">
            {HUMOR_OPTIONS.map((h) => {
              const isActive = settings.humor_level === h.value;
              return (
                <button
                  key={h.value}
                  onClick={() => updateSetting("humor_level", h.value)}
                  className={`text-left px-3 py-2 rounded-lg transition-all ${
                    isActive
                      ? "bg-white/10 border border-white/20"
                      : "bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.05]"
                  }`}
                >
                  <span className={`text-xs font-medium ${isActive ? "text-white" : "text-white/50"}`}>
                    {h.label}
                  </span>
                  <p className={`text-[11px] mt-0.5 ${isActive ? "text-white/40" : "text-white/20"}`}>
                    {h.desc}
                  </p>
                </button>
              );
            })}
          </div>
        </SettingCard>

        {/* Daily Spend Cap */}
        <SettingCard
          icon={DollarSign}
          title="Daily spend cap"
          description="How much can Aurora spend per day? (Aurora promises to be responsible)"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm text-white/30">$</span>
            <input
              type="number"
              min="0.50"
              max="100"
              step="0.50"
              value={settings.daily_spend_cap}
              onChange={(e) => updateSetting("daily_spend_cap", parseFloat(e.target.value) || 0)}
              className="w-24 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white outline-none focus:border-white/20 transition-all"
            />
            <span className="text-xs text-white/20">/ day</span>
          </div>
        </SettingCard>
      </div>

      {/* Info text */}
      <p className="text-xs text-white/15 text-center">
        All of these can also be changed by just texting Aurora.
      </p>

      {/* Save Bar */}
      <div className="sticky bottom-4">
        <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06] backdrop-blur-xl">
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
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-black text-sm font-medium hover:bg-white/90 disabled:opacity-40 transition-all"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save changes
          </button>
        </div>
      </div>
    </div>
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
    <div className="px-4 py-4 rounded-xl bg-white/[0.02] border border-white/[0.04] hover:border-white/[0.08] transition-all">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 w-8 h-8 rounded-lg bg-white/[0.04] flex items-center justify-center shrink-0">
            <Icon className="h-4 w-4 text-white/30" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-white/90">{title}</h3>
            <p className="text-xs text-white/30 mt-0.5 leading-relaxed max-w-sm">
              {description}
            </p>
          </div>
        </div>
        <div className="sm:ml-auto shrink-0">
          {children}
        </div>
      </div>
    </div>
  );
}
