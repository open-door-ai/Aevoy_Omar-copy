"use client";

import { useState, useEffect, useRef } from "react";
import { motion } from "@/components/ui/motion";
import { Mail, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

interface StepEmailVerificationProps {
  onNext: () => void;
}

export function StepEmailVerification({ onNext }: StepEmailVerificationProps) {
  const [isVerified, setIsVerified] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [showTrouble, setShowTrouble] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const checkVerification = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user?.email_confirmed_at) {
        setIsVerified(true);
        // Stop polling once verified
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    };

    // Check immediately
    checkVerification();

    // Then check every 3 seconds
    intervalRef.current = setInterval(checkVerification, 3000);

    // Show trouble message after 5 minutes
    const troubleTimeout = setTimeout(() => {
      setShowTrouble(true);
    }, 300000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      clearTimeout(troubleTimeout);
    };
  }, []);

  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => {
        setResendCooldown(resendCooldown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  const handleResend = async () => {
    if (resendCooldown > 0) return;

    setIsResending(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user?.email) {
        await supabase.auth.resend({
          type: "signup",
          email: user.email,
        });
        setResendCooldown(60);
      }
    } catch (error) {
      console.error("Resend error:", error);
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="space-y-6 max-w-md mx-auto text-center">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: isVerified ? 1 : [1, 1.1, 1] }}
        transition={{
          duration: isVerified ? 0.3 : 2,
          repeat: isVerified ? 0 : Infinity,
          repeatDelay: 3,
        }}
        className="mx-auto"
      >
        {isVerified ? (
          <div className="w-24 h-24 rounded-full bg-green-500 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-12 h-12 text-white" />
          </div>
        ) : (
          <div className="w-24 h-24 rounded-full bg-stone-100 flex items-center justify-center mx-auto">
            <Mail className="w-12 h-12 text-stone-600" />
          </div>
        )}
      </motion.div>

      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-stone-900">
          {isVerified ? "Email Verified!" : "Check Your Email"}
        </h2>
        <p className="text-stone-500">
          {isVerified
            ? "Great! Click Continue to keep setting up your account."
            : "We sent a verification link to your email address. Click the link to continue."}
        </p>
      </div>

      {isVerified ? (
        <Button onClick={onNext} className="w-full" size="lg">
          Continue
        </Button>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-center gap-2 text-sm text-stone-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Waiting for confirmation...</span>
          </div>

          <Button
            variant="outline"
            onClick={handleResend}
            disabled={isResending || resendCooldown > 0}
          >
            {isResending
              ? "Sending..."
              : resendCooldown > 0
              ? `Resend in ${resendCooldown}s`
              : "Resend Verification Email"}
          </Button>

          <p className="text-xs text-stone-500">
            Can&apos;t find it? Check your spam folder
          </p>

          {showTrouble && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="pt-4 border-t border-stone-200"
            >
              <p className="text-sm text-stone-500 mb-2">
                Having trouble?
              </p>
              <a
                href="mailto:support@aevoy.com"
                className="text-sm text-stone-700 hover:underline font-medium"
              >
                Contact support@aevoy.com
              </a>
            </motion.div>
          )}

          {/* Skip option for users whose email was already verified */}
          <button
            onClick={onNext}
            className="text-stone-500 hover:text-stone-700 text-sm transition-colors underline underline-offset-4"
          >
            Skip verification
          </button>
        </div>
      )}
    </div>
  );
}
