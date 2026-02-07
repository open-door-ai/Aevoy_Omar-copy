"use client";

import { useState } from "react";
import { AlertTriangle, Shield, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { SimpleTooltip } from "@/components/ui/tooltip";

interface StepLegalProps {
  onNext: () => void;
  onBack: () => void;
}

export function StepLegal({ onNext, onBack }: StepLegalProps) {
  const [aiMistakes, setAiMistakes] = useState(false);
  const [monitorTasks, setMonitorTasks] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [consentData, setConsentData] = useState(false);
  const [allowVenting, setAllowVenting] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const allRequiredChecked = aiMistakes && monitorTasks && agreeTerms && consentData;

  const handleContinue = async () => {
    if (!allRequiredChecked) return;

    setIsSaving(true);
    try {
      await fetch("/api/onboarding/save-step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: 8,
          data: {
            allow_agent_venting: allowVenting,
          },
        }),
      });
      onNext();
    } catch (error) {
      console.error("Failed to save legal acceptance:", error);
      onNext();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-stone-900">Safety & Legal Stuff</h2>
        <p className="text-stone-500">
          Important things you should know before we begin
        </p>
      </div>

      {/* Warning Card */}
      <div className="border-2 border-yellow-400 bg-yellow-50 rounded-lg p-6 space-y-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-6 h-6 text-yellow-600 flex-shrink-0 mt-0.5" />
          <div className="space-y-2">
            <h3 className="font-semibold text-lg text-stone-900">Aevoy is 99.9999% accurate... but not perfect</h3>
            <p className="text-sm text-stone-600">
              It might book the wrong flight, send the wrong email, or buy 500 rubber ducks
            </p>
            <p className="text-sm font-medium text-stone-900">
              You&apos;re in control — review critical tasks, freeze your agent card anytime
            </p>
          </div>
        </div>
      </div>

      {/* Required Legal Checkboxes */}
      <div className="space-y-3 border border-stone-200 rounded-lg p-4">
        <p className="text-sm font-medium text-stone-900 mb-3">Required acknowledgments:</p>

        <Toggle
          checked={aiMistakes}
          onChange={setAiMistakes}
          label="I understand AI can make mistakes"
          labelPosition="right"
          size="sm"
        />

        <Toggle
          checked={monitorTasks}
          onChange={setMonitorTasks}
          label="I'll monitor critical tasks"
          labelPosition="right"
          size="sm"
        />

        <Toggle
          checked={agreeTerms}
          onChange={setAgreeTerms}
          label={
            <span className="text-stone-700">
              I agree to{" "}
              <a
                href="/legal/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="text-stone-900 font-medium hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                Terms of Service
              </a>
            </span>
          }
          labelPosition="right"
          size="sm"
        />

        <Toggle
          checked={consentData}
          onChange={setConsentData}
          label={
            <span className="text-stone-700">
              I consent to data processing (
              <a
                href="/legal/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-stone-900 font-medium hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                Privacy Policy
              </a>
              )
            </span>
          }
          labelPosition="right"
          size="sm"
        />
      </div>

      {/* Optional: Hive Mind */}
      <div className="space-y-3 border border-stone-200 rounded-lg p-4">
        <p className="text-sm font-medium text-stone-900 mb-3">Optional:</p>

        <div className="flex items-start gap-2">
          <Toggle
            checked={allowVenting}
            onChange={setAllowVenting}
            label={
              <span className="flex items-center gap-2 text-stone-700">
                Let my AI anonymously vent about bad websites (Hive Mind)
                <SimpleTooltip content="No personal data shared, just UX frustrations for collective learning">
                  <Info className="w-4 h-4 text-stone-500" />
                </SimpleTooltip>
              </span>
            }
            labelPosition="right"
            size="sm"
          />
        </div>
      </div>

      {/* Footer */}
      <div className="text-center space-y-2">
        <p className="text-xs text-stone-500">
          By proceeding, you accept full responsibility for AI actions*
        </p>
        <a
          href="/security"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-stone-700 font-medium hover:underline"
        >
          <Shield className="w-4 h-4" />
          Learn about our safety measures
        </a>
      </div>

      <div className="flex justify-between gap-4">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={handleContinue} disabled={!allRequiredChecked || isSaving}>
          {isSaving ? "Saving..." : allRequiredChecked ? "I Accept" : "Check all boxes to continue"}
        </Button>
      </div>
    </div>
  );
}
