"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useTheme } from "@/lib/theme";
import { Loader2, Sun, Moon, LogOut } from "lucide-react";

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

  // Force dark mode on mount
  useEffect(() => {
    if (resolvedTheme !== "dark") {
      setTheme("dark");
    }
  }, []);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-6 w-6 text-white/30 animate-spin" />
          <p className="text-sm text-white/20">Waking Aurora up...</p>
        </div>
      </div>
    );
  }

  const navItems = [
    { href: "/aurora", label: "Feed" },
    { href: "/aurora/settings", label: "Settings" },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Top Navigation */}
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#0a0a0a]/80 backdrop-blur-xl">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            {/* Left: Brand */}
            <div className="flex items-center gap-6">
              <Link href="/aurora" className="text-[15px] font-semibold tracking-tight">
                Aurora
              </Link>
              <nav className="flex items-center gap-1">
                {navItems.map((item) => {
                  const isActive = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`px-3 py-1.5 rounded-lg text-sm transition-all ${
                        isActive
                          ? "bg-white/10 text-white"
                          : "text-white/40 hover:text-white/70 hover:bg-white/[0.04]"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </div>

            {/* Right: User controls */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                className="p-2 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/[0.04] transition-all"
                aria-label="Toggle theme"
              >
                {resolvedTheme === "dark" ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </button>

              {username && (
                <span className="text-xs text-white/30 hidden sm:inline">
                  {username}
                </span>
              )}

              <button
                onClick={handleLogout}
                className="p-2 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/[0.04] transition-all"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Page Content */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}
