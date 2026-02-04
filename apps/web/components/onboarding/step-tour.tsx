"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface StepTourProps {
  aiEmail: string;
  onComplete: () => void;
}

const TOUR_STEPS = [
  {
    title: "Your AI Email",
    description: "Send any task to this email address. Your AI reads it, understands it, and gets it done.",
    icon: "M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75",
  },
  {
    title: "Activity Feed",
    description: "Track every task in real-time. See what your AI is working on, what's completed, and what needs your attention.",
    icon: "M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z",
  },
  {
    title: "Settings",
    description: "Control how autonomous your AI is, manage your phone number, set up your agent card, and more.",
    icon: "M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z",
  },
];

export default function StepTour({ aiEmail, onComplete }: StepTourProps) {
  const [tourStep, setTourStep] = useState(0);
  const [copied, setCopied] = useState(false);

  const isLastStep = tourStep >= TOUR_STEPS.length - 1;
  const current = TOUR_STEPS[tourStep];

  const handleCopy = () => {
    navigator.clipboard.writeText(aiEmail);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col items-center max-w-lg mx-auto px-6">
      <h2 className="text-3xl font-bold text-stone-900 mb-2">Your Dashboard</h2>
      <p className="text-stone-500 mb-8 text-center">
        Here&apos;s a quick tour of what you&apos;ll find
      </p>

      {/* Progress dots */}
      <div className="flex gap-2 mb-8">
        {TOUR_STEPS.map((_, i) => (
          <div
            key={i}
            className={`w-2 h-2 rounded-full transition-colors ${
              i === tourStep ? "bg-stone-800" : i < tourStep ? "bg-stone-400" : "bg-stone-200"
            }`}
          />
        ))}
      </div>

      {/* Spotlight card */}
      <div className="w-full bg-white border-2 border-stone-800 rounded-2xl p-8 text-center space-y-4 mb-8 relative overflow-hidden">
        {/* Background glow */}
        <div className="absolute inset-0 bg-gradient-to-br from-stone-100/50 to-transparent pointer-events-none" />

        <div className="relative">
          <div className="w-16 h-16 bg-stone-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-stone-700"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d={current.icon} />
            </svg>
          </div>

          <h3 className="text-xl font-bold text-stone-900">{current.title}</h3>
          <p className="text-stone-500 mt-2">{current.description}</p>
        </div>
      </div>

      {/* Step navigation */}
      <div className="flex gap-4 w-full mb-6">
        {tourStep > 0 && (
          <Button variant="outline" onClick={() => setTourStep((s) => s - 1)} className="flex-1">
            Previous
          </Button>
        )}
        {!isLastStep ? (
          <Button onClick={() => setTourStep((s) => s + 1)} className="flex-1">
            Next
          </Button>
        ) : (
          <div className="flex-1" />
        )}
      </div>

      {/* Final CTA */}
      {isLastStep && (
        <div className="w-full space-y-4">
          <div className="bg-gradient-to-br from-stone-800 to-stone-900 rounded-2xl p-6 text-center text-white">
            <h3 className="text-lg font-bold mb-2">Ready to send your first task?</h3>
            <p className="text-stone-300 text-sm mb-4">
              Send an email to your AI and watch it work
            </p>
            <div className="bg-white/10 backdrop-blur rounded-xl p-3 font-mono text-lg mb-3">
              {aiEmail}
            </div>
            <button
              onClick={handleCopy}
              className="text-stone-300 hover:text-white text-sm transition-colors underline underline-offset-4"
            >
              {copied ? "Copied!" : "Copy email address"}
            </button>
          </div>

          <Button onClick={onComplete} className="w-full" size="lg">
            Go to Dashboard
          </Button>
        </div>
      )}

      {/* Skip tour link */}
      {!isLastStep && (
        <button
          onClick={onComplete}
          className="text-stone-400 hover:text-stone-600 text-sm transition-colors underline underline-offset-4"
        >
          Skip tour
        </button>
      )}
    </div>
  );
}
