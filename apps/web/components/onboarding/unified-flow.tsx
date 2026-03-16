"use client";

import { useState, useCallback } from "react";
import { AnimatePresence, motion, springs } from "@/components/ui/motion";
import StepBotEmail from "./step-bot-email";
import { StepQuickSetup } from "./step-quick-setup";
import StepSecurityLegal from "./step-security-legal";
import StepPhoneNew from "./step-phone-new";
import StepEmailCalendar from "./step-email-calendar";
import StepReady from "./step-ready";

interface UnifiedFlowProps {
  username: string;
  onComplete: () => void;
}

const TOTAL_STEPS = 6;

export default function UnifiedFlow({ username, onComplete }: UnifiedFlowProps) {
  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState(1);
  const [data, setData] = useState({
    username,
    bot_name: null as string | null,
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
    <div className="fixed inset-0 bg-white z-[60] overflow-auto force-light">
      {/* Progress bar */}
      <div className="fixed top-0 left-0 right-0 z-[61]">
        <div className="h-1 bg-gray-100">
          <motion.div
            className="h-full bg-gray-800"
            animate={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
            transition={springs.default}
          />
        </div>
      </div>

      {/* Step counter */}
      <div className="fixed top-4 right-6 z-[61]">
        <span className="text-sm text-gray-600 font-medium tabular-nums">
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
              <StepBotEmail
                currentUsername={data.username}
                currentBotName={data.bot_name}
                onNext={(newUsername, botName) => {
                  setData((d) => ({ ...d, username: newUsername, bot_name: botName }));
                  goTo(2);
                }}
                onBack={undefined} // First step, no back
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
              <StepQuickSetup
                onNext={() => goTo(3)}
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
              <StepSecurityLegal
                onNext={() => goTo(4)}
                onBack={() => goTo(2)}
              />
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
              <StepPhoneNew
                onNext={(_phone) => goTo(5)}
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
              <StepEmailCalendar
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
              <StepReady
                aiEmail={`${data.username}@aevoy.com`}
                botName={data.bot_name}
                onComplete={handleComplete}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Skip link removed — users should complete onboarding */}
    </div>
  );
}
