import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getClientIP, getFingerprint, hashToken, logAdminAction, secureResponse, secureError } from "@/lib/admin-auth";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

const MAX_ATTEMPTS = 4;
const LOCKOUT_HOURS = 24;
const SESSION_DURATION_MS = 30 * 60 * 1000;

export async function POST(request: NextRequest) {
  try {
    // V13: Validate content-type
    const ct = request.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return secureError("unsupported_media_type", 415);
    }

    const supabase = getAdminClient();
    const ip = getClientIP(request);
    const fingerprint = getFingerprint(request);

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

    // Check lockout
    const lockoutStart = new Date(Date.now() - LOCKOUT_HOURS * 3600000).toISOString();
    const { count: failCount } = await supabase
      .from("admin_login_attempts")
      .select("*", { count: "exact", head: true })
      .eq("ip_address", ip)
      .eq("success", false)
      .gte("attempted_at", lockoutStart);

    const remaining = MAX_ATTEMPTS - (failCount || 0);

    // V18 fix: Always run bcrypt even if locked out to normalize timing
    const isValid = await bcrypt.compare(password, adminHash);

    if (remaining <= 0) {
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
      fingerprint,
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

    const { data: newSession } = await supabase.from("admin_sessions").insert({
      session_token: tokenHash,
      ip_address: ip,
      fingerprint,
      expires_at: expiresAt,
      last_activity_at: new Date().toISOString(),
    }).select("id").single();

    // V11 fix: Link audit log to session
    await logAdminAction(newSession?.id, "login", undefined, undefined, `IP: ${ip}`);

    const response = secureResponse({ success: true });
    response.cookies.set("admin-session", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: SESSION_DURATION_MS / 1000,
      path: "/", // Cookie needs to reach both /admin and /api/admin routes
    });

    return response;
  } catch (err) {
    // V33 fix: Don't log raw error objects
    console.error("Admin login error:", err instanceof Error ? err.message : "unknown");
    return secureError("internal_error", 500);
  }
}
