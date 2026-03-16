"use client";

import { useState, useEffect, useCallback } from "react";
import { StaggerContainer, StaggerItem } from "@/components/ui/motion";
import { SkeletonList } from "@/components/ui/skeleton";
import { Sparkles } from "lucide-react";
import Link from "next/link";

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
  progress_message: string | null;
  progress_step: number | null;
  progress_total: number | null;
  iteration_count: number | null;
  action_count: number | null;
  action_success_count: number | null;
  live_view_url: string | null;
}

interface RecentActivityProps {
  aiEmail: string;
  initialTasks?: Task[];
}

function cleanTaskName(name: string) {
  return name.replace(/^\[(Proactive|Scheduled|proactive|scheduled)\]\s*/i, '').trim();
}

function truncateText(text: string, max: number = 60) {
  return text.length > max ? text.slice(0, max) + '...' : text;
}

export function RecentActivity({ aiEmail, initialTasks = [] }: RecentActivityProps) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [loading, setLoading] = useState(!initialTasks.length);

  const fetchTasks = useCallback(async () => {
    try {
      const response = await fetch("/api/tasks");
      const data = await response.json();
      if (data.tasks) {
        setTasks(data.tasks);
      }
    } catch (err) {
      console.error("Error fetching tasks:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialTasks.length) {
      fetchTasks();
    }

    const hasPendingTasks = tasks.some(
      (t) => t.status === "pending" || t.status === "processing"
    );

    const pollInterval = hasPendingTasks ? 3000 : 10000;
    const interval = setInterval(fetchTasks, pollInterval);
    return () => clearInterval(interval);
  }, [tasks, fetchTasks, initialTasks.length]);

  const formatTime = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60 * 1000) return "Just now";
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

  const getStatusIndicator = (status: string) => {
    switch (status) {
      case "completed":
        return (
          <div className="w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center shrink-0">
            <svg className="w-3 h-3 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        );
      case "failed":
        return (
          <div className="w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center shrink-0">
            <svg className="w-3 h-3 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
        );
      case "processing":
        return (
          <div className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center shrink-0">
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          </div>
        );
      case "pending":
        return (
          <div className="w-5 h-5 rounded-full bg-yellow-100 dark:bg-yellow-900/40 flex items-center justify-center shrink-0">
            <div className="w-2 h-2 rounded-full bg-yellow-500" />
          </div>
        );
      case "needs_review":
        return (
          <div className="w-5 h-5 rounded-full bg-orange-100 dark:bg-orange-900/40 flex items-center justify-center shrink-0">
            <span className="text-[10px] font-bold text-orange-600 dark:text-orange-400">!</span>
          </div>
        );
      case "awaiting_confirmation":
        return (
          <div className="w-5 h-5 rounded-full bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center shrink-0">
            <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400">?</span>
          </div>
        );
      default:
        return (
          <div className="w-5 h-5 rounded-full bg-gray-100 dark:bg-gray-800/40 flex items-center justify-center shrink-0">
            <div className="w-2 h-2 rounded-full bg-gray-400" />
          </div>
        );
    }
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Recent Activity</h2>
        {tasks.length > 0 && (
          <Link
            href="/dashboard/activity"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            View all
          </Link>
        )}
      </div>

      {/* Task list */}
      {loading ? (
        <SkeletonList count={3} variant="task" />
      ) : tasks.length > 0 ? (
        <StaggerContainer className="space-y-1" staggerDelay={0.03}>
          {tasks.map((task) => (
            <StaggerItem key={task.id}>
              <Link href={`/dashboard/tasks/${task.id}`} className="block">
                <div
                  className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-colors hover:bg-muted/50 ${
                    task.status === "processing" ? "bg-blue-50/50 dark:bg-blue-950/10" : ""
                  }`}
                >
                  {getStatusIndicator(task.status)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {truncateText(cleanTaskName(task.email_subject || "Task"))}
                    </p>
                    {task.status === "processing" && task.progress_message && (
                      <p className="text-xs text-blue-600 dark:text-blue-400 truncate mt-0.5">
                        {task.progress_message}
                      </p>
                    )}
                    {task.error_message && task.status === "failed" && (
                      <p className="text-xs text-red-500 truncate mt-0.5">
                        {task.error_message}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground/60 shrink-0">
                    {formatTime(task.created_at)}
                  </span>
                </div>
              </Link>
            </StaggerItem>
          ))}
        </StaggerContainer>
      ) : (
        <div className="text-center py-12 px-6">
          <div className="flex justify-center mb-3">
            <div className="p-3 bg-muted/60 rounded-2xl">
              <Sparkles className="w-8 h-8 text-muted-foreground/60" />
            </div>
          </div>
          <p className="text-sm font-medium text-foreground mb-1">
            Your AI is ready
          </p>
          <p className="text-xs text-muted-foreground">
            Give it something to do — type above or email {aiEmail}
          </p>
        </div>
      )}
    </div>
  );
}
