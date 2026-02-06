"use client";

import { useState } from "react";
import { Mail, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";

interface StepVerificationProps {
  onNext: () => void;
  onBack: () => void;
}

type VerificationMethod = "forward" | "virtual_number";

export default function StepVerification({ onNext, onBack }: StepVerificationProps) {
  const [verificationMethod, setVerificationMethod] = useState<VerificationMethod>("forward");
  const [isSaving, setIsSaving] = useState(false);

  const handleContinue = async () => {
    setIsSaving(true);
    try {
      await fetch("/api/onboarding/save-step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: 7,
          data: { verification_method: verificationMethod },
        }),
      });
      onNext();
    } catch (error) {
      console.error("Failed to save verification method:", error);
      onNext(); // Continue anyway
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
      priceColor: "text-foreground/70",
    },
  ];

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold">How Should I Handle 2FA Codes?</h2>
        <p className="text-foreground/70">
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
                  ? "border-primary bg-primary/5 scale-[1.02]"
                  : "border-border hover:border-primary/50 hover:bg-accent"
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

              {/* Icon */}
              <div
                className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${
                  isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/70"
                }`}
              >
                <Icon className="w-6 h-6" />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h3 className="font-semibold text-lg">{option.label}</h3>
                  <span className={`text-sm font-medium ${option.priceColor}`}>{option.price}</span>
                </div>
                <p className="text-sm text-foreground/70">{option.description}</p>
              </div>

              {/* Checkmark */}
              {isSelected && (
                <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                </div>
              )}
            </label>
          );
        })}
      </div>

      {/* Note about virtual number */}
      {verificationMethod === "virtual_number" && (
        <div className="bg-muted/50 border border-border rounded-lg p-4">
          <p className="text-sm text-foreground/70">
            <strong>Note:</strong> If you haven't set up your phone number yet, you can do that in Settings after onboarding.
          </p>
        </div>
      )}

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
