"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { Switch } from "@/components/ui/switch";
import { Phone, Mail, Cloud, Zap, RotateCcw, Inbox, Copy, Check, Mic, Upload, Play, Pause, Trash2, Volume2, Code2, ChevronDown, ChevronRight, AlertTriangle, Eye, EyeOff, ExternalLink, BarChart2, Key } from "lucide-react";
import Link from "next/link";
import { PurchaseNumberModal } from "@/components/modals/purchase-number-modal";
import InboxManagementSettings from "@/components/settings/inbox-management";
import { InboxSetupWizard } from "@/components/inbox-setup-wizard";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
  voice_preference?: string;
  proactive_daily_limit?: number;
  proactive_channel?: string;
  auto_install_skills?: boolean;
  auto_acquire_oauth?: boolean;
  auto_signup_free_trial?: boolean;
  parallel_execution?: boolean;
  iterative_deepening?: boolean;
  monthly_budget?: number;
  task_budget_cents?: number;
  max_task_iterations?: number;
  master_timeout_minutes?: number;
  report_frequency?: string;
  // Full Send Mode — autonomous email management
  full_send_mode?: boolean;
  full_send_auto_reply?: boolean;
  full_send_draft_threshold?: "all" | "medium" | "high";
  // Voice greeting style
  greeting_style?: "casual" | "jarvis";
}

interface AgentCard {
  id: string;
  last_four: string;
  balance_cents: number;
  is_frozen: boolean;
  created_at: string;
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<string>("profile");
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

  // Hive Mind learning state
  const [allowHiveLearning, setAllowHiveLearning] = useState(true);

  // Proactive notifications limit
  const [proactiveLimit, setProactiveLimit] = useState(10);

  // Proactive channel preference
  const [proactiveChannel, setProactiveChannel] = useState<string>("sms");

  // Report frequency
  const [reportFrequency, setReportFrequency] = useState<string>("weekly");

  // Full Send Mode state
  const [fullSendMode, setFullSendMode] = useState(false);
  const [fullSendAutoReply, setFullSendAutoReply] = useState(true);
  const [fullSendDraftThreshold, setFullSendDraftThreshold] = useState<"all" | "medium" | "high">("medium");

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

  // Voicemail state
  const [voicemailEnabled, setVoicemailEnabled] = useState(true);
  const [voicemailText, setVoicemailText] = useState("");
  const [voicemailAudioUrl, setVoicemailAudioUrl] = useState<string | null>(null);
  const [uploadingVoicemail, setUploadingVoicemail] = useState(false);
  const [recordingVoicemail, setRecordingVoicemail] = useState(false);
  const [playingVoicemail, setPlayingVoicemail] = useState(false);
  const voicemailAudioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // Copy button state
  const [copiedPhone, setCopiedPhone] = useState(false);

  // Save animation state
  const [phoneSaveSuccess, setPhoneSaveSuccess] = useState(false);

  // Email PIN state
  const [emailPin, setEmailPin] = useState("");
  const [savingEmailPin, setSavingEmailPin] = useState(false);
  const [emailPinStatus, setEmailPinStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [savingPhone, setSavingPhone] = useState(false);
  const [restartingTour, setRestartingTour] = useState(false);

  // Integrations state
  const [gmailStatus, setGmailStatus] = useState<{ connected: boolean; email: string | null; connectedAt: string | null } | null>(null);
  const [microsoftStatus, setMicrosoftStatus] = useState<{ connected: boolean; email: string | null; connectedAt: string | null } | null>(null);
  const [nylasStatus, setNylasStatus] = useState<{ connected: boolean; email: string | null; connectedAt: string | null } | null>(null);
  const [inboxStatus, setInboxStatus] = useState<{ connected: boolean; email: string | null; connectedAt: string | null; method?: string } | null>(null);
  const [showInboxSetupDialog, setShowInboxSetupDialog] = useState(false);

  // Credential Vault state
  const [credentials, setCredentials] = useState<Array<{ id: string; site_domain: string; username: string; created_at: string }>>([]);
  const [loadingCredentials, setLoadingCredentials] = useState(false);
  const [newCredential, setNewCredential] = useState({ site_domain: "", username: "", password: "" });
  const [addingCredential, setAddingCredential] = useState(false);
  const [integrationsLoading, setIntegrationsLoading] = useState(true);
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);

  // Wallet state (for plan display)
  const [walletLifetimeTopup, setWalletLifetimeTopup] = useState(0);

  // OpenRouter Developer Mode state
  const [devModeOpen, setDevModeOpen] = useState(false);
  const [agentPasswordSlots, setAgentPasswordSlots] = useState({ primary: false, secondary: false, tertiary: false });
  const [agentPasswordInputs, setAgentPasswordInputs] = useState({ primary: "", secondary: "", tertiary: "" });
  const [savingAgentPasswords, setSavingAgentPasswords] = useState(false);
  const [orHasKey, setOrHasKey] = useState(false);
  const [orMaskedKey, setOrMaskedKey] = useState<string | null>(null);
  const [orEnabled, setOrEnabled] = useState(false);
  const [orPreset, setOrPreset] = useState("auto");
  const [orApiKeyInput, setOrApiKeyInput] = useState("");
  const [orShowKey, setOrShowKey] = useState(false);
  const [orSaving, setOrSaving] = useState(false);
  const [orMessage, setOrMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [orLoading, setOrLoading] = useState(false);

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
        setAllowHiveLearning(data.allow_hive_learning !== false); // Default to true

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
          setProactiveChannel(data.proactive_channel ?? "sms");
          setReportFrequency(data.report_frequency ?? "weekly");
          setFullSendMode(data.full_send_mode ?? false);
          setFullSendAutoReply(data.full_send_auto_reply ?? true);
          setFullSendDraftThreshold(data.full_send_draft_threshold ?? "medium");
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
        const [gmailRes, msRes, nylasRes, inboxRes] = await Promise.all([
          fetch("/api/integrations/gmail"),
          fetch("/api/integrations/microsoft"),
          fetch("/api/integrations/nylas"),
          fetch("/api/integrations/inbox"),
        ]);
        if (gmailRes.ok) setGmailStatus(await gmailRes.json());
        if (msRes.ok) setMicrosoftStatus(await msRes.json());
        if (nylasRes.ok) setNylasStatus(await nylasRes.json());
        if (inboxRes.ok) setInboxStatus(await inboxRes.json());
      } catch (error) {
        console.error("Failed to load integrations:", error);
      }
      setIntegrationsLoading(false);
    }

    async function loadCredentials() {
      setLoadingCredentials(true);
      try {
        const res = await fetch("/api/credentials");
        if (res.ok) {
          const data = await res.json();
          setCredentials(data.credentials || []);
        }
      } catch (error) {
        console.error("Failed to load credentials:", error);
      }
      setLoadingCredentials(false);
    }

    async function loadVoicemail() {
      try {
        const response = await fetch("/api/settings/voicemail");
        if (response.ok) {
          const data = await response.json();
          setVoicemailEnabled(data.voicemail_enabled ?? true);
          setVoicemailText(data.voicemail_greeting_text || "");
          setVoicemailAudioUrl(data.voicemail_greeting_url || null);
        }
      } catch (error) {
        console.error("Failed to load voicemail settings:", error);
      }
    }

    async function loadOpenRouter() {
      try {
        const res = await fetch("/api/settings/openrouter");
        if (res.ok) {
          const data = await res.json();
          setOrHasKey(data.hasKey ?? false);
          setOrMaskedKey(data.maskedKey ?? null);
          setOrEnabled(data.enabled ?? false);
          setOrPreset(data.modelPreset ?? "auto");
        }
      } catch {
        // non-critical
      }
    }

    loadProfile();
    loadSettings();
    loadAgentCard();
    loadPhone();
    loadIntegrations();
    loadCredentials();
    loadVoicemail();
    loadOpenRouter();
    // Load wallet for plan display
    fetch("/api/billing/balance").then(r => r.ok ? r.json() : null).then(d => {
      if (d) {
        const topup = parseFloat(d.lifetime_topup_usd || "0");
        setWalletLifetimeTopup(Math.round(topup * 100));
      }
    }).catch(() => {});
    // Load agent password slots
    fetch("/api/settings/agent-passwords").then(r => r.ok ? r.json() : null).then(d => { if (d) setAgentPasswordSlots(d); }).catch(() => {});
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

  const handleSaveOpenRouter = async () => {
    setOrSaving(true);
    setOrMessage(null);
    try {
      const payload: Record<string, unknown> = {
        enabled: orEnabled,
        modelPreset: orPreset,
      };
      if (orApiKeyInput.trim()) {
        payload.apiKey = orApiKeyInput.trim();
      }
      const res = await fetch("/api/settings/openrouter", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setOrMessage({ type: "success", text: "Developer settings saved." });
        setOrApiKeyInput("");
        // Refresh masked key
        const refreshRes = await fetch("/api/settings/openrouter");
        if (refreshRes.ok) {
          const data = await refreshRes.json();
          setOrHasKey(data.hasKey ?? false);
          setOrMaskedKey(data.maskedKey ?? null);
        }
      } else {
        const data = await res.json();
        setOrMessage({ type: "error", text: data.error || "Failed to save settings." });
      }
    } catch {
      setOrMessage({ type: "error", text: "Network error. Please try again." });
    } finally {
      setOrSaving(false);
    }
  };

  const handleRemoveOpenRouterKey = async () => {
    if (!confirm("Remove your OpenRouter API key? This will disable custom model routing.")) return;
    setOrLoading(true);
    try {
      await fetch("/api/settings/openrouter", { method: "DELETE" });
      setOrHasKey(false);
      setOrMaskedKey(null);
      setOrEnabled(false);
      setOrMessage({ type: "success", text: "API key removed." });
    } finally {
      setOrLoading(false);
    }
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
          proactive_enabled: proactiveLimit > 0, // sync boolean with slider (0 = disabled)
          proactive_channel: proactiveChannel,
          report_frequency: reportFrequency,
          full_send_mode: fullSendMode,
          full_send_auto_reply: fullSendAutoReply,
          full_send_draft_threshold: fullSendDraftThreshold,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save settings");
      }

      // Save venting and learning preferences to profile
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from("profiles")
          .update({
            allow_agent_venting: allowVenting,
            allow_hive_learning: allowHiveLearning
          })
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

      // Only update PIN if user entered a new one — saves as unified_pin_hash (covers all channels)
      if (voicePin.trim()) {
        if (!/^\d{4,6}$/.test(voicePin)) {
          setMessage({ type: "error", text: "PIN must be 4-6 digits" });
          setSavingPhone(false);
          return;
        }
        const pinRes = await fetch("/api/settings/unified-pin", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin: voicePin }),
        });
        if (!pinRes.ok) {
          setMessage({ type: "error", text: "Failed to save PIN" });
          setSavingPhone(false);
          return;
        }
      }

      const { error } = await createClient()
        .from("profiles")
        .update(updateData)
        .eq("id", profile.id);

      // Also save voicemail settings
      await fetch("/api/settings/voicemail", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voicemail_enabled: voicemailEnabled,
          voicemail_greeting_text: voicemailText.trim() || null,
        }),
      });

      if (error) {
        setMessage({ type: "error", text: "Failed to save phone settings" });
      } else {
        setPhoneSaveSuccess(true);
        setMessage({ type: "success", text: "Phone settings saved successfully" });
        setVoicePin(""); // Clear PIN field after save
        setTimeout(() => setPhoneSaveSuccess(false), 2000);
      }
    } catch {
      setMessage({ type: "error", text: "Failed to save phone settings" });
    }

    setSavingPhone(false);
  };

  // Copy phone number to clipboard
  const handleCopyPhone = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedPhone(true);
      setTimeout(() => setCopiedPhone(false), 2000);
    });
  }, []);

  // Voicemail audio upload
  const handleVoicemailUpload = async (file: File) => {
    setUploadingVoicemail(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/settings/voicemail", {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        setVoicemailAudioUrl(data.url);
        setMessage({ type: "success", text: "Voicemail greeting uploaded" });
      } else {
        const err = await res.json();
        setMessage({ type: "error", text: err.error || "Upload failed" });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to upload voicemail" });
    }
    setUploadingVoicemail(false);
  };

  // Voicemail audio delete
  const handleVoicemailDelete = async () => {
    try {
      const res = await fetch("/api/settings/voicemail", { method: "DELETE" });
      if (res.ok) {
        setVoicemailAudioUrl(null);
        setMessage({ type: "success", text: "Voicemail greeting removed" });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to delete voicemail" });
    }
  };

  // Voicemail recording via browser MediaRecorder
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
        const file = new File([blob], "greeting.webm", { type: "audio/webm" });
        await handleVoicemailUpload(file);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecordingVoicemail(true);
    } catch {
      setMessage({ type: "error", text: "Microphone access denied" });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setRecordingVoicemail(false);
  };

  // Voicemail audio playback
  const togglePlayVoicemail = () => {
    if (!voicemailAudioUrl) return;
    if (playingVoicemail && voicemailAudioRef.current) {
      voicemailAudioRef.current.pause();
      setPlayingVoicemail(false);
    } else {
      if (!voicemailAudioRef.current) {
        voicemailAudioRef.current = new Audio(voicemailAudioUrl);
        voicemailAudioRef.current.onended = () => setPlayingVoicemail(false);
      }
      voicemailAudioRef.current.play();
      setPlayingVoicemail(true);
    }
  };

  // PIN strength helper
  const getPinStrength = (pin: string) => {
    if (!pin) return null;
    if (pin.length < 4) return { label: "Too short", color: "bg-gray-300", width: "w-1/4" };
    if (pin.length === 4) return { label: "Minimum", color: "bg-red-500", width: "w-1/3" };
    if (pin.length === 5) return { label: "Good", color: "bg-yellow-500", width: "w-2/3" };
    return { label: "Strong", color: "bg-green-500", width: "w-full" };
  };

  const handleUpdateEmailPin = async () => {
    if (!emailPin || !/^\d{4,6}$/.test(emailPin)) {
      setEmailPinStatus({ success: false, message: "PIN must be 4-6 digits" });
      return;
    }

    setSavingEmailPin(true);
    setEmailPinStatus(null);

    try {
      // Use unified PIN endpoint — replaces old email-pin and voice-pin endpoints
      const res = await fetch("/api/settings/unified-pin", {
        method: "PUT",
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

  const handleRestartTour = async () => {
    setRestartingTour(true);
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dashboard_tour_seen: false }),
      });
      router.push("/dashboard");
    } catch {
      setMessage({ type: "error", text: "Failed to restart tour" });
      setRestartingTour(false);
    }
  };

  const handleConnect = async (provider: "gmail" | "microsoft" | "nylas", providerHint?: string) => {
    setConnectingProvider(provider);
    setMessage(null);

    try {
      let endpoint: string;
      let body: Record<string, string> = {};
      
      if (provider === "gmail") {
        endpoint = "/api/integrations/gmail";
      } else if (provider === "microsoft") {
        endpoint = "/api/integrations/microsoft";
      } else {
        endpoint = "/api/integrations/nylas";
        if (providerHint) body.provider = providerHint;
      }
      
      const res = await fetch(endpoint, { 
        method: "POST",
        headers: body.provider ? { "Content-Type": "application/json" } : undefined,
        body: body.provider ? JSON.stringify(body) : undefined,
      });

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

  const handleInboxSetupComplete = async () => {
    setShowInboxSetupDialog(false);
    setMessage({ type: "success", text: "Inbox connected successfully!" });
    // Reload integrations to update status
    const inboxRes = await fetch("/api/integrations/inbox");
    if (inboxRes.ok) {
      setInboxStatus(await inboxRes.json());
    }
  };

  const handleDisconnect = async (provider: "gmail" | "microsoft" | "nylas") => {
    const displayName = provider === "gmail" ? "Google" : provider === "microsoft" ? "Microsoft" : "Email";
    if (!confirm(`Disconnect ${displayName}? Your AI will no longer be able to access this account's email, calendar, and files.`)) {
      return;
    }

    setConnectingProvider(provider);
    setMessage(null);

    try {
      let endpoint: string;
      if (provider === "gmail") {
        endpoint = "/api/integrations/gmail";
      } else if (provider === "microsoft") {
        endpoint = "/api/integrations/microsoft";
      } else {
        endpoint = "/api/integrations/nylas";
      }
      const res = await fetch(endpoint, { method: "DELETE" });

      if (!res.ok) throw new Error("Failed to disconnect");

      if (provider === "gmail") {
        setGmailStatus({ connected: false, email: null, connectedAt: null });
      } else if (provider === "microsoft") {
        setMicrosoftStatus({ connected: false, email: null, connectedAt: null });
      } else {
        setNylasStatus({ connected: false, email: null, connectedAt: null });
      }
      setMessage({ type: "success", text: `${displayName} disconnected` });
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
    if (params.get("nylas") === "connected") {
      setMessage({ type: "success", text: "Email connected successfully!" });
      setNylasStatus(prev => prev ? { ...prev, connected: true } : { connected: true, email: null, connectedAt: new Date().toISOString() });
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

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b border-border mb-8 overflow-x-auto">
        {[
          { id: "profile", label: "Profile" },
          { id: "ai", label: "AI Settings" },
          { id: "connections", label: "Connections" },
          { id: "phone", label: "Phone & Voice" },
          { id: "advanced", label: "Advanced" },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${
              activeTab === tab.id
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "profile" && (<>
      {/* Help & Tour */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Dashboard Tour</p>
              <p className="text-sm text-muted-foreground">
                Replay the guided walkthrough of your dashboard
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRestartTour}
              disabled={restartingTour}
              className="gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              {restartingTour ? "Restarting..." : "Restart Tour"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Profile Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            The basics. We promise not to sell this to anyone. Not even a little bit.
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
                {walletLifetimeTopup > 0 ? 'Pay As You Go' : 'Free Plan'}
              </p>
              <p className="text-sm text-muted-foreground">
                {`${profile.messages_used} / ${profile.messages_limit} messages used`}
              </p>
            </div>
            <Button variant="outline" onClick={() => router.push('/dashboard/billing')}>
              Upgrade
            </Button>
          </div>
        </CardContent>
      </Card>
      </>)}

      {/* AI Behavior Settings */}
      {activeTab === "ai" && settings && (
        <Card>
          <CardHeader>
            <CardTitle>AI Behavior</CardTitle>
            <CardDescription>
              Teach your AI how much hand-holding you need. No shame in &quot;a lot.&quot;
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

              {/* Preferred channel for proactive alerts */}
              {proactiveLimit > 0 && (
                <div className="space-y-2 pt-2">
                  <Label className="text-sm">Delivery Channel</Label>
                  <p className="text-xs text-muted-foreground">Where should proactive alerts be sent?</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {[
                      { value: "sms", label: "SMS", icon: "💬" },
                      { value: "telegram", label: "Telegram", icon: "✈️" },
                      { value: "whatsapp", label: "WhatsApp", icon: "📱" },
                      { value: "voice", label: "Voice call", icon: "📞" },
                      { value: "email", label: "Email", icon: "📧" },
                    ].map((ch) => (
                      <button
                        key={ch.value}
                        type="button"
                        onClick={() => setProactiveChannel(ch.value)}
                        className={`flex items-center gap-2 p-2 rounded-lg border text-sm transition-colors ${
                          proactiveChannel === ch.value
                            ? "border-primary bg-primary/10 text-primary font-medium"
                            : "border-border hover:border-muted-foreground"
                        }`}
                      >
                        <span>{ch.icon}</span>
                        {ch.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {proactiveChannel === "telegram" && "Requires Telegram connected in Connected Apps."}
                    {proactiveChannel === "whatsapp" && "Requires WhatsApp connected in Connected Apps."}
                    {proactiveChannel === "voice" && "Requires a phone number on your account."}
                    {proactiveChannel === "sms" && "Sent to your registered phone number."}
                    {proactiveChannel === "email" && "Sent to your account email address."}
                  </p>
                </div>
              )}
            </div>

            {/* Report Frequency */}
            <div className="space-y-3 border-t pt-6">
              <Label>Progress Reports</Label>
              <p className="text-sm text-muted-foreground">
                How often should your AI email you a summary of completed tasks and success rates?
              </p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: "daily", label: "Daily", desc: "Every day" },
                  { value: "weekly", label: "Weekly", desc: "Every Monday" },
                  { value: "never", label: "Never", desc: "Opt out" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setReportFrequency(opt.value)}
                    className={`p-3 rounded-lg border text-left transition-colors ${
                      reportFrequency === opt.value
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <p className="font-medium text-sm">{opt.label}</p>
                    <p className="text-xs text-muted-foreground">{opt.desc}</p>
                  </button>
                ))}
              </div>
              {reportFrequency !== "never" && (
                <p className="text-xs text-muted-foreground">
                  Reports include: tasks completed, success rate, time saved, and top wins for the period.
                </p>
              )}
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
                  <p className="text-sm text-muted-foreground">Your agent gets an anonymous identity (e.g. Anticipy-7K2) and can vent about dark patterns it encounters</p>
                </div>
              </label>
            </div>

            {/* Full Send Mode */}
            <div className="space-y-3 border-t pt-6">
              <div className="flex items-center gap-2">
                <Label className="font-semibold text-base">Full Send Mode</Label>
                {fullSendMode && (
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Active</span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Your AI automatically manages all incoming emails by priority — no more inbox noise. Newsletters and spam are silently filtered. Low-priority emails get a quick acknowledgement. Important emails get a full reply and you&apos;re notified via SMS.
              </p>
              <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
                <input
                  type="checkbox"
                  checked={fullSendMode}
                  onChange={(e) => setFullSendMode(e.target.checked)}
                  className="mt-1 w-4 h-4 rounded"
                />
                <div>
                  <p className="font-medium">Enable Full Send Mode</p>
                  <p className="text-sm text-muted-foreground">Let your AI handle incoming email autonomously based on priority</p>
                </div>
              </label>

              {fullSendMode && (
                <div className="space-y-4 pl-1">
                  {/* Auto-reply toggle */}
                  <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
                    <input
                      type="checkbox"
                      checked={fullSendAutoReply}
                      onChange={(e) => setFullSendAutoReply(e.target.checked)}
                      className="mt-1 w-4 h-4 rounded"
                    />
                    <div>
                      <p className="font-medium">Auto-send replies</p>
                      <p className="text-sm text-muted-foreground">AI drafts and sends replies automatically (not just saves drafts)</p>
                    </div>
                  </label>

                  {/* Reply threshold */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Reply threshold</Label>
                    <p className="text-xs text-muted-foreground">Which emails should get a full AI-written reply?</p>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { value: "all", label: "All emails", desc: "Every email gets a reply" },
                        { value: "medium", label: "Medium+", desc: "Personal & urgent emails (recommended)" },
                        { value: "high", label: "High priority only", desc: "Only flagged urgent or action-required" },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setFullSendDraftThreshold(opt.value as "all" | "medium" | "high")}
                          className={`p-3 rounded-lg border text-left transition-colors ${
                            fullSendDraftThreshold === opt.value
                              ? "border-primary bg-primary/10"
                              : "border-border hover:bg-muted/50"
                          }`}
                        >
                          <p className="font-medium text-sm">{opt.label}</p>
                          <p className="text-xs text-muted-foreground">{opt.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Priority breakdown */}
                  <div className="bg-muted/30 p-3 rounded-lg border text-xs space-y-1.5">
                    <p className="font-semibold text-sm mb-2">How emails are handled:</p>
                    <div className="flex items-start gap-2"><span className="text-red-500 font-bold w-20 shrink-0">Spam</span><span className="text-muted-foreground">Silently filtered — no reply, no task created</span></div>
                    <div className="flex items-start gap-2"><span className="text-orange-500 font-bold w-20 shrink-0">Newsletter</span><span className="text-muted-foreground">Silently filtered — no reply, no task created</span></div>
                    <div className="flex items-start gap-2"><span className="text-yellow-600 font-bold w-20 shrink-0">Notification</span><span className="text-muted-foreground">Brief &quot;Got it&quot; acknowledgement sent, logged to activity</span></div>
                    <div className="flex items-start gap-2"><span className="text-blue-500 font-bold w-20 shrink-0">Medium</span><span className="text-muted-foreground">Full reply drafted and sent (if threshold allows)</span></div>
                    <div className="flex items-start gap-2"><span className="text-purple-600 font-bold w-20 shrink-0">High/Urgent</span><span className="text-muted-foreground">Full reply sent + you get an SMS alert immediately</span></div>
                  </div>
                </div>
              )}
            </div>

            {/* Hive Mind Learning Uploads */}
            <div className="space-y-3">
              <Label>Hive Mind Learning Uploads</Label>
              <p className="text-sm text-muted-foreground">
                Allow your AI agent to share anonymous learnings (successful action patterns) with the global Hive Mind.
                All personal information is automatically scrubbed before upload — emails, names, passwords are never shared.
                This helps ALL Anticipy agents get smarter over time.
              </p>
              <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
                <input
                  type="checkbox"
                  checked={allowHiveLearning}
                  onChange={(e) => setAllowHiveLearning(e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                <div>
                  <p className="font-medium">Share anonymous learnings</p>
                  <p className="text-sm text-muted-foreground">
                    When your agent successfully completes a task, it shares the action sequence (with PII redacted)
                    to help other agents learn. Example: &quot;To login to GitHub, click button with selector .btn-primary&quot;
                  </p>
                </div>
              </label>
              <div className="bg-muted/30 p-3 rounded-lg border border-blue-500/20">
                <p className="text-xs text-muted-foreground">
                  <strong className="text-blue-600">Privacy guaranteed:</strong> We scrub emails, phone numbers, passwords,
                  tokens, names, addresses, and all other PII before upload. Only generic action patterns are shared.
                  {!allowHiveLearning && <span className="block mt-1 text-orange-600 font-semibold">⚠️ Currently opted out — your agent cannot benefit from or contribute to collective learning.</span>}
                </p>
              </div>
            </div>

          </CardContent>
          <CardFooter>
            <Button onClick={handleSaveSettings} disabled={savingSettings}>
              {savingSettings ? "Saving..." : "Save AI Settings"}
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Advanced tab intro */}
      {activeTab === "advanced" && (
        <p className="text-sm text-muted-foreground/60 italic mb-6">Welcome to the engine room. You probably don&apos;t need to be here, but we respect the curiosity.</p>
      )}

      {/* Autonomous Features */}
      {activeTab === "advanced" && settings && (
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

      {/* Task Execution */}
      {activeTab === "advanced" && settings && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <BarChart2 className="w-5 h-5" />
              <CardTitle>Task Execution</CardTitle>
            </div>
            <CardDescription>
              Control how much time and resources the AI spends on each task
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Per-Task Budget */}
            <div className="space-y-2">
              <Label className="font-semibold">Per-Task Budget</Label>
              <p className="text-xs text-muted-foreground">
                Maximum cost per individual task. Higher budgets allow more complex tasks.
              </p>
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min={100}
                  max={5000}
                  step={50}
                  value={settings.task_budget_cents ?? 500}
                  onChange={(e) => setSettings({ ...settings, task_budget_cents: parseInt(e.target.value) })}
                  className="flex-1 accent-primary"
                />
                <span className="text-sm font-medium w-16 text-right">
                  ${((settings.task_budget_cents ?? 500) / 100).toFixed(2)}
                </span>
              </div>
            </div>

            {/* Task Timeout */}
            <div className="space-y-2">
              <Label className="font-semibold">Task Timeout</Label>
              <p className="text-xs text-muted-foreground">
                How long a task can run before auto-completing. Longer timeouts for complex tasks.
              </p>
              <select
                value={settings.master_timeout_minutes ?? 15}
                onChange={(e) => setSettings({ ...settings, master_timeout_minutes: parseInt(e.target.value) })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value={5}>5 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>1 hour</option>
                <option value={180}>3 hours</option>
                <option value={480}>8 hours</option>
              </select>
            </div>

            {/* Max Iterations */}
            <div className="space-y-2">
              <Label className="font-semibold">Max Attempts</Label>
              <p className="text-xs text-muted-foreground">
                How many rounds the AI tries before completing. More attempts = more thorough.
              </p>
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min={5}
                  max={30}
                  step={1}
                  value={settings.max_task_iterations ?? 15}
                  onChange={(e) => setSettings({ ...settings, max_task_iterations: parseInt(e.target.value) })}
                  className="flex-1 accent-primary"
                />
                <span className="text-sm font-medium w-8 text-right">
                  {settings.max_task_iterations ?? 15}
                </span>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button onClick={handleSaveSettings} disabled={savingSettings}>
              {savingSettings ? "Saving..." : "Save Task Settings"}
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Agent Card */}
      {activeTab === "advanced" && (
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
      )}

      {/* Quick Inbox Setup */}
      {activeTab === "connections" && (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Inbox className="w-5 h-5" />
            <CardTitle>Quick Inbox Setup</CardTitle>
          </div>
          <CardDescription>
            Connect your email inbox in one click - no OAuth verification needed
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {integrationsLoading ? (
            <p className="text-sm text-muted-foreground">Loading inbox status...</p>
          ) : inboxStatus?.connected ? (
            <div className="flex items-center justify-between p-4 border rounded-lg bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-900">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <Mail className="w-5 h-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="font-medium">Inbox Connected</p>
                  <p className="text-sm text-green-600 dark:text-green-400">
                    {inboxStatus.email}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Method: {inboxStatus.method === "imap" ? "App Password (IMAP)" : "OAuth"}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  if (confirm("Disconnect inbox? Your AI will no longer be able to read and send emails.")) {
                    try {
                      const res = await fetch("/api/integrations/inbox", { method: "DELETE" });
                      if (res.ok) {
                        setInboxStatus({ connected: false, email: null, connectedAt: null });
                        setMessage({ type: "success", text: "Inbox disconnected" });
                      }
                    } catch {
                      setMessage({ type: "error", text: "Failed to disconnect inbox" });
                    }
                  }
                }}
              >
                Disconnect
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-blue-50 dark:bg-blue-950/30 p-4 rounded-lg space-y-2">
                <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                  Apple-like simplicity - no technical setup
                </p>
                <ul className="text-xs text-blue-800 dark:text-blue-200 space-y-1 list-disc list-inside">
                  <li>One button to connect Gmail or Outlook</li>
                  <li>We auto-configure all IMAP settings</li>
                  <li>Just paste your app password - we handle the rest</li>
                  <li>No OAuth verification needed (we&apos;re not verified by Google yet)</li>
                </ul>
              </div>
              <Button
                onClick={() => setShowInboxSetupDialog(true)}
                className="w-full"
              >
                <Mail className="w-4 h-4 mr-2" />
                Connect Your Inbox (1-Click)
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* Integrations */}
      {activeTab === "connections" && (
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

              {/* Nylas - One-click email (Recommended) */}
              <div className="flex items-center justify-between p-4 border rounded-lg bg-green-50/30 dark:bg-green-950/10 border-green-200 dark:border-green-900">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                    <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">One-Click Email</p>
                      <span className="text-xs px-2 py-0.5 bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 rounded-full">Recommended</span>
                    </div>
                    {nylasStatus?.connected ? (
                      <>
                        <p className="text-sm text-green-600 dark:text-green-400">
                          Connected{nylasStatus.email ? ` - ${nylasStatus.email}` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Gmail, Outlook, Yahoo, Calendar
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm text-muted-foreground">
                          Connect any email with one click
                        </p>
                        <p className="text-xs text-green-600 dark:text-green-600">
                          No app passwords needed • Works with all providers
                        </p>
                      </>
                    )}
                  </div>
                </div>
                {nylasStatus?.connected ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDisconnect("nylas")}
                    disabled={connectingProvider === "nylas"}
                  >
                    {connectingProvider === "nylas" ? "..." : "Disconnect"}
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleConnect("nylas", "google")}
                      disabled={connectingProvider === "nylas"}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      {connectingProvider === "nylas" ? "Connecting..." : "Connect"}
                    </Button>
                  </div>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                Your tokens are encrypted with AES-256-GCM and automatically refreshed. Disconnect anytime.
                One-Click Email is powered by Nylas.
              </p>
            </>
          )}
        </CardContent>
      </Card>
      )}

      {/* Inbox Management */}
      {activeTab === "connections" && (<>
      <InboxManagementSettings />

      {/* Credential Vault - Saved Passwords */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <CardTitle>Saved Passwords</CardTitle>
          </div>
          <CardDescription>
            Store credentials for websites your AI needs to access. Encrypted with AES-256-GCM.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Add New Credential */}
          <div className="bg-slate-50 dark:bg-slate-900 border rounded-lg p-4 space-y-4">
            <h4 className="font-semibold text-sm">Add New Credential</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="siteDomain" className="text-xs">Website (e.g., netflix.com)</Label>
                <Input
                  id="siteDomain"
                  value={newCredential.site_domain}
                  onChange={(e) => setNewCredential({ ...newCredential, site_domain: e.target.value })}
                  placeholder="netflix.com"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="siteUsername" className="text-xs">Username / Email</Label>
                <Input
                  id="siteUsername"
                  value={newCredential.username}
                  onChange={(e) => setNewCredential({ ...newCredential, username: e.target.value })}
                  placeholder="your@email.com"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="sitePassword" className="text-xs">Password</Label>
                <Input
                  id="sitePassword"
                  type="password"
                  value={newCredential.password}
                  onChange={(e) => setNewCredential({ ...newCredential, password: e.target.value })}
                  placeholder="••••••••"
                  className="mt-1"
                />
              </div>
            </div>
            <Button
              onClick={async () => {
                if (!newCredential.site_domain || !newCredential.username || !newCredential.password) {
                  setMessage({ type: "error", text: "Please fill in all fields" });
                  return;
                }
                setAddingCredential(true);
                try {
                  const res = await fetch("/api/credentials", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(newCredential),
                  });
                  if (res.ok) {
                    setMessage({ type: "success", text: "Credential saved successfully" });
                    setNewCredential({ site_domain: "", username: "", password: "" });
                    // Refresh list
                    const credsRes = await fetch("/api/credentials");
                    const credsData = await credsRes.json();
                    setCredentials(credsData.credentials || []);
                  } else {
                    setMessage({ type: "error", text: "Failed to save credential" });
                  }
                } catch {
                  setMessage({ type: "error", text: "Failed to save credential" });
                } finally {
                  setAddingCredential(false);
                }
              }}
              disabled={addingCredential}
              className="w-full md:w-auto"
            >
              {addingCredential ? "Saving..." : "Save Credential"}
            </Button>
          </div>

          {/* Saved Credentials List */}
          <div>
            <h4 className="font-semibold text-sm mb-3">Your Saved Credentials</h4>
            {loadingCredentials ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : credentials.length === 0 ? (
              <p className="text-sm text-muted-foreground">No saved credentials yet.</p>
            ) : (
              <div className="space-y-2">
                {credentials.map((cred) => (
                  <div key={cred.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
                    <div>
                      <p className="font-medium">{cred.site_domain}</p>
                      <p className="text-xs text-muted-foreground">{cred.username}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        try {
                          const res = await fetch(`/api/credentials/${cred.id}`, { method: "DELETE" });
                          if (res.ok) {
                            setCredentials(credentials.filter((c) => c.id !== cred.id));
                            setMessage({ type: "success", text: "Credential deleted" });
                          }
                        } catch {
                          setMessage({ type: "error", text: "Failed to delete credential" });
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Your AI will use these credentials to log into websites on your behalf. 
            Credentials are encrypted and never shared. For 2FA, the AI will ask you for the code.
          </p>
        </CardContent>
      </Card>
      </>)}

      {/* Phone & Voice Settings */}
      {activeTab === "phone" && (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Phone className="w-5 h-5" />
            <CardTitle>Phone & Voice</CardTitle>
          </div>
          <CardDescription>
            Manage your phone number, voice calls, voicemail, and daily check-ins
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
            <div className="flex items-center gap-1 mt-1">
              <p className="text-xs text-muted-foreground">
                Call or text{" "}
                <button
                  type="button"
                  onClick={() => handleCopyPhone("+18882981661")}
                  className="inline-flex items-center gap-1 font-mono font-semibold hover:text-primary transition-colors"
                >
                  +1 (604) 332-1466
                  {copiedPhone ? (
                    <Check className="w-3 h-3 text-green-500 transition-all" />
                  ) : (
                    <Copy className="w-3 h-3 opacity-50" />
                  )}
                </button>
                {" "}from this number anytime
              </p>
            </div>
          </div>

          {/* Voice PIN with strength indicator */}
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
              {/* PIN strength bar */}
              {voicePin && (
                <div className="mt-2">
                  <div className="h-1.5 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ease-out ${getPinStrength(voicePin)?.color || "bg-gray-300"} ${getPinStrength(voicePin)?.width || "w-0"}`}
                    />
                  </div>
                  <p className={`text-xs mt-1 ${
                    getPinStrength(voicePin)?.color === "bg-green-500" ? "text-green-600" :
                    getPinStrength(voicePin)?.color === "bg-yellow-500" ? "text-yellow-600" :
                    getPinStrength(voicePin)?.color === "bg-red-500" ? "text-red-600" : "text-muted-foreground"
                  }`}>
                    {getPinStrength(voicePin)?.label}
                  </p>
                </div>
              )}
              {!voicePin && (
                <p className="text-xs text-muted-foreground mt-1">
                  Works across: Voice • Email • Telegram • WhatsApp
                </p>
              )}
              <p className="text-xs text-muted-foreground/50 italic mt-1">Your PIN keeps strangers out. Even the charming ones.</p>
            </div>
          )}

          {/* Voice Preference — card-based picker */}
          <div>
            <Label className="mb-3 block">AI Voice</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { id: "21m00Tcm4TlvDq8ikWAM", label: "Rachel", desc: "Natural, warm (female)" },
                { id: "EXAVITQu4vr4xnSDxMaL", label: "Sarah", desc: "Soft, warm (female)" },
                { id: "XB0fDUnXU5powFXDhCwa", label: "Charlotte", desc: "Bright, professional (female)" },
                { id: "XrExE9yKIg1WjnnlVkGX", label: "Matilda", desc: "Warm, engaging (female)" },
                { id: "nPczCjzI2devNBz1zQrb", label: "Brian", desc: "Deep, authoritative (male)" },
                { id: "29vD33N1CtxCmqQRPOHJ", label: "Drew", desc: "Confident, clear (male)" },
                { id: "CYw3kZ02Hs0563khs1Fj", label: "Dave", desc: "Casual, friendly (male)" },
                { id: "iP95p4xoKVk53GoZ742B", label: "Chris", desc: "Clean, professional (male)" },
              ].map((voice) => (
                <button
                  key={voice.id}
                  type="button"
                  onClick={async () => {
                    setSettings({ ...settings, voice_preference: voice.id } as UserSettings);
                    // Auto-save voice preference immediately on click
                    try {
                      await fetch("/api/settings", {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ ...settings, voice_preference: voice.id }),
                      });
                    } catch {}
                  }}
                  className={`relative flex items-center gap-3 p-3 rounded-lg border text-left transition-all duration-200 ${
                    (settings?.voice_preference || "EXAVITQu4vr4xnSDxMaL") === voice.id
                      ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                      : "border-input hover:border-primary/40 hover:bg-muted/50"
                  }`}
                >
                  <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-violet-500 to-purple-600">
                    <Volume2 className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium">{voice.label}</span>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">ElevenLabs</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{voice.desc}</span>
                  </div>
                  {(settings?.voice_preference || "EXAVITQu4vr4xnSDxMaL") === voice.id && (
                    <Check className="w-4 h-4 text-primary flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              All voices powered by ElevenLabs — natural, human-like speech on every call.
            </p>
            <p className="text-xs text-muted-foreground/50 italic">Pick a voice. Your AI won&apos;t be offended if you change it later.</p>
          </div>

          {/* Greeting Style */}
          {settings && (
            <div className="border-t pt-6">
              <Label className="mb-2 block">Greeting Style</Label>
              <p className="text-xs text-muted-foreground mb-3">
                How should your AI greet you when you call?
              </p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: "casual", label: "Casual", desc: "\"Hey! What can I help with?\"" },
                  { value: "jarvis", label: "Jarvis", desc: "\"Good morning. How may I assist you?\"" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={async () => {
                      const updated = { ...settings, greeting_style: opt.value as "casual" | "jarvis" };
                      setSettings(updated);
                      try {
                        await fetch("/api/settings", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ greeting_style: opt.value }),
                        });
                      } catch {}
                    }}
                    className={`p-3 rounded-lg border text-left transition-colors ${
                      (settings.greeting_style || "casual") === opt.value
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <p className="font-medium text-sm">{opt.label}</p>
                    <p className="text-xs text-muted-foreground">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Voicemail */}
          <div className="border-t pt-6">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h4 className="font-semibold text-sm flex items-center gap-2">
                  <Volume2 className="w-4 h-4" />
                  Voicemail
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Custom greeting for callers when you&apos;re unavailable
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={voicemailEnabled}
                  onChange={(e) => setVoicemailEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
              </label>
            </div>

            {voicemailEnabled && (
              <div className="space-y-4 pl-4 border-l-2 border-primary/20">
                {/* Text greeting */}
                <div>
                  <Label htmlFor="voicemailText" className="text-xs">Greeting Text</Label>
                  <textarea
                    id="voicemailText"
                    value={voicemailText}
                    onChange={(e) => setVoicemailText(e.target.value.slice(0, 1000))}
                    placeholder="Hi, you've reached my AI assistant. I'm not available right now, but leave a message and I'll get back to you!"
                    rows={3}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {voicemailText.length}/1000 characters. AI will speak this text with your chosen voice.
                  </p>
                </div>

                {/* Audio greeting upload/record */}
                <div>
                  <Label className="text-xs mb-2 block">Or Upload/Record Audio</Label>

                  {voicemailAudioUrl ? (
                    <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg border">
                      <button
                        type="button"
                        onClick={togglePlayVoicemail}
                        className="w-8 h-8 rounded-full bg-primary flex items-center justify-center hover:bg-primary/90 transition-colors"
                      >
                        {playingVoicemail ? (
                          <Pause className="w-4 h-4 text-primary-foreground" />
                        ) : (
                          <Play className="w-4 h-4 text-primary-foreground ml-0.5" />
                        )}
                      </button>
                      <div className="flex-1">
                        <p className="text-xs font-medium">Custom greeting uploaded</p>
                        <p className="text-[10px] text-muted-foreground">Audio greeting overrides text greeting</p>
                      </div>
                      <button
                        type="button"
                        onClick={handleVoicemailDelete}
                        className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <label className="flex-1">
                        <input
                          type="file"
                          accept="audio/mpeg,audio/wav,audio/webm,audio/ogg"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleVoicemailUpload(file);
                            e.target.value = "";
                          }}
                        />
                        <div className={`flex items-center justify-center gap-2 p-2.5 rounded-lg border border-dashed cursor-pointer transition-colors ${
                          uploadingVoicemail ? "opacity-50 pointer-events-none" : "hover:border-primary hover:bg-primary/5"
                        }`}>
                          <Upload className="w-4 h-4 text-muted-foreground" />
                          <span className="text-xs">{uploadingVoicemail ? "Uploading..." : "Upload MP3/WAV"}</span>
                        </div>
                      </label>

                      <button
                        type="button"
                        onClick={recordingVoicemail ? stopRecording : startRecording}
                        className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border transition-all ${
                          recordingVoicemail
                            ? "border-red-500 bg-red-50 dark:bg-red-950 text-red-600 animate-pulse"
                            : "border-dashed hover:border-primary hover:bg-primary/5"
                        }`}
                      >
                        <Mic className={`w-4 h-4 ${recordingVoicemail ? "text-red-500" : "text-muted-foreground"}`} />
                        <span className="text-xs">{recordingVoicemail ? "Stop" : "Record"}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Messaging Channels Status */}
          <div className="border-t pt-6">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-sm">Messaging Channels</h4>
              <a href="/dashboard/apps" className="text-xs text-primary hover:underline">Manage →</a>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Your Security PIN works across all channels below.
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                ✓ Email
              </span>
              <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                ✓ SMS
              </span>
              <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                ✓ Voice
              </span>
              <a href="/dashboard/apps" className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors">
                + Telegram
              </a>
              <a href="/dashboard/apps" className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors">
                + WhatsApp
              </a>
            </div>
          </div>

          {/* Premium Number */}
          {premiumNumber ? (
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-semibold text-sm">Your Dedicated Number</h4>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-2xl font-mono">{premiumNumber}</p>
                    <button
                      type="button"
                      onClick={() => handleCopyPhone(premiumNumber)}
                      className="p-1 rounded hover:bg-primary/10 transition-colors"
                    >
                      {copiedPhone ? (
                        <Check className="w-4 h-4 text-green-500" />
                      ) : (
                        <Copy className="w-4 h-4 text-muted-foreground" />
                      )}
                    </button>
                  </div>
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
                    Purchase a dedicated US or Canadian number for $2/mo. Choose your area code!
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
                    AI calls you with personalized greetings and task updates
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
          <Button
            onClick={handleSavePhoneSettings}
            disabled={savingPhone}
            className="relative min-w-[160px] transition-all duration-300"
          >
            {phoneSaveSuccess ? (
              <span className="flex items-center gap-2">
                <Check className="w-4 h-4 text-green-400" />
                Saved
              </span>
            ) : savingPhone ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Saving...
              </span>
            ) : (
              "Save Phone Settings"
            )}
          </Button>
        </CardFooter>
      </Card>
      )}

      {/* Agent Passwords */}
      {activeTab === "advanced" && (
      <Card className="border-border">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5 text-muted-foreground" />
            <div>
              <CardTitle>Agent Passwords</CardTitle>
              <CardDescription>Passwords your AI can use when creating accounts on websites</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Store up to 3 passwords. Your AI uses the primary password first, then secondary, then tertiary.
            Encrypted with AES-256-GCM — never visible in plaintext after saving.
          </p>
          {(["primary", "secondary", "tertiary"] as const).map((slot) => (
            <div key={slot} className="space-y-1">
              <Label htmlFor={`pwd-${slot}`} className="capitalize text-sm">{slot} Password</Label>
              <div className="flex gap-2">
                <Input
                  id={`pwd-${slot}`}
                  type="password"
                  placeholder={agentPasswordSlots[slot] ? "••••••••" : `Enter ${slot} password`}
                  value={agentPasswordInputs[slot]}
                  onChange={(e) => setAgentPasswordInputs(prev => ({ ...prev, [slot]: e.target.value }))}
                  className="flex-1"
                />
                {agentPasswordSlots[slot] && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await fetch("/api/settings/agent-passwords", {
                        method: "DELETE",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ slot }),
                      });
                      setAgentPasswordSlots(prev => ({ ...prev, [slot]: false }));
                    }}
                    className="text-destructive hover:text-destructive"
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>
          ))}
          <Button
            onClick={async () => {
              setSavingAgentPasswords(true);
              const body: Record<string, string> = {};
              if (agentPasswordInputs.primary) body.primary = agentPasswordInputs.primary;
              if (agentPasswordInputs.secondary) body.secondary = agentPasswordInputs.secondary;
              if (agentPasswordInputs.tertiary) body.tertiary = agentPasswordInputs.tertiary;
              if (Object.keys(body).length === 0) { setSavingAgentPasswords(false); return; }
              await fetch("/api/settings/agent-passwords", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              });
              setAgentPasswordInputs({ primary: "", secondary: "", tertiary: "" });
              // Refresh slots
              const res = await fetch("/api/settings/agent-passwords");
              if (res.ok) setAgentPasswordSlots(await res.json());
              setSavingAgentPasswords(false);
              setMessage({ type: "success", text: "Agent passwords saved" });
            }}
            disabled={savingAgentPasswords || (!agentPasswordInputs.primary && !agentPasswordInputs.secondary && !agentPasswordInputs.tertiary)}
            size="sm"
          >
            {savingAgentPasswords ? "Saving..." : "Save Passwords"}
          </Button>
        </CardContent>
      </Card>
      )}

      {/* Developer Mode */}
      {activeTab === "advanced" && (
      <div id="developer">
        <Card className="border-border">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Code2 className="w-5 h-5 text-muted-foreground" />
                <div>
                  <CardTitle>Developer Mode</CardTitle>
                  <CardDescription>Raw API access, webhook logs, and settings that can break things in creative ways.</CardDescription>
                </div>
              </div>
              <button
                onClick={() => setDevModeOpen(!devModeOpen)}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {devModeOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                {devModeOpen ? "Hide" : "Show"}
              </button>
            </div>
          </CardHeader>

          {devModeOpen && (
            <CardContent className="space-y-6">
              <p className="text-xs text-amber-600 italic">I solemnly swear I know what I&apos;m doing.</p>
              {/* Warning banner */}
              <div className="flex items-start gap-3 p-4 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold text-yellow-800 dark:text-yellow-300">For technical users only</p>
                  <p className="text-yellow-700 dark:text-yellow-400 mt-1">
                    Custom model settings can affect AI quality, response style, and costs. Changes take effect immediately.
                    The system may fall back to default models if your settings cause failures.
                  </p>
                </div>
              </div>

              {/* What is OpenRouter */}
              <div className="space-y-2">
                <h3 className="font-semibold flex items-center gap-2">
                  OpenRouter Integration
                  <a
                    href="https://openrouter.ai"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3" />
                    openrouter.ai
                  </a>
                </h3>
                <p className="text-sm text-muted-foreground">
                  OpenRouter provides access to 200+ AI models through a single API key.
                  This includes free models (rate-limited), frontier models, and specialized models.
                  Connect your own key to route Anticipy&apos;s AI calls through your preferred models.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                  <div className="border border-border rounded-lg p-3 text-sm">
                    <p className="font-medium text-green-700 dark:text-green-400">Free Models</p>
                    <p className="text-muted-foreground text-xs mt-1">
                      Llama 3.3 70B, DeepSeek V3, Qwen 2.5 72B — rate-limited but free. Good for non-critical tasks.
                    </p>
                  </div>
                  <div className="border border-border rounded-lg p-3 text-sm">
                    <p className="font-medium text-blue-700 dark:text-blue-400">Quality Models</p>
                    <p className="text-muted-foreground text-xs mt-1">
                      Claude Sonnet, GPT-4o, Gemini 1.5 Pro — best quality, higher cost via your OpenRouter credits.
                    </p>
                  </div>
                  <div className="border border-border rounded-lg p-3 text-sm">
                    <p className="font-medium text-purple-700 dark:text-purple-400">Live Pricing</p>
                    <p className="text-muted-foreground text-xs mt-1">
                      OpenRouter exposes real-time pricing via API — the only source of live rates across all providers.
                    </p>
                  </div>
                </div>
              </div>

              {/* API Key field */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="or-api-key">OpenRouter API Key</Label>
                  {orHasKey && (
                    <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" />
                      Key saved
                    </span>
                  )}
                </div>
                {orHasKey && orMaskedKey && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 px-3 py-2 rounded-md font-mono">
                    {orMaskedKey}
                    <button
                      onClick={handleRemoveOpenRouterKey}
                      disabled={orLoading}
                      className="ml-auto text-xs text-red-600 hover:text-red-700 dark:text-red-400"
                    >
                      Remove
                    </button>
                  </div>
                )}
                <div className="relative">
                  <Input
                    id="or-api-key"
                    type={orShowKey ? "text" : "password"}
                    placeholder={orHasKey ? "Enter new key to replace existing..." : "sk-or-v1-..."}
                    value={orApiKeyInput}
                    onChange={(e) => setOrApiKeyInput(e.target.value)}
                    className="pr-10 font-mono text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setOrShowKey(!orShowKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {orShowKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Get your key at{" "}
                  <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    openrouter.ai/keys
                  </a>
                  . Keys start with <span className="font-mono">sk-or-</span>. Stored encrypted at rest.
                </p>
              </div>

              {/* Enable toggle + preset */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Enable OpenRouter Routing</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      When on, AI calls route through your OpenRouter key. Requires valid key above.
                    </p>
                  </div>
                  <Switch
                    checked={orEnabled}
                    onCheckedChange={setOrEnabled}
                    disabled={!orHasKey && !orApiKeyInput}
                  />
                </div>

                {orEnabled && (
                  <div className="space-y-2 pl-4 border-l-2 border-primary/30">
                    <Label>Model Preset</Label>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {[
                        { id: "auto", label: "Auto", desc: "System picks best model per task type" },
                        { id: "free", label: "Free Only", desc: "Free models only (rate-limited)" },
                        { id: "quality", label: "Quality", desc: "Best quality models, higher cost" },
                        { id: "balanced", label: "Balanced", desc: "Good quality at moderate cost" },
                      ].map((preset) => (
                        <button
                          key={preset.id}
                          onClick={() => setOrPreset(preset.id)}
                          className={`p-3 text-left border rounded-lg transition-all text-sm ${
                            orPreset === preset.id
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-muted-foreground"
                          }`}
                        >
                          <p className="font-medium">{preset.label}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{preset.desc}</p>
                        </button>
                      ))}
                    </div>

                    <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg mt-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        <strong>Free Only</strong> preset uses rate-limited free models. Tasks may fail or be slower during peak hours.
                        <strong> Quality</strong> preset will charge your OpenRouter account.
                        Anticipy is not responsible for OpenRouter charges.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Cost Analytics link */}
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <BarChart2 className="w-4 h-4" />
                <Link href="/dashboard/billing" className="text-primary hover:underline">
                  View Billing →
                </Link>
                <span>to see spending and credit balance</span>
              </div>

              {/* Save */}
              {orMessage && (
                <div className={`text-sm px-3 py-2 rounded-md ${
                  orMessage.type === "success"
                    ? "bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-300"
                    : "bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-300"
                }`}>
                  {orMessage.text}
                </div>
              )}
              <Button onClick={handleSaveOpenRouter} disabled={orSaving} variant="outline">
                {orSaving ? "Saving..." : "Save Developer Settings"}
              </Button>
            </CardContent>
          )}
        </Card>
      </div>
      )}

      {/* Developer Portal */}
      {activeTab === "advanced" && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Code2 className="h-5 w-5" /> Developer</CardTitle>
          <CardDescription>Build and publish widgets on the Anticipy App Store</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex justify-between items-center">
            <div>
              <p className="font-medium text-sm">Developer Portal</p>
              <p className="text-sm text-muted-foreground">Create widgets, submit for review, and earn 70% of every sale</p>
            </div>
            <Link href="/developer" className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
              Open Portal <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
        </CardContent>
      </Card>
      )}

      {/* Danger Zone */}
      {activeTab === "advanced" && (
      <Card className="border-red-200">
        <CardHeader>
          <CardTitle className="text-red-600">Danger Zone</CardTitle>
          <CardDescription>
            This is permanent. Like, actually permanent. Not &quot;Facebook permanent.&quot;
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
      )}

      {/* Purchase Number Modal */}
      <PurchaseNumberModal
        isOpen={showPurchaseModal}
        onClose={() => setShowPurchaseModal(false)}
        onSuccess={(number) => {
          setPremiumNumber(number);
          setMessage({ type: "success", text: `Number ${number} purchased successfully!` });
        }}
      />

      {/* Inbox Setup Dialog */}
      <Dialog open={showInboxSetupDialog} onOpenChange={setShowInboxSetupDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Connect Your Inbox</DialogTitle>
            <DialogDescription>
              One-click setup with app passwords - no OAuth verification needed
            </DialogDescription>
          </DialogHeader>
          <InboxSetupWizard onComplete={handleInboxSetupComplete} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
