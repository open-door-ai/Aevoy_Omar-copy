"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface StepInterviewProps {
  onNext: (data: InterviewData) => void;
  onBack: () => void;
}

export interface InterviewData {
  method: "phone_call" | "email_questionnaire" | "quick_basics" | "skipped";
  phone_number?: string;
  main_uses?: string[];
  daily_checkin_enabled?: boolean;
  daily_checkin_time?: string;
  timezone?: string;
}

const USE_CASES = [
  { id: "bookings", label: "Bookings & Reservations", icon: "M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" },
  { id: "research", label: "Research & Analysis", icon: "m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" },
  { id: "forms", label: "Forms & Applications", icon: "M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" },
  { id: "emails", label: "Email Management", icon: "M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" },
  { id: "calls", label: "Phone Calls", icon: "M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" },
  { id: "shopping", label: "Shopping & Purchases", icon: "M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" },
];

export default function StepInterview({ onNext, onBack }: StepInterviewProps) {
  const [view, setView] = useState<"choose" | "phone" | "basics">("choose");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [callStatus, setCallStatus] = useState<string | null>(null);
  const [selectedUses, setSelectedUses] = useState<string[]>([]);
  const [dailyCheckin, setDailyCheckin] = useState(false);
  const [checkinTime, setCheckinTime] = useState("09:00");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const toggleUse = (id: string) => {
    setSelectedUses((prev) =>
      prev.includes(id) ? prev.filter((u) => u !== id) : [...prev, id]
    );
  };

  const handlePhoneCall = async () => {
    if (!phoneNumber.trim()) return;
    setCallStatus("calling");
    try {
      const res = await fetch("/api/onboarding/request-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone_number: phoneNumber }),
      });
      const data = await res.json();
      setCallStatus(data.status === "calling" ? "in_progress" : "queued");
    } catch {
      setCallStatus("error");
    }
  };

  const handleEmailQuestionnaire = async () => {
    setSendingEmail(true);
    try {
      const res = await fetch("/api/onboarding/send-questionnaire", {
        method: "POST",
      });
      if (res.ok) setEmailSent(true);
    } catch {
      // Ignore
    }
    setSendingEmail(false);
  };

  const handleQuickBasicsSubmit = () => {
    onNext({
      method: "quick_basics",
      main_uses: selectedUses,
      daily_checkin_enabled: dailyCheckin,
      daily_checkin_time: dailyCheckin ? checkinTime : undefined,
    });
  };

  // Choose path view
  if (view === "choose") {
    return (
      <div className="flex flex-col items-center max-w-2xl mx-auto px-6">
        <h2 className="text-3xl font-bold text-stone-900 mb-2">Help Your AI Know You</h2>
        <p className="text-stone-500 mb-8 text-center">
          The more your AI knows about you, the better it works. Choose how you&apos;d like to share:
        </p>

        <div className="grid gap-4 w-full">
          {/* Option A: Phone Call */}
          <button
            onClick={() => setView("phone")}
            className="w-full text-left p-5 border-2 border-stone-200 rounded-2xl hover:border-stone-400 hover:bg-stone-50 transition-all group"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-stone-100 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-stone-200 transition-colors">
                <svg className="w-6 h-6 text-stone-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-stone-900">Phone Call Interview</p>
                <p className="text-sm text-stone-500">Your AI calls you for a quick chat to learn your preferences</p>
              </div>
              <svg className="w-5 h-5 text-stone-300 ml-auto shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </div>
          </button>

          {/* Option B: Email Questionnaire */}
          <button
            onClick={handleEmailQuestionnaire}
            disabled={sendingEmail || emailSent}
            className="w-full text-left p-5 border-2 border-stone-200 rounded-2xl hover:border-stone-400 hover:bg-stone-50 transition-all group disabled:opacity-60"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-stone-100 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-stone-200 transition-colors">
                <svg className="w-6 h-6 text-stone-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-stone-900">
                  {emailSent ? "Questionnaire Sent!" : sendingEmail ? "Sending..." : "Email Questionnaire"}
                </p>
                <p className="text-sm text-stone-500">
                  {emailSent
                    ? "Check your inbox and reply when you're ready"
                    : "Get emailed a questionnaire — reply at your leisure"}
                </p>
              </div>
              {emailSent ? (
                <svg className="w-5 h-5 text-green-500 ml-auto shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-stone-300 ml-auto shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                </svg>
              )}
            </div>
          </button>

          {/* Option C: Quick Basics */}
          <button
            onClick={() => setView("basics")}
            className="w-full text-left p-5 border-2 border-stone-200 rounded-2xl hover:border-stone-400 hover:bg-stone-50 transition-all group"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-stone-100 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-stone-200 transition-colors">
                <svg className="w-6 h-6 text-stone-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-stone-900">Quick Basics</p>
                <p className="text-sm text-stone-500">Fill in a few preferences right here, right now</p>
              </div>
              <svg className="w-5 h-5 text-stone-300 ml-auto shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </div>
          </button>
        </div>

        {/* Skip with guilt trip */}
        <div className="mt-8 flex flex-col items-center gap-3">
          <button
            onClick={() => onNext({ method: "skipped" })}
            className="text-stone-400 hover:text-stone-600 text-sm transition-colors underline underline-offset-4"
          >
            Skip this step
          </button>
          <p className="text-xs text-stone-300 max-w-sm text-center">
            Your AI will still work, but it won&apos;t know your preferences, habits, or context — so it&apos;ll be less effective
          </p>
        </div>

        <div className="mt-6 w-full">
          <Button variant="outline" onClick={onBack} className="w-full">
            Back
          </Button>
          {emailSent && (
            <Button onClick={() => onNext({ method: "email_questionnaire" })} className="w-full mt-3">
              Continue
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Phone call view
  if (view === "phone") {
    return (
      <div className="flex flex-col items-center max-w-lg mx-auto px-6">
        <h2 className="text-3xl font-bold text-stone-900 mb-2">Phone Interview</h2>
        <p className="text-stone-500 mb-8 text-center">
          Enter your phone number and your AI will call you for a quick conversation
        </p>

        {callStatus === "in_progress" || callStatus === "queued" ? (
          <div className="w-full bg-green-50 border-2 border-green-200 rounded-2xl p-8 text-center space-y-4">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto animate-pulse">
              <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
              </svg>
            </div>
            <p className="text-lg font-semibold text-stone-900">
              {callStatus === "in_progress" ? "Calling you now..." : "Call queued!"}
            </p>
            <p className="text-stone-500 text-sm">
              {callStatus === "in_progress"
                ? "Pick up when your phone rings"
                : "We'll call you shortly when the service is ready"}
            </p>
            <Button onClick={() => onNext({ method: "phone_call", phone_number: phoneNumber })} className="mt-4">
              Continue to next step
            </Button>
          </div>
        ) : (
          <div className="w-full space-y-6">
            <div className="space-y-2">
              <Label htmlFor="phone" className="text-stone-600">Your phone number</Label>
              <Input
                id="phone"
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+1 (604) 555-0123"
                className="font-mono text-lg"
              />
            </div>

            {callStatus === "error" && (
              <p className="text-sm text-red-500">Failed to initiate call. Please try again.</p>
            )}

            <Button
              onClick={handlePhoneCall}
              disabled={!phoneNumber.trim() || callStatus === "calling"}
              className="w-full"
            >
              {callStatus === "calling" ? "Initiating call..." : "Call me now"}
            </Button>
          </div>
        )}

        <div className="mt-6 flex gap-4 w-full">
          <Button variant="outline" onClick={() => setView("choose")} className="flex-1">
            Back
          </Button>
        </div>
      </div>
    );
  }

  // Quick basics view
  return (
    <div className="flex flex-col items-center max-w-2xl mx-auto px-6">
      <h2 className="text-3xl font-bold text-stone-900 mb-2">Quick Basics</h2>
      <p className="text-stone-500 mb-8 text-center">
        Tell your AI what you&apos;ll use it for most
      </p>

      {/* Use case pills */}
      <div className="w-full space-y-4 mb-8">
        <Label className="text-stone-600">What will you use Aevoy for?</Label>
        <div className="flex flex-wrap gap-3">
          {USE_CASES.map((useCase) => (
            <button
              key={useCase.id}
              onClick={() => toggleUse(useCase.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-full border-2 transition-all text-sm font-medium ${
                selectedUses.includes(useCase.id)
                  ? "border-stone-800 bg-stone-800 text-white"
                  : "border-stone-200 text-stone-600 hover:border-stone-400"
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={useCase.icon} />
              </svg>
              {useCase.label}
            </button>
          ))}
        </div>
      </div>

      {/* Daily check-in */}
      <div className="w-full bg-stone-50 border border-stone-200 rounded-2xl p-5 space-y-4 mb-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-stone-900">Daily Check-in Call</p>
            <p className="text-sm text-stone-500">Your AI calls you each morning with a daily briefing</p>
          </div>
          <button
            onClick={() => setDailyCheckin(!dailyCheckin)}
            className={`relative w-12 h-7 rounded-full transition-colors ${
              dailyCheckin ? "bg-stone-800" : "bg-stone-300"
            }`}
          >
            <div
              className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${
                dailyCheckin ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        {dailyCheckin && (
          <div className="space-y-2 pt-2 border-t border-stone-200">
            <Label htmlFor="checkinTime" className="text-stone-600">What time?</Label>
            <Input
              id="checkinTime"
              type="time"
              value={checkinTime}
              onChange={(e) => setCheckinTime(e.target.value)}
              className="w-40"
            />
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex gap-4 w-full">
        <Button variant="outline" onClick={() => setView("choose")} className="flex-1">
          Back
        </Button>
        <Button onClick={handleQuickBasicsSubmit} className="flex-1">
          Continue
        </Button>
      </div>
    </div>
  );
}
