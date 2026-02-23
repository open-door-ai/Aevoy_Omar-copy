import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side signup using admin API.
 * Bypasses Supabase's email confirmation entirely — no rate limits, no undelivered emails.
 * Users are auto-confirmed and can log in immediately.
 */
export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    // Use service role key for admin operations
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Create user with email pre-confirmed — no confirmation email sent
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (error) {
      // Map common errors to user-friendly messages
      if (error.message.includes("already been registered") || error.message.includes("already exists")) {
        return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
      }
      console.error("[SIGNUP]", error.message);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ user: { id: data.user.id, email: data.user.email } });
  } catch (err) {
    console.error("[SIGNUP] Unexpected error:", err);
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 500 });
  }
}
