"use client";

import { useEffect, useState } from "react";
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
  CreditCard,
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

const TOPUP_PRESETS = [
  { label: "$5", cents: 500 },
  { label: "$10", cents: 1000 },
  { label: "$25", cents: 2500 },
  { label: "$50", cents: 5000 },
];

export default function BillingPage() {
  const [data, setData] = useState<BalanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [topupLoading, setTopupLoading] = useState(false);
  const [autoReloadEnabled, setAutoReloadEnabled] = useState(false);

  async function fetchBalance() {
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
  }

  useEffect(() => {
    fetchBalance();
    const interval = setInterval(fetchBalance, 15000);
    return () => clearInterval(interval);
  }, []);

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

      if (json.client_secret) {
        // Stripe checkout will be implemented when Stripe key arrives
        alert(`Stripe checkout ready. Client secret: ${json.client_secret.slice(0, 20)}...`);
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
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12 text-gray-500">
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

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold">Billing</h1>

      {/* Balance + Top Up */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Current Balance */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Credit Balance
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className={`text-4xl font-bold ${balanceColor}`}>
              ${data.balance_usd}
            </div>

            {balanceCents <= 0 && (
              <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/20 rounded-lg border border-red-200 dark:border-red-800">
                <AlertCircle className="h-5 w-5 text-red-500" />
                <p className="text-sm text-red-600 dark:text-red-400">
                  No credits remaining. Top up to continue using Aevoy.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-gray-200 dark:border-gray-700">
              <div>
                <p className="text-xs text-gray-500">Lifetime top-ups</p>
                <p className="text-sm font-medium">${data.lifetime_topup_usd}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Lifetime spent</p>
                <p className="text-sm font-medium">${data.lifetime_spent_usd}</p>
              </div>
            </div>

            {data.weekly_summary.task_count > 0 && (
              <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <p className="text-xs text-gray-500 mb-1">This week</p>
                <p className="text-sm">
                  {data.weekly_summary.task_count} tasks, ${data.weekly_summary.spent_usd} spent
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Up */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Top Up
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {TOPUP_PRESETS.map((preset) => (
                <Button
                  key={preset.cents}
                  variant="outline"
                  className="h-14 text-lg font-semibold"
                  onClick={() => handleTopup(preset.cents)}
                  disabled={topupLoading}
                >
                  {topupLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    preset.label
                  )}
                </Button>
              ))}
            </div>

            {!data.stripe_configured && (
              <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <p className="text-sm text-blue-600 dark:text-blue-400">
                  Payment processing coming soon. Your free credits are active.
                </p>
              </div>
            )}

            {/* Auto-Reload */}
            <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <div>
                <p className="text-sm font-medium">Auto-Reload</p>
                <p className="text-xs text-gray-500">
                  Add ${(data.auto_reload.amount_cents / 100).toFixed(0)} when balance drops below ${(data.auto_reload.threshold_cents / 100).toFixed(0)}
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

      {/* Pricing Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Pricing
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-center">
              <p className="text-lg font-bold">1-5c</p>
              <p className="text-xs text-gray-500">AI tasks</p>
            </div>
            <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-center">
              <p className="text-lg font-bold">~1c</p>
              <p className="text-xs text-gray-500">Text messages</p>
            </div>
            <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-center">
              <p className="text-lg font-bold">~1c</p>
              <p className="text-xs text-gray-500">Per minute (voice)</p>
            </div>
            <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-center">
              <p className="text-lg font-bold">3-10c</p>
              <p className="text-xs text-gray-500">Web research</p>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-3 text-center">
            20% Aevoy platform fee included in all prices
          </p>
        </CardContent>
      </Card>

      {/* Transaction History */}
      <Card>
        <CardHeader>
          <CardTitle>Transaction History</CardTitle>
        </CardHeader>
        <CardContent>
          {data.transactions.length === 0 ? (
            <p className="text-center text-gray-500 py-8">
              No transactions yet.
            </p>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {data.transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <div className="flex items-center gap-3">
                    {getTransactionIcon(tx.type)}
                    <div>
                      <p className="text-sm">
                        {tx.description || tx.type}
                      </p>
                      <p className="text-xs text-gray-500">
                        {new Date(tx.created_at).toLocaleDateString()} {new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-medium ${tx.amount_cents >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {tx.amount_cents >= 0 ? '+' : ''}${(tx.amount_cents / 100).toFixed(2)}
                    </p>
                    <p className="text-xs text-gray-500">
                      ${(tx.balance_after_cents / 100).toFixed(2)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
