"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  BarChart2,
  DollarSign,
  Cpu,
  Zap,
  TrendingUp,
  Info,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface ProviderStat {
  provider: string;
  displayName: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  cachedCalls: number;
  inputRatePerM: number;
  outputRatePerM: number;
}

interface PurposeStat {
  purpose: string;
  calls: number;
  costUsd: number;
}

interface PricingRef {
  provider: string;
  displayName: string;
  inputRatePerM: number;
  outputRatePerM: number;
  lastVerified: string;
}

interface Analytics {
  month: string;
  summary: {
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;
  };
  byProvider: ProviderStat[];
  byPurpose: PurposeStat[];
  dailyCosts: Record<string, number>;
  pricingReference: PricingRef[];
}

function formatCost(usd: number): string {
  if (usd === 0) return "Free";
  if (usd < 0.001) return "<$0.001";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function getMonthLabel(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  return new Date(year, mon - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

function prevMonth(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  const d = new Date(year, mon - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function nextMonth(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  const d = new Date(year, mon, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const PROVIDER_COLORS: Record<string, string> = {
  groq: "bg-purple-500",
  deepseek: "bg-blue-500",
  kimi: "bg-emerald-500",
  gemini: "bg-yellow-500",
  sonnet: "bg-orange-500",
  haiku: "bg-pink-500",
  ollama: "bg-gray-500",
  openrouter: "bg-indigo-500",
};

export default function CostAnalyticsPage() {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"breakdown" | "pricing">("breakdown");

  const fetchAnalytics = useCallback(async (m: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/cost-analytics?month=${m}`);
      if (res.ok) {
        const data = await res.json();
        setAnalytics(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnalytics(month);
  }, [month, fetchAnalytics]);

  const handlePrev = () => setMonth(prevMonth(month));
  const handleNext = () => {
    const next = nextMonth(month);
    if (next <= currentMonth) setMonth(next);
  };

  // Daily cost bar chart data (last 14 days of selected month)
  const dailyEntries = analytics
    ? Object.entries(analytics.dailyCosts).sort(([a], [b]) => a.localeCompare(b)).slice(-14)
    : [];
  const maxDaily = dailyEntries.length > 0 ? Math.max(...dailyEntries.map(([, v]) => v), 0.0001) : 0.0001;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart2 className="w-6 h-6" />
            Cost Analytics
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Exact token counts from API responses · Rates verified Feb 2026
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchAnalytics(month)}
          className="shrink-0"
        >
          <RefreshCw className="w-4 h-4 mr-1.5" />
          Refresh
        </Button>
      </div>

      {/* Month navigation */}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={handlePrev}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <span className="text-sm font-medium min-w-[140px] text-center">{getMonthLabel(month)}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={handleNext}
          disabled={nextMonth(month) > currentMonth}
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="pt-4 pb-4">
                <div className="h-4 w-24 bg-muted animate-pulse rounded mb-2" />
                <div className="h-7 w-16 bg-muted animate-pulse rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : analytics ? (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <DollarSign className="w-4 h-4" />
                  <p className="text-sm">Total Cost</p>
                </div>
                <p className="text-2xl font-bold">{formatCost(analytics.summary.totalCostUsd)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Zap className="w-4 h-4" />
                  <p className="text-sm">AI Calls</p>
                </div>
                <p className="text-2xl font-bold">{analytics.summary.totalCalls.toLocaleString()}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Cpu className="w-4 h-4" />
                  <p className="text-sm">Input Tokens</p>
                </div>
                <p className="text-2xl font-bold">{formatTokens(analytics.summary.totalInputTokens)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <TrendingUp className="w-4 h-4" />
                  <p className="text-sm">Output Tokens</p>
                </div>
                <p className="text-2xl font-bold">{formatTokens(analytics.summary.totalOutputTokens)}</p>
              </CardContent>
            </Card>
          </div>

          {/* Daily cost chart */}
          {dailyEntries.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Daily Cost Trend</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end gap-1 h-24">
                  {dailyEntries.map(([day, cost]) => {
                    const heightPct = (cost / maxDaily) * 100;
                    const dayLabel = new Date(day + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
                    return (
                      <div key={day} className="flex-1 flex flex-col items-center gap-1 group relative" title={`${dayLabel}: ${formatCost(cost)}`}>
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-foreground text-background text-xs px-1.5 py-0.5 rounded whitespace-nowrap pointer-events-none z-10">
                          {formatCost(cost)}
                        </div>
                        <div
                          className="w-full bg-primary/80 hover:bg-primary rounded-t transition-all"
                          style={{ height: `${Math.max(heightPct, 2)}%` }}
                        />
                        <span className="text-[9px] text-muted-foreground truncate w-full text-center">
                          {day.slice(8)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tabs */}
          <div className="flex gap-2 border-b border-border">
            <button
              onClick={() => setActiveTab("breakdown")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "breakdown"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Cost Breakdown
            </button>
            <button
              onClick={() => setActiveTab("pricing")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "pricing"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Pricing Reference
            </button>
          </div>

          {activeTab === "breakdown" && (
            <div className="space-y-4">
              {/* By provider */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Cost by AI Provider</CardTitle>
                  <CardDescription>
                    Token counts are exact API response values. Costs = tokens × per-token rates.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {analytics.byProvider.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">
                      No AI calls logged for this month yet.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {analytics.byProvider.map((prov) => {
                        const pct = analytics.summary.totalCostUsd > 0
                          ? (prov.costUsd / analytics.summary.totalCostUsd) * 100
                          : 0;
                        const colorClass = PROVIDER_COLORS[prov.provider] || "bg-gray-400";
                        return (
                          <div key={prov.provider} className="space-y-1">
                            <div className="flex justify-between items-center">
                              <div className="flex items-center gap-2">
                                <div className={`w-2.5 h-2.5 rounded-full ${colorClass}`} />
                                <span className="text-sm font-medium">{prov.displayName}</span>
                              </div>
                              <span className="text-sm font-mono font-medium">{formatCost(prov.costUsd)}</span>
                            </div>
                            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${colorClass}`}
                                style={{ width: `${Math.max(pct, 0.5)}%` }}
                              />
                            </div>
                            <div className="flex gap-4 text-xs text-muted-foreground">
                              <span>{prov.calls} calls</span>
                              <span>{formatTokens(prov.inputTokens)} in</span>
                              <span>{formatTokens(prov.outputTokens)} out</span>
                              {prov.cachedCalls > 0 && (
                                <span className="text-green-600 dark:text-green-400">{prov.cachedCalls} cached</span>
                              )}
                              {prov.inputRatePerM === 0 ? (
                                <span className="text-green-600 dark:text-green-400">Free tier</span>
                              ) : (
                                <span>${prov.inputRatePerM.toFixed(2)}/${prov.outputRatePerM.toFixed(2)} per M tok</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* By purpose */}
              {analytics.byPurpose.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Calls by Task Type</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {analytics.byPurpose.map((p) => (
                        <div key={p.purpose} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
                          <span className="text-sm font-medium capitalize">{p.purpose}</span>
                          <div className="flex gap-4 text-sm text-muted-foreground">
                            <span>{p.calls} calls</span>
                            <span className="font-mono">{formatCost(p.costUsd)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {activeTab === "pricing" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  Current Model Pricing
                  <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded">
                    Verified Feb 2026
                  </span>
                </CardTitle>
                <CardDescription>
                  Token counts come directly from API responses — these are cold, hard numbers, not estimates.
                  Per-token rates are maintained constants (providers don&apos;t offer a live pricing API).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Provider</th>
                        <th className="text-right py-2 pr-4 font-medium text-muted-foreground">Input (per 1M tok)</th>
                        <th className="text-right py-2 font-medium text-muted-foreground">Output (per 1M tok)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.pricingReference.map((ref) => (
                        <tr key={ref.provider} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="py-3 pr-4">
                            <div className="flex items-center gap-2">
                              <div className={`w-2 h-2 rounded-full ${PROVIDER_COLORS[ref.provider] || "bg-gray-400"}`} />
                              <div>
                                <p className="font-medium">{ref.displayName}</p>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 pr-4 text-right font-mono">
                            {ref.inputRatePerM === 0
                              ? <span className="text-green-600 dark:text-green-400">Free</span>
                              : `$${ref.inputRatePerM.toFixed(2)}`}
                          </td>
                          <td className="py-3 text-right font-mono">
                            {ref.outputRatePerM === 0
                              ? <span className="text-green-600 dark:text-green-400">Free</span>
                              : `$${ref.outputRatePerM.toFixed(2)}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 p-3 bg-muted/50 rounded-lg flex items-start gap-2 text-xs text-muted-foreground">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <strong>Data source note:</strong> Token counts are exact values returned by each AI provider&apos;s API.
                    Per-token rates are maintained in code and verified against official provider pricing pages.
                    AI providers do not offer a programmatic pricing API — OpenRouter is the exception
                    (available in Developer settings).
                  </div>
                </div>

                <div className="mt-3 text-xs text-muted-foreground">
                  Want live pricing and access to 200+ models?{" "}
                  <Link href="/dashboard/settings#developer" className="text-primary hover:underline">
                    Connect OpenRouter in Developer settings →
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <BarChart2 className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">Failed to load analytics</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => fetchAnalytics(month)}>
              Try Again
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
