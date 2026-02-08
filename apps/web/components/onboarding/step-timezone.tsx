"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface StepTimezoneProps {
  onNext: () => void;
  onBack: () => void;
}

// Common timezones grouped by region
const TIMEZONE_GROUPS = [
  {
    label: "Americas",
    options: [
      { label: "Pacific Time (Los Angeles)", value: "America/Los_Angeles" },
      { label: "Mountain Time (Denver)", value: "America/Denver" },
      { label: "Central Time (Chicago)", value: "America/Chicago" },
      { label: "Eastern Time (New York)", value: "America/New_York" },
      { label: "Atlantic Time (Halifax)", value: "America/Halifax" },
    ],
  },
  {
    label: "Europe",
    options: [
      { label: "London (GMT)", value: "Europe/London" },
      { label: "Paris (CET)", value: "Europe/Paris" },
      { label: "Berlin (CET)", value: "Europe/Berlin" },
      { label: "Athens (EET)", value: "Europe/Athens" },
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
      { label: "Tokyo", value: "Asia/Tokyo" },
      { label: "Shanghai", value: "Asia/Shanghai" },
    ],
  },
  {
    label: "Pacific",
    options: [
      { label: "Sydney", value: "Australia/Sydney" },
      { label: "Auckland", value: "Pacific/Auckland" },
    ],
  },
];

export function StepTimezone({ onNext, onBack }: StepTimezoneProps) {
  const [timezone, setTimezone] = useState("");
  const [detectedTimezone, setDetectedTimezone] = useState("");
  const [dailyCheckinEnabled, setDailyCheckinEnabled] = useState(false);
  const [dailyCheckinTime, setDailyCheckinTime] = useState("09:00");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    // Auto-detect timezone
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setDetectedTimezone(detected);
    setTimezone(detected);
  }, []);

  const handleContinue = async () => {
    setIsSaving(true);
    try {
      await fetch("/api/onboarding/save-step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: 6,
          data: {
            timezone,
            daily_checkin_enabled: dailyCheckinEnabled,
            daily_checkin_time: dailyCheckinTime,
          },
        }),
      });
      onNext();
    } catch (error) {
      console.error("Failed to save timezone:", error);
      onNext();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-gray-900">When Are You Available?</h2>
        <p className="text-gray-600">
          This helps us schedule tasks at the right time for you
        </p>
      </div>

      <div className="space-y-6">
        {/* Timezone */}
        <div className="space-y-2">
          <Label htmlFor="timezone" className="text-gray-700">Your Timezone</Label>
          <Select
            id="timezone"
            value={timezone}
            onChange={setTimezone}
            groups={TIMEZONE_GROUPS}
            searchable
            placeholder="Search timezones..."
          />
          {detectedTimezone && (
            <p className="text-xs text-gray-600">
              Detected: {detectedTimezone}
              {detectedTimezone !== timezone && (
                <button
                  onClick={() => setTimezone(detectedTimezone)}
                  className="ml-2 text-gray-700 font-medium hover:underline"
                >
                  Use detected
                </button>
              )}
            </p>
          )}
          <p className="text-xs text-gray-600">
            Used for daily check-ins and quiet hours (10PM-7AM)
          </p>
        </div>

        {/* Daily Check-in */}
        <div className="space-y-4 p-4 border border-gray-200 rounded-lg">
          <Toggle
            checked={dailyCheckinEnabled}
            onChange={setDailyCheckinEnabled}
            label="Daily Morning Brief"
            description="Would you like a daily check-in call with your AI?"
            labelPosition="right"
          />

          {dailyCheckinEnabled && (
            <div className="space-y-2 pl-4 border-l-2 border-gray-800">
              <Label htmlFor="checkin-time" className="text-gray-700">What time?</Label>
              <Input
                id="checkin-time"
                type="time"
                value={dailyCheckinTime}
                onChange={(e) => setDailyCheckinTime(e.target.value)}
                className="max-w-[200px]"
              />
              <p className="text-xs text-gray-600">
                Your AI will call to brief you on your day
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-between gap-4">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={handleContinue} disabled={isSaving || !timezone}>
          {isSaving ? "Saving..." : "Continue"}
        </Button>
      </div>
    </div>
  );
}
