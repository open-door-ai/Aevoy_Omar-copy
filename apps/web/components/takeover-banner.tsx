'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

interface TakeoverTask {
  id: string;
  email_subject: string;
  takeover_reason: string | null;
  takeover_requested_at: string | null;
}

const REASON_LABELS: Record<string, string> = {
  captcha_detected: 'CAPTCHA detected',
  bot_blocked: 'Bot detection triggered',
  verification_needed: 'Verification needed',
  login_required: 'Login required',
  low_success_rate: 'Agent is stuck',
};

export function TakeoverBanner() {
  const [tasks, setTasks] = useState<TakeoverTask[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let mounted = true;

    async function poll() {
      try {
        const res = await fetch('/api/tasks?needs_takeover=true&limit=5');
        if (!res.ok) return;
        const data = await res.json();
        if (mounted) {
          setTasks(
            (data.tasks || []).filter(
              (t: Record<string, unknown>) => t.needs_takeover === true
            )
          );
        }
      } catch {
        // Silently fail
      }
    }

    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const handleDismiss = useCallback((taskId: string) => {
    setDismissed((prev) => new Set(prev).add(taskId));
  }, []);

  const visibleTasks = tasks.filter((t) => !dismissed.has(t.id));

  if (visibleTasks.length === 0) return null;

  // Show a single compact banner summarizing all needs-attention tasks
  if (visibleTasks.length === 1) {
    const task = visibleTasks[0];
    const reason = task.takeover_reason || 'low_success_rate';
    const label = REASON_LABELS[reason] || reason;
    return (
      <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/40">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
          <p className="text-sm text-amber-800 dark:text-amber-200 truncate">
            {(task.email_subject || 'Task').replace(/^\[(Proactive|Scheduled|proactive|scheduled)\]\s*/i, '').trim()} — {label.toLowerCase()}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          <Link
            href={`/dashboard/takeover/${task.id}`}
            className="text-sm font-medium text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 transition-colors"
          >
            Help &rarr;
          </Link>
          <button
            onClick={() => handleDismiss(task.id)}
            className="p-1 rounded-md hover:bg-amber-200/50 dark:hover:bg-amber-800/30 text-amber-500 transition-colors"
            aria-label="Dismiss"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // Multiple tasks needing attention
  return (
    <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/40">
      <div className="flex items-center gap-2.5">
        <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
        <p className="text-sm text-amber-800 dark:text-amber-200">
          {visibleTasks.length} tasks need your attention
        </p>
      </div>
      <Link
        href="/dashboard/activity"
        className="text-sm font-medium text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 transition-colors shrink-0 ml-3"
      >
        Review &rarr;
      </Link>
    </div>
  );
}
