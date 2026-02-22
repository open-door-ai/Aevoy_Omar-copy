"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, DollarSign, Plus } from "lucide-react";
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

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <DollarSign className="h-4 w-4" />
            Credits
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-8 animate-pulse bg-gray-200 dark:bg-gray-700 rounded" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const balanceCents = data.balance_cents;
  const balanceColor =
    balanceCents > 500
      ? "text-green-600 dark:text-green-400"
      : balanceCents > 100
      ? "text-yellow-600 dark:text-yellow-400"
      : "text-red-600 dark:text-red-400";

  const borderColor =
    balanceCents <= 0
      ? "border-red-200 dark:border-red-800"
      : balanceCents <= 100
      ? "border-yellow-200 dark:border-yellow-800"
      : "";

  return (
    <Link href="/dashboard/billing">
      <Card className={`cursor-pointer hover:shadow-md transition-shadow ${borderColor}`}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Credits
            </span>
            <Plus className="h-4 w-4 text-gray-400" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className={`text-2xl font-bold ${balanceColor}`}>
            ${data.balance_usd}
          </div>

          {balanceCents <= 0 && (
            <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="h-3.5 w-3.5" />
              <span>No credits — top up to continue</span>
            </div>
          )}

          {balanceCents > 0 && balanceCents <= 100 && (
            <div className="flex items-center gap-1.5 text-xs text-yellow-600 dark:text-yellow-400">
              <AlertCircle className="h-3.5 w-3.5" />
              <span>Low balance</span>
            </div>
          )}

          {data.weekly_summary.task_count > 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-500">
              This week: {data.weekly_summary.task_count} tasks, ${data.weekly_summary.spent_usd} spent
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
