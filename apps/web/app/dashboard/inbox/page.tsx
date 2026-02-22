"use client";

import { useEffect, useState, useCallback } from "react";
import { Mail, CheckCircle, XCircle, Loader2, Settings2, Inbox, RefreshCw, Trash2, Reply, Calendar, Clock } from "lucide-react";

interface QueueItem {
  id: string;
  from_addr: string;
  subject: string;
  body_preview: string;
  category: string;
  confidence: number;
  suggested_action: string;
  suggested_reply: string;
  created_at: string;
}

interface LogItem {
  id: string;
  from_addr: string;
  subject: string;
  category: string;
  action_taken: string;
  was_autonomous: boolean;
  created_at: string;
}

interface InboxSettings {
  enabled: boolean;
  autonomy_level: number;
  check_interval_minutes: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  spam: "bg-red-500/15 text-red-400",
  promotional: "bg-amber-500/15 text-amber-400",
  simple: "bg-blue-500/15 text-blue-400",
  meeting: "bg-purple-500/15 text-purple-400",
  urgent: "bg-orange-500/15 text-orange-400",
  complex: "bg-indigo-500/15 text-indigo-400",
  personal: "bg-green-500/15 text-green-400",
};

const ACTION_ICON: Record<string, React.ReactNode> = {
  delete: <Trash2 className="w-3.5 h-3.5" />,
  reply: <Reply className="w-3.5 h-3.5" />,
  schedule_meeting: <Calendar className="w-3.5 h-3.5" />,
  archive: <Inbox className="w-3.5 h-3.5" />,
};

const INTERVAL_OPTIONS = [
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 60, label: "1 hour" },
  { value: 120, label: "2 hours" },
];

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export default function InboxPage() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [log, setLog] = useState<LogItem[]>([]);
  const [settings, setSettings] = useState<InboxSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [autonomy, setAutonomy] = useState(25);
  const [enabled, setEnabled] = useState(false);
  const [checkInterval, setCheckInterval] = useState(30);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [qRes, lRes, sRes] = await Promise.all([
        fetch("/api/inbox/queue"),
        fetch("/api/inbox/log"),
        fetch("/api/inbox/settings"),
      ]);
      const [qData, lData, sData] = await Promise.all([qRes.json(), lRes.json(), sRes.json()]);
      setQueue(qData.queue || []);
      setLog(lData.items || []);
      const s = sData as InboxSettings | null;
      if (s) {
        setSettings(s);
        setAutonomy(s.autonomy_level ?? 25);
        setEnabled(s.enabled ?? false);
        setCheckInterval(s.check_interval_minutes ?? 30);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleDecision = async (id: string, decision: "approved" | "rejected") => {
    setActionLoading(id);
    try {
      await fetch("/api/inbox/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queueId: id, decision }),
      });
      setQueue((prev) => prev.filter((item) => item.id !== id));
    } catch (e) {
      console.error(e);
    } finally {
      setActionLoading(null);
    }
  };

  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);

  const saveSettings = async () => {
    setSavingSettings(true);
    setSaveError("");
    setSaveSuccess(false);
    try {
      const res = await fetch("/api/inbox/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, autonomyLevel: autonomy, checkIntervalMinutes: checkInterval }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSaveError(data.error || "Failed to save settings");
        return;
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
      await fetchAll();
    } catch (e) {
      console.error(e);
      setSaveError("Failed to save settings — please try again");
    } finally {
      setSavingSettings(false);
    }
  };

  const autonomyLabel = autonomy === 0
    ? "Notify only"
    : autonomy <= 25
    ? "Delete spam"
    : autonomy <= 50
    ? "Auto-reply to simple"
    : "Full auto";

  const intervalLabel = checkInterval < 60
    ? `${checkInterval} minutes`
    : checkInterval === 60 ? "1 hour" : "2 hours";

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Loading inbox…
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Mail className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold">Inbox</h1>
          {queue.length > 0 && (
            <span className="bg-primary text-primary-foreground text-xs font-bold px-2 py-0.5 rounded-full">
              {queue.length} pending
            </span>
          )}
        </div>
        <button
          onClick={fetchAll}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* AI Settings card */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-muted-foreground" />
            <span className="font-semibold text-sm">AI Email Management</span>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-xs text-muted-foreground">{enabled ? "On" : "Off"}</span>
            <div
              onClick={() => setEnabled(!enabled)}
              className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${
                enabled ? "bg-primary" : "bg-muted"
              }`}
            >
              <div
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  enabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </div>
          </label>
        </div>

        {enabled && (
          <div className="space-y-4">
            {/* Autonomy level */}
            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                <span>Autonomy level</span>
                <span className="font-medium text-foreground">{autonomyLabel}</span>
              </div>
              <input
                type="range"
                min={0}
                max={75}
                step={25}
                value={autonomy}
                onChange={(e) => setAutonomy(parseInt(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none bg-muted accent-primary cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                <span>Notify only</span>
                <span>Delete spam</span>
                <span>Auto-reply</span>
                <span>Full auto</span>
              </div>
            </div>
            <div className="text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
              {autonomy === 0 && "AI reads your emails and sends you notifications — no automatic actions."}
              {autonomy === 25 && "AI automatically deletes spam and promotional emails. Everything else needs your approval."}
              {autonomy === 50 && "AI deletes spam and auto-replies to simple emails. Complex emails go to approval queue."}
              {autonomy === 75 && "AI manages your inbox fully — deletes spam, replies to simple emails, and schedules meetings automatically."}
            </div>

            {/* Check interval */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Check inbox every</span>
              </div>
              <div className="flex gap-2">
                {INTERVAL_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setCheckInterval(opt.value)}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                      checkInterval === opt.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-muted/30 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5">
                AI will check your connected email every {intervalLabel} quietly in the background.
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={saveSettings}
            disabled={savingSettings}
            className="text-sm font-medium bg-primary text-primary-foreground px-4 py-1.5 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {savingSettings ? "Saving…" : saveSuccess ? "✓ Saved" : "Save settings"}
          </button>
          {saveError && (
            <span className="text-xs text-red-500">{saveError}</span>
          )}
        </div>
      </div>

      {/* Pending Approval Queue */}
      {queue.length > 0 ? (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border bg-muted/30">
            <h2 className="font-semibold text-sm">Pending Approval ({queue.length})</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Review and approve the AI's suggested actions before they run</p>
          </div>
          <div className="divide-y divide-border">
            {queue.map((item) => (
              <div key={item.id} className="px-5 py-4 space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">{item.from_addr}</span>
                      {item.category && (
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${CATEGORY_COLORS[item.category] || "bg-muted text-muted-foreground"}`}>
                          {item.category}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground truncate">{item.subject}</p>
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(item.created_at)}</span>
                </div>
                {item.body_preview && (
                  <p className="text-xs text-muted-foreground line-clamp-2 bg-muted/40 rounded-lg px-3 py-2">
                    {item.body_preview}
                  </p>
                )}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {ACTION_ICON[item.suggested_action] || <Mail className="w-3.5 h-3.5" />}
                    <span>AI suggests: <span className="text-foreground font-medium">{item.suggested_action?.replace(/_/g, " ")}</span></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleDecision(item.id, "rejected")}
                      disabled={actionLoading === item.id}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Reject
                    </button>
                    <button
                      onClick={() => handleDecision(item.id, "approved")}
                      disabled={actionLoading === item.id}
                      className="flex items-center gap-1 text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors px-3 py-1 rounded-lg"
                    >
                      {actionLoading === item.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CheckCircle className="w-3.5 h-3.5" />
                      )}
                      Approve
                    </button>
                  </div>
                </div>
                {item.suggested_reply && (
                  <div className="text-xs bg-muted/40 rounded-lg px-3 py-2 border-l-2 border-primary/40">
                    <span className="text-muted-foreground">Draft reply: </span>{item.suggested_reply}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card px-5 py-8 text-center">
          <CheckCircle className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm font-medium text-foreground">No pending approvals</p>
          <p className="text-xs text-muted-foreground mt-1">
            {enabled
              ? `Your inbox is up to date. AI checks every ${intervalLabel}.`
              : "Enable AI email management above to get started."}
          </p>
        </div>
      )}

      {/* Activity Log */}
      {log.length > 0 && (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border bg-muted/30">
            <h2 className="font-semibold text-sm">Recent Activity</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Actions taken on your inbox in the last 24h</p>
          </div>
          <div className="divide-y divide-border">
            {log.map((item) => (
              <div key={item.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium truncate">{item.from_addr}</span>
                    {item.category && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${CATEGORY_COLORS[item.category] || "bg-muted text-muted-foreground"}`}>
                        {item.category}
                      </span>
                    )}
                    {item.was_autonomous && (
                      <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">Auto</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{item.subject}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-muted-foreground capitalize">{item.action_taken}</span>
                  <span className="text-[10px] text-muted-foreground">{timeAgo(item.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Connect email prompt */}
      {!settings && (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 px-5 py-8 text-center">
          <Mail className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm font-medium">Connect your email to get started</p>
          <p className="text-xs text-muted-foreground mt-1 mb-4">
            Connect Gmail, Outlook, or any email account so Aevoy can manage your inbox
          </p>
          <a
            href="/dashboard/apps"
            className="inline-flex items-center gap-1.5 text-sm font-medium bg-primary text-primary-foreground px-4 py-2 rounded-xl hover:bg-primary/90 transition-colors"
          >
            <Mail className="w-4 h-4" />
            Connect Email
          </a>
        </div>
      )}
    </div>
  );
}
