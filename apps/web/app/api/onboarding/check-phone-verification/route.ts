import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Check if user's phone is verified
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("phone_number, phone_verified")
      .eq("id", user.id)
      .single();

    if (error) {
      console.error("[CHECK-PHONE] Failed to fetch profile:", error);
      return NextResponse.json(
        { error: "Failed to check verification status" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      verified: profile?.phone_verified === true,
      phone: profile?.phone_number || null,
    });
  } catch (error) {
    console.error("[CHECK-PHONE] Error:", error);
    return NextResponse.json(
      { error: "Failed to check verification status" },
      { status: 500 }
    );
  }
}
