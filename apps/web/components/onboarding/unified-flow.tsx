"use client";

import { useState, useCallback } from "react";
import { AnimatePresence, motion, springs } from "@/components/ui/motion";
import StepWelcome from "./step-welcome";
import StepBotEmail from "./step-bot-email";
import { StepEmailVerification } from "./step-email-verification";
import { StepHowItWorks } from "./step-how-it-works";
import { StepUseCases } from "./step-use-cases";
import { StepAIBehavior } from "./step-ai-behavior";
import { StepTimezone } from "./step-timezone";
import StepVerification from "./step-verification";
import { StepLegal } from "./step-legal";
import StepInterview, { type InterviewData } from "./step-interview";
import StepTour from "./step-tour";

interface UnifiedFlowProps {
  username: string;
  onComplete: () => void;
}

const TOTAL_STEPS = 11;

export default function UnifiedFlow({ username, onComplete }: UnifiedFlowProps) {
  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState(1); // 1 = forward, -1 = back
  const [data, setData] = useState({
    username,
    bot_name: null as string | null,
    interview: null as InterviewData | null,
  });
  const [saving, setSaving] = useState(false);

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
          bot_name: data.bot_name,
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
    <div className="fixed inset-0 bg-background z-50 overflow-auto">
      {/* Progress bar */}
      <div className="fixed top-0 left-0 right-0 z-10">
        <div className="h-1 bg-muted">
          <motion.div
            className="h-full bg-primary"
            animate={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
            transition={springs.default}
          />
        </div>
      </div>

      {/* Step counter */}
      <div className="fixed top-4 right-6 z-10">
        <span className="text-sm text-foreground/70 font-medium tabular-nums">
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
      <div className="min-h-screen flex items-center justify-center py-16 px-4">
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
              <StepBotEmail
                currentUsername={data.username}
                currentBotName={data.bot_name}
                onNext={(newUsername, botName) => {
                  setData((d) => ({ ...d, username: newUsername, bot_name: botName }));
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
              <StepHowItWorks
                onNext={() => goTo(5)}
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
              <StepUseCases
                onNext={() => goTo(6)}
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
              <StepAIBehavior
                onNext={() => goTo(7)}
                onBack={() => goTo(5)}
              />
            </motion.div>
          )}

          {step === 7 && (
            <motion.div
              key="step-7"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={springs.default}
              className="w-full"
            >
              <StepTimezone
                onNext={() => goTo(8)}
                onBack={() => goTo(6)}
              />
            </motion.div>
          )}

          {step === 8 && (
            <motion.div
              key="step-8"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={springs.default}
              className="w-full"
            >
              <StepVerification
                onNext={() => goTo(9)}
                onBack={() => goTo(7)}
              />
            </motion.div>
          )}

          {step === 9 && (
            <motion.div
              key="step-9"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={springs.default}
              className="w-full"
            >
              <StepLegal
                onNext={() => goTo(10)}
                onBack={() => goTo(8)}
              />
            </motion.div>
          )}

          {step === 10 && (
            <motion.div
              key="step-10"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={springs.default}
              className="w-full"
            >
              <StepInterview
                onNext={(interviewData) => {
                  setData((d) => ({ ...d, interview: interviewData }));
                  goTo(11);
                }}
                onBack={() => goTo(9)}
              />
            </motion.div>
          )}

          {step === 11 && (
            <motion.div
              key="step-11"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={springs.default}
              className="w-full"
            >
              <StepTour
                aiEmail={`${data.username}@aevoy.com`}
                botName={data.bot_name}
                onComplete={handleComplete}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Accessibility: Skip to dashboard link */}
      <a
        href="#skip-onboarding"
        onClick={(e) => {
          e.preventDefault();
          handleComplete();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:bg-primary focus:text-primary-foreground focus:px-4 focus:py-2 focus:rounded"
      >
        Skip to dashboard
      </a>
    </div>
  );
}
