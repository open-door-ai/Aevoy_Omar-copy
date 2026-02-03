import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  
  // Get all tasks with pagination
  const { data: tasks, count } = await supabase
    .from("tasks")
    .select("*", { count: "exact" })
    .eq("user_id", user?.id)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Activity</h1>
        <p className="text-muted-foreground">
          View all your tasks and their history
        </p>
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
            <div className="space-y-4">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between p-4 border rounded-md"
                >
                  <div className="flex-1">
                    <p className="font-medium">{task.email_subject || "Task"}</p>
                    <div className="flex gap-4 text-sm text-muted-foreground">
                      <span>Type: {task.type || "general"}</span>
                      <span>
                        Created: {new Date(task.created_at).toLocaleString()}
                      </span>
                      {task.completed_at && (
                        <span>
                          Completed: {new Date(task.completed_at).toLocaleString()}
                        </span>
                      )}
                    </div>
                    {task.error_message && (
                      <p className="text-sm text-red-500 mt-1">
                        Error: {task.error_message}
                      </p>
                    )}
                  </div>
                  <span
                    className={`px-2 py-1 text-xs rounded-full shrink-0 ${
                      task.status === "completed"
                        ? "bg-green-100 text-green-800"
                        : task.status === "failed"
                        ? "bg-red-100 text-red-800"
                        : task.status === "processing"
                        ? "bg-blue-100 text-blue-800"
                        : "bg-yellow-100 text-yellow-800"
                    }`}
                  >
                    {task.status}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No tasks yet</p>
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
