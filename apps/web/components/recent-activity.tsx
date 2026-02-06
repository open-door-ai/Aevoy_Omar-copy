"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StaggerContainer, StaggerItem } from "@/components/ui/motion";
import { SkeletonList } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Mail, Filter } from "lucide-react";
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
}

interface RecentActivityProps {
  aiEmail: string;
  initialTasks?: Task[];
}

export function RecentActivity({ aiEmail, initialTasks = [] }: RecentActivityProps) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [loading, setLoading] = useState(!initialTasks.length);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

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
        return "bg-blue-100 text-blue-800";
      case "pending":
        return "bg-yellow-100 text-yellow-800";
      case "needs_review":
        return "bg-orange-100 text-orange-800";
      case "awaiting_confirmation":
        return "bg-purple-100 text-purple-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return "OK";
      case "failed":
        return "X";
      case "processing":
        return "...";
      case "pending":
        return "o";
      case "needs_review":
        return "!";
      case "awaiting_confirmation":
        return "?";
      default:
        return "-";
    }
  };

  const getChannelBadge = (channel: string | null) => {
    switch (channel) {
      case "sms":
        return <span className="text-xs bg-cyan-100 text-cyan-700 px-1.5 py-0.5 rounded">SMS</span>;
      case "voice":
        return <span className="text-xs bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded">Voice</span>;
      case "chat":
        return <span className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">Chat</span>;
      case "proactive":
        return <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Proactive</span>;
      default:
        return null; // email is default, no badge needed
    }
  };

  const getVerificationBadge = (status: string | null) => {
    if (!status) return null;
    if (status === "verified") {
      return <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">Verified</span>;
    }
    if (status === "unverified") {
      return <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">Unverified</span>;
    }
    return null;
  };

  // Filter tasks
  const filteredTasks = tasks.filter((task) => {
    if (channelFilter !== "all" && task.input_channel !== channelFilter) return false;
    if (statusFilter !== "all" && task.status !== statusFilter) return false;
    return true;
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>
              Your latest tasks and their status
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className="text-xs border rounded-md px-2 py-1 bg-white dark:bg-stone-900"
            >
              <option value="all">All Channels</option>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
              <option value="voice">Voice</option>
              <option value="proactive">Proactive</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="text-xs border rounded-md px-2 py-1 bg-white dark:bg-stone-900"
            >
              <option value="all">All Status</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="processing">Processing</option>
              <option value="pending">Pending</option>
            </select>
            <Link href="/dashboard/activity">
              <Button variant="outline" size="sm">View All</Button>
            </Link>
          </div>
        </div>
        <div className="text-xs text-muted-foreground mt-2">
          Updated {formatTime(lastUpdate.toISOString())}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <SkeletonList count={3} variant="task" />
        ) : filteredTasks.length > 0 ? (
          <StaggerContainer className="space-y-3" staggerDelay={0.05}>
            {filteredTasks.map((task) => (
              <StaggerItem key={task.id}>
                <div
                  className={`flex items-center justify-between p-4 border rounded-lg transition-all ${
                    task.status === "processing" ? "border-blue-200 bg-blue-50/50 animate-pulse" : ""
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {task.email_subject || "Task"}
                    </p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-sm text-muted-foreground">
                        {formatTime(task.created_at)}
                      </span>
                      {getChannelBadge(task.input_channel)}
                      {task.type && (
                        <span className="text-xs bg-muted px-2 py-0.5 rounded">
                          {task.type}
                        </span>
                      )}
                      {getVerificationBadge(task.verification_status)}
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
              </StaggerItem>
            ))}
          </StaggerContainer>
        ) : (
          <EmptyState
            icon={Mail}
            title={channelFilter === "all" && statusFilter === "all" ? "No tasks yet" : "No tasks match your filters"}
            description={
              channelFilter === "all" && statusFilter === "all"
                ? `Send an email to ${aiEmail} to get started!`
                : "Try adjusting your filters to see more tasks."
            }
            action={
              channelFilter === "all" && statusFilter === "all"
                ? undefined
                : {
                    label: "Clear Filters",
                    onClick: () => {
                      setChannelFilter("all");
                      setStatusFilter("all");
                    },
                  }
            }
          />
        )}
      </CardContent>
    </Card>
  );
}
