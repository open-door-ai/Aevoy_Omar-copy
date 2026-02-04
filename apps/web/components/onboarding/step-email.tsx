"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface StepEmailProps {
  currentUsername: string;
  onNext: (username: string) => void;
  onBack: () => void;
}

export default function StepEmail({ currentUsername, onNext, onBack }: StepEmailProps) {
  const [username, setUsername] = useState(currentUsername);
  const [checking, setChecking] = useState(false);
  const [availability, setAvailability] = useState<{
    available: boolean;
    reason?: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  // Debounced availability check
  const checkAvailability = useCallback(async (name: string) => {
    if (name === currentUsername) {
      setAvailability({ available: true });
      setChecking(false);
      return;
    }
    if (name.length < 3) {
      setAvailability({ available: false, reason: "Username must be at least 3 characters" });
      setChecking(false);
      return;
    }

    try {
      const res = await fetch("/api/onboarding/check-username", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: name }),
      });
      const data = await res.json();
      setAvailability(data);
    } catch {
      setAvailability(null);
    }
    setChecking(false);
  }, [currentUsername]);

  useEffect(() => {
    if (!username.trim()) {
      setAvailability(null);
      return;
    }
    setChecking(true);
    const timer = setTimeout(() => checkAvailability(username.trim().toLowerCase()), 400);
    return () => clearTimeout(timer);
  }, [username, checkAvailability]);

  const handleCopy = () => {
    navigator.clipboard.writeText(`${username}@aevoy.com`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isValid = availability?.available === true;

  return (
    <div className="flex flex-col items-center max-w-lg mx-auto px-6">
      <h2 className="text-3xl font-bold text-stone-900 mb-2">Your AI Email</h2>
      <p className="text-stone-500 mb-8 text-center">
        This is the email address you&apos;ll use to send tasks to your AI
      </p>

      {/* Large email display */}
      <div className="w-full bg-stone-50 border-2 border-stone-200 rounded-2xl p-6 mb-6">
        <div className="flex items-baseline justify-center gap-1 flex-wrap">
          <span className="text-2xl md:text-3xl font-mono font-bold text-stone-900">
            {username || "..."}
          </span>
          <span className="text-2xl md:text-3xl font-mono text-stone-400">@aevoy.com</span>
        </div>
        <button
          onClick={handleCopy}
          className="mt-3 mx-auto block text-sm text-stone-400 hover:text-stone-600 transition-colors"
        >
          {copied ? "Copied!" : "Copy email address"}
        </button>
      </div>

      {/* Customize prefix */}
      <div className="w-full space-y-2 mb-6">
        <Label htmlFor="username" className="text-stone-600">
          Customize your prefix
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))}
            placeholder="your-name"
            className="font-mono text-lg"
            maxLength={20}
          />
          <span className="text-stone-400 font-mono whitespace-nowrap">@aevoy.com</span>
        </div>

        {/* Availability indicator */}
        <div className="h-5">
          {checking && (
            <p className="text-sm text-stone-400">Checking availability...</p>
          )}
          {!checking && availability && (
            <p className={`text-sm ${availability.available ? "text-green-600" : "text-red-500"}`}>
              {availability.available ? "Available!" : availability.reason}
            </p>
          )}
        </div>
      </div>

      {/* Example task */}
      <div className="w-full bg-stone-100/50 border border-stone-200 rounded-xl p-4 mb-8">
        <p className="text-sm text-stone-500 mb-1">Try emailing:</p>
        <p className="text-stone-700 font-medium italic">
          &quot;Book me a dinner for 2 at Miku on Saturday at 7pm&quot;
        </p>
      </div>

      {/* Navigation */}
      <div className="flex gap-4 w-full">
        <Button variant="outline" onClick={onBack} className="flex-1">
          Back
        </Button>
        <Button onClick={() => onNext(username)} disabled={!isValid} className="flex-1">
          Continue
        </Button>
      </div>
    </div>
  );
}
