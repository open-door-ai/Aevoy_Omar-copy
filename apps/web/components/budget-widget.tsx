"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { AlertCircle, DollarSign, TrendingUp } from "lucide-react";

interface BudgetStatus {
  billing_enabled: boolean;
  tier: string;
  used_usd: number;
  limit_usd: number | null;
  remaining_usd: number | null;
  percentage_used: number;
  is_over_budget: boolean;
  warning_threshold_reached: boolean;
}

export function BudgetWidget() {
  const [budget, setBudget] = useState<BudgetStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchBudget() {
      try {
        const res = await fetch("/api/budget");
        if (res.ok) {
          const data = await res.json();
          setBudget(data);
        }
      } catch (error) {
        console.error("Failed to fetch budget:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchBudget();

    // Refresh every 30 seconds
    const interval = setInterval(fetchBudget, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Budget
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-20 animate-pulse bg-gray-200 dark:bg-gray-700 rounded"></div>
        </CardContent>
      </Card>
    );
  }

  if (!budget) {
    return null;
  }

  // Beta mode (billing disabled)
  if (!budget.billing_enabled) {
    return (
      <Card className="border-blue-200 dark:border-blue-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
            <DollarSign className="h-5 w-5" />
            Beta Mode
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            You're in beta! Unlimited usage while we test the platform.
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
            Current usage: ${budget.used_usd.toFixed(2)} (tracking only)
          </p>
        </CardContent>
      </Card>
    );
  }

  // Production mode (billing enabled)
  const isUnlimited = budget.limit_usd === null || budget.tier === "paid";
  const warningColor = budget.is_over_budget
    ? "text-red-600 dark:text-red-400"
    : budget.warning_threshold_reached
    ? "text-yellow-600 dark:text-yellow-400"
    : "text-green-600 dark:text-green-400";

  const progressColor = budget.is_over_budget
    ? "bg-red-500"
    : budget.warning_threshold_reached
    ? "bg-yellow-500"
    : "bg-green-500";

  return (
    <Card className={
      budget.is_over_budget
        ? "border-red-200 dark:border-red-800"
        : budget.warning_threshold_reached
        ? "border-yellow-200 dark:border-yellow-800"
        : ""
    }>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="h-5 w-5" />
          Monthly Budget
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {budget.is_over_budget && (
          <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950/20 rounded-lg border border-red-200 dark:border-red-800">
            <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5" />
            <div>
              <p className="font-medium text-red-600 dark:text-red-400 text-sm">
                Budget Exceeded
              </p>
              <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                Tasks are currently blocked. <a href="/billing" className="underline">Upgrade your plan</a>
              </p>
            </div>
          </div>
        )}

        {!budget.is_over_budget && budget.warning_threshold_reached && (
          <div className="flex items-start gap-2 p-3 bg-yellow-50 dark:bg-yellow-950/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
            <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mt-0.5" />
            <div>
              <p className="font-medium text-yellow-600 dark:text-yellow-400 text-sm">
                Budget Warning
              </p>
              <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                You've used 80% of your monthly budget
              </p>
            </div>
          </div>
        )}

        {!isUnlimited && (
          <>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">Used</span>
                <span className={warningColor}>
                  ${budget.used_usd.toFixed(2)} / ${budget.limit_usd?.toFixed(2) || "∞"}
                </span>
              </div>
              <Progress value={Math.min(100, budget.percentage_used)} className="h-2">
                <div
                  className={`h-full ${progressColor} transition-all`}
                  style={{ width: `${Math.min(100, budget.percentage_used)}%` }}
                />
              </Progress>
              <p className="text-xs text-gray-500 dark:text-gray-500">
                {budget.percentage_used}% used
              </p>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
              <span className="text-sm text-gray-600 dark:text-gray-400">Remaining</span>
              <span className="text-lg font-semibold">
                ${budget.remaining_usd?.toFixed(2) || "0.00"}
              </span>
            </div>
          </>
        )}

        {isUnlimited && (
          <div className="text-center py-4">
            <TrendingUp className="h-8 w-8 mx-auto text-green-500 mb-2" />
            <p className="font-medium text-green-600 dark:text-green-400">
              Unlimited Usage
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
              {budget.tier === "paid" ? "Paid Plan" : "Beta Access"}
            </p>
          </div>
        )}

        <div className="text-xs text-gray-500 dark:text-gray-500 text-center">
          Resets on {new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toLocaleDateString()}
        </div>
      </CardContent>
    </Card>
  );
}
