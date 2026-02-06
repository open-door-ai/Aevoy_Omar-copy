"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface StepAIBehaviorProps {
  onNext: () => void;
  onBack: () => void;
}

export function StepAIBehavior({ onNext, onBack }: StepAIBehaviorProps) {
  const [autonomyLevel, setAutonomyLevel] = useState(50);
  const [riskTolerance, setRiskTolerance] = useState(50);
  const [proactiveLimit, setProactiveLimit] = useState(10);
  const [isSaving, setIsSaving] = useState(false);

  const getAutonomyLabel = (value: number) => {
    if (value <= 30) return "Ask me every time 🤔";
    if (value <= 60) return "Smart autonomy 😎";
    return "Full send mode 🚀";
  };

  const getRiskLabel = (value: number) => {
    if (value <= 30) return "Safe tasks only 🔒";
    if (value <= 60) return "Balanced ⚖️";
    return "YOLO — buy things, send emails 🎲";
  };

  const getProactiveLabel = (value: number) => {
    if (value === 0) return "Disabled";
    if (value <= 5) return "Minimal";
    if (value <= 15) return "Moderate";
    return "Maximum";
  };

  const handleContinue = async () => {
    setIsSaving(true);
    try {
      await fetch("/api/onboarding/save-step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: 5,
          data: {
            autonomy_level: autonomyLevel,
            risk_tolerance: riskTolerance,
            proactive_daily_limit: proactiveLimit,
          },
        }),
      });
      onNext();
    } catch (error) {
      console.error("Failed to save AI behavior:", error);
      onNext(); // Continue anyway
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-8 max-w-2xl mx-auto">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold">How Should Your AI Behave?</h2>
        <p className="text-muted-foreground">
          These control how your AI works. You can change them anytime in Settings.
        </p>
      </div>

      <div className="space-y-8">
        {/* Autonomy Level */}
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Autonomy Level</label>
            <p className="text-sm text-muted-foreground">
              How often should AI ask for permission before taking actions?
            </p>
          </div>
          <div className="space-y-3">
            <input
              type="range"
              min="0"
              max="100"
              value={autonomyLevel}
              onChange={(e) => setAutonomyLevel(parseInt(e.target.value))}
              className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer slider"
              style={{
                background: `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${autonomyLevel}%, hsl(var(--muted)) ${autonomyLevel}%, hsl(var(--muted)) 100%)`,
              }}
            />
            <div className="text-center text-lg font-medium">
              {getAutonomyLabel(autonomyLevel)}
            </div>
          </div>
        </div>

        {/* Risk Tolerance */}
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Risk Tolerance</label>
            <p className="text-sm text-muted-foreground">
              What level of risk are you comfortable with?
            </p>
          </div>
          <div className="space-y-3">
            <input
              type="range"
              min="0"
              max="100"
              value={riskTolerance}
              onChange={(e) => setRiskTolerance(parseInt(e.target.value))}
              className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer slider"
              style={{
                background: `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${riskTolerance}%, hsl(var(--muted)) ${riskTolerance}%, hsl(var(--muted)) 100%)`,
              }}
            />
            <div className="text-center text-lg font-medium">
              {getRiskLabel(riskTolerance)}
            </div>
          </div>
        </div>

        {/* Proactive Notifications */}
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Proactive Notifications</label>
            <p className="text-sm text-muted-foreground">
              How many daily check-ins/reminders allowed?
            </p>
          </div>
          <div className="space-y-3">
            <input
              type="range"
              min="0"
              max="20"
              value={proactiveLimit}
              onChange={(e) => setProactiveLimit(parseInt(e.target.value))}
              className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer slider"
              style={{
                background: `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${(proactiveLimit / 20) * 100}%, hsl(var(--muted)) ${(proactiveLimit / 20) * 100}%, hsl(var(--muted)) 100%)`,
              }}
            />
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{proactiveLimit} per day</span>
              <span className="font-medium">{getProactiveLabel(proactiveLimit)}</span>
            </div>
          </div>
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
