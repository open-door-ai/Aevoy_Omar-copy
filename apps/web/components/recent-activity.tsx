"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface Task {
  id: string;
  email_subject: string | null;
  status: string;
  type: string | null;
  created_at: string;
  completed_at: string | null;
  tokens_used: number;
  cost_usd: number | null;
  error_message: string | null;
}

interface RecentActivityProps {
  aiEmail: string;
  initialTasks?: Task[];
}

export function RecentActivity({ aiEmail, initialTasks = [] }: RecentActivityProps) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [loading, setLoading] = useState(!initialTasks.length);
  const [lastUpdate, setLastUpdate] = useState(new Date());

  const fetchTasks = useCallback(async () => {
    try {
      const response = await fetch("/api/tasks");
      const data = await response.json();
      if (data.tasks) {
        setTasks(data.tasks);
        setLastUpdate(new Date());
      }
    } catch (err) {
      console.error("Error fetching tasks:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial fetch if no initial tasks
    if (!initialTasks.length) {
      fetchTasks();
    }

    // Check if there are any pending/processing tasks
    const hasPendingTasks = tasks.some(
      (t) => t.status === "pending" || t.status === "processing"
    );

    // Poll more frequently if there are pending tasks
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-green-100 text-green-800";
      case "failed":
        return "bg-red-100 text-red-800";
      case "processing":
        return "bg-blue-100 text-blue-800 animate-pulse";
      case "pending":
        return "bg-yellow-100 text-yellow-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return "✓";
      case "failed":
        return "✕";
      case "processing":
        return "⟳";
      case "pending":
        return "○";
      default:
        return "•";
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>
            Your latest tasks and their status
          </CardDescription>
        </div>
        <div className="text-xs text-muted-foreground">
          Updated {formatTime(lastUpdate.toISOString())}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-8">
            <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2"></div>
            <p className="text-sm text-muted-foreground">Loading tasks...</p>
          </div>
        ) : tasks.length > 0 ? (
          <div className="space-y-3">
            {tasks.map((task) => (
              <div
                key={task.id}
                className={`flex items-center justify-between p-4 border rounded-lg transition-all ${
                  task.status === "processing" ? "border-blue-200 bg-blue-50/50" : ""
                }`}
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">
                    {task.email_subject || "Task"}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-sm text-muted-foreground">
                      {formatTime(task.created_at)}
                    </span>
                    {task.type && (
                      <span className="text-xs bg-muted px-2 py-0.5 rounded">
                        {task.type}
                      </span>
                    )}
                    {task.tokens_used > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {task.tokens_used.toLocaleString()} tokens
                      </span>
                    )}
                    {task.cost_usd != null && task.cost_usd > 0 && (
                      <span className="text-xs text-muted-foreground">
                        ${task.cost_usd.toFixed(4)}
                      </span>
                    )}
                  </div>
                  {task.error_message && (
                    <p className="text-xs text-red-500 mt-1 truncate">
                      {task.error_message}
                    </p>
                  )}
                </div>
                <span
                  className={`px-3 py-1 text-xs rounded-full flex items-center gap-1 ${getStatusColor(
                    task.status
                  )}`}
                >
                  <span>{getStatusIcon(task.status)}</span>
                  {task.status}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-2">No tasks yet</p>
            <p className="text-sm text-muted-foreground">
              Send an email to{" "}
              <span className="font-mono bg-muted px-1 rounded">{aiEmail}</span>{" "}
              to get started!
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
