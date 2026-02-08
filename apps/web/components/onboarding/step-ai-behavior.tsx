"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { HelpCircle, Zap, Rocket, Lock, Scale, Dice6 } from "lucide-react";

interface StepAIBehaviorProps {
  onNext: () => void;
  onBack: () => void;
}

export function StepAIBehavior({ onNext, onBack }: StepAIBehaviorProps) {
  const [autonomyLevel, setAutonomyLevel] = useState(50);
  const [riskTolerance, setRiskTolerance] = useState(50);
  const [proactiveLimit, setProactiveLimit] = useState(10);
  const [isSaving, setIsSaving] = useState(false);

  const getAutonomyLabel = (value: number): { text: string; Icon: typeof HelpCircle } => {
    if (value <= 30) return { text: "Ask me every time", Icon: HelpCircle };
    if (value <= 60) return { text: "Smart autonomy", Icon: Zap };
    return { text: "Full send mode", Icon: Rocket };
  };

  const getRiskLabel = (value: number): { text: string; Icon: typeof Lock } => {
    if (value <= 30) return { text: "Safe tasks only", Icon: Lock };
    if (value <= 60) return { text: "Balanced", Icon: Scale };
    return { text: "YOLO — buy things, send emails", Icon: Dice6 };
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
      onNext();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-8 max-w-2xl mx-auto">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-gray-900">How Should Your AI Behave?</h2>
        <p className="text-gray-600">
          These control how your AI works. You can change them anytime in Settings.
        </p>
      </div>

      <div className="space-y-8">
        {/* Autonomy Level */}
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-900">Autonomy Level</label>
            <p className="text-sm text-gray-600">
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
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
              style={{
                background: `linear-gradient(to right, #1f2937 0%, #1f2937 ${autonomyLevel}%, #e5e7eb ${autonomyLevel}%, #e5e7eb 100%)`,
              }}
            />
            <div className="text-center text-lg font-medium text-gray-900 flex items-center justify-center gap-2">
              {(() => {
                const { text, Icon } = getAutonomyLabel(autonomyLevel);
                return (
                  <>
                    {text}
                    <Icon className="w-5 h-5" />
                  </>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Risk Tolerance */}
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-900">Risk Tolerance</label>
            <p className="text-sm text-gray-600">
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
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
              style={{
                background: `linear-gradient(to right, #1f2937 0%, #1f2937 ${riskTolerance}%, #e5e7eb ${riskTolerance}%, #e5e7eb 100%)`,
              }}
            />
            <div className="text-center text-lg font-medium text-gray-900 flex items-center justify-center gap-2">
              {(() => {
                const { text, Icon } = getRiskLabel(riskTolerance);
                return (
                  <>
                    {text}
                    <Icon className="w-5 h-5" />
                  </>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Proactive Notifications */}
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-900">Proactive Notifications</label>
            <p className="text-sm text-gray-600">
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
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
              style={{
                background: `linear-gradient(to right, #1f2937 0%, #1f2937 ${(proactiveLimit / 20) * 100}%, #e5e7eb ${(proactiveLimit / 20) * 100}%, #e5e7eb 100%)`,
              }}
            />
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">{proactiveLimit} per day</span>
              <span className="font-medium text-gray-900">{getProactiveLabel(proactiveLimit)}</span>
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
