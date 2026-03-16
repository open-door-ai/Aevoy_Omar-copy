"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface BalanceData {
  balance_cents: number;
  balance_usd: string;
  weekly_summary: {
    spent_usd: string;
    task_count: number;
    remaining_usd: string;
  };
  stripe_configured: boolean;
}

export function BudgetWidget() {
  const [data, setData] = useState<BalanceData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchBalance() {
      try {
        const res = await fetch("/api/billing/balance");
        if (res.ok) {
          const json = await res.json();
          setData(json);
        }
      } catch (error) {
        console.error("Failed to fetch balance:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchBalance();
    const interval = setInterval(fetchBalance, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return null;
  if (!data) return null;

  const balanceCents = data.balance_cents;

  // Only show when balance is low or zero — otherwise task-stats handles it
  if (balanceCents > 50) return null;

  return (
    <Link href="/dashboard/billing">
      <div className={`flex items-center justify-between px-4 py-2.5 rounded-xl text-sm transition-colors cursor-pointer ${
        balanceCents <= 0
          ? "bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/30"
          : "bg-yellow-50 dark:bg-yellow-950/20 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-100 dark:hover:bg-yellow-950/30"
      }`}>
        <span>
          {balanceCents <= 0 ? "Add credits to keep your AI running" : "Running low on credits"}
        </span>
        <span className="text-xs font-medium opacity-70">Top up &rarr;</span>
      </div>
    </Link>
  );
}
