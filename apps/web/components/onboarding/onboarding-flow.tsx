"use client";

import { useState, useCallback } from "react";
import { AnimatePresence, motion, springs } from "@/components/ui/motion";
import StepWelcome from "./step-welcome";
import StepEmail from "./step-email";
import { StepEmailVerification } from "./step-email-verification";
import StepPhone from "./step-phone";
import StepInterview, { type InterviewData } from "./step-interview";
import StepTour from "./step-tour";

interface OnboardingFlowProps {
  username: string;
  onComplete: () => void;
}

const TOTAL_STEPS = 6;

export default function OnboardingFlow({ username, onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState(1); // 1 = forward, -1 = back
  const [data, setData] = useState({
    username,
    phone: null as string | null,
    interview: null as InterviewData | null,
  });
  const [saving, setSaving] = useState(false);

  const aiEmail = `${data.username}@aevoy.com`;

  const goTo = (next: number) => {
    setDirection(next > step ? 1 : -1);
    setStep(next);
  };

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

  const slideVariants = {
    enter: (dir: number) => ({
      x: dir > 0 ? 80 : -80,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (dir: number) => ({
      x: dir > 0 ? -80 : 80,
      opacity: 0,
    }),
  };

  return (
    <div className="fixed inset-0 bg-white z-50 overflow-auto force-light">
      {/* Progress bar */}
      <div className="fixed top-0 left-0 right-0 z-10">
        <div className="h-1 bg-gray-100">
          <motion.div
            className="h-full bg-gray-800"
            animate={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
            transition={springs.default}
          />
        </div>
      </div>

      {/* Step counter */}
      <div className="fixed top-4 right-6 z-10">
        <span className="text-sm text-gray-500 font-medium tabular-nums">
          <motion.span
            key={step}
            initial={{ y: -10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={springs.micro}
            className="inline-block"
          >
            {step}
          </motion.span>
          {" / "}
          {TOTAL_STEPS}
        </span>
      </div>

      {/* Content area */}
      <div className="min-h-screen flex items-center justify-center py-16">
        <AnimatePresence mode="wait" custom={direction}>
          {step === 1 && (
            <motion.div
              key="step-1"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={springs.default}
              className="w-full"
            >
              <StepWelcome
                name={data.username}
                onNext={() => goTo(2)}
              />
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="step-2"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={springs.default}
              className="w-full"
            >
              <StepEmail
                currentUsername={data.username}
                onNext={(newUsername) => {
                  setData((d) => ({ ...d, username: newUsername }));
                  goTo(3);
                }}
                onBack={() => goTo(1)}
              />
            </motion.div>
          )}

          {step === 3 && (
            <motion.div
              key="step-3"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={springs.default}
              className="w-full"
            >
              <StepEmailVerification onNext={() => goTo(4)} />
            </motion.div>
          )}

          {step === 4 && (
            <motion.div
              key="step-4"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={springs.default}
              className="w-full"
            >
              <StepPhone
                onNext={(phone) => {
                  setData((d) => ({ ...d, phone }));
                  goTo(5);
                }}
                onBack={() => goTo(3)}
              />
            </motion.div>
          )}

          {step === 5 && (
            <motion.div
              key="step-5"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={springs.default}
              className="w-full"
            >
              <StepInterview
                onNext={(interview) => {
                  setData((d) => ({ ...d, interview }));
                  goTo(6);
                }}
                onBack={() => goTo(4)}
              />
            </motion.div>
          )}

          {step === 6 && (
            <motion.div
              key="step-6"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={springs.default}
              className="w-full"
            >
              <StepTour
                aiEmail={aiEmail}
                onComplete={saving ? () => {} : handleComplete}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
