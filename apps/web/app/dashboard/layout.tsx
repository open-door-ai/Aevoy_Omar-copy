"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Activity, Settings, LogOut, Menu, X } from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/activity", label: "Activity", icon: Activity },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const NavContent = () => (
    <>
      <div className="p-4 border-b border-stone-200/60">
        <Link href="/" className="text-2xl font-bold text-stone-900">
          Aevoy
        </Link>
      </div>
      <nav className="p-3 space-y-1 flex-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 relative ${
                isActive
                  ? "bg-stone-900 text-white shadow-sm"
                  : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
              }`}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 mt-auto border-t border-stone-200/60">
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-stone-500 hover:text-stone-900"
          onClick={handleSignOut}
          disabled={signingOut}
        >
          <LogOut className="w-4 h-4" />
          {signingOut ? "Signing out..." : "Sign out"}
        </Button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex bg-stone-50/50">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 flex-col border-r border-stone-200/60 bg-white/80 backdrop-blur-sm sticky top-0 h-screen">
        <NavContent />
      </aside>

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-white/80 backdrop-blur-sm border-b border-stone-200/60">
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/" className="text-xl font-bold text-stone-900">
            Aevoy
          </Link>
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="p-2 rounded-lg hover:bg-stone-100 transition-colors"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute left-0 top-0 bottom-0 w-64 bg-white shadow-xl flex flex-col animate-in slide-in-from-left duration-200">
            <NavContent />
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 p-6 md:p-8 pt-16 md:pt-8">
        {children}
      </main>
    </div>
  );
}
