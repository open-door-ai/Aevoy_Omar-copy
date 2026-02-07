'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface TaskData {
  id: string;
  email_subject: string;
  live_view_url: string | null;
  needs_takeover: boolean;
  takeover_reason: string | null;
  takeover_requested_at: string | null;
  takeover_resolved_at: string | null;
  status: string;
}

const REASON_LABELS: Record<string, { title: string; instruction: string }> = {
  captcha_detected: {
    title: 'CAPTCHA Detected',
    instruction: 'Solve the CAPTCHA in the browser below, then click "I\'m Done".',
  },
  bot_blocked: {
    title: 'Bot Detection',
    instruction: 'The website blocked the AI agent. Complete the verification challenge below.',
  },
  verification_needed: {
    title: 'Verification Needed',
    instruction: 'Enter the verification code or complete the security check below.',
  },
  login_required: {
    title: 'Login Required',
    instruction: 'Log in to the website with your credentials below.',
  },
  low_success_rate: {
    title: 'Agent Stuck',
    instruction: 'The AI is having trouble. Take over the browser and complete the action manually.',
  },
};

function formatElapsed(startIso: string): string {
  const diff = Date.now() - new Date(startIso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

export default function TakeoverPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const router = useRouter();
  const [task, setTask] = useState<TaskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [elapsed, setElapsed] = useState('0s');

  const fetchTask = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`);
      if (!res.ok) {
        setError('Task not found');
        return;
      }
      const data = await res.json();
      setTask(data.task);

      // If takeover already resolved, redirect back
      if (!data.task.needs_takeover && data.task.takeover_resolved_at) {
        router.push('/dashboard/activity');
      }
    } catch {
      setError('Failed to load task');
    } finally {
      setLoading(false);
    }
  }, [taskId, router]);

  useEffect(() => {
    fetchTask();
  }, [fetchTask]);

  // Update elapsed timer
  useEffect(() => {
    if (!task?.takeover_requested_at) return;
    const interval = setInterval(() => {
      setElapsed(formatElapsed(task.takeover_requested_at!));
    }, 1000);
    return () => clearInterval(interval);
  }, [task?.takeover_requested_at]);

  async function handleResolve(action: 'resolved' | 'resume') {
    setResolving(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/takeover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        router.push('/dashboard/activity');
      } else {
        setError('Failed to resolve takeover');
      }
    } catch {
      setError('Failed to resolve takeover');
    } finally {
      setResolving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-4">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-muted-foreground">Loading browser session...</p>
        </div>
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <p className="text-red-500 font-medium">{error || 'Task not found'}</p>
            <button
              onClick={() => router.push('/dashboard')}
              className="mt-4 text-sm text-primary underline"
            >
              Back to Dashboard
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const reason = task.takeover_reason || 'low_success_rate';
  const reasonInfo = REASON_LABELS[reason] || REASON_LABELS.low_success_rate;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 bg-orange-50 dark:bg-orange-950/30 border-b border-orange-200 dark:border-orange-800 shrink-0">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="font-semibold text-sm">
              {reasonInfo.title}
            </h2>
            <p className="text-xs text-muted-foreground truncate max-w-[300px]">
              {task.email_subject || 'Task'}
            </p>
          </div>
          <div className="text-xs text-orange-600 dark:text-orange-400 font-mono">
            {elapsed}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleResolve('resolved')}
            disabled={resolving}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {resolving ? 'Resolving...' : "I'm Done (Mark Complete)"}
          </button>
          <button
            onClick={() => handleResolve('resume')}
            disabled={resolving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {resolving ? 'Resolving...' : 'Resume Agent'}
          </button>
        </div>
      </div>

      {/* Instruction bar */}
      <div className="px-4 py-2 bg-muted/50 border-b text-sm text-muted-foreground shrink-0">
        {reasonInfo.instruction}
      </div>

      {/* Browser iframe */}
      {task.live_view_url ? (
        <iframe
          src={task.live_view_url}
          className="flex-1 w-full border-0"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          title="Live Browser Session"
        />
      ) : (
        <div className="flex-1 flex items-center justify-center bg-muted/30">
          <Card className="max-w-md">
            <CardHeader>
              <CardTitle className="text-lg">No Live Browser Available</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                The browser session for this task is not available. This can happen if:
              </p>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside mb-4">
                <li>The task is using local Playwright (not cloud Browserbase)</li>
                <li>The browser session has already closed</li>
                <li>The task was completed before you could take over</li>
              </ul>
              <button
                onClick={() => router.push('/dashboard')}
                className="text-sm text-primary underline"
              >
                Back to Dashboard
              </button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
