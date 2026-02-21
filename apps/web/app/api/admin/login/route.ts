import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

const MAX_ATTEMPTS = 6;
const LOCKOUT_HOURS = 24;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
    const body = await request.json();
    const { password } = body;

    if (!password) return NextResponse.json({ error: "bad_request" }, { status: 400 });

    // Check lockout: count failed attempts in last 24h
    const lockoutStart = new Date(Date.now() - LOCKOUT_HOURS * 3600000).toISOString();
    const { count: failCount } = await supabase.from("admin_login_attempts")
      .select("*", { count: "exact", head: true })
      .eq("ip_address", ip)
      .eq("success", false)
      .gte("attempted_at", lockoutStart);

    const remaining = MAX_ATTEMPTS - (failCount || 0);
    if (remaining <= 0) {
      return NextResponse.json({
        error: "locked",
        message: "Account locked due to too many failed attempts. Contact system administrator.",
        attemptsRemaining: 0,
      }, { status: 429 });
    }

    // Verify password against ADMIN_PASSWORD_HASH env var
    const adminHash = process.env.ADMIN_PASSWORD_HASH;
    if (!adminHash) {
      return NextResponse.json({ error: "config_error", message: "Admin not configured" }, { status: 503 });
    }

    const isValid = await bcrypt.compare(password, adminHash);

    // Log attempt
    await supabase.from("admin_login_attempts").insert({ ip_address: ip, success: isValid });

    if (!isValid) {
      return NextResponse.json({
        error: "invalid_password",
        message: "Incorrect password",
        attemptsRemaining: remaining - 1,
      }, { status: 401 });
    }

    // Create admin session
    const sessionToken = randomBytes(48).toString("hex");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    await supabase.from("admin_sessions").insert({
      session_token: sessionToken,
      ip_address: ip,
      expires_at: expiresAt,
      last_activity_at: new Date().toISOString(),
    });

    const response = NextResponse.json({ success: true });
    response.cookies.set("admin-session", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 30 * 60,
      path: "/",
    });
    return response;
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
