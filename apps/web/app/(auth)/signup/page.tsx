"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BetaPaymentModal } from "@/components/beta-payment-modal";
import { FadeIn, StaggerContainer, StaggerItem, ShakeOnError } from "@/components/ui/motion";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showBetaModal, setShowBetaModal] = useState(false);
  const router = useRouter();

  // Password strength
  const passwordStrength = useMemo(() => {
    if (!password) return 0;
    let score = 0;
    if (password.length >= 6) score++;
    if (password.length >= 10) score++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    return Math.min(score, 4);
  }, [password]);

  const strengthColors = ["bg-red-400", "bg-orange-400", "bg-yellow-400", "bg-lime-400", "bg-green-500"];
  const strengthLabels = ["", "Weak", "Fair", "Good", "Strong"];

  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setLoading(true);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }

      setShowBetaModal(true);
    } catch {
      setError("An unexpected error occurred");
      setLoading(false);
    }
  };

  const handleBetaComplete = () => {
    setShowBetaModal(false);
    setLoading(false);
    router.push("/dashboard");
    router.refresh();
  };

  return (
    <>
      <div>
        <FadeIn>
          <h1 className="text-3xl font-bold text-stone-900 tracking-tight">
            Get your AI employee
          </h1>
          <p className="mt-2 text-stone-500">
            <span className="text-[oklch(0.55_0.15_270)] font-semibold">Free during beta</span>
            {" "}&mdash; create your account to get started
          </p>
        </FadeIn>

        <form onSubmit={handleSubmit} className="mt-8">
          <ShakeOnError error={error}>
            {error && (
              <FadeIn direction="none" className="mb-6">
                <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl">
                  {error}
                </div>
              </FadeIn>
            )}
          </ShakeOnError>

          <StaggerContainer className="space-y-5" staggerDelay={0.1} delayStart={0.15}>
            <StaggerItem>
              <div className="space-y-2">
                <Label htmlFor="email" className="text-stone-700 font-medium">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-12 rounded-xl text-base"
                />
              </div>
            </StaggerItem>

            <StaggerItem>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-stone-700 font-medium">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-12 rounded-xl text-base"
                />
                {/* Password strength indicator */}
                {password && (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex gap-1">
                      {[0, 1, 2, 3].map((i) => (
                        <div
                          key={i}
                          className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                            i < passwordStrength ? strengthColors[passwordStrength] : "bg-stone-200"
                          }`}
                        />
                      ))}
                    </div>
                    <p className="text-xs text-stone-400">{strengthLabels[passwordStrength]}</p>
                  </div>
                )}
              </div>
            </StaggerItem>

            <StaggerItem>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-stone-700 font-medium">
                  Confirm Password
                </Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="Confirm your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className="h-12 rounded-xl text-base pr-10"
                  />
                  {confirmPassword && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      {passwordsMatch ? (
                        <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </StaggerItem>

            <StaggerItem>
              <Button
                type="submit"
                className="w-full h-12 rounded-xl text-base font-semibold relative overflow-hidden"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="opacity-0">Create account</span>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    </div>
                    <div className="absolute inset-0 animate-shimmer" />
                  </>
                ) : (
                  "Create account"
                )}
              </Button>
            </StaggerItem>
          </StaggerContainer>

          <FadeIn delay={0.5} className="mt-6 text-center">
            <p className="text-sm text-stone-500">
              Already have an account?{" "}
              <Link
                href="/login"
                className="text-stone-900 font-medium hover:underline underline-offset-4 transition-all"
              >
                Sign in
              </Link>
            </p>
          </FadeIn>
        </form>
      </div>

      {showBetaModal && (
        <BetaPaymentModal
          onComplete={handleBetaComplete}
          userEmail={email}
        />
      )}
    </>
  );
}
