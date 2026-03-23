"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useTheme } from "@/lib/theme";
import { Loader2, LogOut } from "lucide-react";

export default function AuroraLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    async function checkAuth() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("username, display_name")
        .eq("id", user.id)
        .single();

      setUsername(profile?.display_name || profile?.username || user.email?.split("@")[0] || null);
      setLoading(false);
    }

    checkAuth();
  }, [router]);

  // Force dark mode
  useEffect(() => {
    if (resolvedTheme !== "dark") {
      setTheme("dark");
    }
  }, [resolvedTheme, setTheme]);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
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
    <div className="min-h-screen bg-background text-foreground">
      {/* Top Navigation */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            {/* Left: Brand + Nav */}
            <div className="flex items-center gap-6">
              <Link href="/aurora" className="text-[15px] font-semibold tracking-tight">
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
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground hover:text-foreground/70 hover:bg-muted/50"
                        }`}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </nav>
              )}
            </div>

            {/* Right: User controls */}
            <div className="flex items-center gap-3">
              {username && (
                <span className="text-xs text-muted-foreground hidden sm:inline">
                  {username}
                </span>
              )}
              <button
                onClick={handleLogout}
                className="p-2 rounded-lg text-muted-foreground hover:text-foreground/60 hover:bg-muted/50 transition-all"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Page Content */}
      <main className={isOnboarding ? "max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8" : ""}>
        {children}
      </main>
    </div>
  );
}
