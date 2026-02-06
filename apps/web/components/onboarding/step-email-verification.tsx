"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
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

  useEffect(() => {
    const checkVerification = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user?.email_confirmed_at) {
        setIsVerified(true);
        // Auto-advance after showing success
        setTimeout(() => {
          onNext();
        }, 1500);
      }
    };

    // Check immediately
    checkVerification();

    // Then check every 3 seconds
    const interval = setInterval(checkVerification, 3000);

    // Show trouble message after 5 minutes
    const troubleTimeout = setTimeout(() => {
      setShowTrouble(true);
    }, 300000); // 5 minutes

    return () => {
      clearInterval(interval);
      clearTimeout(troubleTimeout);
    };
  }, [onNext]);

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
        setResendCooldown(60); // 1 minute cooldown
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
          <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <Mail className="w-12 h-12 text-primary" />
          </div>
        )}
      </motion.div>

      <div className="space-y-2">
        <h2 className="text-2xl font-bold">
          {isVerified ? "Email Verified!" : "Check Your Email"}
        </h2>
        <p className="text-muted-foreground">
          {isVerified
            ? "Great! Let's continue setting up your account."
            : "We sent a verification link to your email address. Click the link to continue."}
        </p>
      </div>

      {!isVerified && (
        <div className="space-y-4">
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
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

          <p className="text-xs text-muted-foreground">
            Can't find it? Check your spam folder
          </p>

          {showTrouble && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="pt-4 border-t"
            >
              <p className="text-sm text-muted-foreground mb-2">
                Having trouble?
              </p>
              <a
                href="mailto:support@aevoy.com"
                className="text-sm text-primary hover:underline"
              >
                Contact support@aevoy.com
              </a>
            </motion.div>
          )}
        </div>
      )}
    </div>
  );
}
