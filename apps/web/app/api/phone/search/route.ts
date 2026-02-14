import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const CANADIAN_AREA_CODES = new Set([
  '204','226','236','249','250','289','306','343','365','367','382',
  '403','416','418','431','437','438','450','506','514','519','548',
  '579','581','587','604','613','639','647','672','683','705','709',
  '742','778','780','782','807','819','825','867','873','902','905'
]);

function getCountryForAreaCode(areaCode: string): string {
  return CANADIAN_AREA_CODES.has(areaCode) ? 'CA' : 'US';
}

function getTwilioCredentials(): { accountSid: string; authToken: string; apiKeySid?: string; apiKeySecret?: string } | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return null;
  return {
    accountSid,
    authToken,
    apiKeySid: process.env.TWILIO_API_KEY_SID || undefined,
    apiKeySecret: process.env.TWILIO_API_KEY_SECRET || undefined,
  };
}

function twilioAuthHeader(creds: { accountSid: string; authToken: string; apiKeySid?: string; apiKeySecret?: string }): string {
  const user = creds.apiKeySid && creds.apiKeySecret ? creds.apiKeySid : creds.accountSid;
  const pass = creds.apiKeySid && creds.apiKeySecret ? creds.apiKeySecret : creds.authToken;
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

/**
 * GET /api/phone/search?areaCode=310&limit=5
 * Search for available phone numbers in a specific area code
 */
export async function GET(request: Request) {
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

  const { searchParams } = new URL(request.url);
  const areaCode = searchParams.get("areaCode");
  const limit = parseInt(searchParams.get("limit") || "5", 10);
  const pattern = searchParams.get("pattern") || "";

  if (!areaCode || !/^\d{3}$/.test(areaCode)) {
    return NextResponse.json(
      { error: "Valid 3-digit area code is required" },
      { status: 400 }
    );
  }

  try {
    const country = getCountryForAreaCode(areaCode);
    const searchQuery = new URLSearchParams({
      AreaCode: areaCode,
      SmsEnabled: "true",
      VoiceEnabled: "true",
      Limit: String(Math.min(limit, 20)), // Cap at 20
    });

    const searchRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/AvailablePhoneNumbers/${country}/Local.json?${searchQuery}`,
      {
        headers: { Authorization: twilioAuthHeader(creds) },
      }
    );

    if (!searchRes.ok) {
      const err = await searchRes.text();
      console.error("[PHONE SEARCH] Twilio error:", err);
      return NextResponse.json(
        { error: "Failed to search for available numbers" },
        { status: 502 }
      );
    }

    const searchData = await searchRes.json() as {
      available_phone_numbers: Array<{
        phone_number: string;
        friendly_name: string;
        locality?: string;
        region?: string;
        capabilities: {
          voice: boolean;
          SMS: boolean;
          MMS: boolean;
        };
      }>;
    };

    let numbers = searchData.available_phone_numbers || [];

    // Filter by pattern if provided
    if (pattern === "easy") {
      numbers = numbers.filter((n) => {
        const digits = n.phone_number.replace(/\D/g, "");
        const last4 = digits.slice(-4);
        return /(\d)\1{2,}/.test(last4) || // Repeating (1111, 222)
               /0123|1234|2345|3456|4567|5678|6789/.test(last4); // Sequences
      });
    }

    return NextResponse.json({
      areaCode,
      country,
      available: numbers.length > 0,
      count: numbers.length,
      numbers: numbers.map((num) => ({
        phoneNumber: num.phone_number,
        friendlyName: num.friendly_name,
        locality: num.locality,
        region: num.region,
        capabilities: num.capabilities,
        monthlyCost: 1.15, // Twilio standard pricing
      })),
    });
  } catch (error) {
    console.error("[PHONE SEARCH] Error:", error);
    return NextResponse.json(
      { error: "Internal error during phone search" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/phone/search (legacy support)
 */
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

    const searchUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/AvailablePhoneNumbers/${getCountryForAreaCode(areaCode)}/Local.json?AreaCode=${areaCode}&Limit=10`;

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
