import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * Normalize phone number to E.164 format
 * Handles: +17781234567, 17781234567, 7781234567
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
    const rawPhoneNumber = body.phone_number?.trim();

    if (!rawPhoneNumber) {
      return NextResponse.json(
        { error: "Phone number is required" },
        { status: 400 }
      );
    }

    // Basic phone validation: digits, +, spaces, dashes, parens
    if (!/^[+\d\s()-]{7,20}$/.test(rawPhoneNumber)) {
      return NextResponse.json(
        { error: "Invalid phone number format" },
        { status: 400 }
      );
    }

    // Normalize to E.164 format
    const phoneNumber = normalizePhone(rawPhoneNumber);

    // Save phone number to database for future caller identification
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ phone_number: phoneNumber })
      .eq("id", user.id);

    if (updateError) {
      console.error("[ONBOARDING] Failed to save phone number:", updateError);
      // Don't fail the request, but log for debugging
    }

    // Check Twilio credentials
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioNumber = process.env.TWILIO_PHONE_NUMBER;
    const apiKeySid = process.env.TWILIO_API_KEY_SID;
    const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;

    if (!accountSid || !authToken || !twilioNumber) {
      // Mark as requested but service unavailable
      await supabase
        .from("profiles")
        .update({ onboarding_interview_status: "call_requested" })
        .eq("id", user.id);

      return NextResponse.json({
        success: true,
        status: "queued",
        message: "Call interview requested. We'll call you when the service is ready.",
      });
    }

    // Initiate the call via Twilio
    const agentUrl = process.env.AGENT_URL || "http://localhost:3001";
    const callBody = new URLSearchParams({
      To: phoneNumber,
      From: twilioNumber,
      Url: `${agentUrl}/webhook/interview-call/${user.id}`,
      Method: "POST",
      StatusCallback: `${agentUrl}/webhook/call-status/${user.id}`,
      StatusCallbackMethod: "POST",
    });

    // Prefer API Key auth (more secure, independently revocable)
    const authUser = apiKeySid && apiKeySecret ? apiKeySid : accountSid;
    const authPass = apiKeySid && apiKeySecret ? apiKeySecret : authToken;
    const auth = "Basic " + Buffer.from(`${authUser}:${authPass}`).toString("base64");

    const callRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
      {
        method: "POST",
        headers: {
          Authorization: auth,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: callBody.toString(),
      }
    );

    if (!callRes.ok) {
      console.error("[ONBOARDING] Twilio call error:", await callRes.text());
      return NextResponse.json(
        { error: "Failed to initiate call. Please try again." },
        { status: 502 }
      );
    }

    // Update interview status
    await supabase
      .from("profiles")
      .update({ onboarding_interview_status: "call_in_progress" })
      .eq("id", user.id);

    return NextResponse.json({
      success: true,
      status: "calling",
      message: "Calling you now! Pick up to start your AI interview.",
    });
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}
