"use client";

import { motion } from "@/components/ui/motion";
import { UserCheck, Briefcase, MessageSquare, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface StepMeetInternProps {
  botName: string;
  onNext: () => void;
  onBack: () => void;
}

const tips = [
  {
    icon: MessageSquare,
    title: "Talk to it like a person",
    description: "No special commands or syntax. Just say what you need done, like you would to a new hire.",
  },
  {
    icon: Briefcase,
    title: "Give it real tasks",
    description: "Book a restaurant. Research a topic. Draft an email. It learns your preferences with every task.",
  },
  {
    icon: UserCheck,
    title: "Be specific, get better results",
    description: "The more context you give, the better it performs. It gets sharper over time — just like a real intern.",
  },
];

export default function StepMeetIntern({ botName, onNext, onBack }: StepMeetInternProps) {
  return (
    <div className="space-y-8 max-w-2xl mx-auto">
      <div className="text-center space-y-3">
        <motion.div
          initial={{ scale: 0, rotate: -10 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 15 }}
          className="w-20 h-20 rounded-full bg-stone-900 flex items-center justify-center mx-auto text-white text-2xl font-bold"
        >
          {(botName || "A").charAt(0).toUpperCase()}
        </motion.div>
        <h2 className="text-3xl font-bold text-gray-900">
          Meet your AI intern
        </h2>
        <p className="text-lg text-gray-500 max-w-md mx-auto">
          Think of {botName || "your AI"} as a smart new hire on day one — eager, capable, and getting better every day.
        </p>
      </div>

      <div className="space-y-4">
        {tips.map((tip, index) => {
          const Icon = tip.icon;
          return (
            <motion.div
              key={tip.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 * index }}
              className="flex gap-4 items-start p-4 rounded-xl bg-stone-50 border border-stone-100"
            >
              <div className="shrink-0 w-10 h-10 rounded-lg bg-stone-900 flex items-center justify-center">
                <Icon className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">{tip.title}</h3>
                <p className="text-sm text-gray-500 mt-0.5">{tip.description}</p>
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="bg-stone-50 border border-stone-200 rounded-xl p-5 text-center">
        <p className="text-sm text-stone-600">
          <span className="font-semibold text-stone-800">Pro tip:</span> The best results come from treating it like a real teammate. Delegate, give feedback, and watch it improve.
        </p>
      </div>

      <div className="flex justify-between gap-4">
        <Button variant="outline" onClick={onBack}>
          <ChevronLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <Button onClick={onNext}>
          Got it, let&apos;s go
          <ChevronRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
