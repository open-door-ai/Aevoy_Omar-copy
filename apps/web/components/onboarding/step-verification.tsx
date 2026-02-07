"use client";

import { useState } from "react";
import { Mail, Phone, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface StepVerificationProps {
  onNext: () => void;
  onBack: () => void;
}

type VerificationMethod = "forward" | "virtual_number";

export default function StepVerification({ onNext, onBack }: StepVerificationProps) {
  const [verificationMethod, setVerificationMethod] = useState<VerificationMethod>("forward");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [voicePin, setVoicePin] = useState("");
  const [dailyCheckinEnabled, setDailyCheckinEnabled] = useState(false);
  const [morningTime, setMorningTime] = useState("09:00");
  const [eveningTime, setEveningTime] = useState("21:00");
  const [isSaving, setIsSaving] = useState(false);
  const [callStatus, setCallStatus] = useState<"idle" | "calling" | "ringing" | "verified" | "error">("idle");

  const handleTestCall = async () => {
    if (!phoneNumber.trim()) return;
    setCallStatus("calling");
    try {
      const res = await fetch("/api/onboarding/request-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone_number: phoneNumber }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCallStatus("ringing");
      } else {
        setCallStatus("error");
      }
    } catch {
      setCallStatus("error");
    }
  };

  const handleContinue = async () => {
    setIsSaving(true);
    try {
      const data: Record<string, unknown> = {
        verification_method: verificationMethod,
      };

      if (phoneNumber.trim()) {
        data.phone_number = phoneNumber.trim();
      }

      if (voicePin.trim()) {
        if (!/^\d{4,6}$/.test(voicePin)) {
          alert("PIN must be 4-6 digits");
          setIsSaving(false);
          return;
        }
        data.voice_pin = voicePin;
      }

      data.daily_checkin_enabled = dailyCheckinEnabled;
      if (dailyCheckinEnabled) {
        data.daily_checkin_morning_time = morningTime;
        data.daily_checkin_evening_time = eveningTime;
      }

      await fetch("/api/onboarding/save-step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: 7,
          data,
        }),
      });
      onNext();
    } catch (error) {
      console.error("Failed to save verification data:", error);
      onNext();
    } finally {
      setIsSaving(false);
    }
  };

  const options = [
    {
      value: "forward" as const,
      icon: Mail,
      label: "Forward Codes",
      description: "AI emails you when it needs a code, you reply with it",
      price: "FREE",
      priceColor: "text-green-600",
    },
    {
      value: "virtual_number" as const,
      icon: Phone,
      label: "Auto-Receive Codes",
      description: "Get a virtual phone number that automatically receives codes",
      price: "$1/month",
      priceColor: "text-stone-500",
    },
  ];

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-stone-900">How Should I Handle 2FA Codes?</h2>
        <p className="text-stone-500">
          When logging into websites for you, I may encounter verification codes
        </p>
      </div>

      <div className="grid gap-4">
        {options.map((option) => {
          const Icon = option.icon;
          const isSelected = verificationMethod === option.value;

          return (
            <label
              key={option.value}
              className={`flex items-start gap-4 p-5 border-2 rounded-xl cursor-pointer transition-all ${
                isSelected
                  ? "border-stone-800 bg-stone-50 scale-[1.02]"
                  : "border-stone-200 hover:border-stone-400 hover:bg-stone-50"
              }`}
            >
              <input
                type="radio"
                name="verification"
                value={option.value}
                checked={isSelected}
                onChange={(e) => setVerificationMethod(e.target.value as VerificationMethod)}
                className="sr-only"
              />

              <div
                className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${
                  isSelected ? "bg-stone-800 text-white" : "bg-stone-100 text-stone-500"
                }`}
              >
                <Icon className="w-6 h-6" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h3 className="font-semibold text-lg text-stone-900">{option.label}</h3>
                  <span className={`text-sm font-medium ${option.priceColor}`}>{option.price}</span>
                </div>
                <p className="text-sm text-stone-500">{option.description}</p>
              </div>

              {isSelected && (
                <div className="w-6 h-6 rounded-full bg-stone-800 text-white flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                </div>
              )}
            </label>
          );
        })}
      </div>

      {verificationMethod === "virtual_number" && (
        <div className="bg-stone-50 border border-stone-200 rounded-lg p-4">
          <p className="text-sm text-stone-500">
            <strong className="text-stone-700">Note:</strong> If you haven&apos;t set up your phone number yet, you can do that in Settings after onboarding.
          </p>
        </div>
      )}

      {/* Phone & Voice Setup */}
      <div className="mt-8 pt-8 border-t border-stone-200 space-y-6">
        <div>
          <h3 className="text-lg font-semibold text-stone-900 mb-2">Phone Setup</h3>
          <p className="text-sm text-stone-500">
            Add your phone number so you can call or text your AI anytime at{" "}
            <span className="font-mono font-semibold text-stone-700">+1 (778) 900-8951</span>
          </p>
        </div>

        <div className="space-y-4">
          {/* Phone Number Input */}
          <div>
            <Label htmlFor="phone" className="text-stone-700">Your Phone Number (Optional)</Label>
            <Input
              id="phone"
              type="tel"
              placeholder="+1 (778) 123-4567"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="mt-2"
            />
            <p className="text-xs text-stone-500 mt-1">
              Format: (778) 123-4567 or 7781234567 or +17781234567
            </p>
          </div>

          {/* Test call button */}
          {phoneNumber.trim().length >= 10 && (
            <div className="bg-stone-50 border border-stone-200 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-3">
                <Phone className="w-5 h-5 text-stone-600" />
                <div>
                  <p className="text-sm font-medium text-stone-900">Test your phone</p>
                  <p className="text-xs text-stone-500">
                    {callStatus === "idle" && "Get a quick test call from your AI to verify the number"}
                    {callStatus === "calling" && "Initiating call..."}
                    {callStatus === "ringing" && "Your phone should be ringing! Pick up to hear from your AI."}
                    {callStatus === "verified" && "Phone verified!"}
                    {callStatus === "error" && "Call failed. Check the number and try again."}
                  </p>
                </div>
              </div>
              {callStatus !== "verified" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTestCall}
                  disabled={callStatus === "calling" || callStatus === "ringing"}
                >
                  {callStatus === "calling" ? "Calling..." : callStatus === "ringing" ? "Ringing..." : callStatus === "error" ? "Retry Call" : "Call Me"}
                </Button>
              )}
            </div>
          )}

          {/* PIN Setup */}
          {phoneNumber.trim() && (
            <div>
              <Label htmlFor="pin" className="text-stone-700">Security PIN (4-6 digits)</Label>
              <Input
                id="pin"
                type="password"
                inputMode="numeric"
                pattern="\d{4,6}"
                placeholder="1234"
                value={voicePin}
                onChange={(e) => setVoicePin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                maxLength={6}
                className="mt-2"
              />
              <p className="text-xs text-stone-500 mt-1">
                Used to verify your identity when calling from unknown numbers
              </p>
            </div>
          )}

          {/* Premium Number Upsell */}
          <div className="bg-stone-50 border border-stone-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Phone className="w-5 h-5 text-stone-600 mt-0.5 flex-shrink-0" />
              <div>
                <h4 className="font-semibold text-sm text-stone-900">Want your own dedicated number?</h4>
                <p className="text-xs text-stone-500 mt-1">
                  Get a personal number for just $2/mo. Choose your area code and pattern!
                </p>
                <p className="text-xs text-stone-500 mt-2">
                  You can set this up later in Settings
                </p>
              </div>
            </div>
          </div>

          {/* Daily Check-ins Opt-in */}
          {phoneNumber.trim() && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Sun className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <h4 className="font-semibold text-sm text-stone-900">Daily Check-in Calls</h4>
                  <p className="text-xs text-stone-500 mt-1 mb-3">
                    Your AI can call you twice a day (morning & evening) to check in and help plan your day.
                  </p>

                  <div className="flex items-center gap-2 mb-3">
                    <input
                      type="checkbox"
                      id="checkin"
                      checked={dailyCheckinEnabled}
                      onChange={(e) => setDailyCheckinEnabled(e.target.checked)}
                      className="rounded"
                    />
                    <Label htmlFor="checkin" className="text-sm font-normal cursor-pointer text-stone-700">
                      Yes, I want daily check-in calls
                    </Label>
                  </div>

                  {dailyCheckinEnabled && (
                    <div className="grid grid-cols-2 gap-3 mt-3">
                      <div>
                        <Label htmlFor="morning" className="text-xs text-stone-600">
                          Morning Time
                        </Label>
                        <Input
                          id="morning"
                          type="time"
                          value={morningTime}
                          onChange={(e) => setMorningTime(e.target.value)}
                          className="text-sm mt-1"
                        />
                      </div>
                      <div>
                        <Label htmlFor="evening" className="text-xs text-stone-600">
                          Evening Time
                        </Label>
                        <Input
                          id="evening"
                          type="time"
                          value={eveningTime}
                          onChange={(e) => setEveningTime(e.target.value)}
                          className="text-sm mt-1"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-between gap-4">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={handleContinue} disabled={isSaving}>
          {isSaving ? "Saving..." : "Continue"}
        </Button>
      </div>
    </div>
  );
}
