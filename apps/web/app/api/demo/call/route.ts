import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '../_rate-limit';

const PHONE_REGEX = /^\+?[1-9]\d{9,14}$/;
const DAY_MS = 86_400_000;

/**
 * Normalize phone number to E.164 format for Twilio.
 * Handles: "6045551234" → "+16045551234", "16045551234" → "+16045551234", "+16045551234" → "+16045551234"
 */
function normalizePhone(raw: string): string {
  let phone = raw.replace(/[\s()\-\.]/g, '');
  if (!phone.startsWith('+')) {
    // 10 digits without country code → assume +1 (North America)
    if (/^[2-9]\d{9}$/.test(phone)) {
      phone = '+1' + phone;
    }
    // 11 digits starting with 1 → just add +
    else if (/^1[2-9]\d{9}$/.test(phone)) {
      phone = '+' + phone;
    }
    // Otherwise add + (international)
    else {
      phone = '+' + phone;
    }
  }
  return phone;
}

function getTwilioCredentials() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !from) return null;
  return { accountSid, authToken, from };
}

/**
 * POST /api/demo/call — Place a demo Twilio call
 * Body: { phone: string }
 * Rate limit: 3 calls/day per IP
 */
export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);

    if (!checkRateLimit('demo-call', ip, 3, DAY_MS)) {
      return NextResponse.json(
        { error: 'Demo limit reached. You can try again tomorrow.' },
        { status: 429 }
      );
    }

    const creds = getTwilioCredentials();
    if (!creds) {
      return NextResponse.json(
        { error: 'Call demo is not configured on this instance.' },
        { status: 503 }
      );
    }

    const body = await request.json();
    const rawPhone = String(body.phone || '').replace(/[\s()-]/g, '');

    if (!PHONE_REGEX.test(rawPhone)) {
      return NextResponse.json(
        { error: 'Please enter a valid phone number (e.g. 6045551234 or +16045551234).' },
        { status: 400 }
      );
    }

    const phone = normalizePhone(rawPhone);

    const twiml = `<Response><Say voice="Polly.Amy">Hello! This is Aevoy, your AI employee. This call proves we're real. You can email us any task and we'll actually do it. Have a great day!</Say></Response>`;

    const callBody = new URLSearchParams({
      To: phone,
      From: creds.from,
      Twiml: twiml,
    });

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Calls.json`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: callBody.toString(),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      console.error('[DEMO/CALL] Twilio error:', res.status, res.statusText);
      console.error('[DEMO/CALL] Twilio response body:', err);
      // Detect trial account limitation
      if (err.includes('unverified') || err.includes('trial')) {
        return NextResponse.json(
          { error: 'Twilio trial limitation: can only call verified numbers. Upgrade account for public access.' },
          { status: 502 }
        );
      }
      return NextResponse.json(
        { error: 'Failed to place call. Please check your number and try again.' },
        { status: 502 }
      );
    }

    console.log('[DEMO/CALL] Call placed successfully to:', phone.slice(0, 4) + '****');
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DEMO/CALL] Error:', error);
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    );
  }
}
