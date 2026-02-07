'use client';

import { useEffect, useState } from 'react';
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

  if (tasks.length === 0) return null;

  return (
    <div className="space-y-2">
      {tasks.map((task) => {
        const reason = task.takeover_reason || 'low_success_rate';
        const label = REASON_LABELS[reason] || reason;
        return (
          <div
            key={task.id}
            className="flex items-center justify-between p-4 rounded-lg border border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950/30 animate-pulse"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-3 h-3 rounded-full bg-orange-500 animate-ping shrink-0" />
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">
                  Your AI needs help with: {task.email_subject || 'Task'}
                </p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </div>
            <Link
              href={`/dashboard/takeover/${task.id}`}
              className="shrink-0 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Take Over Browser
            </Link>
          </div>
        );
      })}
    </div>
  );
}
