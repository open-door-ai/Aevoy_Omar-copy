import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const phoneNumber = body.phone_number;

    if (!phoneNumber) {
      return NextResponse.json(
        { error: "Phone number is required" },
        { status: 400 }
      );
    }

    // 1. Purchase number from Twilio
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const agentUrl = process.env.AGENT_URL || "https://hissing-verile-aevoy-e721b4a6.koyeb.app";

    const purchaseUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json`;

    const twilioRes = await fetch(purchaseUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        PhoneNumber: phoneNumber,
        VoiceUrl: `${agentUrl}/webhook/voice/premium/${user.id}`,
        VoiceMethod: "POST",
        SmsUrl: `${agentUrl}/webhook/sms/premium/${user.id}`,
        SmsMethod: "POST"
      })
    });

    if (!twilioRes.ok) {
      console.error("[PHONE] Purchase failed:", await twilioRes.text());
      return NextResponse.json(
        { error: "Failed to purchase number" },
        { status: 502 }
      );
    }

    const twilioData = await twilioRes.json();
    const sid = twilioData.sid;

    // 2. Save to database
    const { error: dbError } = await supabase
      .from("user_twilio_numbers")
      .insert({
        user_id: user.id,
        phone_number: phoneNumber,
        provider: "twilio",
        sid: sid
      });

    if (dbError) {
      console.error("[PHONE] DB save error:", dbError);
      // Rollback: release Twilio number
      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers/${sid}.json`, {
        method: "DELETE",
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`
        }
      });
      return NextResponse.json(
        { error: "Failed to save number" },
        { status: 500 }
      );
    }

    // 3. Create Stripe subscription ($2/mo)
    // TODO: Implement Stripe integration
    // For now, just return success

    return NextResponse.json({
      success: true,
      phone_number: phoneNumber,
      message: "Number purchased! You'll be charged $2/mo starting next billing cycle."
    });
  } catch (error) {
    console.error("[PHONE] Purchase error:", error);
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}
