"use client";

import { useState, useEffect, useCallback } from "react";

interface StepWelcomeProps {
  name: string;
  onNext: () => void;
}

export default function StepWelcome({ name, onNext }: StepWelcomeProps) {
  const [phase, setPhase] = useState<"typing" | "demo" | "ready">("typing");
  const [typedText, setTypedText] = useState("");
  const [demoStep, setDemoStep] = useState(0);

  const fullText = `Welcome to Aevoy, ${name}`;

  // Typing effect
  useEffect(() => {
    if (phase !== "typing") return;
    if (typedText.length >= fullText.length) {
      const timer = setTimeout(() => setPhase("demo"), 600);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => {
      setTypedText(fullText.slice(0, typedText.length + 1));
    }, 60);
    return () => clearTimeout(timer);
  }, [typedText, fullText, phase]);

  // Demo animation steps
  useEffect(() => {
    if (phase !== "demo") return;
    if (demoStep >= 3) {
      const timer = setTimeout(() => setPhase("ready"), 800);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => setDemoStep((s) => s + 1), 1000);
    return () => clearTimeout(timer);
  }, [demoStep, phase]);

  // Auto-advance after ready
  const autoTimer = useCallback(() => {
    if (phase !== "ready") return;
    const timer = setTimeout(onNext, 3000);
    return () => clearTimeout(timer);
  }, [phase, onNext]);

  useEffect(() => {
    return autoTimer();
  }, [autoTimer]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6">
      {/* Typing greeting */}
      <h1 className="text-4xl md:text-5xl font-bold text-stone-900 mb-12 min-h-[3.5rem]">
        {typedText}
        {phase === "typing" && (
          <span className="inline-block w-[3px] h-[1.2em] bg-stone-900 ml-1 animate-pulse align-middle" />
        )}
      </h1>

      {/* Animated concept demo */}
      <div
        className={`flex items-center gap-4 md:gap-8 transition-opacity duration-700 ${
          phase === "typing" ? "opacity-0" : "opacity-100"
        }`}
      >
        {/* Step 1: Email in */}
        <div
          className={`flex flex-col items-center gap-2 transition-all duration-500 ${
            demoStep >= 1 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          }`}
        >
          <div className="w-16 h-16 md:w-20 md:h-20 rounded-2xl bg-stone-100 border-2 border-stone-200 flex items-center justify-center">
            <svg
              className="w-8 h-8 md:w-10 md:h-10 text-stone-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"
              />
            </svg>
          </div>
          <span className="text-xs md:text-sm text-stone-500 font-medium">You send a task</span>
        </div>

        {/* Arrow 1 */}
        <div
          className={`transition-all duration-500 delay-100 ${
            demoStep >= 1 ? "opacity-100 scale-100" : "opacity-0 scale-50"
          }`}
        >
          <svg className="w-6 h-6 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
          </svg>
        </div>

        {/* Step 2: AI processes */}
        <div
          className={`flex flex-col items-center gap-2 transition-all duration-500 ${
            demoStep >= 2 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          }`}
        >
          <div className="w-16 h-16 md:w-20 md:h-20 rounded-2xl bg-gradient-to-br from-stone-800 to-stone-900 flex items-center justify-center relative">
            <svg
              className="w-8 h-8 md:w-10 md:h-10 text-stone-100"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z"
              />
            </svg>
            {demoStep >= 2 && (
              <div className="absolute inset-0 rounded-2xl animate-ping bg-stone-400/20" />
            )}
          </div>
          <span className="text-xs md:text-sm text-stone-500 font-medium">AI does the work</span>
        </div>

        {/* Arrow 2 */}
        <div
          className={`transition-all duration-500 delay-100 ${
            demoStep >= 2 ? "opacity-100 scale-100" : "opacity-0 scale-50"
          }`}
        >
          <svg className="w-6 h-6 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
          </svg>
        </div>

        {/* Step 3: Results */}
        <div
          className={`flex flex-col items-center gap-2 transition-all duration-500 ${
            demoStep >= 3 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          }`}
        >
          <div className="w-16 h-16 md:w-20 md:h-20 rounded-2xl bg-green-50 border-2 border-green-200 flex items-center justify-center">
            <svg
              className="w-8 h-8 md:w-10 md:h-10 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </div>
          <span className="text-xs md:text-sm text-stone-500 font-medium">Get results back</span>
        </div>
      </div>

      {/* Skip / Continue */}
      <div
        className={`mt-16 transition-opacity duration-500 ${
          phase !== "typing" ? "opacity-100" : "opacity-0"
        }`}
      >
        <button
          onClick={onNext}
          className="text-stone-400 hover:text-stone-600 text-sm transition-colors underline underline-offset-4"
        >
          {phase === "ready" ? "Continue" : "Skip intro"}
        </button>
      </div>
    </div>
  );
}
