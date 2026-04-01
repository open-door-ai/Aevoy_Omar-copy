"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Loader2, LogOut, Sun, Moon } from "lucide-react";
import { StatusBanner } from "@/components/anticipy/StatusBanner";

type AnticipyTheme = "light" | "dark";

export default function AnticipyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState<string | null>(null);
  const [anticipyTheme, setAnticipyTheme] = useState<AnticipyTheme>("dark");
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  // Load theme from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem("anticipy-theme") as AnticipyTheme | null;
    if (stored === "light" || stored === "dark") {
      setAnticipyTheme(stored);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setAnticipyTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem("anticipy-theme", next);
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
    { href: "/anticipy", label: "Feed" },
    { href: "/anticipy/settings", label: "Settings" },
  ];

  const isOnboarding = pathname === "/anticipy/onboarding";

  return (
    <div data-theme={anticipyTheme} className="min-h-screen bg-[--anticipy-bg] text-[--anticipy-text]">
      {/* Top Navigation */}
      <header className="sticky top-0 z-40 border-b border-[--anticipy-card-border] bg-[--anticipy-bg]/80 backdrop-blur-xl">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            {/* Left: Brand + Nav */}
            <div className="flex items-center gap-6">
              <Link
                href="/anticipy"
                className="text-[15px] font-semibold tracking-tight text-[--anticipy-text]"
              >
                Anticipy
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
                            : "text-[#8E8E93] hover:text-[--anticipy-text]/70"
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
                className="p-2 rounded-lg text-[--anticipy-text-secondary] hover:text-[--anticipy-text]/60 hover:bg-[--anticipy-card] transition-all"
                aria-label={
                  anticipyTheme === "dark"
                    ? "Switch to light mode"
                    : "Switch to dark mode"
                }
              >
                {anticipyTheme === "dark" ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </button>

              {username && (
                <span className="text-xs text-[--anticipy-text-secondary] hidden sm:inline">
                  {username}
                </span>
              )}
              <button
                onClick={() => setShowLogoutConfirm(true)}
                className="p-2 rounded-lg text-[--anticipy-text-secondary] hover:text-[--anticipy-text]/60 hover:bg-[--anticipy-card] transition-all"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Service Status Banner — shows when degraded/down */}
      <StatusBanner />

      {/* Logout Confirmation Dialog */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-[--anticipy-card] border border-[--anticipy-card-border] rounded-2xl p-6 max-w-sm mx-4 shadow-2xl">
            <h3 className="text-lg font-semibold text-[--anticipy-text]">
              Leave Anticipy?
            </h3>
            <p className="text-sm text-[--anticipy-text-secondary] mt-2">
              You&apos;ll be signed out and returned to the login page.
            </p>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 px-4 py-2.5 rounded-lg border border-[--anticipy-card-border] text-sm text-[--anticipy-text] hover:bg-[--anticipy-card-border]/20 transition-all"
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
