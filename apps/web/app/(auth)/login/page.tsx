"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FadeIn, StaggerContainer, StaggerItem, ShakeOnError } from "@/components/ui/motion";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setError(error.message);
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <FadeIn>
        <h1 className="text-3xl font-bold text-stone-900 tracking-tight">
          Welcome back
        </h1>
        <p className="mt-2 text-stone-500">
          Sign in to your account to continue
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
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-12 rounded-xl text-base"
              />
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
                  <span className="opacity-0">Sign in</span>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  </div>
                  <div className="absolute inset-0 animate-shimmer" />
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </StaggerItem>
        </StaggerContainer>

        <FadeIn delay={0.5} className="mt-6 text-center">
          <p className="text-sm text-stone-500">
            Don&apos;t have an account?{" "}
            <Link
              href="/signup"
              className="text-stone-900 font-medium hover:underline underline-offset-4 transition-all"
            >
              Sign up
            </Link>
          </p>
        </FadeIn>
      </form>
    </div>
  );
}
