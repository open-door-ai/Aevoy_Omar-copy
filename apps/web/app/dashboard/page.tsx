import { createClient } from "@/lib/supabase/server";
import DashboardWithOnboarding from "@/components/dashboard-with-onboarding";
import { TakeoverBanner } from "@/components/takeover-banner";
import { WidgetGrid } from "@/components/dashboard/widget-grid";
import type { WidgetLayoutItem } from "@/lib/widgets/default-layout";
import { DEFAULT_LAYOUT } from "@/lib/widgets/default-layout";

export const dynamic = "force-dynamic";

function formatTimeSaved(taskCount: number): string {
  const minutesSaved = taskCount * 15;
  if (minutesSaved >= 60) {
    const hours = Math.round(minutesSaved / 60 * 10) / 10;
    return `~${hours} hour${hours !== 1 ? "s" : ""}`;
  }
  return `~${minutesSaved} min`;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);

  const [{ data: profile }, { data: layoutRow }, { count: weeklyCompleted }] = await Promise.all([
    supabase.from("profiles").select("username, display_name, bot_name, subscription_status").eq("id", user?.id ?? "").single(),
    supabase.from("dashboard_widget_layouts").select("layout").eq("user_id", user?.id ?? "").single(),
    supabase.from("tasks").select("*", { count: "exact", head: true }).eq("user_id", user?.id ?? "").eq("status", "completed").gte("created_at", weekStart.toISOString()),
  ]);

  const username = profile?.username || user?.email?.split("@")[0] || "user";
  const botName = profile?.bot_name || null;
  const completedThisWeek = weeklyCompleted || 0;
  // Use saved layout or default
  let layout: WidgetLayoutItem[] = [];
  if (layoutRow?.layout && Array.isArray(layoutRow.layout) && layoutRow.layout.length > 0) {
    layout = layoutRow.layout as WidgetLayoutItem[];
  } else {
    layout = DEFAULT_LAYOUT.map(item => ({
      id: crypto.randomUUID(),
      ...item,
    }));
  }

  return (
    <DashboardWithOnboarding username={username}>
      <div className="space-y-6 sm:space-y-8 max-w-4xl mx-auto">
        {/* Maintenance banner — remove when done */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-center">
          <p className="text-sm text-amber-800 font-medium">
            Aevoy is under maintenance — systems may be temporarily slow. We&apos;re making things better.
          </p>
        </div>

        {/* Takeover Banner — thin, top of page */}
        <TakeoverBanner />

        {/* Hero Greeting — warm, action-oriented */}
        <div className="pt-2 sm:pt-4">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
            What can {botName || "your AI"} do for you?
          </h1>
          {completedThisWeek > 0 && (
            <p className="text-sm text-muted-foreground mt-1">
              {completedThisWeek} task{completedThisWeek !== 1 ? "s" : ""} completed this week — saving you {formatTimeSaved(completedThisWeek)}
            </p>
          )}
        </div>

        {/* Modular Widget Grid */}
        <WidgetGrid initialLayout={layout} />
      </div>
    </DashboardWithOnboarding>
  );
}
