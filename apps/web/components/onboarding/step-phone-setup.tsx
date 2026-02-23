"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FadeIn, StaggerContainer, StaggerItem } from "@/components/ui/motion";
import { Phone, Shield, ArrowRight } from "lucide-react";

interface StepPhoneSetupProps {
  onNext: (data: { personalPhone?: string }) => void;
  onBack: () => void;
  onSkip: () => void;
}

/**
 * Normalize phone number to E.164 format for storage.
 */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length > 10) return `+${digits}`;
  return phone.trim();
}

function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

export default function StepPhoneSetup({ onNext, onBack, onSkip }: StepPhoneSetupProps) {
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    if (!phone.trim()) {
      onSkip();
      return;
    }

    if (!isValidPhone(phone)) {
      setError("Please enter a valid phone number");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const normalized = normalizePhone(phone);
      const res = await fetch("/api/profile/phone", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone_number: normalized }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to save phone number");
        setSaving(false);
        return;
      }

      onNext({ personalPhone: normalized });
    } catch {
      setError("Failed to save. Please try again.");
    }
    setSaving(false);
  };

  return (
    <div className="flex flex-col items-center max-w-lg mx-auto px-6">
      <FadeIn>
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Phone className="w-8 h-8 text-gray-700" />
          </div>
          <h2 className="text-3xl font-bold text-gray-900 mb-2">Your Phone Number</h2>
          <p className="text-gray-600">
            So your AI can call you back, send reminders, and keep you in the loop.
          </p>
        </div>
      </FadeIn>

      <StaggerContainer className="w-full space-y-4" staggerDelay={0.08} delayStart={0.1}>
        <StaggerItem>
          <div className="space-y-2">
            <Input
              type="tel"
              placeholder="+1 (555) 123-4567"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setError("");
              }}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              className="text-lg h-12 text-center"
              autoFocus
            />
            {error && <p className="text-sm text-red-600 text-center">{error}</p>}
          </div>
        </StaggerItem>

        <StaggerItem>
          <div className="flex items-center gap-2 text-sm text-gray-500 justify-center">
            <Shield className="w-4 h-4" />
            <span>Only used for AI callbacks and reminders. Never shared.</span>
          </div>
        </StaggerItem>

        <StaggerItem>
          <div className="flex flex-col gap-3 pt-4">
            <Button
              onClick={handleSave}
              disabled={saving || (!phone.trim())}
              className="w-full h-11"
            >
              {saving ? "Saving..." : "Continue"}
              {!saving && <ArrowRight className="w-4 h-4 ml-2" />}
            </Button>

            <div className="flex gap-3">
              <Button variant="outline" onClick={onBack} className="flex-1">
                Back
              </Button>
              <Button
                variant="ghost"
                onClick={onSkip}
                className="flex-1 text-gray-500"
              >
                Skip for now
              </Button>
            </div>
          </div>
        </StaggerItem>
      </StaggerContainer>
    </div>
  );
}
