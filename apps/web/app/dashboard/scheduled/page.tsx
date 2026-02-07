'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SkeletonList } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import {
  Calendar,
  Clock,
  Plus,
  Trash2,
  Loader2,
  Pause,
  Play,
  RefreshCw,
} from 'lucide-react';

interface ScheduledTask {
  id: string;
  task_template: string;
  description: string;
  cron_expression: string;
  next_run_at: string;
  last_run_at: string | null;
  is_active: boolean;
  run_count: number;
  created_at: string;
}

export default function ScheduledTasksPage() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newTask, setNewTask] = useState('');
  const [frequency, setFrequency] = useState('daily');
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const toast = useToast();

  const fetchTasks = useCallback(async () => {
    try {
      const response = await fetch('/api/scheduled-tasks');
      if (response.ok) {
        const data = await response.json();
        setTasks(data.tasks || []);
      }
    } catch (err) {
      console.error('Error fetching scheduled tasks:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTask.trim()) return;
    setSubmitting(true);
    try {
      const response = await fetch('/api/scheduled-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_template: newTask,
          frequency,
          description: newTask.substring(0, 100),
        }),
      });
      if (response.ok) {
        setNewTask('');
        setShowForm(false);
        toast.success('Scheduled task created');
        fetchTasks();
      } else {
        const data = await response.json();
        toast.error(data.error || 'Failed to create task');
      }
    } catch {
      toast.error('Failed to create task');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (taskId: string) => {
    setDeletingId(taskId);
    try {
      const response = await fetch(`/api/scheduled-tasks?id=${taskId}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setTasks((prev) => prev.filter((t) => t.id !== taskId));
        toast.success('Scheduled task removed');
      } else {
        toast.error('Failed to remove task');
      }
    } catch {
      toast.error('Failed to remove task');
    } finally {
      setDeletingId(null);
    }
  };

  const formatFrequency = (cron: string): string => {
    const map: Record<string, string> = {
      '0 9 * * *': 'Daily at 9 AM',
      '0 9 * * 1': 'Weekly on Monday at 9 AM',
      '0 9 * * 1-5': 'Weekdays at 9 AM',
      '0 9 1 * *': 'Monthly on the 1st at 9 AM',
      '0 * * * *': 'Every hour',
    };
    return map[cron] || cron;
  };

  const formatNextRun = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = date.getTime() - now.getTime();

    if (diff < 0) return 'Overdue';
    if (diff < 60 * 60 * 1000) {
      const mins = Math.round(diff / (60 * 1000));
      return `In ${mins} min${mins !== 1 ? 's' : ''}`;
    }
    if (diff < 24 * 60 * 60 * 1000) {
      const hours = Math.round(diff / (60 * 60 * 1000));
      return `In ${hours} hour${hours !== 1 ? 's' : ''}`;
    }
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const formatLastRun = (dateStr: string | null): string => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60 * 1000) return 'Just now';
    if (diff < 60 * 60 * 1000) {
      const mins = Math.floor(diff / (60 * 1000));
      return `${mins}m ago`;
    }
    if (diff < 24 * 60 * 60 * 1000) {
      const hours = Math.floor(diff / (60 * 60 * 1000));
      return `${hours}h ago`;
    }
    return date.toLocaleDateString();
  };

  const activeTasks = tasks.filter((t) => t.is_active);
  const inactiveTasks = tasks.filter((t) => !t.is_active);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Scheduled Tasks</h1>
          <p className="text-muted-foreground">
            Set up recurring tasks that your AI runs automatically. Perfect for daily email summaries, weekly reports, or any routine task.
          </p>
        </div>
        <Button
          variant={showForm ? 'outline' : 'default'}
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? (
            'Cancel'
          ) : (
            <>
              <Plus className="w-4 h-4 mr-1" />
              New Schedule
            </>
          )}
        </Button>
      </div>

      {/* Create Form */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Create Scheduled Task</CardTitle>
            <CardDescription>
              Describe what your AI should do and how often
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="task">Task Description</Label>
                <Input
                  id="task"
                  placeholder="e.g., Check my email for urgent messages and summarize them"
                  value={newTask}
                  onChange={(e) => setNewTask(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="frequency">Frequency</Label>
                <select
                  id="frequency"
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
                >
                  <option value="hourly">Every hour</option>
                  <option value="daily">Daily at 9 AM</option>
                  <option value="weekdays">Weekdays at 9 AM</option>
                  <option value="weekly">Weekly on Monday</option>
                  <option value="monthly">Monthly on the 1st</option>
                </select>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={submitting || !newTask.trim()}>
                  {submitting ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-1" />
                  ) : (
                    <Calendar className="w-4 h-4 mr-1" />
                  )}
                  Create Schedule
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Active Tasks */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Play className="w-5 h-5 text-green-500" />
            <CardTitle>Active Schedules</CardTitle>
            <span className="text-sm text-muted-foreground">({activeTasks.length})</span>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <SkeletonList count={3} variant="task" />
          ) : activeTasks.length > 0 ? (
            <div className="space-y-3">
              {activeTasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{task.task_template}</p>
                    <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <RefreshCw className="w-3 h-3" />
                        {formatFrequency(task.cron_expression)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Next: {formatNextRun(task.next_run_at)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        Last: {formatLastRun(task.last_run_at)}
                      </span>
                      {task.run_count > 0 && (
                        <span className="text-xs bg-muted px-2 py-0.5 rounded">
                          {task.run_count} runs
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(task.id)}
                    disabled={deletingId === task.id}
                    className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20 shrink-0"
                  >
                    {deletingId === task.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Calendar}
              title="No active scheduled tasks"
              description="Create recurring tasks that run automatically on a schedule."
              action={{
                label: 'Create Schedule',
                onClick: () => setShowForm(true),
              }}
            />
          )}
        </CardContent>
      </Card>

      {/* Inactive Tasks */}
      {inactiveTasks.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Pause className="w-5 h-5 text-muted-foreground" />
              <CardTitle>Paused / Cancelled</CardTitle>
              <span className="text-sm text-muted-foreground">({inactiveTasks.length})</span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {inactiveTasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between p-4 border rounded-lg opacity-60"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{task.task_template}</p>
                    <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                      <span>{formatFrequency(task.cron_expression)}</span>
                      {task.run_count > 0 && (
                        <span className="text-xs bg-muted px-2 py-0.5 rounded">
                          {task.run_count} total runs
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground px-2 py-1 bg-muted rounded">
                    Inactive
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
