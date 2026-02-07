'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2,
  Circle,
  Clock,
  AlertCircle,
  PlayCircle,
  XCircle,
  Search,
  Inbox,
  Loader2,
  Send,
  Mail,
  MessageSquare,
  Phone,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SkeletonList } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';

interface Task {
  id: string;
  email_subject: string | null;
  status: string;
  type: string | null;
  input_channel: string | null;
  created_at: string;
  completed_at: string | null;
  tokens_used: number;
  cost_usd: number | null;
  error_message: string | null;
  verification_status: string | null;
  cascade_level: string | null;
}

type StatusFilter = 'all' | 'pending' | 'processing' | 'awaiting_confirmation' | 'awaiting_user_input';

export default function TaskQueuePage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const toast = useToast();

  const fetchTasks = useCallback(async () => {
    try {
      const statuses = 'pending,processing,awaiting_confirmation,awaiting_user_input';
      const response = await fetch(`/api/tasks?status=${statuses}&limit=50`);
      const data = await response.json();
      if (data.tasks) {
        setTasks(data.tasks);
      }
    } catch (err) {
      console.error('Error fetching queue tasks:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    // Poll every 5 seconds for active queue
    const interval = setInterval(fetchTasks, 5000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  const handleCancel = async (taskId: string) => {
    setCancellingId(taskId);
    try {
      // Optimistic update
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      toast.success('Task cancelled');
    } catch {
      toast.error('Failed to cancel task');
      fetchTasks();
    } finally {
      setCancellingId(null);
    }
  };

  const filteredTasks = tasks.filter((task) => {
    const matchesStatus = filterStatus === 'all' || task.status === filterStatus;
    const matchesSearch =
      !searchQuery ||
      (task.email_subject || '').toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  // Group tasks by status
  const groupedTasks: Record<string, Task[]> = {};
  const statusOrder = ['processing', 'pending', 'awaiting_confirmation', 'awaiting_user_input'];
  for (const task of filteredTasks) {
    const key = task.status;
    if (!groupedTasks[key]) groupedTasks[key] = [];
    groupedTasks[key].push(task);
  }

  const stats = {
    pending: tasks.filter((t) => t.status === 'pending').length,
    processing: tasks.filter((t) => t.status === 'processing').length,
    awaiting: tasks.filter(
      (t) => t.status === 'awaiting_confirmation' || t.status === 'awaiting_user_input'
    ).length,
    total: tasks.length,
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />;
      case 'processing':
        return <Loader2 className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-600 dark:text-red-400" />;
      case 'awaiting_confirmation':
      case 'awaiting_user_input':
        return <AlertCircle className="w-4 h-4 text-orange-600 dark:text-orange-400" />;
      default:
        return <Circle className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />;
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
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300';
      default:
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'processing':
        return 'Processing';
      case 'pending':
        return 'Pending';
      case 'awaiting_confirmation':
        return 'Awaiting Confirmation';
      case 'awaiting_user_input':
        return 'Awaiting Input';
      default:
        return status;
    }
  };

  const getChannelIcon = (channel: string | null) => {
    switch (channel) {
      case 'sms':
        return <MessageSquare className="w-3 h-3" />;
      case 'voice':
        return <Phone className="w-3 h-3" />;
      case 'web':
        return <Send className="w-3 h-3" />;
      default:
        return <Mail className="w-3 h-3" />;
    }
  };

  const formatTime = (dateStr: string): string => {
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

  const statusFilters: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'processing', label: 'Processing' },
    { value: 'pending', label: 'Pending' },
    { value: 'awaiting_confirmation', label: 'Awaiting' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Task Queue</h1>
        <p className="text-muted-foreground">
          Tasks waiting to be processed by your AI. Watch as they move from queued to completed.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <PlayCircle className="w-4 h-4 text-blue-500" />
              <span className="text-sm text-muted-foreground">Processing</span>
            </div>
            <p className="text-2xl font-bold mt-1">{stats.processing}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-yellow-500" />
              <span className="text-sm text-muted-foreground">Pending</span>
            </div>
            <p className="text-2xl font-bold mt-1">{stats.pending}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-orange-500" />
              <span className="text-sm text-muted-foreground">Awaiting</span>
            </div>
            <p className="text-2xl font-bold mt-1">{stats.awaiting}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <Inbox className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Total in Queue</span>
            </div>
            <p className="text-2xl font-bold mt-1">{stats.total}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters & Search */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search tasks..."
                className="pl-10"
              />
            </div>
            <div className="flex gap-2 overflow-x-auto">
              {statusFilters.map((sf) => (
                <Button
                  key={sf.value}
                  variant={filterStatus === sf.value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilterStatus(sf.value)}
                >
                  {sf.label}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Task List */}
      {loading ? (
        <Card>
          <CardHeader>
            <CardTitle>Loading queue...</CardTitle>
          </CardHeader>
          <CardContent>
            <SkeletonList count={4} variant="task" />
          </CardContent>
        </Card>
      ) : filteredTasks.length === 0 ? (
        <Card>
          <CardContent className="py-6">
            <EmptyState
              icon={Inbox}
              title="Nothing in the queue right now"
              description="You're all caught up! Send a task via email, SMS, or the dashboard to get started."
            />
          </CardContent>
        </Card>
      ) : (
        statusOrder.map((status) => {
          const group = groupedTasks[status];
          if (!group || group.length === 0) return null;
          return (
            <Card key={status}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  {getStatusIcon(status)}
                  <CardTitle className="text-lg">{getStatusLabel(status)}</CardTitle>
                  <span className="text-sm text-muted-foreground">({group.length})</span>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {group.map((task) => (
                    <div
                      key={task.id}
                      className={`flex items-center justify-between p-4 border rounded-lg transition-all ${
                        task.status === 'processing'
                          ? 'border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20'
                          : ''
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(task.status)}
                          <p className="font-medium truncate">
                            {task.email_subject || 'Task'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap ml-6">
                          <span className="text-sm text-muted-foreground flex items-center gap-1">
                            {getChannelIcon(task.input_channel)}
                            {task.input_channel || 'email'}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            {formatTime(task.created_at)}
                          </span>
                          {task.type && (
                            <span className="text-xs bg-muted px-2 py-0.5 rounded">
                              {task.type}
                            </span>
                          )}
                          <span
                            className={`px-2 py-0.5 text-xs rounded-full ${getStatusColor(
                              task.status
                            )}`}
                          >
                            {getStatusLabel(task.status)}
                          </span>
                        </div>
                        {task.error_message && (
                          <p className="text-xs text-red-500 mt-1 ml-6 truncate">
                            {task.error_message}
                          </p>
                        )}
                      </div>
                      {task.status === 'pending' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20 shrink-0"
                          onClick={() => handleCancel(task.id)}
                          disabled={cancellingId === task.id}
                        >
                          {cancellingId === task.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            'Cancel'
                          )}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
