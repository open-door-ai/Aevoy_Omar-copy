import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

/**
 * In-memory rate limiter: max 5 signups per IP per hour.
 * Map<ip, timestamp[]>
 */
const signupAttempts = new Map<string, number[]>();
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// Cleanup stale entries every 10 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of signupAttempts.entries()) {
    const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (recent.length === 0) {
      signupAttempts.delete(ip);
    } else {
      signupAttempts.set(ip, recent);
    }
  }
}, 10 * 60 * 1000);

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const attempts = (signupAttempts.get(ip) || []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );
  signupAttempts.set(ip, attempts);
  return attempts.length >= RATE_LIMIT_MAX;
}

function recordAttempt(ip: string): void {
  const attempts = signupAttempts.get(ip) || [];
  attempts.push(Date.now());
  signupAttempts.set(ip, attempts);
}

/** Basic email format check — not exhaustive, just catches obvious junk */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Server-side signup using admin API.
 * Bypasses Supabase's email confirmation entirely — no rate limits, no undelivered emails.
 * Users are auto-confirmed and can log in immediately.
 */
export async function POST(req: NextRequest) {
  try {
    // Rate limit by IP
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";

    if (isRateLimited(ip)) {
      return NextResponse.json(
        { error: "Too many signup attempts. Please try again later." },
        { status: 429 }
      );
    }

    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password required" },
        { status: 400 }
      );
    }

    // Validate email format
    if (typeof email !== "string" || !EMAIL_REGEX.test(email)) {
      return NextResponse.json(
        { error: "Please enter a valid email address" },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    // Record attempt before hitting Supabase (counts even failed ones)
    recordAttempt(ip);

    // Use service role key for admin operations
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Create user with email pre-confirmed — no confirmation email sent
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: email.toLowerCase().trim(),
      password,
      email_confirm: true,
    });

    if (error) {
      // Map common errors to user-friendly messages
      if (
        error.message.includes("already been registered") ||
        error.message.includes("already exists")
      ) {
        return NextResponse.json(
          { error: "An account with this email already exists" },
          { status: 409 }
        );
      }
      console.error("[SIGNUP]", error.message);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      user: { id: data.user.id, email: data.user.email },
    });
  } catch (err) {
    console.error("[SIGNUP] Unexpected error:", err);
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
