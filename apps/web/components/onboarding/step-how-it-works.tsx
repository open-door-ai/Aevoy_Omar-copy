"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "@/components/ui/motion";
import { Mail, Bot, CheckCircle, ChevronLeft, ChevronRight, Moon, ArrowRight, Globe, Mouse, Keyboard, Check, Inbox, Smile } from "lucide-react";
import { Button } from "@/components/ui/button";

interface StepHowItWorksProps {
  onNext: () => void;
  onBack: () => void;
}

const panels = [
  {
    title: "You Send Tasks",
    description: "Email, SMS, voice, or chat — send tasks any way you like",
    icon: Mail,
    visualIcons: [Mail, ArrowRight, Bot],
  },
  {
    title: "AI Takes Control",
    description: "Your AI browses, clicks, fills forms, and completes tasks like a human",
    icon: Bot,
    visualIcons: [Globe, Mouse, Keyboard],
  },
  {
    title: "You Get Results",
    description: "Completed tasks delivered back to you with full details",
    icon: CheckCircle,
    visualIcons: [Check, Inbox, Smile],
  },
];

export function StepHowItWorks({ onNext, onBack }: StepHowItWorksProps) {
  const [currentPanel, setCurrentPanel] = useState(0);

  const handleNext = () => {
    if (currentPanel < panels.length - 1) {
      setCurrentPanel(currentPanel + 1);
    } else {
      onNext();
    }
  };

  const handlePrev = () => {
    if (currentPanel > 0) {
      setCurrentPanel(currentPanel - 1);
    } else {
      onBack();
    }
  };

  const panel = panels[currentPanel];
  const Icon = panel.icon;

  return (
    <div className="space-y-8 max-w-2xl mx-auto">
      <div className="text-center space-y-2">
        <h2 className="text-3xl font-bold text-gray-900">How Aevoy Works</h2>
        <p className="text-lg text-gray-600 flex items-center justify-center gap-2">
          Your AI employee that never sleeps
          <Moon className="w-5 h-5 inline-block" />
        </p>
      </div>

      {/* Panel carousel */}
      <div className="relative min-h-[300px] flex items-center justify-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentPanel}
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            transition={{ duration: 0.3 }}
            className="text-center space-y-6 w-full"
          >
            {/* Icon */}
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center mx-auto"
            >
              <Icon className="w-10 h-10 text-gray-700" />
            </motion.div>

            {/* Visual representation */}
            <div className="flex items-center justify-center gap-4">
              {panel.visualIcons.map((VisualIcon, idx) => (
                <VisualIcon key={idx} className="w-12 h-12 text-gray-700" strokeWidth={1.5} />
              ))}
            </div>

            {/* Title and description */}
            <div className="space-y-2">
              <h3 className="text-2xl font-bold text-gray-900">{panel.title}</h3>
              <p className="text-gray-600 max-w-md mx-auto">
                {panel.description}
              </p>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Pagination dots */}
      <div className="flex justify-center gap-2">
        {panels.map((_, index) => (
          <button
            key={index}
            onClick={() => setCurrentPanel(index)}
            className={`h-2 rounded-full transition-all ${
              index === currentPanel
                ? "w-8 bg-gray-800"
                : "w-2 bg-gray-200 hover:bg-gray-400"
            }`}
            aria-label={`Go to panel ${index + 1}`}
          />
        ))}
      </div>

      {/* Navigation */}
      <div className="flex justify-between gap-4">
        <Button variant="outline" onClick={handlePrev}>
          <ChevronLeft className="w-4 h-4 mr-2" />
          {currentPanel === 0 ? "Back" : "Previous"}
        </Button>
        <Button onClick={handleNext}>
          {currentPanel === panels.length - 1 ? "Continue" : "Next"}
          <ChevronRight className="w-4 h-4 ml-2" />
        </Button>
      </div>

      <div className="text-center">
        <button
          onClick={onNext}
          className="text-sm text-gray-600 hover:text-gray-700 transition-colors underline underline-offset-4"
        >
          Skip intro
        </button>
      </div>
    </div>
  );
}
