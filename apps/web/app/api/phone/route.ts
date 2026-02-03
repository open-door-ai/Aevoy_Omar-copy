import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Simple in-memory rate limiting: one provisioning per user per 60s
const provisionCooldowns = new Map<string, number>();

function checkCooldown(userId: string): boolean {
  const lastTime = provisionCooldowns.get(userId);
  if (lastTime && Date.now() - lastTime < 60_000) {
    return false;
  }
  return true;
}

function setCooldown(userId: string): void {
  provisionCooldowns.set(userId, Date.now());
  // Clean old entries every 100 writes
  if (provisionCooldowns.size > 100) {
    const now = Date.now();
    for (const [key, time] of provisionCooldowns) {
      if (now - time > 120_000) provisionCooldowns.delete(key);
    }
  }
}

function getTwilioCredentials(): { accountSid: string; authToken: string } | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return null;
  return { accountSid, authToken };
}

function twilioAuthHeader(creds: { accountSid: string; authToken: string }): string {
  return "Basic " + Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64");
}

/**
 * GET /api/phone — Return user's current twilio_number (or null)
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("twilio_number")
    .eq("id", user.id)
    .single();

  return NextResponse.json({ phone: profile?.twilio_number ?? null });
}

/**
 * POST /api/phone — Provision a new Twilio number
 * Body: { areaCode?: string }
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const creds = getTwilioCredentials();
  if (!creds) {
    return NextResponse.json(
      { error: "Phone provisioning is not configured" },
      { status: 503 }
    );
  }

  // Rate limit
  if (!checkCooldown(user.id)) {
    return NextResponse.json(
      { error: "Please wait before provisioning another number" },
      { status: 429 }
    );
  }

  // Check user doesn't already have a number
  const { data: profile } = await supabase
    .from("profiles")
    .select("twilio_number")
    .eq("id", user.id)
    .single();

  if (profile?.twilio_number) {
    return NextResponse.json(
      { error: "You already have a phone number. Release it first." },
      { status: 400 }
    );
  }

  // Parse body
  let areaCode = "604";
  try {
    const body = await request.json();
    if (body.areaCode) {
      const code = String(body.areaCode).trim();
      if (!/^\d{3}$/.test(code)) {
        return NextResponse.json(
          { error: "Area code must be exactly 3 digits" },
          { status: 400 }
        );
      }
      areaCode = code;
    }
  } catch {
    // No body or invalid JSON — use default area code
  }

  try {
    // 1. Search for an available number
    const searchParams = new URLSearchParams({
      AreaCode: areaCode,
      SmsEnabled: "true",
      VoiceEnabled: "true",
      Limit: "1",
    });

    const searchRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/AvailablePhoneNumbers/US/Local.json?${searchParams}`,
      {
        headers: { Authorization: twilioAuthHeader(creds) },
      }
    );

    if (!searchRes.ok) {
      const err = await searchRes.text();
      console.error("[PHONE] Twilio search error:", err);
      return NextResponse.json(
        { error: "Failed to search for available numbers" },
        { status: 502 }
      );
    }

    const searchData = await searchRes.json() as {
      available_phone_numbers: Array<{ phone_number: string; friendly_name: string }>;
    };

    if (!searchData.available_phone_numbers?.length) {
      return NextResponse.json(
        { error: `No numbers available in area code ${areaCode}. Try a different area code.` },
        { status: 404 }
      );
    }

    const phoneNumber = searchData.available_phone_numbers[0].phone_number;

    // 2. Purchase the number and set webhook URLs
    const agentUrl = process.env.AGENT_URL || "http://localhost:3001";
    const purchaseBody = new URLSearchParams({
      PhoneNumber: phoneNumber,
      SmsUrl: `${agentUrl}/webhook/sms/${user.id}`,
      SmsMethod: "POST",
      VoiceUrl: `${agentUrl}/webhook/voice/${user.id}`,
      VoiceMethod: "POST",
      FriendlyName: `Aevoy - ${user.id.slice(0, 8)}`,
    });

    const purchaseRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/IncomingPhoneNumbers.json`,
      {
        method: "POST",
        headers: {
          Authorization: twilioAuthHeader(creds),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: purchaseBody.toString(),
      }
    );

    if (!purchaseRes.ok) {
      const err = await purchaseRes.text();
      console.error("[PHONE] Twilio purchase error:", err);
      return NextResponse.json(
        { error: "Failed to provision phone number" },
        { status: 502 }
      );
    }

    // 3. Update profiles.twilio_number
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ twilio_number: phoneNumber })
      .eq("id", user.id);

    if (profileError) {
      console.error("[PHONE] Profile update error:", profileError.message);
      // Try to release the number since DB update failed
      // (best-effort cleanup)
      return NextResponse.json(
        { error: "Failed to save phone number" },
        { status: 500 }
      );
    }

    // 4. Update user_settings.virtual_phone
    await supabase
      .from("user_settings")
      .upsert(
        {
          user_id: user.id,
          virtual_phone: phoneNumber,
          verification_method: "virtual_number",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

    setCooldown(user.id);

    return NextResponse.json({ phone: phoneNumber }, { status: 201 });
  } catch (error) {
    console.error("[PHONE] Provision error:", error);
    return NextResponse.json(
      { error: "Internal error during phone provisioning" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/phone — Release user's Twilio number
 */
export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const creds = getTwilioCredentials();
  if (!creds) {
    return NextResponse.json(
      { error: "Phone provisioning is not configured" },
      { status: 503 }
    );
  }

  // Get user's current number
  const { data: profile } = await supabase
    .from("profiles")
    .select("twilio_number")
    .eq("id", user.id)
    .single();

  if (!profile?.twilio_number) {
    return NextResponse.json(
      { error: "You don't have a phone number to release" },
      { status: 404 }
    );
  }

  const phoneNumber = profile.twilio_number;

  try {
    // 1. Find the Twilio SID for this number
    const lookupParams = new URLSearchParams({
      PhoneNumber: phoneNumber,
    });

    const lookupRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/IncomingPhoneNumbers.json?${lookupParams}`,
      {
        headers: { Authorization: twilioAuthHeader(creds) },
      }
    );

    if (lookupRes.ok) {
      const lookupData = await lookupRes.json() as {
        incoming_phone_numbers: Array<{ sid: string }>;
      };

      if (lookupData.incoming_phone_numbers?.length) {
        const sid = lookupData.incoming_phone_numbers[0].sid;

        // 2. Delete the number from Twilio
        const deleteRes = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/IncomingPhoneNumbers/${sid}.json`,
          {
            method: "DELETE",
            headers: { Authorization: twilioAuthHeader(creds) },
          }
        );

        if (!deleteRes.ok && deleteRes.status !== 404) {
          console.error("[PHONE] Twilio delete error:", await deleteRes.text());
          // Continue to clear DB even if Twilio delete fails
        }
      }
    }

    // 3. Clear profiles.twilio_number
    await supabase
      .from("profiles")
      .update({ twilio_number: null })
      .eq("id", user.id);

    // 4. Clear user_settings.virtual_phone
    await supabase
      .from("user_settings")
      .update({
        virtual_phone: null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[PHONE] Release error:", error);
    return NextResponse.json(
      { error: "Internal error during phone release" },
      { status: 500 }
    );
  }
}
