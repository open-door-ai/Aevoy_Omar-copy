"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AnimatePresence, motion, springs } from "@/components/ui/motion";

interface ScheduledTask {
  id: string;
  task_template: string;
  description: string;
  cron_expression: string;
  next_run_at: string;
  is_active: boolean;
  last_run_at: string | null;
  created_at: string;
}

export function ScheduledTasks() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [frequency, setFrequency] = useState("daily");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTasks();
  }, []);

  const fetchTasks = async () => {
    try {
      const response = await fetch("/api/scheduled-tasks");
      const data = await response.json();
      if (data.tasks) {
        setTasks(data.tasks.filter((t: ScheduledTask) => t.is_active));
      }
    } catch (err) {
      console.error("Error fetching scheduled tasks:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch("/api/scheduled-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_template: newTask,
          frequency,
          description: newTask.substring(0, 100),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create task");
      }

      setNewTask("");
      setShowForm(false);
      fetchTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (taskId: string) => {
    try {
      const response = await fetch(`/api/scheduled-tasks?id=${taskId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setTasks(tasks.filter((t) => t.id !== taskId));
      }
    } catch (err) {
      console.error("Error cancelling task:", err);
    }
  };

  const formatFrequency = (cron: string): string => {
    const map: Record<string, string> = {
      "0 9 * * *": "Daily at 9 AM",
      "0 9 * * 1": "Weekly on Monday",
      "0 9 * * 1-5": "Weekdays at 9 AM",
      "0 9 1 * *": "Monthly on the 1st",
      "0 * * * *": "Every hour",
    };
    return map[cron] || cron;
  };

  const formatNextRun = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = date.getTime() - now.getTime();

    if (diff < 0) return "Overdue";
    if (diff < 60 * 60 * 1000) {
      const mins = Math.round(diff / (60 * 1000));
      return `In ${mins} min${mins !== 1 ? "s" : ""}`;
    }
    if (diff < 24 * 60 * 60 * 1000) {
      const hours = Math.round(diff / (60 * 60 * 1000));
      return `In ${hours} hour${hours !== 1 ? "s" : ""}`;
    }
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Scheduled Tasks</CardTitle>
          <CardDescription>
            Recurring tasks that run automatically
          </CardDescription>
        </div>
        <Button
          variant={showForm ? "outline" : "default"}
          size="sm"
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? "Cancel" : "+ Add Task"}
        </Button>
      </CardHeader>
      <CardContent>
        <AnimatePresence>
          {showForm && (
            <motion.form
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={springs.default}
              onSubmit={handleCreate}
              className="mb-6 p-4 bg-muted rounded-lg space-y-4 overflow-hidden"
            >
              {error && (
                <div className="p-3 text-sm text-red-500 bg-red-50 border border-red-200 rounded-md">
                  {error}
                </div>
              )}
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
                  className="w-full px-3 py-2 border rounded-md bg-white"
                >
                  <option value="hourly">Every hour</option>
                  <option value="daily">Daily at 9 AM</option>
                  <option value="weekdays">Weekdays at 9 AM</option>
                  <option value="weekly">Weekly on Monday</option>
                  <option value="monthly">Monthly on the 1st</option>
                </select>
              </div>
              <Button type="submit" disabled={submitting || !newTask.trim()}>
                {submitting ? "Creating..." : "Create Scheduled Task"}
              </Button>
            </motion.form>
          )}
        </AnimatePresence>

        {loading ? (
          <div className="text-center py-8 text-muted-foreground">
            Loading scheduled tasks...
          </div>
        ) : tasks.length > 0 ? (
          <div className="space-y-3">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{task.task_template}</p>
                  <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <span>🔄</span> {formatFrequency(task.cron_expression)}
                    </span>
                    <span className="flex items-center gap-1">
                      <span>⏰</span> {formatNextRun(task.next_run_at)}
                    </span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCancel(task.id)}
                  className="text-red-500 hover:text-red-700 hover:bg-red-50"
                >
                  Cancel
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-2">No scheduled tasks</p>
            <p className="text-sm text-muted-foreground">
              Create recurring tasks that run automatically on a schedule.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
