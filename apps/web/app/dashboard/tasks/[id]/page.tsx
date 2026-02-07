'use client';

import { useState, useEffect } from 'react';
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
} from 'lucide-react';

interface TaskDetail {
  id: string;
  email_subject: string | null;
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
}

interface TaskLog {
  id: string;
  task_id: string;
  level: string;
  message: string;
  created_at: string;
}

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!taskId) return;

    const fetchTask = async () => {
      try {
        const response = await fetch(`/api/tasks/${taskId}`);
        if (!response.ok) {
          if (response.status === 404) {
            setError('Task not found');
          } else {
            setError('Failed to load task');
          }
          return;
        }
        const data = await response.json();
        setTask(data.task);
        setLogs(data.logs || []);
      } catch {
        setError('Failed to load task');
      } finally {
        setLoading(false);
      }
    };

    fetchTask();
  }, [taskId]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />;
      case 'processing':
        return <Loader2 className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-spin" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />;
      case 'awaiting_confirmation':
      case 'awaiting_user_input':
      case 'needs_review':
        return <AlertCircle className="w-5 h-5 text-orange-600 dark:text-orange-400" />;
      default:
        return <Circle className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300';
      case 'processing':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300';
      case 'failed':
        return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
      case 'awaiting_confirmation':
      case 'awaiting_user_input':
      case 'needs_review':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300';
      default:
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300';
    }
  };

  const getChannelIcon = (channel: string | null) => {
    switch (channel) {
      case 'sms':
        return <MessageSquare className="w-4 h-4" />;
      case 'voice':
        return <Phone className="w-4 h-4" />;
      case 'web':
        return <Send className="w-4 h-4" />;
      default:
        return <Mail className="w-4 h-4" />;
    }
  };

  const getLogLevelColor = (level: string) => {
    switch (level) {
      case 'error':
        return 'border-l-red-500 bg-red-50/50 dark:bg-red-950/20';
      case 'warn':
      case 'warning':
        return 'border-l-yellow-500 bg-yellow-50/50 dark:bg-yellow-950/20';
      case 'info':
        return 'border-l-blue-500 bg-blue-50/50 dark:bg-blue-950/20';
      case 'success':
        return 'border-l-green-500 bg-green-50/50 dark:bg-green-950/20';
      default:
        return 'border-l-gray-300 dark:border-l-gray-600';
    }
  };

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getDuration = () => {
    if (!task?.created_at) return null;
    const start = new Date(task.created_at).getTime();
    const end = task.completed_at
      ? new Date(task.completed_at).getTime()
      : Date.now();
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

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back
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
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Activity
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

  return (
    <div className="space-y-6">
      {/* Back button */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard/activity')}>
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Activity
        </Button>
      </div>

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
                  <span
                    className={`px-3 py-1 text-xs rounded-full font-medium ${getStatusColor(
                      task.status
                    )}`}
                  >
                    {task.status}
                  </span>
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    {getChannelIcon(task.input_channel)}
                    {task.input_channel || 'email'}
                  </span>
                  {task.type && (
                    <span className="text-xs bg-muted px-2 py-0.5 rounded">
                      {task.type}
                    </span>
                  )}
                  {task.verification_status && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        task.verification_status === 'verified'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                          : 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300'
                      }`}
                    >
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
        </CardContent>
      </Card>

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
                      <span
                        className={`text-xs font-medium uppercase px-1.5 py-0.5 rounded ${
                          log.level === 'error'
                            ? 'text-red-600 dark:text-red-400'
                            : log.level === 'warn' || log.level === 'warning'
                            ? 'text-yellow-600 dark:text-yellow-400'
                            : 'text-muted-foreground'
                        }`}
                      >
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
