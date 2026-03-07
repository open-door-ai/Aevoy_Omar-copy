'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
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

type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

function formatElapsed(startIso: string): string {
  const diff = Date.now() - new Date(startIso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 800;

export default function TakeoverPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const router = useRouter();
  const [task, setTask] = useState<TaskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [elapsed, setElapsed] = useState('0s');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [currentUrl, setCurrentUrl] = useState('');
  const [wsError, setWsError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 3;

  const fetchTask = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`);
      if (!res.ok) {
        setError('Task not found');
        return;
      }
      const data = await res.json();
      setTask(data.task);

      if (!data.task.needs_takeover && data.task.takeover_resolved_at) {
        router.push('/dashboard/activity');
      }
    } catch {
      setError('Failed to load task');
    } finally {
      setLoading(false);
    }
  }, [taskId, router]);

  const connectWebSocket = useCallback(async () => {
    if (!taskId) return;

    setConnectionStatus('connecting');
    setWsError(null);

    try {
      // Get a short-lived token
      const tokenRes = await fetch(`/api/tasks/${taskId}/takeover-token`, { method: 'POST' });
      if (!tokenRes.ok) {
        const errData = await tokenRes.json().catch(() => ({ message: 'Failed to get token' }));
        setWsError(errData.message || 'Failed to authenticate');
        setConnectionStatus('error');
        return;
      }
      const { wsUrl } = await tokenRes.json();

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnectionStatus('connected');
        reconnectAttempts.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === 'screenshot' && msg.data) {
            const img = new Image();
            img.onload = () => {
              const canvas = canvasRef.current;
              if (!canvas) return;
              const ctx = canvas.getContext('2d');
              if (!ctx) return;
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            };
            img.src = `data:image/jpeg;base64,${msg.data}`;
            if (msg.url) setCurrentUrl(msg.url);
          } else if (msg.type === 'status') {
            if (!msg.connected) {
              setConnectionStatus('disconnected');
            }
          } else if (msg.type === 'error') {
            setWsError(msg.message);
          }
        } catch { /* ignore parse errors */ }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (reconnectAttempts.current < maxReconnectAttempts) {
          reconnectAttempts.current++;
          setConnectionStatus('reconnecting');
          const delay = Math.pow(2, reconnectAttempts.current) * 1000;
          setTimeout(connectWebSocket, delay);
        } else {
          setConnectionStatus('disconnected');
        }
      };

      ws.onerror = () => {
        // onclose will handle reconnection
      };
    } catch (err) {
      setWsError(err instanceof Error ? err.message : 'Connection failed');
      setConnectionStatus('error');
    }
  }, [taskId]);

  // Send action to WebSocket
  const sendAction = useCallback((action: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(action));
    }
  }, []);

  // Canvas mouse event handler — translates canvas coords to viewport coords
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = VIEWPORT_WIDTH / rect.width;
    const scaleY = VIEWPORT_HEIGHT / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);

    if (e.detail === 2) {
      sendAction({ type: 'dblclick', x, y });
    } else {
      sendAction({ type: 'click', x, y });
    }
  }, [sendAction]);

  // Scroll handler
  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    sendAction({ type: 'scroll', deltaX: e.deltaX, deltaY: e.deltaY });
  }, [sendAction]);

  // Keyboard handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (connectionStatus !== 'connected') return;
      // Don't capture if user is in an input field
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      e.preventDefault();

      const specialKeys = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'Space',
        'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
        'Home', 'End', 'PageUp', 'PageDown'];

      if (e.ctrlKey || e.metaKey) {
        const combo = `Control+${e.key}`;
        sendAction({ type: 'press', key: combo });
      } else if (specialKeys.includes(e.key)) {
        sendAction({ type: 'press', key: e.key });
      } else if (e.key.length === 1) {
        sendAction({ type: 'type', text: e.key });
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [connectionStatus, sendAction]);

  useEffect(() => {
    fetchTask();
  }, [fetchTask]);

  // Connect WebSocket after task loads
  useEffect(() => {
    if (task && (task.status === 'processing' || task.status === 'awaiting_user_input' || task.needs_takeover)) {
      connectWebSocket();
    }
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Elapsed timer
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
        if (wsRef.current) wsRef.current.close();
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

  const statusDot = {
    connecting: 'bg-yellow-400 animate-pulse',
    connected: 'bg-green-500',
    reconnecting: 'bg-yellow-400 animate-pulse',
    disconnected: 'bg-red-500',
    error: 'bg-red-500',
  };

  const statusLabel = {
    connecting: 'Connecting...',
    connected: 'Connected',
    reconnecting: `Reconnecting (${reconnectAttempts.current}/${maxReconnectAttempts})...`,
    disconnected: 'Disconnected',
    error: 'Error',
  };

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

  // If task completed, show completion state
  if (task.status === 'completed' || task.status === 'failed') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Task {task.status === 'completed' ? 'Completed' : 'Failed'}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              This task has already {task.status === 'completed' ? 'been completed' : 'failed'}.
            </p>
            <button
              onClick={() => router.push(`/dashboard/tasks/${taskId}`)}
              className="text-sm text-primary underline"
            >
              View Task Details
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

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
        <div className="flex items-center gap-3">
          {/* Connection status */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`w-2 h-2 rounded-full ${statusDot[connectionStatus]}`} />
            {statusLabel[connectionStatus]}
          </div>
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
      <div className="px-4 py-2 bg-muted/50 border-b text-sm text-muted-foreground shrink-0 flex items-center justify-between">
        <span>{reasonInfo.instruction}</span>
        {currentUrl && (
          <span className="text-xs font-mono truncate max-w-[400px] ml-4 opacity-70">{currentUrl}</span>
        )}
      </div>

      {/* WebSocket error */}
      {wsError && (
        <div className="px-4 py-2 bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400 shrink-0">
          {wsError}
        </div>
      )}

      {/* Interactive Canvas */}
      <div className="flex-1 flex items-center justify-center bg-muted/30 p-2 overflow-hidden">
        {connectionStatus === 'connecting' || connectionStatus === 'reconnecting' ? (
          <div className="text-center space-y-4">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-muted-foreground text-sm">
              {connectionStatus === 'reconnecting' ? 'Reconnecting to browser...' : 'Connecting to browser...'}
            </p>
          </div>
        ) : connectionStatus === 'error' || connectionStatus === 'disconnected' ? (
          <Card className="max-w-md">
            <CardHeader>
              <CardTitle className="text-lg">
                {connectionStatus === 'error' ? 'Connection Error' : 'Disconnected'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                {wsError || 'The browser session is no longer available. The task may have completed or the browser closed.'}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={connectWebSocket}
                  className="text-sm text-primary underline"
                >
                  Try Reconnecting
                </button>
                <button
                  onClick={() => router.push('/dashboard')}
                  className="text-sm text-muted-foreground underline"
                >
                  Back to Dashboard
                </button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <canvas
            ref={canvasRef}
            width={VIEWPORT_WIDTH}
            height={VIEWPORT_HEIGHT}
            onClick={handleCanvasClick}
            onWheel={handleWheel}
            className="border border-border rounded-lg shadow-lg cursor-crosshair w-full max-w-[1280px] max-h-full object-contain"
            style={{ aspectRatio: `${VIEWPORT_WIDTH}/${VIEWPORT_HEIGHT}` }}
            tabIndex={0}
          />
        )}
      </div>
    </div>
  );
}
