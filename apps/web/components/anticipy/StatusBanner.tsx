'use client';
import { useState, useEffect } from 'react';

interface ServiceStatus {
  operational: boolean;
  services: Record<string, { status: string; detail: string }>;
  degraded: string[];
}

export function StatusBanner() {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || 'https://agent-production-1339.up.railway.app';

    async function checkStatus() {
      try {
        const res = await fetch(`${AGENT_URL}/anticipy/status`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const data = await res.json();
          setStatus(data);
        } else {
          // Agent itself is down
          setStatus({
            operational: false,
            services: {},
            degraded: ['agent'],
          });
        }
      } catch {
        // Network error — agent unreachable
        setStatus({
          operational: false,
          services: {},
          degraded: ['agent'],
        });
      }
    }

    checkStatus();
    // Poll every 30 seconds
    const interval = setInterval(checkStatus, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Don't show if operational or dismissed
  if (!status || (status.operational && status.degraded.length === 0) || dismissed) {
    return null;
  }

  const isDown = !status.operational;

  return (
    <div className={`mx-4 mt-2 px-4 py-3 rounded-xl flex items-center justify-between gap-3 text-sm ${
      isDown
        ? 'bg-red-500/10 border border-red-500/20 text-red-400'
        : 'bg-amber-500/10 border border-amber-500/20 text-amber-400'
    }`}>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${isDown ? 'bg-red-400' : 'bg-amber-400'} animate-pulse`} />
        <span>
          {isDown
            ? 'Anticipy is having trouble connecting. Your messages are queued.'
            : 'Some services are running slower than usual. Everything still works.'}
        </span>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="text-xs opacity-60 hover:opacity-100 shrink-0"
      >
        Dismiss
      </button>
    </div>
  );
}
