import { NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, logAdminAction, getClientIP, secureResponse, secureError } from "@/lib/admin-auth";
import bcrypt from "bcryptjs";

// Kill switch requires:
// 1. Valid admin session
// 2. Password re-entry
// 3. Typed confirmation phrase
// 4. 4 sequential confirmations with increasing severity

const KILLSWITCH_MAX_PASSWORD_ATTEMPTS = 3;
const KILLSWITCH_LOCKOUT_MINUTES = 30;

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;

  const supabase = getAdminClient();

  // V20 fix: Use distributed_locks as single source of truth
  const { data: lock } = await supabase
    .from("distributed_locks")
    .select("locked_at")
    .eq("lock_name", "api_killswitch")
    .single();

  return secureResponse({
    active: !!lock,
    since: lock?.locked_at || null,
  });
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth) return auth.error;

    let body: {
      action?: "activate" | "deactivate";
      password?: string;
      confirmPhrase?: string;
      confirmations?: number;
    };

    try {
      body = await request.json();
    } catch {
      return secureError("bad_request", 400);
    }

    const { action, password, confirmPhrase, confirmations } = body;
    const supabase = getAdminClient();
    const ip = getClientIP(request);

    // V06 fix: Rate limit password attempts on killswitch
    async function checkKsPasswordAttempts(): Promise<boolean> {
      const since = new Date(Date.now() - KILLSWITCH_LOCKOUT_MINUTES * 60000).toISOString();
      const { count } = await supabase
        .from("admin_login_attempts")
        .select("*", { count: "exact", head: true })
        .eq("ip_address", ip)
        .eq("success", false)
        .gte("attempted_at", since);
      return (count || 0) < KILLSWITCH_MAX_PASSWORD_ATTEMPTS;
    }

    async function logKsAttempt(success: boolean) {
      await supabase.from("admin_login_attempts").insert({
        ip_address: ip,
        success,
        fingerprint: `killswitch_${action}`,
      });
    }

    if (action === "activate") {
      if (!password || typeof password !== "string") {
        return secureResponse({ error: "password_required", message: "Re-enter your admin password" }, 400);
      }

      if (!await checkKsPasswordAttempts()) {
        return secureResponse({ error: "locked", message: "Too many failed attempts. Wait 30 minutes." }, 429);
      }

      const adminHash = process.env.ADMIN_PASSWORD_HASH;
      if (!adminHash) {
        await bcrypt.compare(password, "$2b$12$invalidhashpaddingtomatchlength00000000");
        return secureError("unauthorized", 401);
      }

      const isValid = await bcrypt.compare(password, adminHash);
      await logKsAttempt(isValid);

      if (!isValid) {
        return secureResponse({ error: "invalid_password", message: "Incorrect password" }, 401);
      }

      if (confirmPhrase !== "SHUTDOWN API") {
        return secureResponse({
          error: "confirmation_required",
          message: 'Type "SHUTDOWN API" to confirm',
        }, 400);
      }

      if (typeof confirmations !== "number" || confirmations < 4) {
        return secureResponse({
          error: "insufficient_confirmations",
          message: `Need 4 confirmations, got ${confirmations || 0}`,
          required: 4,
        }, 400);
      }

      await logAdminAction(auth.session.id, "killswitch_on", "system", undefined, "API kill switch activated");

      await supabase.from("distributed_locks").upsert({
        lock_name: "api_killswitch",
        locked_by: "admin",
        locked_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 365 * 86400000).toISOString(),
      });

      return secureResponse({ success: true, active: true, message: "API kill switch activated. All task processing halted." });
    }

    if (action === "deactivate") {
      if (!password || typeof password !== "string") {
        return secureResponse({ error: "password_required" }, 400);
      }

      if (!await checkKsPasswordAttempts()) {
        return secureResponse({ error: "locked", message: "Too many failed attempts. Wait 30 minutes." }, 429);
      }

      const adminHash = process.env.ADMIN_PASSWORD_HASH;
      if (!adminHash) {
        await bcrypt.compare(password, "$2b$12$invalidhashpaddingtomatchlength00000000");
        return secureError("unauthorized", 401);
      }

      const isValid = await bcrypt.compare(password, adminHash);
      await logKsAttempt(isValid);

      if (!isValid) {
        return secureResponse({ error: "invalid_password", message: "Incorrect password" }, 401);
      }

      await logAdminAction(auth.session.id, "killswitch_off", "system", undefined, "API kill switch deactivated");
      await supabase.from("distributed_locks").delete().eq("lock_name", "api_killswitch");

      return secureResponse({ success: true, active: false, message: "API kill switch deactivated. Task processing resumed." });
    }

    return secureError("invalid_action", 400);
  } catch (err) {
    console.error("Killswitch error:", err instanceof Error ? err.message : "unknown");
    return secureError("internal_error", 500);
  }
}
