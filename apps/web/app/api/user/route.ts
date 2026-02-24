import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export async function GET() {
  try {
    const supabase = await createClient();
    
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: "unauthorized", message: "Not logged in" },
        { status: 401 }
      );
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { error: "not_found", message: "Profile not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: profile.id,
      username: profile.username,
      email: profile.email,
      aiEmail: `${profile.username}@aevoy.com`,
      displayName: profile.display_name,
      botName: profile.bot_name || null,
      timezone: profile.timezone,
      onboardingCompleted: profile.onboarding_completed || false,
      subscription: {
        tier: profile.subscription_tier,
        messagesUsed: profile.messages_used,
        messagesLimit: profile.messages_limit,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "internal_error", message: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: "unauthorized", message: "Not logged in" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { displayName, timezone, botName } = body;

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (displayName !== undefined) {
      updateData.display_name = displayName || null;
    }

    if (timezone !== undefined) {
      updateData.timezone = timezone;
    }

    if (botName !== undefined) {
      const trimmed = typeof botName === 'string' ? botName.trim().substring(0, 30) : null;
      if (trimmed) {
        // Check uniqueness with admin client (RLS blocks cross-user queries)
        const admin = createAdminClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { autoRefreshToken: false, persistSession: false } }
        );
        const { data: existingBot } = await admin
          .from("profiles")
          .select("id")
          .ilike("bot_name", trimmed)
          .neq("id", user.id)
          .maybeSingle();

        if (existingBot) {
          return NextResponse.json(
            { error: "bot_name_taken", message: "This AI name is already taken" },
            { status: 409 }
          );
        }
      }
      updateData.bot_name = trimmed || null;
    }

    const { data: profile, error: updateError } = await supabase
      .from("profiles")
      .update(updateData)
      .eq("id", user.id)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: "internal_error", message: "Failed to update profile" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      id: profile.id,
      username: profile.username,
      email: profile.email,
      aiEmail: `${profile.username}@aevoy.com`,
      displayName: profile.display_name,
      botName: profile.bot_name || null,
      timezone: profile.timezone,
      subscription: {
        tier: profile.subscription_tier,
        messagesUsed: profile.messages_used,
        messagesLimit: profile.messages_limit,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "internal_error", message: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
