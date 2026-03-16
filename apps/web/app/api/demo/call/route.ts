import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
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

const DEMO_PHONE_NUMBER = process.env.DEMO_PHONE_NUMBER || '+18882981661'; // Toll-free demo number

// CRITICAL: This is the Twilio callback URL — Twilio's servers fetch TwiML from here.
// It MUST be the public Railway production URL, never localhost or any internal URL.
// Do NOT use AGENT_URL here — that env var may be set to localhost for local dev.
const TWILIO_CALLBACK_BASE = process.env.TWILIO_CALLBACK_URL
  || process.env.RAILWAY_PUBLIC_URL
  || 'https://agent-production-1339.up.railway.app';

function getTwilioCredentials() {
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

/**
 * POST /api/demo/call — Place a demo Twilio call
 * Body: { phone: string }
 * Rate limit: 3 calls/day per IP
 */
export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);

    // In-memory check (fast path, but resets on cold start)
    if (!checkRateLimit('demo-call', ip, 3, DAY_MS)) {
      return NextResponse.json(
        { error: 'Demo limit reached. You can try again tomorrow.' },
        { status: 429 }
      );
    }

    // DB-backed global demo cap — prevents abuse across serverless instances
    // Max 20 demo calls per day total (all users combined)
    try {
      const { createClient: createAdmin } = await import('@supabase/supabase-js');
      const admin = createAdmin(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      );
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { data: todayCalls } = await admin
        .from('call_history')
        .select('id')
        .eq('call_type', 'demo')
        .gte('created_at', todayStart.toISOString())
        .limit(21);
      if (todayCalls && todayCalls.length >= 20) {
        console.warn(`[DEMO/CALL] GLOBAL daily demo cap reached (${todayCalls.length} calls today)`);
        return NextResponse.json(
          { error: 'Demo is temporarily unavailable due to high demand. Try again tomorrow or sign up for a free account.' },
          { status: 429 }
        );
      }
    } catch (e) {
      console.error('[DEMO/CALL] DB rate limit check failed:', e);
      // Continue if DB check fails — don't block on errors
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

    // Check if the caller is a logged-in user (for onboarding calls)
    // SECURITY: Always use session userId — never trust client-supplied userId
    let userId = '';
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) userId = user.id;
    } catch { /* not logged in — cold demo */ }

    // Twilio callback: when the callee answers, Twilio POSTs to this URL to get TwiML
    const demoUrl = new URL(`${TWILIO_CALLBACK_BASE}/webhook/voice/demo-outbound`);
    if (userId) demoUrl.searchParams.set('userId', userId);

    console.log('[DEMO/CALL] Callback URL:', demoUrl.toString());
    console.log('[DEMO/CALL] TWILIO_CALLBACK_BASE:', TWILIO_CALLBACK_BASE);

    const callBody = new URLSearchParams({
      To: phone,
      From: DEMO_PHONE_NUMBER,
      Url: demoUrl.toString(),
      Method: 'POST',
      StatusCallback: `${TWILIO_CALLBACK_BASE}/webhook/voice/status`,
      StatusCallbackEvent: 'initiated ringing answered completed',
      TimeLimit: '300', // 5 min hard cap — demo calls are free, prevent runaway billing
    });

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Calls.json`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(
            creds.apiKeySid && creds.apiKeySecret
              ? `${creds.apiKeySid}:${creds.apiKeySecret}`
              : `${creds.accountSid}:${creds.authToken}`
          ).toString('base64'),
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
