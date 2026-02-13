'use client';

import { useState, useEffect } from 'react';

interface Task {
  id: string;
  description: string;
  progress: number;
  eta: string;
  cost: number;
  actions: { completed: number; total: number };
  url: string;
  screenshot?: string;
}

interface QueueTask {
  id: string;
  description: string;
  priority: number;
}

interface Stats {
  tasksCompleted: number;
  tasksFailed: number;
  tasksPending: number;
  costToday: number;
  actionsTotal: number;
  avgTime: string;
  successRate: number;
}

export function useSSE() {
  const [currentTask, setCurrentTask] = useState<Task | null>(null);
  const [queue, setQueue] = useState<QueueTask[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [presence, setPresence] = useState(false);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const eventSource = new EventSource('/api/events');

    eventSource.onopen = () => {
      setConnected(true);
      console.log('[SSE] Connected');
    };

    eventSource.onerror = () => {
      setConnected(false);
      console.error('[SSE] Connection error');
    };

    eventSource.addEventListener('task:update', (e) => {
      try {
        const data = JSON.parse(e.data);
        setCurrentTask(data);
      } catch (err) {
        console.error('[SSE] Failed to parse task:update', err);
      }
    });

    eventSource.addEventListener('queue:update', (e) => {
      try {
        const data = JSON.parse(e.data);
        setQueue(data);
      } catch (err) {
        console.error('[SSE] Failed to parse queue:update', err);
      }
    });

    eventSource.addEventListener('stats:update', (e) => {
      try {
        const data = JSON.parse(e.data);
        setStats(data);
      } catch (err) {
        console.error('[SSE] Failed to parse stats:update', err);
      }
    });

    eventSource.addEventListener('presence:update', (e) => {
      try {
        const data = JSON.parse(e.data);
        setPresence(data.present);
      } catch (err) {
        console.error('[SSE] Failed to parse presence:update', err);
      }
    });

    // Load mock data initially
    setTimeout(() => {
      setCurrentTask({
        id: 'task-1',
        description: 'Research latest AI papers on arxiv.org',
        progress: 65,
        eta: '2m 15s',
        cost: 0.0023,
        actions: { completed: 13, total: 20 },
        url: 'https://arxiv.org/list/cs.AI/recent',
        screenshot: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="200"%3E%3Crect fill="%23334155" width="400" height="200"/%3E%3Ctext x="50%25" y="50%25" font-family="monospace" font-size="14" fill="%2394a3b8" text-anchor="middle" dy=".3em"%3EBrowser Screenshot%3C/text%3E%3C/svg%3E',
      });

      setQueue([
        { id: 'q-1', description: 'Send meeting recap email to team', priority: 1 },
        { id: 'q-2', description: 'Check calendar for tomorrow', priority: 2 },
        { id: 'q-3', description: 'Order groceries from Instacart', priority: 3 },
      ]);

      setStats({
        tasksCompleted: 12,
        tasksFailed: 1,
        tasksPending: 3,
        costToday: 0.18,
        actionsTotal: 247,
        avgTime: '3m 42s',
        successRate: 92,
      });

      setPresence(true);
    }, 1000);

    return () => {
      eventSource.close();
    };
  }, []);

  return { currentTask, queue, stats, presence, connected };
}
