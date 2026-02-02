import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScheduledTasks } from "@/components/scheduled-tasks";
import { RecentActivity } from "@/components/recent-activity";
import DashboardWithOnboarding from "@/components/dashboard-with-onboarding";

export default async function DashboardPage() {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  
  // Get profile data
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user?.id)
    .single();

  // Get recent tasks
  const { data: tasks } = await supabase
    .from("tasks")
    .select("*")
    .eq("user_id", user?.id)
    .order("created_at", { ascending: false })
    .limit(5);

  const username = profile?.username || user?.email?.split("@")[0] || "user";
  const aiEmail = `${username}@aevoy.com`;
  const messagesUsed = profile?.messages_used || 0;
  const messagesLimit = profile?.messages_limit || 20;

  const isBetaUser = profile?.subscription_status === 'beta';

  return (
    <DashboardWithOnboarding username={username}>
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">
            Welcome back! Here&apos;s your AI assistant overview.
          </p>
        </div>
        {isBetaUser && (
          <div className="bg-gradient-to-r from-purple-600 to-pink-600 text-white px-4 py-2 rounded-full text-sm font-semibold flex items-center gap-2">
            <span>🎉</span>
            Beta User
          </div>
        )}
      </div>

      {/* AI Email Card */}
      <Card>
        <CardHeader>
          <CardTitle>Your AI Email Address</CardTitle>
          <CardDescription>
            Send tasks to this email and your AI will handle them
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-mono bg-muted p-4 rounded-md inline-block">
            {aiEmail}
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Messages Used</CardDescription>
            <CardTitle className="text-3xl">
              {messagesUsed} / {messagesLimit}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="w-full bg-muted rounded-full h-2">
              <div 
                className="bg-primary h-2 rounded-full transition-all"
                style={{ width: `${Math.min((messagesUsed / messagesLimit) * 100, 100)}%` }}
              />
            </div>
          </CardContent>
        </Card>

        <Card className={isBetaUser ? "border-purple-300 bg-gradient-to-br from-purple-50 to-pink-50" : ""}>
          <CardHeader className="pb-2">
            <CardDescription>Plan</CardDescription>
            <CardTitle className="text-3xl capitalize">
              {isBetaUser ? "Beta" : (profile?.subscription_tier || "Free")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {isBetaUser ? "Unlimited during beta" : `${messagesLimit} messages/month`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Tasks</CardDescription>
            <CardTitle className="text-3xl">
              {tasks?.length || 0}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              All time completed
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Scheduled Tasks */}
      <ScheduledTasks />

      {/* Recent Activity with Real-time Updates */}
      <RecentActivity aiEmail={aiEmail} initialTasks={tasks || []} />
    </div>
    </DashboardWithOnboarding>
  );
}
