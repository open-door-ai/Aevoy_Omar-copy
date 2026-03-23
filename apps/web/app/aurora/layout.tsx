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
                        className={`px-3 py-1.5 rounded-lg text-sm transition-all ${
                          isActive
                            ? "bg-[#6C5CE7]/10 text-[#6C5CE7]"
                            : "text-[--aurora-text-secondary] hover:text-[--aurora-text]/70 hover:bg-[--aurora-card]"
                        }`}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </nav>
              )}
            </div>

            {/* Right: Theme toggle + User controls */}
            <div className="flex items-center gap-2">
              {/* Light/Dark toggle */}
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
                onClick={handleLogout}
                className="p-2 rounded-lg text-[--aurora-text-secondary] hover:text-[--aurora-text]/60 hover:bg-[--aurora-card] transition-all"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

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
