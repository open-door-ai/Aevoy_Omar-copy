import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { status } = await request.json();

    // Update profile with beta status
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ 
        subscription_status: status,
        // Give beta users unlimited messages
        messages_limit: 10000
      })
      .eq("id", user.id);

    if (updateError) {
      console.error("Error updating beta status:", updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, status });
  } catch (error) {
    console.error("Beta status error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
