import { NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, logAdminAction, secureResponse, secureError } from "@/lib/admin-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_TIERS = ["free", "pro", "beta", "blocked"]; // V21 fix

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth) return auth.error;

    const supabase = getAdminClient();
    const { id } = await params;

    if (!UUID_RE.test(id)) return secureError("invalid_id", 400);

    // V10 fix: Explicit column list, exclude sensitive fields like unified_pin_hash
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, username, email, display_name, timezone, subscription_tier, created_at, updated_at, last_active_at, onboarding_completed, onboarding_interview_status, messages_used, messages_limit, main_uses, daily_checkin_enabled, daily_checkin_time, phone_number")
      .eq("id", id)
      .single();

    if (!profile) return secureError("not_found", 404);

    // V26 fix: Explicit columns for settings
    const { data: settings } = await supabase
      .from("user_settings")
      .select("user_id, confirmation_mode, verification_method, agent_card_enabled, agent_card_limit_transaction, agent_card_limit_monthly, virtual_phone, proactive_enabled, proactive_channel, greeting_style")
      .eq("user_id", id)
      .single();

    const { data: wallet } = await supabase
      .from("credit_wallets")
      .select("balance_cents, lifetime_topup_cents, lifetime_spent_cents, auto_reload_enabled, auto_reload_threshold_cents, auto_reload_amount_cents, free_credits_granted")
      .eq("user_id", id)
      .single();

    const { data: tasks } = await supabase
      .from("tasks")
      .select("id, status, type, email_subject, input_channel, created_at, completed_at, cost_usd, error_message, response_text")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(50);

    const { data: costs } = await supabase
      .from("ai_cost_log")
      .select("provider, model, cost_usd, created_at")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(100);

    const totalCost = (costs || []).reduce((sum: number, c: { cost_usd: string }) => sum + parseFloat(c.cost_usd || "0"), 0);

    const { data: scheduled } = await supabase
      .from("scheduled_tasks")
      .select("id, description, cron_expression, is_active, run_count, next_run_at, created_at")
      .eq("user_id", id)
      .order("created_at", { ascending: false });

    const { data: phone } = await supabase
      .from("user_twilio_numbers")
      .select("phone_number, friendly_name, created_at")
      .eq("user_id", id)
      .limit(1);

    const { data: oauth } = await supabase
      .from("oauth_connections")
      .select("provider, scope, created_at, updated_at")
      .eq("user_id", id);

    await logAdminAction(auth.session.id, "view_user", "user", id);

    return secureResponse({
      profile,
      settings,
      wallet,
      tasks: tasks || [],
      costs: costs || [],
      totalCost,
      scheduled: scheduled || [],
      phone: phone?.[0] || null,
      oauth: oauth || [],
    });
  } catch (err) {
    console.error("Admin user detail error:", err instanceof Error ? err.message : "unknown");
    return secureError("internal_error", 500);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth) return auth.error;

    const supabase = getAdminClient();
    const { id } = await params;

    if (!UUID_RE.test(id)) return secureError("invalid_id", 400);

    // V08 fix: Wrap json parse in try/catch
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return secureError("bad_request", 400);
    }

    const updates: Record<string, unknown> = {};

    // V21 fix: Type-validate each field
    if (body.blocked === true) {
      updates.subscription_tier = "blocked";
    } else if (body.blocked === false) {
      updates.subscription_tier = "free";
    } else if (typeof body.subscription_tier === "string" && VALID_TIERS.includes(body.subscription_tier)) {
      updates.subscription_tier = body.subscription_tier;
    }

    if (typeof body.messages_limit === "number" && body.messages_limit >= 0 && body.messages_limit <= 100000) {
      updates.messages_limit = Math.floor(body.messages_limit);
    }

    if (typeof body.onboarding_completed === "boolean") {
      updates.onboarding_completed = body.onboarding_completed;
    }

    if (Object.keys(updates).length === 0) {
      return secureError("no_changes", 400);
    }

    updates.updated_at = new Date().toISOString();

    const { error } = await supabase.from("profiles").update(updates).eq("id", id);
    if (error) return secureError("update_failed", 500);

    const action = updates.subscription_tier === "blocked" ? "block_user" : "update_user";
    await logAdminAction(auth.session.id, action, "user", id, JSON.stringify(updates));

    return secureResponse({ success: true });
  } catch (err) {
    console.error("Admin user update error:", err instanceof Error ? err.message : "unknown");
    return secureError("internal_error", 500);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth) return auth.error;

    const supabase = getAdminClient();
    const { id } = await params;

    if (!UUID_RE.test(id)) return secureError("invalid_id", 400);

    // Verify user exists before deleting
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, username, email")
      .eq("id", id)
      .single();

    if (!profile) return secureError("not_found", 404);

    // Delete associated data in order (foreign key safe)
    const deletions = [
      supabase.from("user_twilio_numbers").delete().eq("user_id", id),
      supabase.from("ai_cost_log").delete().eq("user_id", id),
      supabase.from("scheduled_tasks").delete().eq("user_id", id),
      supabase.from("oauth_connections").delete().eq("user_id", id),
      supabase.from("credit_wallets").delete().eq("user_id", id),
      supabase.from("user_settings").delete().eq("user_id", id),
      supabase.from("tasks").delete().eq("user_id", id),
    ];

    const results = await Promise.all(deletions);
    const errors = results.filter(r => r.error);
    if (errors.length > 0) {
      console.error("Admin delete partial errors:", errors.map(e => e.error?.message));
    }

    // Delete the profile last
    const { error: profileErr } = await supabase.from("profiles").delete().eq("id", id);
    if (profileErr) {
      console.error("Admin delete profile error:", profileErr.message);
      return secureError("delete_failed", 500);
    }

    await logAdminAction(auth.session.id, "delete_user", "user", id, `Deleted user: ${profile.username} (${profile.email})`);

    return secureResponse({ success: true, deleted: { username: profile.username, email: profile.email } });
  } catch (err) {
    console.error("Admin user delete error:", err instanceof Error ? err.message : "unknown");
    return secureError("internal_error", 500);
  }
}
