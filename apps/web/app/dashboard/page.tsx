import { createClient } from "@/lib/supabase/server";
import DashboardWithOnboarding from "@/components/dashboard-with-onboarding";
import { TakeoverBanner } from "@/components/takeover-banner";
import { WidgetGrid } from "@/components/dashboard/widget-grid";
import type { WidgetLayoutItem } from "@/lib/widgets/default-layout";
import { DEFAULT_LAYOUT } from "@/lib/widgets/default-layout";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: profile }, { data: layoutRow }] = await Promise.all([
    supabase.from("profiles").select("username, display_name, bot_name, subscription_status").eq("id", user?.id ?? "").single(),
    supabase.from("dashboard_widget_layouts").select("layout").eq("user_id", user?.id ?? "").single(),
  ]);

  const username = profile?.username || user?.email?.split("@")[0] || "user";
  const botName = profile?.bot_name || null;
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
        {/* Takeover Banner — thin, top of page */}
        <TakeoverBanner />

        {/* Hero Greeting — warm, action-oriented */}
        <div className="pt-2 sm:pt-4">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
            What can {botName || "your AI"} do for you?
          </h1>
        </div>

        {/* Modular Widget Grid */}
        <WidgetGrid initialLayout={layout} />
      </div>
    </DashboardWithOnboarding>
  );
}
