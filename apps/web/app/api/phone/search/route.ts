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
    const areaCode = body.area_code || "778"; // Default Vancouver area
    const pattern = body.pattern || ""; // Optional: "easy", "repeating", etc.

    // Search Twilio API for available numbers
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    const searchUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/AvailablePhoneNumbers/US/Local.json?AreaCode=${areaCode}&Limit=10`;

    const twilioRes = await fetch(searchUrl, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`
      }
    });

    if (!twilioRes.ok) {
      console.error("[PHONE] Twilio search failed:", await twilioRes.text());
      return NextResponse.json(
        { error: "Failed to search numbers" },
        { status: 502 }
      );
    }

    const data = await twilioRes.json();
    const numbers = data.available_phone_numbers || [];

    // Filter by pattern if provided
    let filtered = numbers;
    if (pattern === "easy") {
      // Filter for easy-to-remember patterns (repeating digits, sequences)
      filtered = numbers.filter((n: any) => {
        const digits = n.phone_number.replace(/\D/g, "");
        const last4 = digits.slice(-4);
        return /(\d)\1{2,}/.test(last4) || // Repeating (1111, 222)
               /0123|1234|2345|3456|4567|5678|6789/.test(last4); // Sequences
      });
    }

    // Return first 10 results
    return NextResponse.json({
      numbers: filtered.slice(0, 10).map((n: any) => ({
        phone_number: n.phone_number,
        friendly_name: n.friendly_name,
        locality: n.locality,
        region: n.region
      }))
    });
  } catch (error) {
    console.error("[PHONE] Search error:", error);
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}
