import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/encryption";

// GET /api/credentials - List stored credentials (service names only, no passwords)
export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "unauthorized", message: "Not logged in" },
        { status: 401 }
      );
    }

    const { data: credentials, error } = await supabase
      .from("credential_vault")
      .select("id, site_domain, username, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: "internal_error", message: "Failed to fetch credentials" },
        { status: 500 }
      );
    }

    return NextResponse.json({ credentials: credentials || [] });
  } catch {
    return NextResponse.json(
      { error: "internal_error", message: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}

// POST /api/credentials - Store a new credential
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "unauthorized", message: "Not logged in" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { site_domain, username, password } = body;

    if (!site_domain || !username || !password) {
      return NextResponse.json(
        { error: "bad_request", message: "site_domain, username, and password are required" },
        { status: 400 }
      );
    }

    // Encrypt the password
    const encryptedPassword = await encrypt(password);

    const { data: credential, error } = await supabase
      .from("credential_vault")
      .insert({
        user_id: user.id,
        site_domain,
        username,
        encrypted_password: encryptedPassword,
      })
      .select("id, site_domain, username, created_at")
      .single();

    if (error) {
      return NextResponse.json(
        { error: "internal_error", message: "Failed to store credential" },
        { status: 500 }
      );
    }

    return NextResponse.json({ credential }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "internal_error", message: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
