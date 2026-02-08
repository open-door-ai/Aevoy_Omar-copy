"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FadeIn, motion, springs } from "@/components/ui/motion";

interface StepPhoneProps {
  onNext: (phone: string | null) => void;
  onBack: () => void;
}

type VerificationStatus = "input" | "calling" | "waiting" | "verified" | "error";

export default function StepPhone({ onNext, onBack }: StepPhoneProps) {
  const [userPhone, setUserPhone] = useState("");
  const [status, setStatus] = useState<VerificationStatus>("input");
  const [error, setError] = useState<string | null>(null);
  const [verifiedPhone, setVerifiedPhone] = useState<string | null>(null);

  // Check if user already has a verified phone
  useEffect(() => {
    async function checkExistingPhone() {
      try {
        const res = await fetch("/api/onboarding/check-phone-verification");
        if (res.ok) {
          const data = await res.json();
          if (data.verified && data.phone) {
            setVerifiedPhone(data.phone);
            setStatus("verified");
          }
        }
      } catch {
        // Ignore errors, user will just go through verification
      }
    }
    checkExistingPhone();
  }, []);

  // Poll for verification status when in "waiting" state
  useEffect(() => {
    if (status !== "waiting") return;

    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch("/api/onboarding/check-phone-verification");
        if (res.ok) {
          const data = await res.json();
          if (data.verified) {
            setVerifiedPhone(data.phone);
            setStatus("verified");
            clearInterval(pollInterval);
          }
        }
      } catch {
        // Continue polling on error
      }
    }, 2000);

    // Stop polling after 2 minutes
    const timeout = setTimeout(() => {
      clearInterval(pollInterval);
      if (status === "waiting") {
        setError("Verification timed out. Please try again.");
        setStatus("error");
      }
    }, 120000);

    return () => {
      clearInterval(pollInterval);
      clearTimeout(timeout);
    };
  }, [status]);

  const normalizePhone = useCallback((phone: string): string => {
    const hasPlus = phone.trim().startsWith("+");
    const digits = phone.replace(/\D/g, "");

    if (!digits) return "";

    // If 11 digits starting with 1 (US/CA)
    if (digits.length === 11 && digits.startsWith("1")) {
      return `+${digits}`;
    }

    // If 10 digits, assume US/CA
    if (digits.length === 10) {
      return `+1${digits}`;
    }

    // If had + prefix, keep as-is (international)
    if (hasPlus) {
      return `+${digits}`;
    }

    // Otherwise, assume US and prepend +1
    if (digits.length >= 10) {
      return `+${digits}`;
    }

    return phone.trim();
  }, []);

  const validatePhone = (phone: string): boolean => {
    const normalized = normalizePhone(phone);
    // E.164 format: starts with + and has 10-15 digits
    return /^\+[1-9]\d{6,14}$/.test(normalized);
  };

  const handleCallMe = async () => {
    setError(null);
    setStatus("calling");

    try {
      const res = await fetch("/api/onboarding/verify-phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: userPhone }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to initiate verification call");
        setStatus("error");
        return;
      }

      // Successfully initiated call, now wait for user to press 1
      setStatus("waiting");
    } catch {
      setError("Network error. Please try again.");
      setStatus("error");
    }
  };

  const formatPhoneForDisplay = (phone: string): string => {
    const normalized = normalizePhone(phone);
    // Format as (XXX) XXX-XXXX for US numbers
    if (normalized.startsWith("+1") && normalized.length === 12) {
      const digits = normalized.slice(2);
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return normalized;
  };

  // Verified state - show success and allow continue
  if (status === "verified" && verifiedPhone) {
    return (
      <div className="flex flex-col items-center max-w-lg mx-auto px-6">
        <FadeIn>
          <h2 className="text-3xl font-bold text-gray-900 mb-2 text-center">Phone Verified!</h2>
          <p className="text-gray-600 mb-8 text-center">
            Your phone number has been verified successfully
          </p>
        </FadeIn>

        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={springs.default}
          className="w-full text-center space-y-6"
        >
          <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-8">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={springs.bouncy}
              className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4"
            >
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </motion.div>
            <div className="text-2xl font-mono font-bold text-gray-900 mb-2">
              {formatPhoneForDisplay(verifiedPhone)}
            </div>
            <p className="text-green-700 text-sm">✓ Verified</p>
          </div>

          <div className="flex gap-4 w-full">
            <Button variant="outline" onClick={onBack} className="flex-1">
              Back
            </Button>
            <Button onClick={() => onNext(verifiedPhone)} className="flex-1">
              Continue
            </Button>
          </div>
        </motion.div>
      </div>
    );
  }

  // Waiting state - polling for verification
  if (status === "waiting") {
    return (
      <div className="flex flex-col items-center max-w-lg mx-auto px-6">
        <FadeIn>
          <h2 className="text-3xl font-bold text-gray-900 mb-2 text-center">Waiting for Verification</h2>
          <p className="text-gray-600 mb-8 text-center">
            Please answer the call and press 1 to verify your number
          </p>
        </FadeIn>

        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={springs.default}
          className="w-full text-center space-y-6"
        >
          <div className="bg-blue-50 border-2 border-blue-200 rounded-2xl p-8">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full mx-auto mb-4"
            />
            <div className="text-xl font-medium text-gray-900 mb-2">
              Calling {formatPhoneForDisplay(userPhone)}
            </div>
            <p className="text-blue-700 text-sm">
              Answer the call and press 1 to verify
            </p>
          </div>

          <div className="flex gap-4 w-full">
            <Button variant="outline" onClick={() => setStatus("input")} className="flex-1">
              Cancel
            </Button>
          </div>
        </motion.div>
      </div>
    );
  }

  // Input form or Calling state
  return (
    <div className="flex flex-col items-center max-w-lg mx-auto px-6">
      <FadeIn>
        <h2 className="text-3xl font-bold text-gray-900 mb-2 text-center">Verify Your Phone</h2>
        <p className="text-gray-600 mb-8 text-center">
          Enter your phone number and we&apos;ll call you to verify
        </p>
      </FadeIn>

      <FadeIn delay={0.15} className="w-full">
        <div className="w-full space-y-6">
          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gray-200 rounded-lg flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
                </svg>
              </div>
              <div>
                <p className="font-medium text-gray-900">Phone Verification</p>
                <p className="text-sm text-gray-600">
                  We&apos;ll call you and ask you to press 1 to confirm
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone" className="text-gray-600">
                Your phone number
              </Label>
              <Input
                id="phone"
                value={userPhone}
                onChange={(e) => setUserPhone(e.target.value)}
                placeholder="+1 (604) 555-1234"
                className="font-mono text-lg"
                disabled={status === "calling"}
                type="tel"
              />
              <p className="text-xs text-gray-500">
                Format: +16045551234 or (604) 555-1234
              </p>
            </div>

            {error && (
              <motion.p 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-sm text-red-500 bg-red-50 p-3 rounded-lg"
              >
                {error}
              </motion.p>
            )}

            <Button
              onClick={handleCallMe}
              disabled={status === "calling" || !validatePhone(userPhone)}
              className="w-full"
            >
              {status === "calling" ? (
                <>
                  <motion.span
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full mr-2"
                  />
                  Calling...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
                  </svg>
                  Call Me to Verify
                </>
              )}
            </Button>
          </div>

          <div className="flex gap-4 w-full">
            <Button variant="outline" onClick={onBack} className="flex-1">
              Back
            </Button>
            <button
              onClick={() => onNext(null)}
              className="flex-1 text-gray-600 hover:text-gray-700 text-sm transition-colors underline underline-offset-4"
            >
              Skip for now
            </button>
          </div>
        </div>
      </FadeIn>
    </div>
  );
}
