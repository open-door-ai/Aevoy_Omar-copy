import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
    const { displayName, timezone } = body;

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (displayName !== undefined) {
      updateData.display_name = displayName || null;
    }

    if (timezone !== undefined) {
      updateData.timezone = timezone;
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
