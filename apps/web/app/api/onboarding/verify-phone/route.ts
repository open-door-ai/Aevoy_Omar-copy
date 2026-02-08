import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * Normalize phone number to E.164 format
 * Handles: +17781234567, 17781234567, 7781234567, (778) 123-4567
 */
function normalizePhone(phone: string): string {
  const hasPlus = phone.trim().startsWith("+");
  const digits = phone.replace(/\D/g, "");

  if (!digits) return "";

  // If 11 digits starting with 1 (US/CA)
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  // If 10 digits, assume US/CA
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  // If had + prefix, keep as-is (international)
  if (hasPlus) {
    return `+${digits}`;
  }

  // Otherwise, assume US and prepend +1
  if (digits.length >= 10) {
    return `+${digits}`;
  }

  return phone.trim();
}

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const rawPhone = body.phone?.trim();

    if (!rawPhone) {
      return NextResponse.json(
        { error: "Phone number is required" },
        { status: 400 }
      );
    }

    // Normalize to E.164 format
    const phoneNumber = normalizePhone(rawPhone);

    // Validate normalized phone
    if (!phoneNumber || phoneNumber.length < 10) {
      return NextResponse.json(
        { error: "Invalid phone number format. Please enter a valid phone number." },
        { status: 400 }
      );
    }

    // Basic E.164 validation (starts with + and has 10-15 digits)
    if (!/^\+[1-9]\d{6,14}$/.test(phoneNumber)) {
      return NextResponse.json(
        { error: "Invalid phone number format. Use format: +16045551234" },
        { status: 400 }
      );
    }

    // Save phone number to profile (not verified yet)
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ 
        phone_number: phoneNumber,
        phone_verified: false
      })
      .eq("id", user.id);

    if (updateError) {
      console.error("[VERIFY-PHONE] Failed to save phone number:", updateError);
      return NextResponse.json(
        { error: "Failed to save phone number" },
        { status: 500 }
      );
    }

    // Check if Twilio is configured
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioNumber = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !twilioNumber) {
      // Record attempt but note service unavailable
      await supabase.from("phone_verification_attempts").insert({
        user_id: user.id,
        phone_number: phoneNumber,
        status: "failed"
      });

      return NextResponse.json(
        { error: "Phone verification service unavailable" },
        { status: 503 }
      );
    }

    // Call agent webhook to initiate verification call
    const agentUrl = process.env.AGENT_URL || "http://localhost:3001";
    const webhookSecret = process.env.AGENT_WEBHOOK_SECRET;

    if (!webhookSecret) {
      return NextResponse.json(
        { error: "Agent webhook secret not configured" },
        { status: 503 }
      );
    }

    const verifyRes = await fetch(`${agentUrl}/webhook/voice/onboarding-verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": webhookSecret,
      },
      body: JSON.stringify({
        userId: user.id,
        phone: phoneNumber,
      }),
    });

    if (!verifyRes.ok) {
      const errorData = await verifyRes.text();
      console.error("[VERIFY-PHONE] Agent webhook error:", errorData);
      
      await supabase.from("phone_verification_attempts").insert({
        user_id: user.id,
        phone_number: phoneNumber,
        status: "failed"
      });

      return NextResponse.json(
        { error: "Failed to initiate verification call" },
        { status: 502 }
      );
    }

    const verifyData = await verifyRes.json();

    // Record verification attempt
    await supabase.from("phone_verification_attempts").insert({
      user_id: user.id,
      phone_number: phoneNumber,
      call_sid: verifyData.callSid,
      status: "initiated"
    });

    return NextResponse.json({
      success: true,
      status: "calling",
      message: "Calling you now! Pick up and press 1 to verify.",
    });
  } catch (error) {
    console.error("[VERIFY-PHONE] Error:", error);
    return NextResponse.json(
      { error: "Failed to process verification request" },
      { status: 500 }
    );
  }
}
