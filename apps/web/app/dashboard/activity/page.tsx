import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";

export const dynamic = "force-dynamic";

function getStatusColor(status: string) {
  switch (status) {
    case "completed":
      return "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300";
    case "failed":
      return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300";
    case "processing":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300";
    case "pending":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300";
    case "needs_review":
      return "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300";
    case "awaiting_confirmation":
      return "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300";
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-800/40 dark:text-gray-300";
  }
}

function getStatusIcon(status: string) {
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
}

function getChannelBadge(channel: string | null) {
  switch (channel) {
    case "sms":
      return "SMS";
    case "voice":
      return "Voice";
    case "web":
      return "Web";
    case "chat":
      return "Chat";
    case "proactive":
      return "Proactive";
    default:
      return null;
  }
}

function getChannelBadgeColor(channel: string | null) {
  switch (channel) {
    case "sms":
      return "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300";
    case "voice":
      return "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300";
    case "web":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
    case "chat":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
    case "proactive":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
    default:
      return "";
  }
}

function formatDuration(createdAt: string, completedAt: string | null): string {
  if (!completedAt) return "-";
  const start = new Date(createdAt).getTime();
  const end = new Date(completedAt).getTime();
  const diff = end - start;
  if (diff < 1000) return "<1s";
  if (diff < 60 * 1000) return `${Math.round(diff / 1000)}s`;
  if (diff < 60 * 60 * 1000) {
    const mins = Math.floor(diff / (60 * 1000));
    const secs = Math.round((diff % (60 * 1000)) / 1000);
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(diff / (60 * 60 * 1000));
  const mins = Math.round((diff % (60 * 60 * 1000)) / (60 * 1000));
  return `${hours}h ${mins}m`;
}

export default async function ActivityPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();

  // Get all tasks with pagination
  const { data: tasks, count } = await supabase
    .from("tasks")
    .select("*", { count: "exact" })
    .eq("user_id", user?.id)
    .order("created_at", { ascending: false });

  // Calculate summary stats
  const completed = tasks?.filter((t) => t.status === "completed").length || 0;
  const failed = tasks?.filter((t) => t.status === "failed").length || 0;
  const totalCost = tasks?.reduce((sum, t) => sum + (t.cost_usd || 0), 0) || 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Activity</h1>
        <p className="text-muted-foreground">
          View all your tasks and their history
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground">Total Tasks</p>
            <p className="text-2xl font-bold">{count || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground">Completed</p>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">{completed}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground">Failed</p>
            <p className="text-2xl font-bold text-red-600 dark:text-red-400">{failed}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground">Total Cost</p>
            <p className="text-2xl font-bold">${totalCost.toFixed(4)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Tasks</CardTitle>
          <CardDescription>
            {count || 0} total tasks
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tasks && tasks.length > 0 ? (
            <div className="space-y-3">
              {tasks.map((task) => {
                const channelLabel = getChannelBadge(task.input_channel);
                return (
                  <Link
                    key={task.id}
                    href={`/dashboard/tasks/${task.id}`}
                    className="block"
                  >
                    <div
                      className={`flex items-center justify-between p-4 border rounded-lg transition-all hover:bg-muted/50 hover:border-primary/30 cursor-pointer ${
                        task.status === "processing"
                          ? "border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20"
                          : ""
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{task.email_subject || "Task"}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className="text-sm text-muted-foreground">
                            {new Date(task.created_at).toLocaleString()}
                          </span>
                          {channelLabel && (
                            <span className={`text-xs px-1.5 py-0.5 rounded ${getChannelBadgeColor(task.input_channel)}`}>
                              {channelLabel}
                            </span>
                          )}
                          {task.type && (
                            <span className="text-xs bg-muted px-2 py-0.5 rounded">
                              {task.type}
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {formatDuration(task.created_at, task.completed_at)}
                          </span>
                          {task.cost_usd != null && task.cost_usd > 0 && (
                            <span className="text-xs text-muted-foreground">
                              ${task.cost_usd.toFixed(4)}
                            </span>
                          )}
                        </div>
                        {task.status === "completed" && !task.error_message && (
                          <p className="text-xs text-green-600 dark:text-green-400 mt-1.5 truncate">
                            Completed successfully{task.tokens_used ? ` (${task.tokens_used.toLocaleString()} tokens)` : ""}
                          </p>
                        )}
                        {task.error_message && (
                          <p className="text-xs text-red-500 mt-1.5 truncate">
                            {task.error_message}
                          </p>
                        )}
                        {task.status === "processing" && (
                          <p className="text-xs text-blue-600 dark:text-blue-400 mt-1.5">
                            Processing now...
                          </p>
                        )}
                        {(task.status === "awaiting_confirmation" || task.status === "needs_review") && (
                          <p className="text-xs text-orange-600 dark:text-orange-400 mt-1.5">
                            Waiting for your response
                          </p>
                        )}
                      </div>
                      <span
                        className={`px-3 py-1 text-xs rounded-full shrink-0 flex items-center gap-1 ${getStatusColor(
                          task.status
                        )}`}
                      >
                        <span>{getStatusIcon(task.status)}</span>
                        {task.status}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12">
              <div className="p-4 bg-muted rounded-2xl inline-block mb-4">
                <svg
                  className="w-10 h-10 text-muted-foreground"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-1">No tasks yet</h3>
              <p className="text-sm text-muted-foreground">
                Send an email to your AI to create your first task
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
