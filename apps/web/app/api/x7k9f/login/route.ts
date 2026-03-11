import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getClientIP, hashToken, logAdminAction, secureResponse, secureError } from "@/lib/admin-auth";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

const MAX_ATTEMPTS = 3;
const LOCKOUT_HOURS = 48;
const SESSION_DURATION_MS = 30 * 60 * 1000;
const GLOBAL_MAX_ATTEMPTS = 15; // Total failed attempts from ALL IPs in window → full lockdown

export async function POST(request: NextRequest) {
  try {
    // V13: Validate content-type
    const ct = request.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return secureError("unsupported_media_type", 415);
    }

    const supabase = getAdminClient();
    const ip = getClientIP(request);

    let body: { password?: string };
    try {
      body = await request.json();
    } catch {
      return secureError("bad_request", 400);
    }

    const { password } = body;
    if (!password || typeof password !== "string" || password.length > 128) {
      return secureError("bad_request", 400);
    }

    // V19 fix: Don't reveal config state
    const adminHash = process.env.ADMIN_PASSWORD_HASH;
    if (!adminHash) {
      // V18 fix: Always run bcrypt to normalize timing
      await bcrypt.compare(password, "$2b$12$invalidhashpaddingtomatchlength00000000");
      return secureError("unauthorized", 401);
    }

    // Check lockout — per-IP and global
    const lockoutStart = new Date(Date.now() - LOCKOUT_HOURS * 3600000).toISOString();
    const [{ count: failCount }, { count: globalFailCount }] = await Promise.all([
      supabase
        .from("admin_login_attempts")
        .select("*", { count: "exact", head: true })
        .eq("ip_address", ip)
        .eq("success", false)
        .gte("attempted_at", lockoutStart),
      supabase
        .from("admin_login_attempts")
        .select("*", { count: "exact", head: true })
        .eq("success", false)
        .gte("attempted_at", new Date(Date.now() - 3600000).toISOString()), // 1hr window for global
    ]);

    const remaining = MAX_ATTEMPTS - (failCount || 0);
    const globalLocked = (globalFailCount || 0) >= GLOBAL_MAX_ATTEMPTS;

    // V18 fix: Always run bcrypt even if locked out to normalize timing
    const isValid = await bcrypt.compare(password, adminHash);

    if (remaining <= 0 || globalLocked) {
      return secureResponse({
        error: "locked",
        message: "Access locked. Try again later.",
        attemptsRemaining: 0,
      }, 429);
    }

    // Log attempt
    await supabase.from("admin_login_attempts").insert({
      ip_address: ip,
      success: isValid,
    });

    if (!isValid) {
      return secureResponse({
        error: "invalid_password",
        message: "Incorrect password",
        attemptsRemaining: remaining - 1,
      }, 401);
    }

    // V36 fix: Clear failed attempts on successful login
    await supabase
      .from("admin_login_attempts")
      .delete()
      .eq("ip_address", ip)
      .eq("success", false)
      .gte("attempted_at", lockoutStart);

    // Invalidate existing sessions for this IP (single-session enforcement)
    await supabase.from("admin_sessions").delete().eq("ip_address", ip);

    // Create new session — V03 fix: store hash, not plaintext
    const sessionToken = randomBytes(48).toString("hex");
    const tokenHash = hashToken(sessionToken);
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

    const { data: newSession, error: insertError } = await supabase.from("admin_sessions").insert({
      session_token: tokenHash,
      ip_address: ip,
      expires_at: expiresAt,
      last_activity_at: new Date().toISOString(),
    }).select("id").single();

    if (insertError || !newSession) {
      console.error("Session insert failed:", insertError?.message || "no data");
      return secureError("internal_error", 500);
    }

    // V11 fix: Link audit log to session
    await logAdminAction(newSession.id, "login", undefined, undefined, `IP: ${ip}`);

    const response = secureResponse({ success: true });
    response.cookies.set("admin-session", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: SESSION_DURATION_MS / 1000,
      path: "/",
    });

    return response;
  } catch (err) {
    // V33 fix: Don't log raw error objects
    console.error("Admin login error:", err instanceof Error ? err.message : "unknown");
    return secureError("internal_error", 500);
  }
}
