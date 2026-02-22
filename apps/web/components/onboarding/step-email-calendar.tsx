"use client";

import { useState } from "react";

interface StepEmailCalendarProps {
  onNext: () => void;
  onBack: () => void;
}

type ImapProvider = "gmail" | "outlook" | "yahoo" | "icloud" | "other";

const IMAP_GUIDES: Record<ImapProvider, { videoId?: string; videoDuration?: string; steps: { text: string; url?: string; urlLabel?: string }[] }> = {
  gmail: {
    videoId: "N_J3HCATA1c",
    videoDuration: "41s",
    steps: [
      { text: "Go to", url: "https://myaccount.google.com/security", urlLabel: "Google Account Security" },
      { text: "Ensure 2-Step Verification is On" },
      { text: "Open", url: "https://myaccount.google.com/apppasswords", urlLabel: "App Passwords" },
      { text: 'Type "Aevoy" → click Create → copy the 16-char password' },
    ],
  },
  outlook: {
    videoId: "nP1F5NEpuWQ",
    videoDuration: "51s",
    steps: [
      { text: "Go to", url: "https://account.microsoft.com/security", urlLabel: "Microsoft Security" },
      { text: "Click Advanced security options → enable Two-step verification" },
      { text: "Under App passwords → Create a new app password" },
      { text: "Copy the generated password" },
    ],
  },
  yahoo: {
    videoId: "h_LrGeNV36g",
    videoDuration: "48s",
    steps: [
      { text: "Go to", url: "https://login.yahoo.com/account/security", urlLabel: "Yahoo Account Security" },
      { text: "Enable Two-step verification" },
      { text: 'Click Generate app password → Other app → type "Aevoy"' },
      { text: "Copy the generated password" },
    ],
  },
  icloud: {
    videoId: "IeFkbBI0DXs",
    videoDuration: "33s",
    steps: [
      { text: "Sign in at", url: "https://appleid.apple.com", urlLabel: "appleid.apple.com" },
      { text: "Under Sign-In and Security → App-Specific Passwords" },
      { text: 'Click + → label it "Aevoy" → Create' },
      { text: "Copy the xxxx-xxxx-xxxx-xxxx password" },
    ],
  },
  other: {
    steps: [
      { text: "In your email provider's settings → Security or Account" },
      { text: "Enable IMAP access + App passwords or 2-factor auth" },
      { text: "Generate an app-specific password → copy it" },
    ],
  },
};

export default function StepEmailCalendar({ onNext, onBack }: StepEmailCalendarProps) {
  const [connected, setConnected] = useState(false);
  const [imapProvider, setImapProvider] = useState<ImapProvider>("gmail");
  const [imapEmail, setImapEmail] = useState("");
  const [imapPassword, setImapPassword] = useState("");
  const [connectingImap, setConnectingImap] = useState(false);
  const [imapError, setImapError] = useState("");

  const handleConnectImap = async () => {
    if (!imapEmail || !imapPassword) return;
    setConnectingImap(true);
    setImapError("");
    try {
      const res = await fetch("/api/integrations/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: imapEmail, password: imapPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        setConnected(true);
      } else {
        setImapError(data.error || "Could not connect — check your app password");
      }
    } catch {
      setImapError("Connection failed — please try again");
    } finally {
      setConnectingImap(false);
    }
  };

  const guide = IMAP_GUIDES[imapProvider];

  return (
    <div className="max-w-2xl mx-auto px-6 w-full max-h-[calc(100dvh-8rem)] overflow-y-auto">
      {/* Header */}
      <div className="text-center mb-5">
        <div className="text-4xl mb-4">📬</div>
        <h1 className="font-bold text-gray-900 mb-2 text-2xl">Connect Your Email</h1>
        <p className="text-gray-500">
          Aevoy reads, prioritizes, and responds to your emails — quietly working in the background.
        </p>
        <span className="inline-block mt-3 text-xs font-medium text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
          Optional — you can do this later in Settings
        </span>
      </div>

      {/* Connected state */}
      {connected ? (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-6 text-center mb-8">
          <div className="text-3xl mb-2">✓</div>
          <p className="font-semibold text-green-800">{imapEmail} connected!</p>
          <p className="text-sm text-green-600 mt-1">
            Aevoy will check your inbox every 30 minutes and handle emails for you.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4 mb-8">
          {/* Provider tabs */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Select your email provider</p>
            <div className="flex flex-wrap gap-2">
              {(["gmail", "outlook", "yahoo", "icloud", "other"] as ImapProvider[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setImapProvider(p)}
                  className={`px-3 py-1 text-xs font-medium rounded-lg border transition-colors ${
                    imapProvider === p
                      ? "border-gray-800 bg-gray-900 text-white"
                      : "border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300"
                  }`}
                >
                  {p === "gmail" ? "Gmail" : p === "outlook" ? "Outlook" : p === "yahoo" ? "Yahoo" : p === "icloud" ? "iCloud" : "Other"}
                </button>
              ))}
            </div>
          </div>

          {/* Guide steps */}
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-700">How to get your app password</p>
              {guide.videoId && (
                <a
                  href={`https://www.youtube.com/watch?v=${guide.videoId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[11px] font-medium text-red-600 hover:text-red-700 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                  </svg>
                  Watch {guide.videoDuration} tutorial →
                </a>
              )}
            </div>
            <ol className="space-y-2">
              {guide.steps.map((step, i) => (
                <li key={i} className="flex gap-3 text-xs text-gray-600">
                  <span className="w-5 h-5 rounded-full bg-gray-800 text-white font-bold flex items-center justify-center shrink-0 text-[10px]">
                    {i + 1}
                  </span>
                  <span>
                    {step.text}{" "}
                    {step.url && (
                      <a
                        href={step.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 underline underline-offset-2"
                      >
                        {step.urlLabel}
                      </a>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          {/* Inputs */}
          <div className="space-y-2">
            <input
              type="email"
              placeholder={`your@${imapProvider === "gmail" ? "gmail.com" : imapProvider === "outlook" ? "outlook.com" : imapProvider === "yahoo" ? "yahoo.com" : imapProvider === "icloud" ? "icloud.com" : "email.com"}`}
              value={imapEmail}
              onChange={(e) => setImapEmail(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-800 focus:border-transparent"
            />
            <input
              type="password"
              placeholder="App password (from steps above)"
              value={imapPassword}
              onChange={(e) => setImapPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-800 focus:border-transparent"
            />
            {imapError && (
              <p className="text-xs text-red-600">{imapError}</p>
            )}
          </div>
          <button
            onClick={handleConnectImap}
            disabled={connectingImap || !imapEmail || !imapPassword}
            className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {connectingImap && <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
            Connect Email
          </button>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          ← Back
        </button>
        <button
          onClick={onNext}
          className="py-3 px-8 bg-gray-900 text-white font-medium rounded-xl hover:bg-gray-800 transition-colors"
        >
          {connected ? "Continue →" : "Skip for now →"}
        </button>
      </div>
    </div>
  );
}
