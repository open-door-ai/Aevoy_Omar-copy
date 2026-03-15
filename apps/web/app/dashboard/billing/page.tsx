"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DollarSign,
  Plus,
  ArrowDownCircle,
  ArrowUpCircle,
  Gift,
  RefreshCw,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface Transaction {
  id: string;
  type: string;
  amount_cents: number;
  balance_after_cents: number;
  description: string;
  created_at: string;
}

interface BalanceData {
  balance_cents: number;
  balance_usd: string;
  lifetime_topup_usd: string;
  lifetime_spent_usd: string;
  auto_reload: {
    enabled: boolean;
    threshold_cents: number;
    amount_cents: number;
  };
  weekly_summary: {
    spent_usd: string;
    task_count: number;
    remaining_usd: string;
  };
  transactions: Transaction[];
  stripe_configured: boolean;
}

interface MonthlySummary {
  totalCalls: number;
  totalCostUsd: number;
}

interface DailyCosts {
  [date: string]: number;
}

const TOPUP_PRESETS = [
  { label: "$5", cents: 500 },
  { label: "$10", cents: 1000 },
  { label: "$25", cents: 2500 },
  { label: "$50", cents: 5000 },
];

function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

export default function BillingPage() {
  const [data, setData] = useState<BalanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [topupLoading, setTopupLoading] = useState(false);
  const [autoReloadEnabled, setAutoReloadEnabled] = useState(false);
  const [monthlySummary, setMonthlySummary] = useState<MonthlySummary | null>(null);
  const [dailyCosts, setDailyCosts] = useState<DailyCosts>({});

  const fetchBalance = useCallback(async () => {
    try {
      const res = await fetch("/api/billing/balance");
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setAutoReloadEnabled(json.auto_reload?.enabled || false);
      }
    } catch (error) {
      console.error("Failed to fetch balance:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSpending = useCallback(async () => {
    try {
      const month = new Date().toISOString().slice(0, 7);
      const res = await fetch(`/api/cost-analytics?month=${month}`);
      if (res.ok) {
        const json = await res.json();
        setMonthlySummary(json.summary);
        setDailyCosts(json.dailyCosts || {});
      }
    } catch {
      // Spending chart is optional — don't block the page
    }
  }, []);

  useEffect(() => {
    fetchBalance();
    fetchSpending();
    const interval = setInterval(fetchBalance, 15000);
    return () => clearInterval(interval);
  }, [fetchBalance, fetchSpending]);

  async function handleTopup(amountCents: number) {
    setTopupLoading(true);
    try {
      const res = await fetch("/api/billing/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount_cents: amountCents }),
      });
      const json = await res.json();

      if (json.beta_mode) {
        alert("Payment processing is coming soon. Your costs are tracked and your free credits are active.");
        return;
      }

      if (json.checkout_url) {
        // Redirect to Stripe Checkout
        window.location.href = json.checkout_url;
        return;
      }
    } catch (error) {
      console.error("Top-up error:", error);
    } finally {
      setTopupLoading(false);
    }
  }

  async function toggleAutoReload(enabled: boolean) {
    setAutoReloadEnabled(enabled);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase
        .from("credit_wallets")
        .update({ auto_reload_enabled: enabled })
        .eq("user_id", user.id);
    } catch (error) {
      console.error("Auto-reload toggle error:", error);
      setAutoReloadEnabled(!enabled);
    }
  }

  function getTransactionIcon(type: string) {
    switch (type) {
      case "topup":
      case "auto_reload":
        return <ArrowUpCircle className="h-4 w-4 text-green-500" />;
      case "deduction":
        return <ArrowDownCircle className="h-4 w-4 text-red-500" />;
      case "free_grant":
        return <Gift className="h-4 w-4 text-blue-500" />;
      case "refund":
        return <RefreshCw className="h-4 w-4 text-purple-500" />;
      default:
        return <DollarSign className="h-4 w-4 text-gray-500" />;
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Failed to load billing data.
      </div>
    );
  }

  const balanceCents = data.balance_cents;
  const balanceColor =
    balanceCents > 500
      ? "text-green-600 dark:text-green-400"
      : balanceCents > 100
      ? "text-yellow-600 dark:text-yellow-400"
      : "text-red-600 dark:text-red-400";

  // Daily spending chart data (last 14 days)
  const dailyEntries = Object.entries(dailyCosts)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14);
  const maxDaily = dailyEntries.length > 0
    ? Math.max(...dailyEntries.map(([, v]) => v), 0.001)
    : 0.001;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold">Billing</h1>

      {/* Balance + Top Up */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Current Balance */}
        <Card>
          <CardContent className="pt-6 space-y-4">
            <p className="text-sm text-muted-foreground">Credit Balance</p>
            <div className={`text-4xl font-bold tracking-tight ${balanceColor}`}>
              ${data.balance_usd}
            </div>

            {balanceCents <= 0 && (
              <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/20 rounded-lg border border-red-200 dark:border-red-800">
                <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                <p className="text-sm text-red-600 dark:text-red-400">
                  No credits remaining. Top up to continue.
                </p>
              </div>
            )}

            <div className="flex gap-6 text-sm text-muted-foreground">
              <div>
                <span className="text-foreground font-medium">${data.lifetime_topup_usd}</span> added
              </div>
              <div>
                <span className="text-foreground font-medium">${data.lifetime_spent_usd}</span> spent
              </div>
            </div>

            {data.weekly_summary.task_count > 0 && (
              <p className="text-xs text-muted-foreground">
                This week: {data.weekly_summary.task_count} tasks, ${data.weekly_summary.spent_usd} spent
              </p>
            )}
          </CardContent>
        </Card>

        {/* Top Up */}
        <Card>
          <CardContent className="pt-6 space-y-4">
            <p className="text-sm text-muted-foreground">Add Credits</p>
            <div className="grid grid-cols-2 gap-2">
              {TOPUP_PRESETS.map((preset) => (
                <Button
                  key={preset.cents}
                  variant="outline"
                  className="h-12 text-lg font-semibold"
                  onClick={() => handleTopup(preset.cents)}
                  disabled={topupLoading}
                >
                  {topupLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    preset.label
                  )}
                </Button>
              ))}
            </div>

            {!data.stripe_configured && (
              <p className="text-xs text-muted-foreground text-center">
                Payment processing coming soon. Free credits are active.
              </p>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-border">
              <div>
                <p className="text-sm font-medium">Auto-Reload</p>
                <p className="text-xs text-muted-foreground">
                  Add ${(data.auto_reload.amount_cents / 100).toFixed(0)} when below ${(data.auto_reload.threshold_cents / 100).toFixed(0)}
                </p>
              </div>
              <Switch
                checked={autoReloadEnabled}
                onCheckedChange={toggleAutoReload}
                disabled={!data.stripe_configured}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Monthly Spending */}
      {(dailyEntries.length > 0 || monthlySummary) && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">This Month</CardTitle>
              {monthlySummary && (
                <span className="text-sm text-muted-foreground">
                  {formatCost(monthlySummary.totalCostUsd)} · {monthlySummary.totalCalls} tasks
                </span>
              )}
            </div>
          </CardHeader>
          {dailyEntries.length > 0 && (
            <CardContent>
              <div className="flex items-end gap-1 h-20">
                {dailyEntries.map(([day, cost]) => {
                  const heightPct = (cost / maxDaily) * 100;
                  const dayNum = day.slice(8);
                  return (
                    <div
                      key={day}
                      className="flex-1 flex flex-col items-center gap-1 group relative"
                    >
                      <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-foreground text-background text-xs px-1.5 py-0.5 rounded whitespace-nowrap pointer-events-none z-10">
                        {formatCost(cost)}
                      </div>
                      <div
                        className="w-full bg-primary/70 hover:bg-primary rounded-t transition-colors"
                        style={{ height: `${Math.max(heightPct, 3)}%` }}
                      />
                      <span className="text-[9px] text-muted-foreground">
                        {dayNum}
                      </span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Recent Activity */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {data.transactions.length === 0 ? (
            <p className="text-center text-muted-foreground py-6 text-sm">
              No activity yet.
            </p>
          ) : (
            <div className="space-y-1 max-h-[400px] overflow-y-auto">
              {data.transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between py-2.5 px-2 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {getTransactionIcon(tx.type)}
                    <div className="min-w-0">
                      <p className="text-sm truncate">
                        {tx.description || tx.type}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(tx.created_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}{" "}
                        {new Date(tx.created_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p
                      className={`text-sm font-medium tabular-nums ${
                        tx.amount_cents >= 0
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {tx.amount_cents >= 0 ? "+" : ""}
                      ${(tx.amount_cents / 100).toFixed(2)}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      bal ${(tx.balance_after_cents / 100).toFixed(2)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Simple pricing note */}
      <p className="text-xs text-center text-muted-foreground pb-4">
        AI tasks 1-5¢ · Texts ~1¢ · Voice ~1¢/min · Web research 3-10¢ · 20% platform fee included
      </p>
    </div>
  );
}
