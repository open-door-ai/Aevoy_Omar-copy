"use client";

import { useState } from "react";

interface StepEmailCalendarProps {
  onNext: () => void;
  onBack: () => void;
}

type Provider = "google" | "microsoft" | "imap" | null;
type ImapProvider = "gmail" | "outlook" | "yahoo" | "icloud" | "other";

const IMAP_GUIDES: Record<ImapProvider, { steps: { text: string; url?: string; urlLabel?: string }[] }> = {
  gmail: {
    steps: [
      { text: "Go to", url: "https://myaccount.google.com/security", urlLabel: "Google Account Security" },
      { text: "Ensure 2-Step Verification is On" },
      { text: "Open", url: "https://myaccount.google.com/apppasswords", urlLabel: "App Passwords" },
      { text: 'Type "Aevoy" → click Create → copy the 16-char password' },
    ],
  },
  outlook: {
    steps: [
      { text: "Go to", url: "https://account.microsoft.com/security", urlLabel: "Microsoft Security" },
      { text: "Click Advanced security options → enable Two-step verification" },
      { text: "Under App passwords → Create a new app password" },
      { text: "Copy the generated password" },
    ],
  },
  yahoo: {
    steps: [
      { text: "Go to", url: "https://login.yahoo.com/account/security", urlLabel: "Yahoo Account Security" },
      { text: "Enable Two-step verification" },
      { text: 'Click Generate app password → Other app → type "Aevoy"' },
      { text: "Copy the generated password" },
    ],
  },
  icloud: {
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
  const [connectedProvider, setConnectedProvider] = useState<Provider>(null);
  const [connectingGoogle, setConnectingGoogle] = useState(false);
  const [connectingMicrosoft, setConnectingMicrosoft] = useState(false);
  const [showImapForm, setShowImapForm] = useState(false);
  const [imapProvider, setImapProvider] = useState<ImapProvider>("gmail");
  const [imapEmail, setImapEmail] = useState("");
  const [imapPassword, setImapPassword] = useState("");
  const [connectingImap, setConnectingImap] = useState(false);
  const [imapError, setImapError] = useState("");

  const handleConnectGoogle = async () => {
    setConnectingGoogle(true);
    try {
      const res = await fetch("/api/integrations/gmail", { method: "POST" });
      const data = await res.json();
      if (data.authUrl) {
        window.location.href = data.authUrl;
      }
    } catch {
      setConnectingGoogle(false);
    }
  };

  const handleConnectMicrosoft = async () => {
    setConnectingMicrosoft(true);
    try {
      const res = await fetch("/api/integrations/microsoft", { method: "POST" });
      const data = await res.json();
      if (data.authUrl) {
        window.location.href = data.authUrl;
      }
    } catch {
      setConnectingMicrosoft(false);
    }
  };

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
        setConnectedProvider("imap");
        setShowImapForm(false);
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
    <div className="max-w-2xl mx-auto px-6">
      {/* Header */}
      <div className="text-center mb-10">
        <div className="text-4xl mb-4">📬</div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Connect Email & Calendar</h1>
        <p className="text-gray-500 text-lg">
          Aevoy reads, prioritizes, and responds to your emails — quietly working in the background.
        </p>
        <span className="inline-block mt-3 text-xs font-medium text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
          Optional — you can do this later in Settings
        </span>
      </div>

      {/* Connected state */}
      {connectedProvider ? (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-6 text-center mb-8">
          <div className="text-3xl mb-2">✓</div>
          <p className="font-semibold text-green-800">
            {connectedProvider === "google" && "Gmail & Google Calendar connected!"}
            {connectedProvider === "microsoft" && "Outlook & Microsoft Calendar connected!"}
            {connectedProvider === "imap" && `${imapEmail} connected via IMAP!`}
          </p>
          <p className="text-sm text-green-600 mt-1">
            Aevoy will check your inbox every 30 minutes and handle emails for you.
          </p>
        </div>
      ) : (
        <div className="space-y-3 mb-8">
          {/* Google */}
          <button
            onClick={handleConnectGoogle}
            disabled={connectingGoogle}
            className="w-full flex items-center gap-4 bg-white border border-gray-200 rounded-2xl p-4 hover:border-gray-300 hover:shadow-sm transition-all text-left disabled:opacity-70"
          >
            <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
              <svg viewBox="0 0 24 24" className="w-7 h-7">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-gray-900">Google</div>
              <div className="text-sm text-gray-500">Gmail + Google Calendar — one click</div>
            </div>
            <div className="ml-auto">
              {connectingGoogle ? (
                <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
              ) : (
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
            </div>
          </button>

          {/* Microsoft */}
          <button
            onClick={handleConnectMicrosoft}
            disabled={connectingMicrosoft}
            className="w-full flex items-center gap-4 bg-white border border-gray-200 rounded-2xl p-4 hover:border-gray-300 hover:shadow-sm transition-all text-left disabled:opacity-70"
          >
            <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
              <svg viewBox="0 0 24 24" className="w-7 h-7">
                <rect fill="#F25022" x="1" y="1" width="10" height="10" />
                <rect fill="#7FBA00" x="13" y="1" width="10" height="10" />
                <rect fill="#00A4EF" x="1" y="13" width="10" height="10" />
                <rect fill="#FFB900" x="13" y="13" width="10" height="10" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-gray-900">Microsoft</div>
              <div className="text-sm text-gray-500">Outlook + Microsoft Calendar — one click</div>
            </div>
            <div className="ml-auto">
              {connectingMicrosoft ? (
                <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
              ) : (
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
            </div>
          </button>

          {/* Other (IMAP) */}
          {!showImapForm ? (
            <button
              onClick={() => setShowImapForm(true)}
              className="w-full flex items-center gap-4 bg-white border border-gray-200 rounded-2xl p-4 hover:border-gray-300 hover:shadow-sm transition-all text-left"
            >
              <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                <svg viewBox="0 0 24 24" className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-gray-900">Yahoo, iCloud, or other</div>
                <div className="text-sm text-gray-500">Connect with an app password — takes 2 minutes</div>
              </div>
              <div className="ml-auto">
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </button>
          ) : (
            <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
              {/* Provider tabs */}
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

              {/* Guide steps */}
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs font-semibold text-gray-700 mb-3">Step-by-step: getting your app password</p>
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
              <div className="flex gap-2">
                <button
                  onClick={handleConnectImap}
                  disabled={connectingImap || !imapEmail || !imapPassword}
                  className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {connectingImap && <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                  Connect Email
                </button>
                <button
                  onClick={() => { setShowImapForm(false); setImapError(""); }}
                  className="px-4 py-2 border border-gray-200 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
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
          {connectedProvider ? "Continue →" : "Skip for now →"}
        </button>
      </div>
    </div>
  );
}
