"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Loader2, LogOut, Sun, Moon } from "lucide-react";

type AuroraTheme = "light" | "dark";

export default function AuroraLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState<string | null>(null);
  const [auroraTheme, setAuroraTheme] = useState<AuroraTheme>("dark");
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  // Load theme from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem("aurora-theme") as AuroraTheme | null;
    if (stored === "light" || stored === "dark") {
      setAuroraTheme(stored);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setAuroraTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem("aurora-theme", next);
      return next;
    });
  }, []);

  useEffect(() => {
    const supabase = createClient();

    async function checkAuth() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("username, display_name")
        .eq("id", user.id)
        .single();

      setUsername(
        profile?.display_name ||
          profile?.username ||
          user.email?.split("@")[0] ||
          null
      );
      setLoading(false);
    }

    checkAuth();
  }, [router]);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0B] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-6 w-6 text-[#8E8E93] animate-spin" />
        </div>
      </div>
    );
  }

  const navItems = [
    { href: "/aurora", label: "Feed" },
    { href: "/aurora/settings", label: "Settings" },
  ];

  const isOnboarding = pathname === "/aurora/onboarding";

  return (
    <div data-theme={auroraTheme} className="min-h-screen bg-[--aurora-bg] text-[--aurora-text]">
      {/* Top Navigation */}
      <header className="sticky top-0 z-40 border-b border-[--aurora-card-border] bg-[--aurora-bg]/80 backdrop-blur-xl">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            {/* Left: Brand + Nav */}
            <div className="flex items-center gap-6">
              <Link
                href="/aurora"
                className="text-[15px] font-semibold tracking-tight text-[--aurora-text]"
              >
                Aurora
              </Link>
              {!isOnboarding && (
                <nav className="flex items-center gap-1">
                  {navItems.map((item) => {
                    const isActive = pathname === item.href;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`px-3 py-1.5 text-sm transition-all relative ${
                          isActive
                            ? "text-[#6C5CE7]"
                            : "text-[#8E8E93] hover:text-[--aurora-text]/70"
                        }`}
                      >
                        {item.label}
                        {/* Active bottom border */}
                        {isActive && (
                          <span className="absolute bottom-0 left-1 right-1 h-[2px] bg-[#6C5CE7] rounded-full" />
                        )}
                      </Link>
                    );
                  })}
                </nav>
              )}
            </div>

            {/* Right: Theme toggle + User controls */}
            <div className="flex items-center gap-2">
              {/* Light/Dark toggle: sun when dark (switch TO light), moon when light */}
              <button
                onClick={toggleTheme}
                className="p-2 rounded-lg text-[--aurora-text-secondary] hover:text-[--aurora-text]/60 hover:bg-[--aurora-card] transition-all"
                aria-label={
                  auroraTheme === "dark"
                    ? "Switch to light mode"
                    : "Switch to dark mode"
                }
              >
                {auroraTheme === "dark" ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </button>

              {username && (
                <span className="text-xs text-[--aurora-text-secondary] hidden sm:inline">
                  {username}
                </span>
              )}
              <button
                onClick={() => setShowLogoutConfirm(true)}
                className="p-2 rounded-lg text-[--aurora-text-secondary] hover:text-[--aurora-text]/60 hover:bg-[--aurora-card] transition-all"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Logout Confirmation Dialog */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-[--aurora-card] border border-[--aurora-card-border] rounded-2xl p-6 max-w-sm mx-4 shadow-2xl">
            <h3 className="text-lg font-semibold text-[--aurora-text]">
              Leave Aurora?
            </h3>
            <p className="text-sm text-[--aurora-text-secondary] mt-2">
              You&apos;ll be signed out and returned to the login page.
            </p>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 px-4 py-2.5 rounded-lg border border-[--aurora-card-border] text-sm text-[--aurora-text] hover:bg-[--aurora-card-border]/20 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleLogout}
                className="flex-1 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 hover:bg-red-500/20 transition-all"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Page Content */}
      <main
        className={
          isOnboarding
            ? "max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8"
            : ""
        }
      >
        {children}
      </main>
    </div>
  );
}
