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
    .limit(10);

  // Get usage stats for current month
  const currentMonth = new Date().toISOString().slice(0, 7);
  const { data: usage } = await supabase
    .from("usage")
    .select("*")
    .eq("user_id", user?.id)
    .eq("month", currentMonth)
    .single();

  const username = profile?.username || user?.email?.split("@")[0] || "user";
  const aiEmail = `${username}@aevoy.com`;
  const messagesUsed = profile?.messages_used || 0;
  const messagesLimit = profile?.messages_limit || 20;
  const twilioNumber = profile?.twilio_number || null;

  const isBetaUser = profile?.subscription_status === 'beta';

  // Count tasks by input channel
  const emailTasks = tasks?.filter(t => !t.input_channel || t.input_channel === 'email').length || 0;
  const smsTasks = tasks?.filter(t => t.input_channel === 'sms').length || 0;
  const voiceTasks = tasks?.filter(t => t.input_channel === 'voice').length || 0;

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
            <span>Beta User</span>
          </div>
        )}
      </div>

      {/* Contact Info Cards */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Your AI Email</CardTitle>
            <CardDescription>
              Send tasks via email
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-mono bg-muted p-4 rounded-md inline-block">
              {aiEmail}
            </div>
          </CardContent>
        </Card>

        {twilioNumber && (
          <Card>
            <CardHeader>
              <CardTitle>Your AI Phone</CardTitle>
              <CardDescription>
                Call or text tasks
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-mono bg-muted p-4 rounded-md inline-block">
                {twilioNumber}
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                Voice + SMS enabled
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Stats */}
      <div className="grid md:grid-cols-4 gap-4">
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

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>AI Cost (Month)</CardDescription>
            <CardTitle className="text-3xl">
              ${((usage?.ai_cost_cents || 0) / 100).toFixed(2)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {currentMonth}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Channel Breakdown */}
      {(smsTasks > 0 || voiceTasks > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Task Channels</CardTitle>
            <CardDescription>How tasks are being submitted</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-6">
              <div className="text-center">
                <div className="text-2xl font-bold">{emailTasks}</div>
                <div className="text-sm text-muted-foreground">Email</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">{smsTasks}</div>
                <div className="text-sm text-muted-foreground">SMS</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">{voiceTasks}</div>
                <div className="text-sm text-muted-foreground">Voice</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Scheduled Tasks */}
      <ScheduledTasks />

      {/* Recent Activity with Real-time Updates */}
      <RecentActivity aiEmail={aiEmail} initialTasks={tasks || []} />
    </div>
    </DashboardWithOnboarding>
  );
}
