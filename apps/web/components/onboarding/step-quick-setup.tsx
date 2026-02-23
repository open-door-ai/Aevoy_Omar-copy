"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { FadeIn, GlassCard, motion, springs, AnimatePresence } from "@/components/ui/motion";
import { Toggle } from "@/components/ui/toggle";
import { Select } from "@/components/ui/select";
import type { SelectOptionGroup } from "@/components/ui/select";
import {
  Calendar,
  Search,
  FileText,
  Mail,
  Phone,
  ShoppingCart,
  Share2,
  DollarSign,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StepQuickSetupProps {
  onNext: () => void;
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USE_CASES = [
  { id: "bookings", label: "Bookings", icon: Calendar },
  { id: "research", label: "Research", icon: Search },
  { id: "forms", label: "Forms", icon: FileText },
  { id: "emails", label: "Emails", icon: Mail },
  { id: "calls", label: "Calls", icon: Phone },
  { id: "shopping", label: "Shopping", icon: ShoppingCart },
  { id: "social", label: "Social", icon: Share2 },
  { id: "finance", label: "Finance", icon: DollarSign },
] as const;

const MAX_USE_CASES = 3;

const TIMEZONE_GROUPS: SelectOptionGroup[] = [
  {
    label: "Americas",
    options: [
      { label: "Pacific Time (Los Angeles)", value: "America/Los_Angeles" },
      { label: "Mountain Time (Denver)", value: "America/Denver" },
      { label: "Central Time (Chicago)", value: "America/Chicago" },
      { label: "Eastern Time (New York)", value: "America/New_York" },
      { label: "Atlantic Time (Halifax)", value: "America/Halifax" },
      { label: "Sao Paulo", value: "America/Sao_Paulo" },
      { label: "Buenos Aires", value: "America/Argentina/Buenos_Aires" },
      { label: "Vancouver", value: "America/Vancouver" },
      { label: "Toronto", value: "America/Toronto" },
      { label: "Mexico City", value: "America/Mexico_City" },
    ],
  },
  {
    label: "Europe",
    options: [
      { label: "London (GMT)", value: "Europe/London" },
      { label: "Paris (CET)", value: "Europe/Paris" },
      { label: "Berlin (CET)", value: "Europe/Berlin" },
      { label: "Amsterdam (CET)", value: "Europe/Amsterdam" },
      { label: "Athens (EET)", value: "Europe/Athens" },
      { label: "Istanbul", value: "Europe/Istanbul" },
      { label: "Moscow (MSK)", value: "Europe/Moscow" },
    ],
  },
  {
    label: "Asia",
    options: [
      { label: "Dubai", value: "Asia/Dubai" },
      { label: "Mumbai", value: "Asia/Kolkata" },
      { label: "Bangkok", value: "Asia/Bangkok" },
      { label: "Singapore", value: "Asia/Singapore" },
      { label: "Hong Kong", value: "Asia/Hong_Kong" },
      { label: "Shanghai", value: "Asia/Shanghai" },
      { label: "Tokyo", value: "Asia/Tokyo" },
      { label: "Seoul", value: "Asia/Seoul" },
    ],
  },
  {
    label: "Pacific",
    options: [
      { label: "Sydney", value: "Australia/Sydney" },
      { label: "Melbourne", value: "Australia/Melbourne" },
      { label: "Auckland", value: "Pacific/Auckland" },
      { label: "Honolulu", value: "Pacific/Honolulu" },
    ],
  },
  {
    label: "Africa",
    options: [
      { label: "Cairo", value: "Africa/Cairo" },
      { label: "Lagos", value: "Africa/Lagos" },
      { label: "Johannesburg", value: "Africa/Johannesburg" },
      { label: "Nairobi", value: "Africa/Nairobi" },
      { label: "Casablanca", value: "Africa/Casablanca" },
    ],
  },
  {
    label: "Other",
    options: [
      { label: "UTC", value: "Etc/UTC" },
      { label: "Reykjavik (GMT)", value: "Atlantic/Reykjavik" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Autonomy zone helpers
// ---------------------------------------------------------------------------

function getAutonomyZone(value: number): {
  label: string;
  description: string;
} {
  if (value <= 33) {
    return {
      label: "Cautious",
      description: "Asks before acting on anything important",
    };
  }
  if (value <= 66) {
    return {
      label: "Smart",
      description: "Acts on routine tasks, asks for big decisions",
    };
  }
  return {
    label: "Full auto",
    description: "Handles everything, only flags emergencies",
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StepQuickSetup({ onNext, onBack }: StepQuickSetupProps) {
  // --- Use cases ---
  const [selectedUseCases, setSelectedUseCases] = useState<string[]>([]);

  // --- Timezone ---
  const [timezone, setTimezone] = useState("");
  const [detectedTimezone, setDetectedTimezone] = useState("");
  const [showTimezoneSelect, setShowTimezoneSelect] = useState(false);

  // --- Autonomy ---
  const [autonomyLevel, setAutonomyLevel] = useState(50);

  // --- Daily check-in ---
  const [dailyCheckinEnabled, setDailyCheckinEnabled] = useState(false);
  const [dailyCheckinTime, setDailyCheckinTime] = useState("08:00");

  // --- Saving ---
  const [isSaving, setIsSaving] = useState(false);

  // Auto-detect timezone on mount
  useEffect(() => {
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      setDetectedTimezone(detected);
      setTimezone(detected);
    } catch {
      // Fallback — leave empty so the user picks manually
      setShowTimezoneSelect(true);
    }
  }, []);

  // --- Use case toggle ---
  const toggleUseCase = useCallback(
    (id: string) => {
      setSelectedUseCases((prev) => {
        if (prev.includes(id)) return prev.filter((uc) => uc !== id);
        if (prev.length >= MAX_USE_CASES) return prev;
        return [...prev, id];
      });
    },
    []
  );

  // --- Derived ---
  const autonomyZone = getAutonomyZone(autonomyLevel);
  const canContinue = selectedUseCases.length >= 1;

  // --- Save & continue ---
  const handleContinue = async () => {
    if (!canContinue) return;

    setIsSaving(true);
    try {
      await fetch("/api/onboarding/save-step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: 2,
          data: {
            main_uses: selectedUseCases,
            timezone: timezone || detectedTimezone || "Etc/UTC",
            autonomy_level: autonomyLevel,
            daily_checkin_enabled: dailyCheckinEnabled,
            daily_checkin_time: dailyCheckinTime,
          },
        }),
      });
    } catch (error) {
      console.error("Failed to save quick setup:", error);
    } finally {
      setIsSaving(false);
    }
    // Continue regardless of success/failure
    onNext();
  };

  // --- Slider track gradient ---
  const sliderBackground = `linear-gradient(to right, #1f2937 0%, #1f2937 ${autonomyLevel}%, #e5e7eb ${autonomyLevel}%, #e5e7eb 100%)`;

  return (
    <div className="max-w-lg mx-auto space-y-8 pb-4">
      {/* ----------------------------------------------------------------- */}
      {/* Section 1 — Use Cases                                             */}
      {/* ----------------------------------------------------------------- */}
      <FadeIn delay={0}>
        <div className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-gray-900">
              What will you use your AI for?
            </h2>
            <p className="text-sm text-gray-600">
              Pick up to {MAX_USE_CASES} &mdash;{" "}
              <span className="font-medium text-gray-800">
                {selectedUseCases.length}/{MAX_USE_CASES}
              </span>
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {USE_CASES.map((useCase) => {
              const Icon = useCase.icon;
              const isSelected = selectedUseCases.includes(useCase.id);
              const isDisabled =
                !isSelected && selectedUseCases.length >= MAX_USE_CASES;

              return (
                <motion.button
                  key={useCase.id}
                  type="button"
                  whileTap={{ scale: 0.95 }}
                  onClick={() => toggleUseCase(useCase.id)}
                  disabled={isDisabled}
                  className={`
                    inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium
                    border transition-all duration-150 select-none
                    ${
                      isSelected
                        ? "bg-gray-900 text-white border-gray-900"
                        : isDisabled
                        ? "bg-white text-gray-400 border-gray-200 opacity-50 cursor-not-allowed"
                        : "bg-white text-gray-700 border-gray-300 hover:border-gray-500 hover:bg-gray-50 cursor-pointer"
                    }
                  `}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {useCase.label}
                  {isSelected && <Check className="w-3.5 h-3.5 ml-0.5" />}
                </motion.button>
              );
            })}
          </div>
        </div>
      </FadeIn>

      {/* Divider */}
      <div className="border-t border-gray-200" />

      {/* ----------------------------------------------------------------- */}
      {/* Section 2 — Timezone                                              */}
      {/* ----------------------------------------------------------------- */}
      <FadeIn delay={0.1}>
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">Your timezone</h2>

          {timezone && !showTimezoneSelect ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 border border-green-200 text-green-800 px-3 py-1.5 font-medium">
                <Check className="w-3.5 h-3.5" />
                {timezone.replace(/_/g, " ")}
              </span>
              <button
                type="button"
                onClick={() => setShowTimezoneSelect(true)}
                className="text-gray-500 hover:text-gray-800 underline underline-offset-2 text-xs"
              >
                Change
              </button>
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              Could not auto-detect &mdash; please select:
            </p>
          )}

          <AnimatePresence>
            {showTimezoneSelect && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={springs.micro}
                className="overflow-hidden"
              >
                <Select
                  value={timezone}
                  onChange={(val) => {
                    setTimezone(val);
                    setShowTimezoneSelect(false);
                  }}
                  groups={TIMEZONE_GROUPS}
                  searchable
                  placeholder="Search timezones..."
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </FadeIn>

      {/* Divider */}
      <div className="border-t border-gray-200" />

      {/* ----------------------------------------------------------------- */}
      {/* Section 3 — Autonomy slider                                       */}
      {/* ----------------------------------------------------------------- */}
      <FadeIn delay={0.2}>
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">
            How autonomous should your AI be?
          </h2>

          <div className="space-y-2">
            <input
              type="range"
              min={0}
              max={100}
              value={autonomyLevel}
              onChange={(e) => setAutonomyLevel(parseInt(e.target.value, 10))}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer"
              style={{ background: sliderBackground }}
            />

            {/* Zone markers */}
            <div className="flex justify-between text-[11px] text-gray-400 px-0.5">
              <span>Cautious</span>
              <span>Smart</span>
              <span>Full auto</span>
            </div>

            {/* Active zone label */}
            <div className="text-center">
              <span className="text-sm font-semibold text-gray-900">
                {autonomyZone.label}
              </span>
              <span className="text-sm text-gray-500"> &mdash; </span>
              <span className="text-sm text-gray-600">
                {autonomyZone.description}
              </span>
            </div>
          </div>
        </div>
      </FadeIn>

      {/* Divider */}
      <div className="border-t border-gray-200" />

      {/* ----------------------------------------------------------------- */}
      {/* Section 4 — Daily check-in call                                   */}
      {/* ----------------------------------------------------------------- */}
      <FadeIn delay={0.3}>
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <h2 className="text-lg font-semibold text-gray-900">
                Daily check-in call?
              </h2>
              <p className="text-sm text-gray-500">
                Your AI calls you each morning with a summary
              </p>
            </div>
            <Toggle
              checked={dailyCheckinEnabled}
              onChange={setDailyCheckinEnabled}
              size="sm"
            />
          </div>

          <AnimatePresence>
            {dailyCheckinEnabled && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={springs.micro}
                className="overflow-hidden"
              >
                <div className="flex items-center gap-2 pl-1 pt-1">
                  <Clock className="w-4 h-4 text-gray-400" />
                  <input
                    type="time"
                    value={dailyCheckinTime}
                    onChange={(e) => setDailyCheckinTime(e.target.value)}
                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:border-gray-400"
                  />
                  <span className="text-xs text-gray-500">
                    {timezone
                      ? timezone.replace(/_/g, " ").split("/").pop()
                      : "your time"}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </FadeIn>

      {/* ----------------------------------------------------------------- */}
      {/* Navigation                                                        */}
      {/* ----------------------------------------------------------------- */}
      <div className="flex justify-between gap-4 pt-2">
        <Button variant="outline" onClick={onBack}>
          <ChevronLeft className="w-4 h-4" />
          Back
        </Button>
        <Button onClick={handleContinue} disabled={!canContinue || isSaving}>
          {isSaving ? "Saving..." : "Continue"}
          {!isSaving && <ChevronRight className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
}
