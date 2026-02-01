import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function DELETE() {
  try {
    const supabase = await createClient();
    
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: "unauthorized", message: "Not logged in" },
        { status: 401 }
      );
    }

    // Delete tasks
    await supabase
      .from("tasks")
      .delete()
      .eq("user_id", user.id);

    // Delete scheduled tasks
    await supabase
      .from("scheduled_tasks")
      .delete()
      .eq("user_id", user.id);

    // Delete profile (this will cascade to delete related data)
    await supabase
      .from("profiles")
      .delete()
      .eq("id", user.id);

    // Note: The actual auth user deletion would need to be done
    // with the service role key on the agent server
    // For now, we just delete the profile data

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "internal_error", message: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
