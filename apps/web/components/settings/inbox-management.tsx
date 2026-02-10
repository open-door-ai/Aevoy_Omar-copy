"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Mail, Bell, Trash2, Calendar, Phone, Sparkles, ChevronDown, ChevronUp, Inbox, CheckCircle, XCircle, Clock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";

interface InboxSettings {
  autonomyLevel: number;
  enabled: boolean;
  monitorInbox: boolean;
  deleteSpam: boolean;
  respondToSimple: boolean;
  scheduleMeetings: boolean;
  callForComplex: boolean;
  aiSignatureEnabled: boolean;
  aiSignatureText: string;
  userRules: string[];
  notifyDailyDigest: boolean;
  notifyUrgentImmediately: boolean;
  maxEmailsPerDay: number;
}

interface QueueStats {
  pending: number;
  approved: number;
  rejected: number;
}

const autonomyPresets = [
  {
    level: 0,
    label: "Notify Only",
    description: "I'll tell you about important emails but won't take action.",
    icon: Bell,
    color: "from-slate-400 to-slate-500",
  },
  {
    level: 25,
    label: "Handle Simple",
    description: "I'll delete spam and organize newsletters.",
    icon: Trash2,
    color: "from-blue-400 to-blue-500",
  },
  {
    level: 50,
    label: "Most Emails",
    description: "I'll respond to routine emails and schedule meetings.",
    icon: Mail,
    color: "from-indigo-400 to-indigo-500",
  },
  {
    level: 75,
    label: "High Autonomy",
    description: "I'll handle almost everything. I'll call for complex decisions.",
    icon: Calendar,
    color: "from-violet-400 to-violet-500",
  },
  {
    level: 100,
    label: "Full Autonomy",
    description: "I run your inbox completely and learn from your feedback.",
    icon: Sparkles,
    color: "from-amber-400 to-amber-500",
  },
];

export default function InboxManagementSettings() {
  const [settings, setSettings] = useState<InboxSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [newRule, setNewRule] = useState("");
  const [stats, setStats] = useState<QueueStats>({ pending: 0, approved: 0, rejected: 0 });
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    loadSettings();
    loadQueueStats();
  }, []);

  const loadSettings = async () => {
    try {
      const res = await fetch("/api/inbox/settings");
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
      }
    } catch (err) {
      console.error("Failed to load inbox settings:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadQueueStats = async () => {
    try {
      const res = await fetch("/api/inbox/queue?status=all");
      if (res.ok) {
        const data = await res.json();
        setStats(data.stats);
      }
    } catch (err) {
      console.error("Failed to load queue stats:", err);
    }
  };

  const handleSave = async () => {
    if (!settings) return;
    
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/inbox/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });

      if (res.ok) {
        setMessage({ type: "success", text: "Inbox settings saved" });
      } else {
        throw new Error("Failed to save");
      }
    } catch (err) {
      setMessage({ type: "error", text: "Failed to save settings" });
    } finally {
      setSaving(false);
    }
  };

  const handleAddRule = () => {
    if (!settings || !newRule.trim()) return;
    if (settings.userRules.includes(newRule.trim())) return;
    
    setSettings({
      ...settings,
      userRules: [...settings.userRules, newRule.trim()],
    });
    setNewRule("");
  };

  const handleRemoveRule = (rule: string) => {
    if (!settings) return;
    setSettings({
      ...settings,
      userRules: settings.userRules.filter(r => r !== rule),
    });
  };

  const getCurrentPreset = () => {
    if (!settings) return autonomyPresets[0];
    return autonomyPresets.find(p => p.level === settings.autonomyLevel) || autonomyPresets[0];
  };

  const preset = getCurrentPreset();
  const Icon = preset.icon;

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-gray-200 rounded w-1/3"></div>
            <div className="h-8 bg-gray-200 rounded"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!settings) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Inbox className="w-5 h-5" />
          <CardTitle>Inbox Management</CardTitle>
        </div>
        <CardDescription>
          Let your AI assistant manage your email inbox autonomously
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {message && (
          <div className={`p-3 rounded-lg text-sm ${
            message.type === "success" 
              ? "bg-green-50 text-green-700 border border-green-200" 
              : "bg-red-50 text-red-700 border border-red-200"
          }`}>
            {message.text}
          </div>
        )}

        {/* Enable Toggle */}
        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
          <div>
            <h4 className="font-medium">Enable AI Inbox Manager</h4>
            <p className="text-sm text-gray-500">
              {settings.enabled 
                ? "Your AI checks your inbox every 5 minutes"
                : "Turn on to let AI manage your emails"
              }
            </p>
          </div>
          <Switch 
            checked={settings.enabled} 
            onCheckedChange={(checked) => setSettings({ ...settings, enabled: checked })}
          />
        </div>

        {settings.enabled && (
          <>
            {/* Queue Stats */}
            {stats.pending > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Clock className="w-5 h-5 text-amber-600" />
                    <div>
                      <p className="font-medium text-amber-900">{stats.pending} emails need your review</p>
                      <p className="text-sm text-amber-700">Your AI queued these for your approval</p>
                    </div>
                  </div>
                  <Link href="/dashboard/inbox-queue">
                    <Button size="sm" variant="outline" className="border-amber-300">
                      Review Queue
                    </Button>
                  </Link>
                </div>
              </div>
            )}

            {/* Autonomy Slider */}
            <div className="space-y-4">
              <Label className="text-sm font-medium">
                Autonomy Level: {preset.label}
              </Label>
              
              <div className="relative">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="25"
                  value={settings.autonomyLevel}
                  onChange={(e) => {
                    const level = parseInt(e.target.value);
                    setSettings({
                      ...settings,
                      autonomyLevel: level,
                      monitorInbox: level >= 0,
                      deleteSpam: level >= 25,
                      respondToSimple: level >= 50,
                      scheduleMeetings: level >= 50,
                      callForComplex: level >= 75,
                    });
                  }}
                  className="w-full h-3 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${settings.autonomyLevel}%, #e5e7eb ${settings.autonomyLevel}%, #e5e7eb 100%)`
                  }}
                />
                <div className="flex justify-between text-xs text-gray-400 mt-2">
                  <span>Notify</span>
                  <span>Simple</span>
                  <span>Most</span>
                  <span>High</span>
                  <span>Full</span>
                </div>
              </div>

              {/* Current Level Card */}
              <motion.div 
                key={settings.autonomyLevel}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`p-4 rounded-xl bg-gradient-to-r ${preset.color} text-white`}
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-white/20 rounded-lg">
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-semibold">{preset.label}</h4>
                    <p className="text-sm text-white/90 mt-1">{preset.description}</p>
                  </div>
                </div>
              </motion.div>
            </div>

            {/* What Your AI Will Do */}
            <div className="space-y-3">
              <h4 className="font-medium text-sm">Your AI will:</h4>
              <div className="space-y-2">
                {[
                  { icon: Bell, label: "Monitor your inbox", enabled: settings.monitorInbox },
                  { icon: Trash2, label: "Delete obvious spam", enabled: settings.deleteSpam },
                  { icon: Mail, label: "Respond to simple emails", enabled: settings.respondToSimple },
                  { icon: Calendar, label: "Schedule meetings", enabled: settings.scheduleMeetings },
                  { icon: Phone, label: "Call you for complex decisions", enabled: settings.callForComplex },
                ].map((item, i) => (
                  <div 
                    key={i} 
                    className={`flex items-center gap-3 text-sm ${item.enabled ? 'text-gray-700' : 'text-gray-400'}`}
                  >
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                      item.enabled ? 'bg-green-100 text-green-600' : 'bg-gray-200'
                    }`}>
                      {item.enabled ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                    </div>
                    <item.icon className="w-4 h-4" />
                    {item.label}
                  </div>
                ))}
              </div>
            </div>

            {/* Advanced Settings Toggle */}
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              Advanced Settings
            </button>

            {/* Advanced Settings */}
            <AnimatePresence>
              {showAdvanced && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="space-y-4 overflow-hidden"
                >
                  {/* AI Signature */}
                  <div className="p-4 bg-gray-50 rounded-lg space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="font-medium">AI Signature</Label>
                      <Switch 
                        checked={settings.aiSignatureEnabled} 
                        onCheckedChange={(checked) => setSettings({ ...settings, aiSignatureEnabled: checked })}
                      />
                    </div>
                    {settings.aiSignatureEnabled && (
                      <Input
                        value={settings.aiSignatureText}
                        onChange={(e) => setSettings({ ...settings, aiSignatureText: e.target.value })}
                        placeholder="How should your AI sign emails?"
                      />
                    )}
                    <p className="text-xs text-gray-500">
                      Added to emails sent on your behalf
                    </p>
                  </div>

                  {/* Special Instructions */}
                  <div className="p-4 bg-gray-50 rounded-lg space-y-3">
                    <Label className="font-medium">Special Instructions</Label>
                    <p className="text-xs text-gray-500">
                      Tell your AI how to handle specific situations. These become part of its prompt.
                    </p>
                    <div className="space-y-2">
                      {settings.userRules.map((rule, i) => (
                        <div key={i} className="flex items-center gap-2 bg-white px-3 py-2 rounded-lg text-sm">
                          <span className="flex-1">{rule}</span>
                          <button 
                            onClick={() => handleRemoveRule(rule)}
                            className="text-gray-400 hover:text-red-500"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        value={newRule}
                        onChange={(e) => setNewRule(e.target.value)}
                        placeholder="E.g., Always forward emails from my boss immediately"
                        onKeyDown={(e) => e.key === 'Enter' && handleAddRule()}
                      />
                      <Button variant="outline" onClick={handleAddRule} disabled={!newRule.trim()}>
                        Add
                      </Button>
                    </div>
                  </div>

                  {/* Daily Limit */}
                  <div className="p-4 bg-gray-50 rounded-lg space-y-3">
                    <Label className="font-medium">Daily Email Limit</Label>
                    <Input
                      type="number"
                      value={settings.maxEmailsPerDay}
                      onChange={(e) => setSettings({ ...settings, maxEmailsPerDay: parseInt(e.target.value) || 50 })}
                      min={10}
                      max={200}
                    />
                    <p className="text-xs text-gray-500">
                      Maximum emails your AI will process per day
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Save Button */}
            <Button 
              onClick={handleSave} 
              disabled={saving}
              className="w-full"
            >
              {saving ? "Saving..." : "Save Inbox Settings"}
            </Button>
          </>
        )}

        {/* Queue Link */}
        {settings.enabled && (
          <div className="pt-4 border-t">
            <Link href="/dashboard/inbox-queue">
              <Button variant="outline" className="w-full">
                <Inbox className="w-4 h-4 mr-2" />
                View Email Queue ({stats.pending} pending)
              </Button>
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
