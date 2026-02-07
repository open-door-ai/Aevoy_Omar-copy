"use client";

import { useState } from "react";
import { motion } from "@/components/ui/motion";
import {
  Calendar,
  Search,
  FileText,
  Mail,
  Phone,
  ShoppingCart,
  Share2,
  DollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface StepUseCasesProps {
  onNext: () => void;
  onBack: () => void;
}

const USE_CASES = [
  { id: "bookings", label: "Bookings", description: "Flights, hotels, restaurants", icon: Calendar },
  { id: "research", label: "Research", description: "Find information, compare options", icon: Search },
  { id: "forms", label: "Forms", description: "Fill out applications, paperwork", icon: FileText },
  { id: "emails", label: "Emails", description: "Compose, send, follow up", icon: Mail },
  { id: "calls", label: "Calls", description: "Schedule, make calls on your behalf", icon: Phone },
  { id: "shopping", label: "Shopping", description: "Find products, price compare", icon: ShoppingCart },
  { id: "social", label: "Social Media", description: "Post, schedule, monitor", icon: Share2 },
  { id: "finance", label: "Finance", description: "Track expenses, pay bills", icon: DollarSign },
];

export function StepUseCases({ onNext, onBack }: StepUseCasesProps) {
  const [selectedUseCases, setSelectedUseCases] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const toggleUseCase = (id: string) => {
    if (selectedUseCases.includes(id)) {
      setSelectedUseCases(selectedUseCases.filter((uc) => uc !== id));
    } else {
      if (selectedUseCases.length < 3) {
        setSelectedUseCases([...selectedUseCases, id]);
      }
    }
  };

  const handleContinue = async () => {
    if (selectedUseCases.length === 0) {
      onNext();
      return;
    }

    setIsSaving(true);
    try {
      await fetch("/api/onboarding/save-step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: 4,
          data: { main_uses: selectedUseCases },
        }),
      });
      onNext();
    } catch (error) {
      console.error("Failed to save use cases:", error);
      onNext();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-stone-900">What Can Aevoy Do For You?</h2>
        <p className="text-stone-500">
          Select 1-3 tasks you&apos;ll use most often (helps us personalize your experience)
        </p>
        <p className="text-sm text-stone-500">
          {selectedUseCases.length}/3 selected
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {USE_CASES.map((useCase, index) => {
          const Icon = useCase.icon;
          const isSelected = selectedUseCases.includes(useCase.id);
          const isDisabled = !isSelected && selectedUseCases.length >= 3;

          return (
            <motion.button
              key={useCase.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              onClick={() => toggleUseCase(useCase.id)}
              disabled={isDisabled}
              className={`relative p-4 rounded-lg border-2 transition-all text-left ${
                isSelected
                  ? "border-stone-800 bg-stone-50 scale-[1.02]"
                  : isDisabled
                  ? "border-stone-200 opacity-50 cursor-not-allowed"
                  : "border-stone-200 hover:border-stone-400 hover:bg-stone-50"
              }`}
            >
              <div className="space-y-2">
                <Icon className={`w-8 h-8 ${isSelected ? "text-stone-800" : "text-stone-500"}`} />
                <div>
                  <h3 className="font-semibold text-sm text-stone-900">{useCase.label}</h3>
                  <p className="text-xs text-stone-500">{useCase.description}</p>
                </div>
              </div>
              {isSelected && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute top-2 right-2 w-6 h-6 rounded-full bg-stone-800 text-white flex items-center justify-center text-xs"
                >
                  ✓
                </motion.div>
              )}
            </motion.button>
          );
        })}
      </div>

      <div className="flex justify-between gap-4">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={handleContinue} disabled={isSaving}>
          {isSaving ? "Saving..." : "Continue"}
        </Button>
      </div>

      <div className="text-center text-sm text-stone-500">
        Don&apos;t worry — Aevoy can handle all of these and more!
      </div>
    </div>
  );
}
