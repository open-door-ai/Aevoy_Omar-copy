"use client";

import { useState, useCallback } from "react";
import StepWelcome from "./step-welcome";
import StepEmail from "./step-email";
import StepPhone from "./step-phone";
import StepInterview, { type InterviewData } from "./step-interview";
import StepTour from "./step-tour";

interface OnboardingFlowProps {
  username: string;
  onComplete: () => void;
}

const TOTAL_STEPS = 5;

export default function OnboardingFlow({ username, onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState(1);
  const [data, setData] = useState({
    username,
    phone: null as string | null,
    interview: null as InterviewData | null,
  });
  const [saving, setSaving] = useState(false);

  const aiEmail = `${data.username}@aevoy.com`;

  const handleComplete = useCallback(async () => {
    setSaving(true);
    try {
      await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: data.username,
          interview_method: data.interview?.method || "skipped",
          main_uses: data.interview?.main_uses || [],
          daily_checkin_enabled: data.interview?.daily_checkin_enabled || false,
          daily_checkin_time: data.interview?.daily_checkin_time,
        }),
      });
    } catch (error) {
      console.error("Failed to save onboarding data:", error);
    }
    setSaving(false);
    onComplete();
  }, [data, onComplete]);

  return (
    <div className="fixed inset-0 bg-white z-50 overflow-auto">
      {/* Progress bar */}
      <div className="fixed top-0 left-0 right-0 z-10">
        <div className="h-1 bg-stone-100">
          <div
            className="h-full bg-stone-800 transition-all duration-500 ease-out"
            style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
          />
        </div>
      </div>

      {/* Step counter */}
      <div className="fixed top-4 right-6 z-10">
        <span className="text-sm text-stone-400 font-medium">
          {step} / {TOTAL_STEPS}
        </span>
      </div>

      {/* Content area */}
      <div className="min-h-screen flex items-center justify-center py-16">
        {step === 1 && (
          <StepWelcome
            name={data.username}
            onNext={() => setStep(2)}
          />
        )}

        {step === 2 && (
          <StepEmail
            currentUsername={data.username}
            onNext={(newUsername) => {
              setData((d) => ({ ...d, username: newUsername }));
              setStep(3);
            }}
            onBack={() => setStep(1)}
          />
        )}

        {step === 3 && (
          <StepPhone
            onNext={(phone) => {
              setData((d) => ({ ...d, phone }));
              setStep(4);
            }}
            onBack={() => setStep(2)}
          />
        )}

        {step === 4 && (
          <StepInterview
            onNext={(interview) => {
              setData((d) => ({ ...d, interview }));
              setStep(5);
            }}
            onBack={() => setStep(3)}
          />
        )}

        {step === 5 && (
          <StepTour
            aiEmail={aiEmail}
            onComplete={saving ? () => {} : handleComplete}
          />
        )}
      </div>
    </div>
  );
}
