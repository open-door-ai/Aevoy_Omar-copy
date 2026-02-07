import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScheduledTasks } from "@/components/scheduled-tasks";
import { RecentActivity } from "@/components/recent-activity";
import DashboardWithOnboarding from "@/components/dashboard-with-onboarding";
import { StaggerContainer, StaggerItem, GlassCard } from "@/components/ui/motion";
import { SkeletonCard } from "@/components/ui/skeleton";
import { Suspense } from "react";
import { SendTaskInput } from "@/components/send-task-input";

export const dynamic = "force-dynamic";

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

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

  // Get today's tasks count
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const { count: todayCount } = await supabase
    .from("tasks")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user?.id)
    .gte("created_at", todayStart.toISOString());

  // Get this week's tasks count
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const { count: weekCount } = await supabase
    .from("tasks")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user?.id)
    .gte("created_at", weekStart.toISOString());

  // Get active tasks count
  const { count: activeCount } = await supabase
    .from("tasks")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user?.id)
    .in("status", ["pending", "processing"]);

  const username = profile?.username || user?.email?.split("@")[0] || "user";
  const botName = profile?.bot_name || null;
  const aiEmail = `${username}@aevoy.com`;
  const messagesUsed = profile?.messages_used || 0;
  const messagesLimit = profile?.messages_limit || 20;
  const twilioNumber = profile?.twilio_number || null;

  const isBetaUser = profile?.subscription_status === 'beta';

  const monthlyCost = ((usage?.ai_cost_cents || 0) / 100).toFixed(2);
  const usagePercent = Math.min((messagesUsed / messagesLimit) * 100, 100);

  return (
    <DashboardWithOnboarding username={username}>
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{getGreeting()}, {username}</h1>
          <p className="text-muted-foreground">
            {botName ? `${botName} is at your service` : "Here's your AI assistant overview"}
          </p>
        </div>
        {isBetaUser && (
          <div
            className="bg-gradient-to-r from-purple-600 to-pink-600 text-white px-4 py-2 rounded-full text-sm font-semibold flex items-center gap-2 animate-[badge-pulse_2s_ease-in-out_infinite_3s]"
          >
            <span>Beta User</span>
          </div>
        )}
      </div>

      {/* Send Task Input */}
      <Suspense fallback={<SkeletonCard />}>
        <SendTaskInput />
      </Suspense>

      {/* Quick Stats */}
      <StaggerContainer className="grid grid-cols-2 md:grid-cols-4 gap-4" staggerDelay={0.08}>
        <StaggerItem>
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-sm text-muted-foreground">Tasks Today</p>
              <p className="text-2xl font-bold">{todayCount || 0}</p>
            </CardContent>
          </Card>
        </StaggerItem>
        <StaggerItem>
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-sm text-muted-foreground">This Week</p>
              <p className="text-2xl font-bold">{weekCount || 0}</p>
            </CardContent>
          </Card>
        </StaggerItem>
        <StaggerItem>
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-sm text-muted-foreground">Active Tasks</p>
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{activeCount || 0}</p>
            </CardContent>
          </Card>
        </StaggerItem>
        <StaggerItem>
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-sm text-muted-foreground">Monthly Cost</p>
              <p className="text-2xl font-bold">${monthlyCost}</p>
            </CardContent>
          </Card>
        </StaggerItem>
      </StaggerContainer>

      {/* Contact Info Cards */}
      <StaggerContainer className="grid md:grid-cols-2 gap-4" staggerDelay={0.08}>
        <StaggerItem>
          <GlassCard className="p-6">
            <div className="space-y-1 mb-4">
              <h3 className="text-sm font-medium text-muted-foreground">{botName ? `${botName}'s Email` : "Your AI Email"}</h3>
              <p className="text-xs text-muted-foreground/70">Send tasks via email</p>
            </div>
            <div className="text-2xl font-mono bg-muted p-4 rounded-xl inline-block border border-border">
              {aiEmail}
            </div>
          </GlassCard>
        </StaggerItem>

        {twilioNumber && (
          <StaggerItem>
            <GlassCard className="p-6">
              <div className="space-y-1 mb-4">
                <h3 className="text-sm font-medium text-muted-foreground">Your AI Phone</h3>
                <p className="text-xs text-muted-foreground/70">Call or text tasks</p>
              </div>
              <div className="text-2xl font-mono bg-muted p-4 rounded-xl inline-block border border-border">
                {twilioNumber}
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                Voice + SMS enabled
              </p>
            </GlassCard>
          </StaggerItem>
        )}
      </StaggerContainer>

      {/* Usage */}
      <StaggerContainer className="grid md:grid-cols-2 gap-4" staggerDelay={0.08} delayStart={0.2}>
        <StaggerItem>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Messages Used</CardDescription>
              <CardTitle className="text-3xl">
                {messagesUsed} / {messagesLimit}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                <div
                  className="bg-primary h-2 rounded-full animate-[progress-fill_1s_ease-out_0.3s_both]"
                  style={{ width: `${usagePercent}%` }}
                />
              </div>
            </CardContent>
          </Card>
        </StaggerItem>

        <StaggerItem>
          <Card className={isBetaUser ? "border-purple-300 dark:border-purple-700 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-950/30 dark:to-pink-950/30" : ""}>
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
        </StaggerItem>
      </StaggerContainer>

      {/* Scheduled Tasks */}
      <ScheduledTasks />

      {/* Recent Activity with Real-time Updates */}
      <RecentActivity aiEmail={aiEmail} initialTasks={tasks || []} />
    </div>
    </DashboardWithOnboarding>
  );
}
