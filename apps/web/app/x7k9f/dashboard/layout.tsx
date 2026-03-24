"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Admin dashboard layout — session gate.
 *
 * Before rendering any admin content, verifies the session cookie
 * via the /api/x7k9f/verify endpoint. If the session is invalid
 * or expired, redirects to the login page at /x7k9f.
 *
 * This prevents unauthenticated users from seeing the admin UI
 * structure even if API calls would independently fail with 401.
 */
export default function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [authState, setAuthState] = useState<"loading" | "authenticated" | "unauthenticated">("loading");

  useEffect(() => {
    let cancelled = false;

    async function verifySession() {
      try {
        const res = await fetch("/api/x7k9f/verify", {
          credentials: "include",
          cache: "no-store",
        });

        if (cancelled) return;

        if (res.ok) {
          setAuthState("authenticated");
        } else {
          setAuthState("unauthenticated");
          router.replace("/x7k9f");
        }
      } catch {
        if (!cancelled) {
          setAuthState("unauthenticated");
          router.replace("/x7k9f");
        }
      }
    }

    verifySession();
    return () => { cancelled = true; };
  }, [router]);

  if (authState === "loading") {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
          <p className="text-white/30 text-xs">Verifying session...</p>
        </div>
      </div>
    );
  }

  if (authState === "unauthenticated") {
    return null;
  }

  return <>{children}</>;
}
