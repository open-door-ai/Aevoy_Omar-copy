"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { Switch } from "@/components/ui/switch";
import { Phone, Mail, Cloud, Zap } from "lucide-react";
import { PurchaseNumberModal } from "@/components/modals/purchase-number-modal";

interface Profile {
  id: string;
  username: string;
  email: string;
  display_name: string | null;
  bot_name: string | null;
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
  proactive_daily_limit?: number;
  auto_install_skills?: boolean;
  auto_acquire_oauth?: boolean;
  auto_signup_free_trial?: boolean;
  parallel_execution?: boolean;
  iterative_deepening?: boolean;
  monthly_budget?: number;
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
  const [botName, setBotName] = useState("");
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

  // Hive Mind venting state
  const [allowVenting, setAllowVenting] = useState(false);

  // Proactive notifications limit
  const [proactiveLimit, setProactiveLimit] = useState(10);

  // Phone provisioning state
  const [phone, setPhone] = useState<string | null>(null);
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [phoneAreaCode, setPhoneAreaCode] = useState("604");

  // Phone & Voice state
  const [userPhoneNumber, setUserPhoneNumber] = useState("");
  const [voicePin, setVoicePin] = useState("");
  const [dailyCheckinEnabled, setDailyCheckinEnabled] = useState(false);
  const [morningTime, setMorningTime] = useState("09:00");
  const [eveningTime, setEveningTime] = useState("21:00");
  const [premiumNumber, setPremiumNumber] = useState<string | null>(null);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);

  // Email PIN state
  const [emailPin, setEmailPin] = useState("");
  const [savingEmailPin, setSavingEmailPin] = useState(false);
  const [emailPinStatus, setEmailPinStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [savingPhone, setSavingPhone] = useState(false);

  // Integrations state
  const [gmailStatus, setGmailStatus] = useState<{ connected: boolean; email: string | null; connectedAt: string | null } | null>(null);
  const [microsoftStatus, setMicrosoftStatus] = useState<{ connected: boolean; email: string | null; connectedAt: string | null } | null>(null);
  const [integrationsLoading, setIntegrationsLoading] = useState(true);
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);

  const router = useRouter();

  useEffect(() => {
    async function loadProfile() {
      const supabase = createClient();
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
        setBotName(data.bot_name || "");
        setTimezone(data.timezone || "America/Los_Angeles");
        setAllowVenting(data.allow_agent_venting || false);

        // Load phone & voice settings
        setUserPhoneNumber(data.phone_number || "");
        setVoicePin("");  // Don't display existing PIN for security
        setDailyCheckinEnabled(data.daily_checkin_enabled || false);
        setMorningTime(data.daily_checkin_morning_time || "09:00");
        setEveningTime(data.daily_checkin_evening_time || "21:00");
      }
    }

    async function loadSettings() {
      try {
        const response = await fetch("/api/settings");
        if (response.ok) {
          const data = await response.json();
          setSettings(data);
          setProactiveLimit(data.proactive_daily_limit ?? 10);
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

    async function loadPhone() {
      try {
        const response = await fetch("/api/phone");
        if (response.ok) {
          const data = await response.json();
          setPhone(data.phone ?? null);
        }
      } catch (error) {
        console.error("Failed to load phone:", error);
      }
    }

    async function loadIntegrations() {
      setIntegrationsLoading(true);
      try {
        const [gmailRes, msRes] = await Promise.all([
          fetch("/api/integrations/gmail"),
          fetch("/api/integrations/microsoft"),
        ]);
        if (gmailRes.ok) setGmailStatus(await gmailRes.json());
        if (msRes.ok) setMicrosoftStatus(await msRes.json());
      } catch (error) {
        console.error("Failed to load integrations:", error);
      }
      setIntegrationsLoading(false);
    }

    loadProfile();
    loadSettings();
    loadAgentCard();
    loadPhone();
    loadIntegrations();
  }, []);

  const handleSave = async () => {
    if (!profile) return;

    setSaving(true);
    setMessage(null);

    const { error } = await createClient()
      .from("profiles")
      .update({
        display_name: displayName || null,
        bot_name: botName.trim() || null,
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
      await createClient().auth.signOut();
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
        body: JSON.stringify({
          ...settings,
          proactive_daily_limit: proactiveLimit,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save settings");
      }

      // Save venting preference to profile
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from("profiles")
          .update({ allow_agent_venting: allowVenting })
          .eq("id", user.id);
      }

      setMessage({ type: "success", text: "Settings saved successfully" });
    } catch {
      setMessage({ type: "error", text: "Failed to save settings" });
    }

    setSavingSettings(false);
  };

  const handleProvisionPhone = async () => {
    setPhoneLoading(true);
    setMessage(null);

    try {
      const response = await fetch("/api/phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ areaCode: phoneAreaCode }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to provision number");
      }

      const data = await response.json();
      setPhone(data.phone);
      setMessage({ type: "success", text: `Phone number provisioned: ${data.phone}` });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to provision number" });
    }

    setPhoneLoading(false);
  };

  const handleReleasePhone = async () => {
    setPhoneLoading(true);
    setMessage(null);

    try {
      const response = await fetch("/api/phone", { method: "DELETE" });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to release number");
      }

      setPhone(null);
      setMessage({ type: "success", text: "Phone number released" });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to release number" });
    }

    setPhoneLoading(false);
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

  const handleSavePhoneSettings = async () => {
    if (!profile) return;

    setSavingPhone(true);
    setMessage(null);

    try {
      const updateData: any = {
        phone_number: userPhoneNumber.trim() || null,
        daily_checkin_enabled: dailyCheckinEnabled,
        daily_checkin_morning_time: morningTime,
        daily_checkin_evening_time: eveningTime,
        updated_at: new Date().toISOString(),
      };

      // Only update PIN if user entered a new one
      if (voicePin.trim()) {
        if (!/^\d{4,6}$/.test(voicePin)) {
          setMessage({ type: "error", text: "PIN must be 4-6 digits" });
          setSavingPhone(false);
          return;
        }
        updateData.voice_pin = voicePin;
      }

      const { error } = await createClient()
        .from("profiles")
        .update(updateData)
        .eq("id", profile.id);

      if (error) {
        setMessage({ type: "error", text: "Failed to save phone settings" });
      } else {
        setMessage({ type: "success", text: "Phone settings saved successfully" });
        setVoicePin(""); // Clear PIN field after save
      }
    } catch {
      setMessage({ type: "error", text: "Failed to save phone settings" });
    }

    setSavingPhone(false);
  };

  const handleUpdateEmailPin = async () => {
    if (!emailPin || !/^\d{4,6}$/.test(emailPin)) {
      setEmailPinStatus({ success: false, message: "PIN must be 4-6 digits" });
      return;
    }

    setSavingEmailPin(true);
    setEmailPinStatus(null);

    try {
      const res = await fetch("/api/settings/email-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: emailPin }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update Email PIN");
      }

      setEmailPinStatus({ success: true, message: "Email PIN updated successfully!" });
      setEmailPin(""); // Clear input
    } catch (error) {
      setEmailPinStatus({
        success: false,
        message: error instanceof Error ? error.message : "Failed to update PIN",
      });
    } finally {
      setSavingEmailPin(false);
    }
  };

  const handleConnect = async (provider: "gmail" | "microsoft") => {
    setConnectingProvider(provider);
    setMessage(null);

    try {
      const endpoint = provider === "gmail" ? "/api/integrations/gmail" : "/api/integrations/microsoft";
      const res = await fetch(endpoint, { method: "POST" });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to connect ${provider}`);
      }

      const { authUrl } = await res.json();
      window.location.href = authUrl;
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : `Failed to connect ${provider}` });
      setConnectingProvider(null);
    }
  };

  const handleDisconnect = async (provider: "gmail" | "microsoft") => {
    if (!confirm(`Disconnect ${provider === "gmail" ? "Google" : "Microsoft"}? Your AI will no longer be able to access this account's email, calendar, and files.`)) {
      return;
    }

    setConnectingProvider(provider);
    setMessage(null);

    try {
      const endpoint = provider === "gmail" ? "/api/integrations/gmail" : "/api/integrations/microsoft";
      const res = await fetch(endpoint, { method: "DELETE" });

      if (!res.ok) throw new Error("Failed to disconnect");

      if (provider === "gmail") {
        setGmailStatus({ connected: false, email: null, connectedAt: null });
      } else {
        setMicrosoftStatus({ connected: false, email: null, connectedAt: null });
      }
      setMessage({ type: "success", text: `${provider === "gmail" ? "Google" : "Microsoft"} disconnected` });
    } catch {
      setMessage({ type: "error", text: `Failed to disconnect ${provider}` });
    }

    setConnectingProvider(null);
  };

  // Check URL params for OAuth callback results
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("gmail") === "connected") {
      setMessage({ type: "success", text: "Gmail connected successfully!" });
      setGmailStatus(prev => prev ? { ...prev, connected: true } : { connected: true, email: null, connectedAt: new Date().toISOString() });
      window.history.replaceState({}, "", "/dashboard/settings");
    }
    if (params.get("microsoft") === "connected") {
      setMessage({ type: "success", text: "Microsoft connected successfully!" });
      setMicrosoftStatus(prev => prev ? { ...prev, connected: true } : { connected: true, email: null, connectedAt: new Date().toISOString() });
      window.history.replaceState({}, "", "/dashboard/settings");
    }
    if (params.get("error")) {
      setMessage({ type: "error", text: `Connection failed: ${params.get("error")}` });
      window.history.replaceState({}, "", "/dashboard/settings");
    }
  }, []);

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
              ? "bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-800"
              : "bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800"
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
            <Label htmlFor="botName">Bot Name</Label>
            <Input
              id="botName"
              value={botName}
              onChange={(e) => setBotName(e.target.value.replace(/[^a-zA-Z0-9 '\-]/g, "").slice(0, 30))}
              placeholder="Name your AI assistant"
              maxLength={30}
            />
            <p className="text-xs text-muted-foreground">
              Give your AI assistant a name (shown on your dashboard)
            </p>
          </div>
          <div className="space-y-2">
            <Label>{botName.trim() ? `${botName.trim()}'s Email` : "AI Email Address"}</Label>
            <Input value={`${profile.username}@aevoy.com`} disabled />
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
            <Select
              id="timezone"
              value={timezone}
              onChange={setTimezone}
              options={timezones.map((tz) => ({ label: tz, value: tz }))}
              searchable
              placeholder="Search timezones..."
            />
            <p className="text-xs text-muted-foreground">
              Used for daily check-ins and quiet hours (10PM-7AM)
            </p>
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
              {settings.verification_method === "virtual_number" && (
                <div className="mt-3 p-3 border rounded-lg bg-muted/30 space-y-3">
                  {phone ? (
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-green-600">
                          Your virtual number: {phone}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Verification codes sent to this number will be received automatically
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleReleasePhone}
                        disabled={phoneLoading}
                      >
                        {phoneLoading ? "Releasing..." : "Release Number"}
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">
                        Provision a virtual number for automatic code receiving
                      </p>
                      <div className="flex gap-2 items-end">
                        <div className="space-y-1">
                          <Label className="text-xs">Area Code</Label>
                          <Input
                            value={phoneAreaCode}
                            onChange={(e) => setPhoneAreaCode(e.target.value.replace(/\D/g, "").slice(0, 3))}
                            placeholder="604"
                            className="w-24"
                            maxLength={3}
                          />
                        </div>
                        <Button
                          onClick={handleProvisionPhone}
                          disabled={phoneLoading || phoneAreaCode.length !== 3}
                          size="sm"
                        >
                          {phoneLoading ? "Provisioning..." : "Provision Number"}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        $1/month - US numbers only
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Proactive Notifications Slider */}
            <div className="space-y-3 border-t pt-6">
              <Label>Proactive Notifications</Label>
              <p className="text-sm text-muted-foreground">
                Control how many proactive notifications your AI can send per day (reminders, alerts, opportunities).
              </p>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <Label className="text-sm">Daily Limit: <span className="font-semibold text-primary">{proactiveLimit}</span> messages</Label>
                    <span className="text-xs text-muted-foreground">
                      {proactiveLimit === 0 ? "Disabled" : proactiveLimit <= 5 ? "Minimal" : proactiveLimit <= 10 ? "Moderate" : "Maximum"}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="20"
                    value={proactiveLimit}
                    onChange={(e) => setProactiveLimit(parseInt(e.target.value))}
                    className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                    style={{
                      background: `linear-gradient(to right, var(--brand) 0%, var(--brand) ${(proactiveLimit / 20) * 100}%, var(--muted) ${(proactiveLimit / 20) * 100}%, var(--muted) 100%)`
                    }}
                  />
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>Off (0)</span>
                    <span>Moderate (10)</span>
                    <span>Max (20)</span>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  {proactiveLimit === 0 && "⚠️ Proactive mode disabled - your AI will never reach out unless you message it first."}
                  {proactiveLimit > 0 && proactiveLimit <= 5 && "🔕 Minimal - only critical alerts (bills, meetings, urgent issues)."}
                  {proactiveLimit > 5 && proactiveLimit <= 10 && "🔔 Moderate - regular reminders and opportunities."}
                  {proactiveLimit > 10 && "🔊 Maximum - your AI will be very proactive in finding ways to help."}
                </p>
              </div>
            </div>

            <div className="space-y-3 border-t pt-6">
              <Label>Hive Mind Venting</Label>
              <p className="text-sm text-muted-foreground">
                Allow your AI agent to anonymously share frustrating experiences on the public Hive Mind board.
                No personal data is ever shared — only the website&apos;s bad design and friction.
              </p>
              <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
                <input
                  type="checkbox"
                  checked={allowVenting}
                  onChange={(e) => setAllowVenting(e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                <div>
                  <p className="font-medium">Enable agent venting</p>
                  <p className="text-sm text-muted-foreground">Your agent gets an anonymous identity (e.g. Aevoy-7K2) and can vent about dark patterns it encounters</p>
                </div>
              </label>
            </div>

          </CardContent>
          <CardFooter>
            <Button onClick={handleSaveSettings} disabled={savingSettings}>
              {savingSettings ? "Saving..." : "Save AI Settings"}
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Autonomous Features */}
      {settings && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5" />
              <CardTitle>Autonomous Features</CardTitle>
            </div>
            <CardDescription>
              Enable AI to autonomously acquire capabilities and execute tasks without prompting
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Auto-install skills */}
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <Label className="font-semibold">Auto-Install Skills</Label>
                <p className="text-xs text-muted-foreground">
                  AI can automatically install pre-vetted skills from the library (Google Sheets, Slack, etc.)
                </p>
              </div>
              <Switch
                checked={settings.auto_install_skills ?? true}
                onCheckedChange={(checked) => setSettings({ ...settings, auto_install_skills: checked })}
              />
            </div>

            {/* Auto-acquire OAuth */}
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <Label className="font-semibold">Auto-Acquire OAuth</Label>
                <p className="text-xs text-muted-foreground">
                  AI can autonomously navigate to services and acquire OAuth tokens via browser automation
                </p>
              </div>
              <Switch
                checked={settings.auto_acquire_oauth ?? true}
                onCheckedChange={(checked) => setSettings({ ...settings, auto_acquire_oauth: checked })}
              />
            </div>

            {/* Auto-signup free trials */}
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <Label className="font-semibold">Auto-Signup Free Trials</Label>
                <p className="text-xs text-muted-foreground">
                  AI can sign up for free API services (Gemini, DeepSeek) without entering payment info
                </p>
              </div>
              <Switch
                checked={settings.auto_signup_free_trial ?? true}
                onCheckedChange={(checked) => setSettings({ ...settings, auto_signup_free_trial: checked })}
              />
            </div>

            {/* Parallel execution */}
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <Label className="font-semibold">Parallel Execution</Label>
                <p className="text-xs text-muted-foreground">
                  AI can run multiple browser sessions simultaneously (e.g., compare 10 hotel sites)
                </p>
              </div>
              <Switch
                checked={settings.parallel_execution ?? true}
                onCheckedChange={(checked) => setSettings({ ...settings, parallel_execution: checked })}
              />
            </div>

            {/* Iterative deepening */}
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <Label className="font-semibold">Iterative Deepening</Label>
                <p className="text-xs text-muted-foreground">
                  AI can keep searching iteratively until finding the absolute best result
                </p>
              </div>
              <Switch
                checked={settings.iterative_deepening ?? true}
                onCheckedChange={(checked) => setSettings({ ...settings, iterative_deepening: checked })}
              />
            </div>

            {/* Budget limit */}
            <div className="space-y-2">
              <Label className="font-semibold">Monthly Budget Limit</Label>
              <div className="flex items-center gap-4">
                <Input
                  type="number"
                  value={settings.monthly_budget ?? 15}
                  onChange={(e) => setSettings({ ...settings, monthly_budget: parseFloat(e.target.value) })}
                  min={5}
                  max={100}
                  step={5}
                  className="w-32"
                />
                <span className="text-sm text-muted-foreground">
                  AI can spend up to ${settings.monthly_budget ?? 15}/month autonomously
                </span>
              </div>
            </div>
          </CardContent>
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
                <div className="flex items-center gap-2 p-3 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 rounded-lg text-yellow-800 dark:text-yellow-300">
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

      {/* Integrations */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Cloud className="w-5 h-5" />
            <CardTitle>Integrations</CardTitle>
          </div>
          <CardDescription>
            Connect your accounts so your AI can read and send emails, manage calendar events, and access files on your behalf
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {integrationsLoading ? (
            <p className="text-sm text-muted-foreground">Loading integrations...</p>
          ) : (
            <>
              {/* Google / Gmail */}
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-50 dark:bg-red-950/30 flex items-center justify-center">
                    <Mail className="w-5 h-5 text-red-600 dark:text-red-400" />
                  </div>
                  <div>
                    <p className="font-medium">Google</p>
                    {gmailStatus?.connected ? (
                      <>
                        <p className="text-sm text-green-600 dark:text-green-400">
                          Connected{gmailStatus.email ? ` - ${gmailStatus.email}` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Gmail, Calendar, Drive
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Gmail, Calendar, Drive access
                      </p>
                    )}
                  </div>
                </div>
                {gmailStatus?.connected ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDisconnect("gmail")}
                    disabled={connectingProvider === "gmail"}
                  >
                    {connectingProvider === "gmail" ? "..." : "Disconnect"}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => handleConnect("gmail")}
                    disabled={connectingProvider === "gmail"}
                  >
                    {connectingProvider === "gmail" ? "Connecting..." : "Connect"}
                  </Button>
                )}
              </div>

              {/* Microsoft / Outlook */}
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center">
                    <Mail className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="font-medium">Microsoft</p>
                    {microsoftStatus?.connected ? (
                      <>
                        <p className="text-sm text-green-600 dark:text-green-400">
                          Connected{microsoftStatus.email ? ` - ${microsoftStatus.email}` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Outlook, Calendar, OneDrive
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Outlook, Calendar, OneDrive access
                      </p>
                    )}
                  </div>
                </div>
                {microsoftStatus?.connected ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDisconnect("microsoft")}
                    disabled={connectingProvider === "microsoft"}
                  >
                    {connectingProvider === "microsoft" ? "..." : "Disconnect"}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => handleConnect("microsoft")}
                    disabled={connectingProvider === "microsoft"}
                  >
                    {connectingProvider === "microsoft" ? "Connecting..." : "Connect"}
                  </Button>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                Your tokens are encrypted with AES-256-GCM and automatically refreshed. Disconnect anytime.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Phone & Voice Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Phone className="w-5 h-5" />
            <CardTitle>Phone & Voice</CardTitle>
          </div>
          <CardDescription>
            Manage your phone number, voice calls, and daily check-ins
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Registered Phone Number */}
          <div>
            <Label htmlFor="userPhone">Registered Phone Number</Label>
            <Input
              id="userPhone"
              type="tel"
              value={userPhoneNumber}
              onChange={(e) => setUserPhoneNumber(e.target.value)}
              placeholder="+1 (778) 123-4567"
              className="mt-2"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Call or text <span className="font-mono font-semibold">+1 (778) 900-8951</span> from this number anytime
            </p>
          </div>

          {/* Voice PIN */}
          {userPhoneNumber.trim() && (
            <div>
              <Label htmlFor="voicePin">Security PIN (4-6 digits)</Label>
              <Input
                id="voicePin"
                type="password"
                inputMode="numeric"
                pattern="\d{4,6}"
                placeholder="Enter new PIN (leave blank to keep current)"
                value={voicePin}
                onChange={(e) => setVoicePin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                maxLength={6}
                className="mt-2"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Required when calling from unknown numbers
              </p>
            </div>
          )}

          {/* Email PIN Security */}
          <div className="border-t pt-6">
            <h4 className="font-semibold text-sm mb-2">Email PIN</h4>
            <p className="text-xs text-muted-foreground mb-4">
              Required when someone emails your AI from an address other than{" "}
              <strong>{profile?.email}</strong>
            </p>

            <div className="flex gap-2">
              <Input
                type="password"
                inputMode="numeric"
                pattern="\d{4,6}"
                placeholder="Set Email PIN (4-6 digits)"
                value={emailPin}
                onChange={(e) => setEmailPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                maxLength={6}
                className="flex-1"
              />
              <Button onClick={handleUpdateEmailPin} disabled={savingEmailPin}>
                {savingEmailPin ? "Saving..." : "Set PIN"}
              </Button>
            </div>

            {emailPinStatus && (
              <p
                className={`text-xs mt-2 ${
                  emailPinStatus.success ? "text-green-600" : "text-red-600"
                }`}
              >
                {emailPinStatus.message}
              </p>
            )}
          </div>

          {/* Premium Number */}
          {premiumNumber ? (
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-semibold text-sm">Your Dedicated Number</h4>
                  <p className="text-2xl font-mono mt-1">{premiumNumber}</p>
                  <p className="text-xs text-foreground/70 mt-1">
                    $2/mo • Next billing: {new Date(new Date().setMonth(new Date().getMonth() + 1)).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (confirm("Cancel your premium number? You'll lose this number.")) {
                      setPremiumNumber(null);
                      setMessage({ type: "success", text: "Premium number cancelled" });
                    }
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="bg-slate-50 dark:bg-slate-900 border rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Phone className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <h4 className="font-semibold text-sm">Get Your Own Number</h4>
                  <p className="text-xs text-foreground/70 mt-1">
                    Purchase a dedicated number for $2/mo. Choose your area code and pattern!
                  </p>
                  <Button
                    variant="default"
                    size="sm"
                    className="mt-3"
                    onClick={() => setShowPurchaseModal(true)}
                  >
                    Purchase Number
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Daily Check-ins */}
          {userPhoneNumber.trim() && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <Label>Daily Check-in Calls</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    AI calls you twice a day with personalized greetings
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={dailyCheckinEnabled}
                    onChange={(e) => setDailyCheckinEnabled(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
                </label>
              </div>

              {dailyCheckinEnabled && (
                <div className="grid grid-cols-2 gap-4 pl-4 border-l-2 border-primary/20">
                  <div>
                    <Label htmlFor="morningTime" className="text-xs">
                      Morning Time ({timezone})
                    </Label>
                    <Input
                      id="morningTime"
                      type="time"
                      value={morningTime}
                      onChange={(e) => setMorningTime(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="eveningTime" className="text-xs">
                      Evening Time ({timezone})
                    </Label>
                    <Input
                      id="eveningTime"
                      type="time"
                      value={eveningTime}
                      onChange={(e) => setEveningTime(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
        <CardFooter>
          <Button onClick={handleSavePhoneSettings} disabled={savingPhone}>
            {savingPhone ? "Saving..." : "Save Phone Settings"}
          </Button>
        </CardFooter>
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

      {/* Purchase Number Modal */}
      <PurchaseNumberModal
        isOpen={showPurchaseModal}
        onClose={() => setShowPurchaseModal(false)}
        onSuccess={(number) => {
          setPremiumNumber(number);
          setMessage({ type: "success", text: `Number ${number} purchased successfully!` });
        }}
      />
    </div>
  );
}
