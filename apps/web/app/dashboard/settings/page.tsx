"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

interface Profile {
  id: string;
  username: string;
  email: string;
  display_name: string | null;
  timezone: string;
  subscription_tier: string;
  subscription_status: string | null;
  messages_used: number;
  messages_limit: number;
}

interface UserSettings {
  confirmation_mode: "always" | "unclear" | "risky" | "never";
  verification_method: "forward" | "virtual_number";
  agent_card_enabled: boolean;
  agent_card_limit_transaction: number;
  agent_card_limit_monthly: number;
  virtual_phone: string | null;
}

interface AgentCard {
  id: string;
  last_four: string;
  balance_cents: number;
  is_frozen: boolean;
  created_at: string;
}

export default function SettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [timezone, setTimezone] = useState("America/Los_Angeles");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  
  // New settings state
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [agentCard, setAgentCard] = useState<AgentCard | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [cardAction, setCardAction] = useState<string | null>(null);
  const [fundAmount, setFundAmount] = useState("");
  
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (data) {
        setProfile(data);
        setDisplayName(data.display_name || "");
        setTimezone(data.timezone || "America/Los_Angeles");
      }
    }

    async function loadSettings() {
      try {
        const response = await fetch("/api/settings");
        if (response.ok) {
          const data = await response.json();
          setSettings(data);
        }
      } catch (error) {
        console.error("Failed to load settings:", error);
      }
    }

    async function loadAgentCard() {
      try {
        const response = await fetch("/api/agent-card");
        if (response.ok) {
          const data = await response.json();
          setAgentCard(data);
        }
      } catch (error) {
        console.error("Failed to load agent card:", error);
      }
    }

    loadProfile();
    loadSettings();
    loadAgentCard();
  }, [supabase]);

  const handleSave = async () => {
    if (!profile) return;

    setSaving(true);
    setMessage(null);

    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: displayName || null,
        timezone,
        updated_at: new Date().toISOString(),
      })
      .eq("id", profile.id);

    if (error) {
      setMessage({ type: "error", text: "Failed to save settings" });
    } else {
      setMessage({ type: "success", text: "Settings saved successfully" });
    }

    setSaving(false);
  };

  const handleDeleteAccount = async () => {
    if (!confirm("Are you sure you want to delete all your data? This action cannot be undone.")) {
      return;
    }

    if (!confirm("This will permanently delete your account, all tasks, and all memories. Continue?")) {
      return;
    }

    setDeleting(true);

    try {
      // Call API to delete user data
      const response = await fetch("/api/user/delete", {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete account");
      }

      // Sign out and redirect
      await supabase.auth.signOut();
      router.push("/");
    } catch {
      setMessage({ type: "error", text: "Failed to delete account" });
      setDeleting(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!settings) return;

    setSavingSettings(true);
    setMessage(null);

    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });

      if (!response.ok) {
        throw new Error("Failed to save settings");
      }

      setMessage({ type: "success", text: "Settings saved successfully" });
    } catch {
      setMessage({ type: "error", text: "Failed to save settings" });
    }

    setSavingSettings(false);
  };

  const handleCardAction = async (action: string) => {
    setCardAction(action);
    setMessage(null);

    try {
      const body: Record<string, unknown> = { action };
      
      if (action === "fund" && fundAmount) {
        body.amount = parseFloat(fundAmount);
      }

      const response = await fetch("/api/agent-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Action failed");
      }

      const data = await response.json();

      if (action === "create") {
        setAgentCard(data);
        setMessage({ type: "success", text: "Agent card created successfully!" });
      } else if (action === "fund") {
        setAgentCard(prev => prev ? { ...prev, balance_cents: data.newBalance } : null);
        setFundAmount("");
        setMessage({ type: "success", text: `Added $${fundAmount} to your card` });
      } else if (action === "freeze") {
        setAgentCard(prev => prev ? { ...prev, is_frozen: true } : null);
        setMessage({ type: "success", text: "Card frozen" });
      } else if (action === "unfreeze") {
        setAgentCard(prev => prev ? { ...prev, is_frozen: false } : null);
        setMessage({ type: "success", text: "Card unfrozen" });
      } else if (action === "delete") {
        setAgentCard(null);
        setMessage({ type: "success", text: "Agent card deleted" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Action failed" });
    }

    setCardAction(null);
  };

  const timezones = [
    "America/Los_Angeles",
    "America/Denver",
    "America/Chicago",
    "America/New_York",
    "America/Vancouver",
    "America/Toronto",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "Asia/Tokyo",
    "Asia/Shanghai",
    "Asia/Singapore",
    "Australia/Sydney",
  ];

  if (!profile) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">
          Manage your account settings and preferences
        </p>
      </div>

      {message && (
        <div
          className={`p-4 rounded-md ${
            message.type === "success"
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Profile Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            Your personal information
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={profile.email} disabled />
            <p className="text-xs text-muted-foreground">
              Email cannot be changed
            </p>
          </div>
          <div className="space-y-2">
            <Label>AI Email Address</Label>
            <Input value={`${profile.username}@aevoy.ai`} disabled />
            <p className="text-xs text-muted-foreground">
              This is your AI&apos;s email address
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="timezone">Timezone</Label>
            <select
              id="timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full h-10 px-3 border rounded-md bg-background"
            >
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
        <CardFooter>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </CardFooter>
      </Card>

      {/* Subscription */}
      <Card>
        <CardHeader>
          <CardTitle>Subscription</CardTitle>
          <CardDescription>
            Your current plan and usage
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <p className="font-medium capitalize">
                {profile.subscription_status === 'beta' ? 'Beta User' : `${profile.subscription_tier} Plan`}
              </p>
              <p className="text-sm text-muted-foreground">
                {profile.subscription_status === 'beta' 
                  ? 'Unlimited during beta' 
                  : `${profile.messages_used} / ${profile.messages_limit} messages used`}
              </p>
            </div>
            <Button variant="outline" disabled>
              Upgrade (Coming Soon)
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* AI Behavior Settings */}
      {settings && (
        <Card>
          <CardHeader>
            <CardTitle>AI Behavior</CardTitle>
            <CardDescription>
              Control how your AI assistant handles tasks
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <Label>Confirmation Mode</Label>
              <p className="text-sm text-muted-foreground">
                When should your AI ask for confirmation before acting?
              </p>
              <div className="grid gap-2">
                {[
                  { value: "always", label: "Always confirm", description: "Safest - confirm every task" },
                  { value: "unclear", label: "When unsure", description: "Recommended - confirm only when AI isn't confident" },
                  { value: "risky", label: "Risky actions only", description: "Confirm for payments, logins, emails" },
                  { value: "never", label: "Never confirm", description: "Full autonomy - AI acts immediately" },
                ].map((option) => (
                  <label
                    key={option.value}
                    className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                      settings.confirmation_mode === option.value
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="confirmation_mode"
                      value={option.value}
                      checked={settings.confirmation_mode === option.value}
                      onChange={(e) => setSettings({ ...settings, confirmation_mode: e.target.value as UserSettings["confirmation_mode"] })}
                      className="mt-1"
                    />
                    <div>
                      <p className="font-medium">{option.label}</p>
                      <p className="text-sm text-muted-foreground">{option.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <Label>Verification Codes</Label>
              <p className="text-sm text-muted-foreground">
                How should your AI handle 2FA/verification codes?
              </p>
              <div className="grid gap-2">
                {[
                  { value: "forward", label: "I'll forward codes", description: "Free - AI asks you via email when it needs a code" },
                  { value: "virtual_number", label: "Auto-receive codes", description: "$1/month - Get a virtual number for automatic code receiving" },
                ].map((option) => (
                  <label
                    key={option.value}
                    className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                      settings.verification_method === option.value
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="verification_method"
                      value={option.value}
                      checked={settings.verification_method === option.value}
                      onChange={(e) => setSettings({ ...settings, verification_method: e.target.value as UserSettings["verification_method"] })}
                      className="mt-1"
                    />
                    <div>
                      <p className="font-medium">{option.label}</p>
                      <p className="text-sm text-muted-foreground">{option.description}</p>
                    </div>
                  </label>
                ))}
              </div>
              {settings.virtual_phone && (
                <p className="text-sm text-green-600">
                  Your virtual number: {settings.virtual_phone}
                </p>
              )}
            </div>
          </CardContent>
          <CardFooter>
            <Button onClick={handleSaveSettings} disabled={savingSettings}>
              {savingSettings ? "Saving..." : "Save AI Settings"}
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Agent Card */}
      <Card>
        <CardHeader>
          <CardTitle>Agent Card</CardTitle>
          <CardDescription>
            Virtual prepaid card for your AI to make purchases
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!agentCard ? (
            <div className="text-center py-6">
              <p className="text-muted-foreground mb-4">
                Give your AI the ability to make purchases for you with a virtual prepaid card.
                You control the balance and limits.
              </p>
              <Button 
                onClick={() => handleCardAction("create")}
                disabled={cardAction === "create"}
              >
                {cardAction === "create" ? "Creating..." : "Create Agent Card"}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-gradient-to-r from-slate-800 to-slate-700 text-white rounded-lg">
                <div>
                  <p className="text-sm opacity-75">Virtual Card</p>
                  <p className="text-lg font-mono">**** **** **** {agentCard.last_four}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm opacity-75">Balance</p>
                  <p className="text-2xl font-bold">${(agentCard.balance_cents / 100).toFixed(2)}</p>
                </div>
              </div>

              {agentCard.is_frozen && (
                <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800">
                  <span>Card is frozen</span>
                </div>
              )}

              <div className="flex gap-2 flex-wrap">
                <div className="flex gap-2 flex-1">
                  <Input
                    type="number"
                    placeholder="Amount"
                    value={fundAmount}
                    onChange={(e) => setFundAmount(e.target.value)}
                    min="1"
                    step="1"
                    className="w-24"
                  />
                  <Button 
                    onClick={() => handleCardAction("fund")}
                    disabled={cardAction === "fund" || !fundAmount}
                    variant="outline"
                  >
                    {cardAction === "fund" ? "Adding..." : "Add Funds"}
                  </Button>
                </div>
                
                {agentCard.is_frozen ? (
                  <Button 
                    onClick={() => handleCardAction("unfreeze")}
                    disabled={cardAction === "unfreeze"}
                    variant="outline"
                  >
                    {cardAction === "unfreeze" ? "..." : "Unfreeze"}
                  </Button>
                ) : (
                  <Button 
                    onClick={() => handleCardAction("freeze")}
                    disabled={cardAction === "freeze"}
                    variant="outline"
                  >
                    {cardAction === "freeze" ? "..." : "Freeze"}
                  </Button>
                )}
                
                <Button 
                  onClick={() => {
                    if (confirm("Delete your agent card? Any remaining balance will be refunded.")) {
                      handleCardAction("delete");
                    }
                  }}
                  disabled={cardAction === "delete"}
                  variant="destructive"
                >
                  {cardAction === "delete" ? "..." : "Delete Card"}
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                Tip: Email &quot;add $50 to my card&quot; to quickly add funds, or &quot;freeze my card&quot; to temporarily disable it.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-red-200">
        <CardHeader>
          <CardTitle className="text-red-600">Danger Zone</CardTitle>
          <CardDescription>
            Irreversible actions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex justify-between items-center">
            <div>
              <p className="font-medium">Delete Account</p>
              <p className="text-sm text-muted-foreground">
                Permanently delete your account and all data
              </p>
            </div>
            <Button
              variant="destructive"
              onClick={handleDeleteAccount}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete All Data"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
