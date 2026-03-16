import { createClient } from "@/lib/supabase/server";
import DashboardWithOnboarding from "@/components/dashboard-with-onboarding";
import { TakeoverBanner } from "@/components/takeover-banner";
import { WidgetGrid } from "@/components/dashboard/widget-grid";
import type { WidgetLayoutItem } from "@/lib/widgets/default-layout";
import { DEFAULT_LAYOUT } from "@/lib/widgets/default-layout";

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

  const [{ data: profile }, { data: layoutRow }] = await Promise.all([
    supabase.from("profiles").select("username, display_name, bot_name, subscription_status").eq("id", user?.id ?? "").single(),
    supabase.from("dashboard_widget_layouts").select("layout").eq("user_id", user?.id ?? "").single(),
  ]);

  const username = profile?.username || user?.email?.split("@")[0] || "user";
  const displayName = profile?.display_name || profile?.bot_name || "there";
  const botName = profile?.bot_name || null;
  const isBetaUser = profile?.subscription_status === "beta";

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
      <div className="space-y-4 sm:space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-start sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">{getGreeting()}, {displayName}</h1>
            <p className="text-muted-foreground text-sm">
              {botName ? `${botName} is at your service` : "Here's your AI assistant overview"}
            </p>
          </div>
          {isBetaUser && (
            <div className="bg-gradient-to-r from-purple-600 to-pink-600 text-white px-4 py-2 rounded-full text-sm font-semibold flex items-center gap-2 shrink-0">
              <span>Beta User</span>
            </div>
          )}
        </div>

        {/* Takeover Banner */}
        <TakeoverBanner />

        {/* Modular Widget Grid */}
        <WidgetGrid initialLayout={layout} />
      </div>
    </DashboardWithOnboarding>
  );
}
