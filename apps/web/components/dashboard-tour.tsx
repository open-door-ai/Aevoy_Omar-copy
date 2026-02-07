"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronRight, ChevronLeft, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TourStep {
  targetId: string;
  title: string;
  description: string;
  position: "top" | "bottom" | "left" | "right";
}

const TOUR_STEPS: TourStep[] = [
  {
    targetId: "send-task-input",
    title: "Send Tasks Here",
    description:
      'Type any task and your AI will handle it. Try "check my email" or "book a restaurant".',
    position: "bottom",
  },
  {
    targetId: "ai-email-card",
    title: "Your AI Email",
    description:
      "Send emails to this address from anywhere. Your AI reads them and gets to work.",
    position: "bottom",
  },
  {
    targetId: "ai-phone-card",
    title: "Your AI Phone",
    description:
      "Call or text this number to give your AI tasks by voice or SMS.",
    position: "bottom",
  },
  {
    targetId: "nav-activity",
    title: "Activity Feed",
    description:
      "Watch every task in real-time. See what your AI is doing, what succeeded, and what needs attention.",
    position: "right",
  },
  {
    targetId: "nav-queue",
    title: "Task Queue",
    description:
      "Tasks waiting to be processed. Your AI works through these in priority order.",
    position: "right",
  },
  {
    targetId: "nav-scheduled",
    title: "Scheduled Tasks",
    description:
      "Set up recurring tasks — daily email summaries, weekly reports, or any routine job.",
    position: "right",
  },
  {
    targetId: "nav-apps",
    title: "Connected Apps",
    description:
      "Link your Google, Microsoft, and other accounts so your AI can access them.",
    position: "right",
  },
  {
    targetId: "nav-skills",
    title: "Skills",
    description:
      "Browse and install capabilities. Each skill teaches your AI a new trick.",
    position: "right",
  },
  {
    targetId: "nav-settings",
    title: "Settings",
    description:
      "Control how autonomous your AI is, set up phone access, and manage your account.",
    position: "right",
  },
];

interface TooltipPosition {
  top: number;
  left: number;
}

interface HighlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface DashboardTourProps {
  onComplete: () => void;
  onSkip: () => void;
}

export default function DashboardTour({
  onComplete,
  onSkip,
}: DashboardTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [highlight, setHighlight] = useState<HighlightRect | null>(null);
  const [tooltipPos, setTooltipPos] = useState<TooltipPosition>({
    top: 0,
    left: 0,
  });
  const [ready, setReady] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const step = TOUR_STEPS[currentStep];

  // Filter to only steps whose target elements exist in the DOM
  const [availableSteps, setAvailableSteps] = useState<TourStep[]>([]);

  useEffect(() => {
    // Small delay to let the DOM settle
    const timer = setTimeout(() => {
      const available = TOUR_STEPS.filter(
        (s) => document.getElementById(s.targetId) !== null
      );
      setAvailableSteps(available.length > 0 ? available : TOUR_STEPS);
      setReady(true);
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  const activeStep = availableSteps[currentStep] || step;

  const calculatePositions = useCallback(() => {
    if (!activeStep) return;

    const el = document.getElementById(activeStep.targetId);
    if (!el) return;

    // Scroll into view if needed
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });

    // Allow scroll to settle
    requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      const padding = 8;

      setHighlight({
        top: rect.top - padding,
        left: rect.left - padding,
        width: rect.width + padding * 2,
        height: rect.height + padding * 2,
      });

      // Calculate tooltip position based on preferred side
      const tooltipWidth = 320;
      const tooltipHeight = 180;
      const gap = 16;

      let top = 0;
      let left = 0;

      switch (activeStep.position) {
        case "bottom":
          top = rect.bottom + gap;
          left = rect.left + rect.width / 2 - tooltipWidth / 2;
          break;
        case "top":
          top = rect.top - tooltipHeight - gap;
          left = rect.left + rect.width / 2 - tooltipWidth / 2;
          break;
        case "right":
          top = rect.top + rect.height / 2 - tooltipHeight / 2;
          left = rect.right + gap;
          break;
        case "left":
          top = rect.top + rect.height / 2 - tooltipHeight / 2;
          left = rect.left - tooltipWidth - gap;
          break;
      }

      // Clamp to viewport
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      left = Math.max(16, Math.min(left, vw - tooltipWidth - 16));
      top = Math.max(16, Math.min(top, vh - tooltipHeight - 16));

      setTooltipPos({ top, left });
    });
  }, [activeStep]);

  useEffect(() => {
    if (!ready) return;
    calculatePositions();
  }, [currentStep, ready, calculatePositions]);

  useEffect(() => {
    const handleResize = () => calculatePositions();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [calculatePositions]);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onSkip();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        if (currentStep < availableSteps.length - 1) {
          setCurrentStep((s) => s + 1);
        } else {
          onComplete();
        }
      } else if (e.key === "ArrowLeft") {
        if (currentStep > 0) {
          setCurrentStep((s) => s - 1);
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [currentStep, availableSteps.length, onComplete, onSkip]);

  if (!ready || availableSteps.length === 0) return null;

  const totalSteps = availableSteps.length;
  const isLast = currentStep === totalSteps - 1;

  return (
    <div className="fixed inset-0 z-[9999]" role="dialog" aria-label="Dashboard tour">
      {/* Dark overlay with cutout */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="absolute inset-0"
      >
        <svg
          className="absolute inset-0 w-full h-full"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <mask id="tour-mask">
              <rect width="100%" height="100%" fill="white" />
              {highlight && (
                <motion.rect
                  initial={{ opacity: 0 }}
                  animate={{
                    x: highlight.left,
                    y: highlight.top,
                    width: highlight.width,
                    height: highlight.height,
                    opacity: 1,
                  }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  rx="12"
                  fill="black"
                />
              )}
            </mask>
          </defs>
          <rect
            width="100%"
            height="100%"
            fill="rgba(0,0,0,0.6)"
            mask="url(#tour-mask)"
          />
        </svg>

        {/* Highlight ring */}
        {highlight && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{
              top: highlight.top,
              left: highlight.left,
              width: highlight.width,
              height: highlight.height,
              opacity: 1,
            }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="absolute rounded-xl ring-2 ring-blue-400 ring-offset-2 ring-offset-transparent pointer-events-none"
            style={{ boxShadow: "0 0 0 4px rgba(59, 130, 246, 0.3)" }}
          />
        )}
      </motion.div>

      {/* Tooltip */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentStep}
          ref={tooltipRef}
          initial={{ opacity: 0, y: 10, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          className="absolute z-10 w-80 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
          style={{ top: tooltipPos.top, left: tooltipPos.left }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-blue-500" />
              </div>
              <span className="text-xs font-medium text-muted-foreground">
                {currentStep + 1} of {totalSteps}
              </span>
            </div>
            <button
              onClick={onSkip}
              className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              aria-label="Skip tour"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Content */}
          <div className="px-5 pb-3">
            <h3 className="text-base font-semibold text-foreground mb-1">
              {activeStep.title}
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {activeStep.description}
            </p>
          </div>

          {/* Progress bar */}
          <div className="px-5 pb-3">
            <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-blue-500 rounded-full"
                initial={{ width: 0 }}
                animate={{
                  width: `${((currentStep + 1) / totalSteps) * 100}%`,
                }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between px-5 pb-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCurrentStep((s) => s - 1)}
              disabled={currentStep === 0}
              className="gap-1"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (isLast) {
                  onComplete();
                } else {
                  setCurrentStep((s) => s + 1);
                }
              }}
              className="gap-1"
            >
              {isLast ? "Done" : "Next"}
              {!isLast && <ChevronRight className="w-4 h-4" />}
            </Button>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
