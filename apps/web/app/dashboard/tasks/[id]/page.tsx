'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SkeletonCard } from '@/components/ui/skeleton';
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  AlertCircle,
  Circle,
  Mail,
  MessageSquare,
  Phone,
  Send,
  DollarSign,
  Cpu,
  Calendar,
  FileText,
  Monitor,
  ExternalLink,
  Activity,
  ChevronDown,
  ChevronRight,
  BarChart2,
  Zap,
} from 'lucide-react';

interface TaskDetail {
  id: string;
  email_subject: string | null;
  input_text: string | null;
  response_text: string | null;
  status: string;
  type: string | null;
  input_channel: string | null;
  created_at: string;
  completed_at: string | null;
  started_at: string | null;
  tokens_used: number;
  cost_usd: number | null;
  error_message: string | null;
  verification_status: string | null;
  cascade_level: string | null;
  checkpoint_data: Record<string, unknown> | null;
  progress_message: string | null;
  progress_step: number | null;
  progress_total: number | null;
  action_count: number | null;
  action_success_count: number | null;
  live_view_url: string | null;
}

interface TaskLog {
  id: string;
  task_id: string;
  level: string;
  message: string;
  created_at: string;
}

interface AiCostCall {
  id: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  purpose: string | null;
  cached: boolean;
  created_at: string;
}

interface AiCostData {
  taskCostUsd: number;
  taskTokensUsed: number;
  calls: AiCostCall[];
  summary: {
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;
    byProvider: Record<string, { calls: number; inputTokens: number; outputTokens: number; costUsd: number }>;
  };
}

const POLL_INTERVAL_MS = 3000; // 3 seconds while processing

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [aiCostData, setAiCostData] = useState<AiCostData | null>(null);
  const [aiCostLoading, setAiCostLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replySending, setReplySending] = useState(false);

  const fetchTask = useCallback(async (silent = false) => {
    try {
      const response = await fetch(`/api/tasks/${taskId}`);
      if (!response.ok) {
        if (!silent) {
          setError(response.status === 404 ? 'Task not found' : 'Failed to load task');
        }
        return;
      }
      const data = await response.json();
      setTask(data.task);
      setLogs(data.logs || []);
    } catch {
      if (!silent) setError('Failed to load task');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [taskId]);

  const fetchAiCosts = useCallback(async () => {
    if (aiCostLoading || aiCostData) return;
    setAiCostLoading(true);
    try {
      const response = await fetch(`/api/tasks/${taskId}/ai-costs`);
      if (response.ok) {
        const data = await response.json();
        setAiCostData(data);
      }
    } catch {
      // non-critical, silently fail
    } finally {
      setAiCostLoading(false);
    }
  }, [taskId, aiCostLoading, aiCostData]);

  const handleReply = async () => {
    if (!replyText.trim() || replySending) return;
    setReplySending(true);
    try {
      const response = await fetch(`/api/tasks/${taskId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: replyText.trim() }),
      });
      if (response.ok) {
        const data = await response.json();
        setReplyText('');
        // Navigate to the new follow-up task
        if (data.taskId) {
          router.push(`/dashboard/tasks/${data.taskId}`);
        }
      }
    } catch {
      // silently fail
    } finally {
      setReplySending(false);
    }
  };

  // Initial load
  useEffect(() => {
    if (!taskId) return;
    fetchTask(false);
  }, [taskId, fetchTask]);

  // Poll while processing
  useEffect(() => {
    if (!task) return;
    const isActive = task.status === 'processing' || task.status === 'queued';
    if (isActive) {
      pollRef.current = setInterval(() => fetchTask(true), POLL_INTERVAL_MS);
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [task?.status, fetchTask]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />;
      case 'processing': return <Loader2 className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-spin" />;
      case 'queued': return <Clock className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />;
      case 'failed': return <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />;
      case 'awaiting_confirmation':
      case 'awaiting_user_input':
      case 'needs_review': return <AlertCircle className="w-5 h-5 text-orange-600 dark:text-orange-400" />;
      default: return <Circle className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300';
      case 'processing': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300';
      case 'queued': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300';
      case 'failed': return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-800';
      case 'awaiting_confirmation':
      case 'awaiting_user_input':
      case 'needs_review': return 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300';
      default: return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300';
    }
  };

  const getChannelIcon = (channel: string | null) => {
    switch (channel) {
      case 'sms': return <MessageSquare className="w-4 h-4" />;
      case 'voice': return <Phone className="w-4 h-4" />;
      case 'web': return <Send className="w-4 h-4" />;
      default: return <Mail className="w-4 h-4" />;
    }
  };

  const getLogLevelColor = (level: string) => {
    switch (level) {
      case 'error': return 'border-l-red-500 bg-red-50/50 dark:bg-red-950/20';
      case 'warn':
      case 'warning': return 'border-l-yellow-500 bg-yellow-50/50 dark:bg-yellow-950/20';
      case 'info': return 'border-l-blue-500 bg-blue-50/50 dark:bg-blue-950/20';
      case 'success': return 'border-l-green-500 bg-green-50/50 dark:bg-green-950/20';
      default: return 'border-l-gray-300 dark:border-l-gray-600';
    }
  };

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', second: '2-digit',
    });
  };

  const getDuration = () => {
    if (!task?.created_at) return null;
    const start = new Date(task.created_at).getTime();
    const end = task.completed_at ? new Date(task.completed_at).getTime() : Date.now();
    const diff = end - start;
    if (diff < 1000) return '<1s';
    if (diff < 60 * 1000) return `${Math.round(diff / 1000)}s`;
    if (diff < 60 * 60 * 1000) {
      const mins = Math.floor(diff / (60 * 1000));
      const secs = Math.round((diff % (60 * 1000)) / 1000);
      return `${mins}m ${secs}s`;
    }
    const hours = Math.floor(diff / (60 * 60 * 1000));
    const mins = Math.round((diff % (60 * 60 * 1000)) / (60 * 1000));
    return `${hours}h ${mins}m`;
  };

  // Detect if live_view_url is an iframe-embeddable URL or just a screenshot
  const isIframeUrl = (url: string) =>
    url.startsWith('http') && !url.match(/\.(png|jpg|jpeg|webp|gif)(\?|$)/i);
  const isScreenshotUrl = (url: string) =>
    url.match(/\.(png|jpg|jpeg|webp|gif)(\?|$)/i) || url.startsWith('data:image/');

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="w-4 h-4 mr-1" />Back
          </Button>
        </div>
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard/activity')}>
            <ArrowLeft className="w-4 h-4 mr-1" />Back to Activity
          </Button>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <XCircle className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-lg font-semibold">{error || 'Task not found'}</h3>
            <p className="text-sm text-muted-foreground mt-1">
              The task you&apos;re looking for doesn&apos;t exist or you don&apos;t have access to it.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isProcessing = task.status === 'processing' || task.status === 'queued';

  return (
    <div className="space-y-6">
      {/* Back button */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard/activity')}>
          <ArrowLeft className="w-4 h-4 mr-1" />Back to Activity
        </Button>
      </div>

      {/* Live Progress Banner (shown when processing) */}
      {isProcessing && (
        <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <Loader2 className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-spin mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-blue-800 dark:text-blue-300">
                  {task.progress_message || 'Working on your task...'}
                </p>
                {task.progress_step != null && task.progress_total != null && task.progress_total > 0 && (
                  <div className="mt-2">
                    <div className="flex justify-between text-xs text-blue-600/70 dark:text-blue-400/70 mb-1">
                      <span>Step {task.progress_step} of {task.progress_total}</span>
                      <span>{Math.round((task.progress_step / task.progress_total) * 100)}%</span>
                    </div>
                    <div className="h-1.5 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.round((task.progress_step / task.progress_total) * 100))}%` }}
                      />
                    </div>
                  </div>
                )}
                {task.action_count != null && task.action_count > 0 && (
                  <p className="text-xs text-blue-600/70 dark:text-blue-400/70 mt-1">
                    {task.action_success_count ?? 0}/{task.action_count} actions completed
                  </p>
                )}
              </div>
              <Activity className="w-4 h-4 text-blue-500 animate-pulse shrink-0" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Live Browser View */}
      {task.live_view_url && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Monitor className="w-5 h-5 text-muted-foreground" />
                <CardTitle>Live Browser View</CardTitle>
                {isProcessing && (
                  <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
                    LIVE
                  </span>
                )}
              </div>
              <Button variant="outline" size="sm" asChild>
                <a href={task.live_view_url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                  Open
                </a>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isIframeUrl(task.live_view_url) ? (
              <iframe
                src={task.live_view_url}
                className="w-full rounded-md border"
                style={{ height: '480px' }}
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
                title="Live Browser Session"
              />
            ) : isScreenshotUrl(task.live_view_url) ? (
              // Screenshot polling — auto-refreshes via component re-render on poll
              <div className="relative">
                {/* Force re-load on each poll by appending timestamp */}
                <img
                  src={`${task.live_view_url}${task.live_view_url.includes('?') ? '&' : '?'}t=${Date.now()}`}
                  alt="Latest browser screenshot"
                  className="w-full rounded-md border object-contain max-h-[480px]"
                  key={task.live_view_url + (task.progress_step ?? '')}
                />
                {isProcessing && (
                  <div className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
                    Updates every 3s
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-6">
                <a
                  href={task.live_view_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:underline text-sm flex items-center gap-1 justify-center"
                >
                  <ExternalLink className="w-4 h-4" />
                  Open live view in new tab
                </a>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Task Header */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              {getStatusIcon(task.status)}
              <div className="min-w-0">
                <CardTitle className="text-xl truncate">
                  {task.email_subject || 'Task'}
                </CardTitle>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className={`px-3 py-1 text-xs rounded-full font-medium ${getStatusColor(task.status)}`}>
                    {task.status}
                  </span>
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    {getChannelIcon(task.input_channel)}
                    {task.input_channel || 'email'}
                  </span>
                  {task.type && (
                    <span className="text-xs bg-muted px-2 py-0.5 rounded">{task.type}</span>
                  )}
                  {task.verification_status && (
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      task.verification_status === 'verified'
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                        : 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300'
                    }`}>
                      {task.verification_status}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Created</p>
                <p className="text-sm font-medium">{formatDateTime(task.created_at)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Duration</p>
                <p className="text-sm font-medium">{getDuration() || 'N/A'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Tokens</p>
                <p className="text-sm font-medium">
                  {task.tokens_used ? task.tokens_used.toLocaleString() : '0'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Cost</p>
                <p className="text-sm font-medium">
                  {task.cost_usd != null ? `$${task.cost_usd.toFixed(4)}` : '$0.00'}
                </p>
              </div>
            </div>
          </div>

          {task.completed_at && (
            <div className="mt-4 pt-4 border-t">
              <p className="text-sm text-muted-foreground">
                Completed: {formatDateTime(task.completed_at)}
              </p>
            </div>
          )}

          {task.error_message && (
            <div className="mt-4 p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-700 dark:text-red-300">{task.error_message}</p>
            </div>
          )}

          {task.cascade_level && (
            <div className="mt-4 pt-4 border-t">
              <p className="text-sm text-muted-foreground">
                Cascade Level: <span className="font-medium text-foreground">{task.cascade_level}</span>
              </p>
            </div>
          )}

          {/* Advanced toggle — Apple-style subtle link */}
          <div className="mt-4 pt-4 border-t">
            <button
              onClick={() => {
                const next = !advancedOpen;
                setAdvancedOpen(next);
                if (next) fetchAiCosts();
              }}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors group"
            >
              {advancedOpen
                ? <ChevronDown className="w-4 h-4 transition-transform group-hover:text-foreground" />
                : <ChevronRight className="w-4 h-4 transition-transform group-hover:text-foreground" />}
              <BarChart2 className="w-3.5 h-3.5" />
              <span>Advanced</span>
            </button>

            {advancedOpen && (
              <div className="mt-4 space-y-3">
                {aiCostLoading ? (
                  <div className="flex items-center gap-2 py-2">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Loading model details...</span>
                  </div>
                ) : aiCostData && aiCostData.calls.length > 0 ? (
                  <>
                    {/* Summary bar */}
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="bg-muted/50 rounded-lg p-3">
                        <p className="text-xs text-muted-foreground">AI Calls</p>
                        <p className="text-lg font-semibold">{aiCostData.summary.totalCalls}</p>
                      </div>
                      <div className="bg-muted/50 rounded-lg p-3">
                        <p className="text-xs text-muted-foreground">Total Tokens</p>
                        <p className="text-lg font-semibold">
                          {(aiCostData.summary.totalInputTokens + aiCostData.summary.totalOutputTokens).toLocaleString()}
                        </p>
                      </div>
                      <div className="bg-muted/50 rounded-lg p-3">
                        <p className="text-xs text-muted-foreground">AI Cost</p>
                        <p className="text-lg font-semibold">
                          ${aiCostData.summary.totalCostUsd < 0.001
                            ? '<$0.001'
                            : aiCostData.summary.totalCostUsd < 0.01
                            ? aiCostData.summary.totalCostUsd.toFixed(4)
                            : aiCostData.summary.totalCostUsd.toFixed(3)}
                        </p>
                      </div>
                    </div>

                    {/* Per-call breakdown table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left py-2 pr-3 font-medium text-muted-foreground">Model</th>
                            <th className="text-left py-2 pr-3 font-medium text-muted-foreground">Purpose</th>
                            <th className="text-right py-2 pr-3 font-medium text-muted-foreground">In tok</th>
                            <th className="text-right py-2 pr-3 font-medium text-muted-foreground">Out tok</th>
                            <th className="text-right py-2 font-medium text-muted-foreground">Cost</th>
                          </tr>
                        </thead>
                        <tbody>
                          {aiCostData.calls.map((call) => (
                            <tr key={call.id} className="border-b border-border/50 hover:bg-muted/30">
                              <td className="py-2 pr-3">
                                <div className="flex items-center gap-1.5">
                                  <Zap className="w-3 h-3 text-muted-foreground shrink-0" />
                                  <span className="font-mono font-medium text-foreground truncate max-w-[140px]">
                                    {call.model}
                                  </span>
                                  {call.cached && (
                                    <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 px-1 rounded">
                                      cached
                                    </span>
                                  )}
                                </div>
                                <div className="text-muted-foreground mt-0.5">{call.provider}</div>
                              </td>
                              <td className="py-2 pr-3 text-muted-foreground">{call.purpose || '—'}</td>
                              <td className="py-2 pr-3 text-right font-mono">{(call.input_tokens || 0).toLocaleString()}</td>
                              <td className="py-2 pr-3 text-right font-mono">{(call.output_tokens || 0).toLocaleString()}</td>
                              <td className="py-2 text-right font-mono">
                                {call.cost_usd === 0 ? 'free' : `$${parseFloat(String(call.cost_usd)).toFixed(4)}`}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Token counts are exact values from API responses. Rates last verified Feb 2026.{' '}
                      <a href="/dashboard/billing" className="text-primary hover:underline">
                        View billing →
                      </a>
                    </p>
                  </>
                ) : aiCostData ? (
                  <p className="text-sm text-muted-foreground py-2">
                    No detailed AI cost data available for this task.
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground py-2">
                    Could not load model details.
                  </p>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* AI Response */}
      {task.response_text && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-muted-foreground" />
              <CardTitle>Response</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
              {task.response_text}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Reply to Task */}
      {task.response_text && (task.status === 'completed' || task.status === 'needs_review') && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex gap-2">
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Reply to this task..."
                className="flex-1 min-h-[60px] max-h-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    handleReply();
                  }
                }}
              />
              <Button
                onClick={handleReply}
                disabled={!replyText.trim() || replySending}
                size="sm"
                className="self-end"
              >
                {replySending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                <span className="ml-1">Reply</span>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Press Cmd+Enter to send. This creates a follow-up task with your response as context.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Task Logs / Timeline */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-muted-foreground" />
            <CardTitle>Execution Timeline</CardTitle>
            <span className="text-sm text-muted-foreground">({logs.length} entries)</span>
          </div>
        </CardHeader>
        <CardContent>
          {logs.length > 0 ? (
            <div className="space-y-2">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className={`border-l-4 rounded-r-lg p-3 ${getLogLevelColor(log.level)}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">{log.message}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs font-medium uppercase px-1.5 py-0.5 rounded ${
                        log.level === 'error' ? 'text-red-600 dark:text-red-400'
                          : log.level === 'warn' || log.level === 'warning' ? 'text-yellow-600 dark:text-yellow-400'
                          : log.level === 'info' ? 'text-blue-600 dark:text-blue-400'
                          : log.level === 'success' ? 'text-green-600 dark:text-green-400'
                          : 'text-muted-foreground'
                      }`}>
                        {log.level}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(log.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No execution logs yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Logs will appear here as the task is processed
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
