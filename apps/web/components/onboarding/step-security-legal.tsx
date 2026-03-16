"use client";

import { useState } from "react";
import { Eye, EyeOff, Shield, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FadeIn, GlassCard } from "@/components/ui/motion";

interface StepSecurityLegalProps {
  onNext: () => void;
  onBack: () => void;
}

export default function StepSecurityLegal({
  onNext,
  onBack,
}: StepSecurityLegalProps) {
  // PIN state
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinTouched, setPinTouched] = useState(false);

  // Legal checkboxes (required)
  const [aiMistakes, setAiMistakes] = useState(false);
  const [monitorTasks, setMonitorTasks] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [consentData, setConsentData] = useState(false);

  // Optional checkbox (default OFF for GDPR compliance)
  const [allowVenting, setAllowVenting] = useState(false);

  // Save state
  const [isSaving, setIsSaving] = useState(false);

  const isPinValid = /^\d{4,6}$/.test(pin);
  const allRequiredChecked =
    aiMistakes && monitorTasks && agreeTerms && consentData;
  const canContinue = isPinValid && allRequiredChecked;

  const handlePinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, 6);
    setPin(value);
    setPinTouched(true);

    if (value.length > 0 && value.length < 4) {
      setPinError("PIN must be at least 4 digits");
    } else if (value.length > 6) {
      setPinError("PIN must be at most 6 digits");
    } else {
      setPinError(null);
    }
  };

  const handleContinue = async () => {
    if (!canContinue) return;

    setIsSaving(true);
    try {
      await fetch("/api/onboarding/save-step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: 3,
          data: {
            voice_pin: pin,
            allow_agent_venting: allowVenting,
          },
        }),
      });
      onNext();
    } catch (error) {
      console.error("Failed to save security & legal data:", error);
      onNext();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-8 max-w-lg mx-auto">
      {/* Section 1: PIN Setup */}
      <FadeIn delay={0}>
        <GlassCard className="p-6 space-y-5">
          <div className="text-center space-y-1.5">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-gray-900 text-white mb-2">
              <Shield className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-bold text-gray-900">Security PIN</h2>
            <p className="text-sm text-gray-600">
              Used to verify your identity across voice, email, and SMS
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="security-pin" className="sr-only">
              Security PIN
            </Label>
            <div className="relative">
              <Input
                id="security-pin"
                type={showPin ? "text" : "password"}
                inputMode="numeric"
                pattern="\d{4,6}"
                placeholder="Enter 4-6 digit PIN"
                value={pin}
                onChange={handlePinChange}
                onBlur={() => setPinTouched(true)}
                maxLength={6}
                autoComplete="off"
                className={`text-center text-2xl font-mono tracking-[0.3em] h-14 pr-12 text-gray-900 ${
                  pinError && pinTouched
                    ? "border-red-400 focus-visible:border-red-400 focus-visible:ring-red-200"
                    : ""
                }`}
              />
              <button
                type="button"
                onClick={() => setShowPin(!showPin)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors p-1"
                aria-label={showPin ? "Hide PIN" : "Show PIN"}
              >
                {showPin ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>

            {pinError && pinTouched && (
              <p className="text-xs text-red-500 text-center">{pinError}</p>
            )}

            {!pinError && pin.length > 0 && isPinValid && (
              <>
                <p className="text-xs text-green-600 text-center">
                  PIN looks good
                </p>
                <p className="text-xs text-muted-foreground/50 italic text-center">Guard this like your Netflix password. Actually, guard it better.</p>
              </>
            )}

            <p className="text-xs text-gray-500 text-center pt-1">
              You&apos;ll use this PIN when sending tasks by email or calling
              your AI
            </p>
          </div>
        </GlassCard>
      </FadeIn>

      {/* Section 2: Legal Acknowledgments */}
      <FadeIn delay={0.15}>
        <div className="space-y-4">
          <div className="text-center space-y-1">
            <h3 className="text-lg font-semibold text-gray-900">
              Almost there — just the legal stuff
            </h3>
          </div>

          {/* Required checkboxes */}
          <div className="space-y-3">
            <CheckboxItem
              id="cb-ai-mistakes"
              checked={aiMistakes}
              onChange={setAiMistakes}
              label="I understand AI can make mistakes and I'll verify important actions"
              required
            />

            <CheckboxItem
              id="cb-monitor-tasks"
              checked={monitorTasks}
              onChange={setMonitorTasks}
              label="I'll monitor critical tasks (purchases, emails sent on my behalf)"
              required
            />

            <CheckboxItem
              id="cb-terms"
              checked={agreeTerms}
              onChange={setAgreeTerms}
              required
              label={
                <>
                  I agree to the{" "}
                  <a
                    href="/legal/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 font-medium text-gray-900 hover:text-gray-700 inline-flex items-center gap-0.5"
                    /* No stopPropagation — click bubbles to parent div which toggles checkbox */
                  >
                    Terms of Service
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </>
              }
            />

            <CheckboxItem
              id="cb-privacy"
              checked={consentData}
              onChange={setConsentData}
              required
              label={
                <>
                  I consent to data processing per the{" "}
                  <a
                    href="/legal/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 font-medium text-gray-900 hover:text-gray-700 inline-flex items-center gap-0.5"
                    /* No stopPropagation — click bubbles to parent div which toggles checkbox */
                  >
                    Privacy Policy
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </>
              }
            />
          </div>

          {/* Separator */}
          <div className="border-t border-gray-200" />

          {/* Optional checkbox */}
          <CheckboxItem
            id="cb-hive-mind"
            checked={allowVenting}
            onChange={setAllowVenting}
            label="Allow my AI to contribute anonymous learnings to improve Aevoy"
            sublabel="No personal data is shared — just aggregated usage patterns"
          />
        </div>
      </FadeIn>

      {/* Navigation */}
      <FadeIn delay={0.25}>
        <div className="flex justify-between gap-4">
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button onClick={handleContinue} disabled={!canContinue || isSaving}>
            {isSaving ? "Saving..." : "Continue"}
          </Button>
        </div>
      </FadeIn>
    </div>
  );
}

/* ─── Checkbox sub-component ─────────────────────────────────────────── */

interface CheckboxItemProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
  sublabel?: string;
  required?: boolean;
}

function CheckboxItem({
  id,
  checked,
  onChange,
  label,
  sublabel,
  required,
}: CheckboxItemProps) {
  return (
    <div
      className="flex items-start gap-3 group cursor-pointer"
      onClick={(e) => {
        // If user clicked a link, let it open AND toggle the checkbox
        onChange(!checked);
      }}
    >
      <div className="relative flex-shrink-0 mt-0.5">
        <input
          type="checkbox"
          id={id}
          checked={checked}
          onChange={(e) => {
            e.stopPropagation();
            onChange(e.target.checked);
          }}
          className="peer sr-only"
        />
        <div
          className={`w-5 h-5 rounded border-2 transition-all duration-150 flex items-center justify-center ${
            checked
              ? "bg-gray-900 border-gray-900"
              : "border-gray-300 bg-white group-hover:border-gray-400"
          }`}
        >
          {checked && (
            <svg
              className="w-3 h-3 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m4.5 12.75 6 6 9-13.5"
              />
            </svg>
          )}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <label
          htmlFor={id}
          className="text-sm text-gray-700 leading-snug cursor-pointer select-none"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onChange(!checked);
          }}
        >
          {label}
          {required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
        {sublabel && (
          <p className="text-xs text-gray-500 mt-0.5">{sublabel}</p>
        )}
      </div>
    </div>
  );
}
