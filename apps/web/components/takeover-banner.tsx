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

const MAX_VISIBLE = 2;

export function TakeoverBanner() {
  const [tasks, setTasks] = useState<TakeoverTask[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);

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

  const displayedTasks = expanded ? visibleTasks : visibleTasks.slice(0, MAX_VISIBLE);
  const hiddenCount = visibleTasks.length - MAX_VISIBLE;

  return (
    <div className="space-y-2">
      {displayedTasks.map((task) => {
        const reason = task.takeover_reason || 'low_success_rate';
        const label = REASON_LABELS[reason] || reason;
        return (
          <div
            key={task.id}
            className="flex items-center justify-between p-4 rounded-lg border border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950/30"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-3 h-3 rounded-full bg-orange-500 animate-ping shrink-0" />
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">
                  Your AI needs help with: {(task.email_subject || 'Task').replace(/^\[(Proactive|Scheduled|proactive|scheduled)\]\s*/i, '').trim()}
                </p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link
                href={`/dashboard/takeover/${task.id}`}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Take Over Browser
              </Link>
              <button
                onClick={() => handleDismiss(task.id)}
                className="p-1.5 rounded-md hover:bg-orange-200 dark:hover:bg-orange-800/50 text-orange-600 dark:text-orange-400 transition-colors"
                aria-label="Dismiss banner"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        );
      })}
      {!expanded && hiddenCount > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="text-sm text-orange-600 dark:text-orange-400 hover:underline px-4"
        >
          and {hiddenCount} more...
        </button>
      )}
      {expanded && hiddenCount > 0 && (
        <button
          onClick={() => setExpanded(false)}
          className="text-sm text-orange-600 dark:text-orange-400 hover:underline px-4"
        >
          Show fewer
        </button>
      )}
    </div>
  );
}
