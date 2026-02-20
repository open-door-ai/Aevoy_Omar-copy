'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Heart,
  Moon,
  Footprints,
  Activity,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  Minus,
  Play,
  Calendar,
  Wifi,
  WifiOff,
  RefreshCw,
  ExternalLink,
  Clock,
  ChevronRight,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────────────────────

interface HealthMetric {
  id: string;
  user_id: string;
  metric_type: 'heart_rate' | 'sleep_hours' | 'steps' | 'hrv';
  value: number;
  recorded_at: string;
  source: string;
}

interface HealthInsight {
  id: string;
  summary: string;
  anomalies: { type: string; severity: 'normal' | 'warning' | 'critical'; message: string }[];
  generated_at: string;
}

type MetricType = 'heart_rate' | 'sleep_hours' | 'steps';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getLatest(metrics: HealthMetric[], type: string): HealthMetric | null {
  const filtered = metrics
    .filter((m) => m.metric_type === type)
    .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime());
  return filtered[0] ?? null;
}

function getTrend(metrics: HealthMetric[], type: string): 'up' | 'down' | 'flat' {
  const filtered = metrics
    .filter((m) => m.metric_type === type)
    .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime());
  if (filtered.length < 2) return 'flat';
  const diff = filtered[0].value - filtered[1].value;
  if (Math.abs(diff) < 0.01) return 'flat';
  return diff > 0 ? 'up' : 'down';
}

function minutesAgo(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
}

function build7DayChart(metrics: HealthMetric[], type: MetricType) {
  const now = new Date();
  const days: { label: string; value: number | null }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dayStr = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString('en-US', { weekday: 'short' });
    const dayMetrics = metrics.filter(
      (m) => m.metric_type === type && m.recorded_at.slice(0, 10) === dayStr
    );
    const avg =
      dayMetrics.length > 0
        ? dayMetrics.reduce((s, m) => s + m.value, 0) / dayMetrics.length
        : null;
    days.push({ label, value: avg !== null ? Math.round(avg * 10) / 10 : null });
  }
  return days;
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function TrendIcon({ trend, good = 'up' }: { trend: 'up' | 'down' | 'flat'; good?: 'up' | 'down' }) {
  const isGood = trend === good;
  const isNeutral = trend === 'flat';
  const cls = isNeutral
    ? 'text-muted-foreground'
    : isGood
    ? 'text-green-500'
    : 'text-amber-500';
  if (trend === 'up') return <TrendingUp className={`w-4 h-4 ${cls}`} />;
  if (trend === 'down') return <TrendingDown className={`w-4 h-4 ${cls}`} />;
  return <Minus className={`w-4 h-4 ${cls}`} />;
}

function MetricSkeleton() {
  return (
    <Card>
      <CardContent className="pt-5 pb-5">
        <div className="h-4 w-20 bg-muted animate-pulse rounded mb-3" />
        <div className="h-8 w-16 bg-muted animate-pulse rounded mb-1" />
        <div className="h-3 w-12 bg-muted animate-pulse rounded" />
      </CardContent>
    </Card>
  );
}

function InsightSkeleton() {
  return (
    <div className="space-y-2">
      <div className="h-4 w-full bg-muted animate-pulse rounded" />
      <div className="h-4 w-5/6 bg-muted animate-pulse rounded" />
      <div className="h-4 w-4/6 bg-muted animate-pulse rounded" />
    </div>
  );
}

const SEVERITY_BADGE: Record<string, string> = {
  normal: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
};

const CHART_LABELS: Record<MetricType, string> = {
  heart_rate: 'Heart Rate (bpm)',
  sleep_hours: 'Sleep (hours)',
  steps: 'Steps',
};

const CHART_COLOR: Record<MetricType, string> = {
  heart_rate: '#ef4444',
  sleep_hours: '#6366f1',
  steps: '#22c55e',
};

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function HealthPage() {
  const router = useRouter();

  const [metrics, setMetrics] = useState<HealthMetric[]>([]);
  const [insight, setInsight] = useState<HealthInsight | null>(null);
  const [fitbitConnected, setFitbitConnected] = useState(false);
  const [disclaimerAcknowledged, setDisclaimerAcknowledged] = useState(true);
  const [activeMetricType, setActiveMetricType] = useState<MetricType>('heart_rate');
  const [bookingNow, setBookingNow] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleConfirmed, setScheduleConfirmed] = useState<string | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const [loadingInsight, setLoadingInsight] = useState(true);
  const [dismissingDisclaimer, setDismissingDisclaimer] = useState(false);
  const [connectingFitbit, setConnectingFitbit] = useState(false);
  const [fitbitError, setFitbitError] = useState<string | null>(null);

  // ── Data fetch ────────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    setLoadingMetrics(true);
    setLoadingInsight(true);

    // Parallel fetch — all 4 endpoints
    const [metricsRes, insightRes, fitbitRes, settingsRes] = await Promise.allSettled([
      fetch('/api/health/metrics?days=7'),
      fetch('/api/health/insights?limit=1'),
      fetch('/api/integrations/fitbit'),
      fetch('/api/settings'),
    ]);

    if (metricsRes.status === 'fulfilled' && metricsRes.value.ok) {
      const data = await metricsRes.value.json();
      setMetrics(data.metrics ?? data ?? []);
    }
    setLoadingMetrics(false);

    if (insightRes.status === 'fulfilled' && insightRes.value.ok) {
      const data = await insightRes.value.json();
      const list = data.insights ?? data ?? [];
      setInsight(list[0] ?? null);
    }
    setLoadingInsight(false);

    if (fitbitRes.status === 'fulfilled' && fitbitRes.value.ok) {
      const data = await fitbitRes.value.json();
      setFitbitConnected(data.connected ?? false);
    }

    if (settingsRes.status === 'fulfilled' && settingsRes.value.ok) {
      const data = await settingsRes.value.json();
      setDisclaimerAcknowledged(data.health_disclaimer_acknowledged ?? false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const dismissDisclaimer = async () => {
    setDismissingDisclaimer(true);
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ health_disclaimer_acknowledged: true }),
      });
      setDisclaimerAcknowledged(true);
    } finally {
      setDismissingDisclaimer(false);
    }
  };

  const startConsultNow = async () => {
    if (!disclaimerAcknowledged) {
      // Scroll user to disclaimer
      document.getElementById('disclaimer-banner')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    setBookingNow(true);
    try {
      const res = await fetch('/api/health/consult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acknowledged_disclaimer: true, scheduled_at: null }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.id) {
          router.push(`/dashboard/health/consultation?id=${data.id}`);
          return;
        }
      }
      // Fallback: navigate without id (consultation page will create one)
      router.push('/dashboard/health/consultation');
    } finally {
      setBookingNow(false);
    }
  };

  const scheduleConsult = async () => {
    if (!scheduleDate) return;
    setBookingNow(true);
    try {
      const res = await fetch('/api/health/consult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acknowledged_disclaimer: true,
          scheduled_at: new Date(scheduleDate).toISOString(),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const label = new Date(scheduleDate).toLocaleString('en-US', {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
        setScheduleConfirmed(data.scheduled_at ? label : scheduleDate);
      }
    } finally {
      setBookingNow(false);
    }
  };

  const connectFitbit = async () => {
    setFitbitError(null);
    setConnectingFitbit(true);
    try {
      const res = await fetch('/api/integrations/fitbit', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.authUrl) {
        window.location.href = data.authUrl;
        return;
      }
      setFitbitError(data.error ?? 'Unable to connect. Fitbit integration may not be configured yet.');
    } catch {
      setFitbitError('Network error. Please try again.');
    } finally {
      setConnectingFitbit(false);
    }
  };

  // ── Derived data ──────────────────────────────────────────────────────────

  const hasData = metrics.length > 0;
  const heartRate = getLatest(metrics, 'heart_rate');
  const sleep = getLatest(metrics, 'sleep_hours');
  const steps = getLatest(metrics, 'steps');
  const hrv = getLatest(metrics, 'hrv');

  const hrTrend = getTrend(metrics, 'heart_rate');
  const sleepTrend = getTrend(metrics, 'sleep_hours');
  const stepsTrend = getTrend(metrics, 'steps');

  const chartData = build7DayChart(metrics, activeMetricType);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Heart className="w-6 h-6 text-red-500" />
            Health
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            AI-powered health insights and consultation
          </p>
        </div>
        <Button onClick={startConsultNow} disabled={bookingNow} className="shrink-0 gap-2">
          {bookingNow ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4 fill-current" />
          )}
          Start Consultation
        </Button>
      </div>

      {/* ── Disclaimer banner ── */}
      {!disclaimerAcknowledged && (
        <div
          id="disclaimer-banner"
          className="flex items-start gap-3 p-4 rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40"
        >
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              Health Advisor Notice
            </p>
            <p className="text-sm text-amber-800 dark:text-amber-300 mt-0.5">
              This tool provides general health information only, not medical advice. Always consult a
              qualified healthcare provider for diagnosis and treatment.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={dismissDisclaimer}
            disabled={dismissingDisclaimer}
            className="shrink-0 border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/40"
          >
            <CheckCircle2 className="w-4 h-4 mr-1.5" />
            I Understand
          </Button>
        </div>
      )}

      {/* ── Data source status bar ── */}
      {!hasData ? (
        <Card className="border-dashed">
          <CardContent className="py-5 flex items-center gap-3">
            <WifiOff className="w-5 h-5 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">No health data connected yet</p>
              <p className="text-sm text-muted-foreground">
                Connect{' '}
                <button
                  onClick={connectFitbit}
                  className="text-primary underline underline-offset-2 hover:no-underline"
                >
                  Fitbit
                </button>
                {' '}or set up an{' '}
                <a
                  href="/dashboard/apps"
                  className="text-primary underline underline-offset-2 hover:no-underline"
                >
                  Apple Shortcuts webhook
                </a>{' '}
                to start tracking.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Wifi className="w-4 h-4 text-green-500" />
          <span>
            {fitbitConnected ? 'Fitbit connected' : 'Apple Health connected'} &middot; Data as of{' '}
            {getLatest(metrics, 'heart_rate')
              ? new Date(getLatest(metrics, 'heart_rate')!.recorded_at).toLocaleString()
              : 'today'}
          </span>
        </div>
      )}

      {/* ── Today's Metrics row ── */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Today&apos;s Metrics
        </h2>
        {loadingMetrics ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <MetricSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Heart Rate */}
            <Card className="relative overflow-hidden">
              <CardContent className="pt-5 pb-5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Heart className="w-4 h-4 text-red-400" />
                    <span className="text-xs font-medium">Heart Rate</span>
                  </div>
                  <TrendIcon trend={hrTrend} good="down" />
                </div>
                {heartRate ? (
                  <>
                    <p className="text-3xl font-bold tabular-nums">{Math.round(heartRate.value)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">bpm</p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground mt-2">No data</p>
                )}
              </CardContent>
            </Card>

            {/* Sleep */}
            <Card>
              <CardContent className="pt-5 pb-5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Moon className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs font-medium">Sleep</span>
                  </div>
                  <TrendIcon trend={sleepTrend} good="up" />
                </div>
                {sleep ? (
                  <>
                    <p className="text-3xl font-bold tabular-nums">
                      {sleep.value.toFixed(1)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">hours last night</p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground mt-2">No data</p>
                )}
              </CardContent>
            </Card>

            {/* Steps */}
            <Card>
              <CardContent className="pt-5 pb-5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Footprints className="w-4 h-4 text-green-400" />
                    <span className="text-xs font-medium">Steps</span>
                  </div>
                  <TrendIcon trend={stepsTrend} good="up" />
                </div>
                {steps ? (
                  <>
                    <p className="text-3xl font-bold tabular-nums">
                      {steps.value.toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">today</p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground mt-2">No data</p>
                )}
              </CardContent>
            </Card>

            {/* HRV */}
            <Card>
              <CardContent className="pt-5 pb-5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Activity className="w-4 h-4 text-purple-400" />
                    <span className="text-xs font-medium">HRV</span>
                  </div>
                  <TrendIcon trend={getTrend(metrics, 'hrv')} good="up" />
                </div>
                {hrv ? (
                  <>
                    <p className="text-3xl font-bold tabular-nums">{Math.round(hrv.value)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">ms</p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground mt-2">No data</p>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* ── AI Health Insight card ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            Today&apos;s AI Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingInsight ? (
            <InsightSkeleton />
          ) : insight ? (
            <div className="space-y-3">
              <p className="text-sm leading-relaxed">{insight.summary}</p>

              {insight.anomalies && insight.anomalies.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {insight.anomalies.map((anomaly, i) => (
                    <span
                      key={i}
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        SEVERITY_BADGE[anomaly.severity] ?? SEVERITY_BADGE.normal
                      }`}
                    >
                      {anomaly.message}
                    </span>
                  ))}
                </div>
              )}

              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                Generated {minutesAgo(insight.generated_at)} minutes ago
              </p>
            </div>
          ) : (
            <div className="py-6 text-center">
              <Sparkles className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-40" />
              <p className="text-sm text-muted-foreground">
                No insight yet &mdash; connect health data to get started.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── 7-Day Trend chart ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              7-Day Trend
            </CardTitle>
            {/* Metric type tabs */}
            <div className="flex gap-1 border border-border rounded-lg p-1 bg-muted/40">
              {(['heart_rate', 'sleep_hours', 'steps'] as MetricType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setActiveMetricType(t)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    activeMetricType === t
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t === 'heart_rate' ? 'Heart Rate' : t === 'sleep_hours' ? 'Sleep' : 'Steps'}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!hasData ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
              No data to display yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11 }}
                  className="text-muted-foreground"
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  className="text-muted-foreground"
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                  labelStyle={{ color: 'hsl(var(--foreground))' }}
                  formatter={(value: number | undefined) => [
                    value ?? '',
                    CHART_LABELS[activeMetricType],
                  ]}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={CHART_COLOR[activeMetricType]}
                  strokeWidth={2}
                  dot={{ fill: CHART_COLOR[activeMetricType], r: 3, strokeWidth: 0 }}
                  activeDot={{ r: 5, strokeWidth: 0 }}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* ── Book Consultation section ── */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Consultation
        </h2>
        <div className="grid md:grid-cols-2 gap-4">
          {/* Start Now */}
          <Card className="border-primary/20 bg-primary/5 dark:bg-primary/10">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Play className="w-4 h-4 fill-current text-primary" />
                Start Now
              </CardTitle>
              <CardDescription>
                Begin a live AI health consultation with camera &amp; voice support.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                className="w-full gap-2"
                onClick={startConsultNow}
                disabled={bookingNow}
              >
                {bookingNow ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 fill-current" />
                )}
                Start Consultation
              </Button>
              {!disclaimerAcknowledged && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Please acknowledge the health notice above first.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Schedule for Later */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Schedule for Later
              </CardTitle>
              <CardDescription>
                Pick a date and time for your consultation.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {scheduleConfirmed ? (
                <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg">
                  <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" />
                  <p className="text-sm text-green-800 dark:text-green-300">
                    Scheduled for <strong>{scheduleConfirmed}</strong>
                  </p>
                </div>
              ) : (
                <>
                  <Input
                    type="datetime-local"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    min={new Date().toISOString().slice(0, 16)}
                    className="text-sm"
                  />
                  <Button
                    variant="outline"
                    className="w-full gap-2"
                    onClick={scheduleConsult}
                    disabled={!scheduleDate || bookingNow}
                  >
                    {bookingNow ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Calendar className="w-4 h-4" />
                    )}
                    Confirm Schedule
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Connect Data section ── */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Connect Health Data
        </h2>
        <div className="grid md:grid-cols-2 gap-4">
          {/* Fitbit */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-500" />
                Fitbit
                {fitbitConnected && (
                  <span className="ml-auto text-xs font-normal px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">
                    Connected
                  </span>
                )}
              </CardTitle>
              <CardDescription>
                Sync heart rate, sleep, steps, and HRV automatically.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant={fitbitConnected ? 'outline' : 'default'}
                className="w-full gap-2"
                onClick={connectFitbit}
                disabled={connectingFitbit}
              >
                {connectingFitbit ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <ExternalLink className="w-4 h-4" />
                )}
                {fitbitConnected ? 'Reconnect Fitbit' : 'Connect Fitbit'}
              </Button>
              {fitbitError && (
                <p className="text-xs text-destructive mt-2 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  {fitbitError}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Apple Health */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Heart className="w-4 h-4 text-red-400" />
                Apple Health
              </CardTitle>
              <CardDescription>
                Push iPhone health data to Aevoy via a personal webhook.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Use Apple Shortcuts, Automations, or any HTTP tool to POST your health metrics
                to your personal endpoint. Your webhook URL is shown in{' '}
                <a href="/dashboard/apps" className="text-primary underline underline-offset-2 hover:no-underline">
                  Connected Apps
                </a>.
              </p>
              <div className="rounded-lg border border-border bg-muted/50 px-3 py-2">
                <p className="text-[11px] font-mono text-muted-foreground truncate">
                  POST /api/health/shortcuts?token=YOUR_TOKEN
                </p>
              </div>
              <a href="/dashboard/apps">
                <Button variant="outline" className="w-full gap-2 text-sm">
                  <ExternalLink className="w-4 h-4" />
                  View Webhook Setup
                </Button>
              </a>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Go deeper link ── */}
      <div className="flex justify-end">
        <Link
          href="/dashboard/apps"
          className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
        >
          Manage all connected apps
          <ChevronRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
