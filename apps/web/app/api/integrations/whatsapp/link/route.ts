import { NextResponse } from "next/server";
import crypto from "crypto";

// Reuse the same secret as Telegram (it's just a shared webhook auth secret)
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function timingSafeCompare(a: string, b: string): boolean {
  try {
    const aBuf = Buffer.from(a.padEnd(64), "utf8");
    const bBuf = Buffer.from(b.padEnd(64), "utf8");
    return crypto.timingSafeEqual(aBuf, bBuf) && a.length === b.length;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  // Validate webhook secret (same secret used for Telegram)
  const secret = request.headers.get("x-whatsapp-link-secret") || "";
  if (!timingSafeCompare(secret, WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json() as { code?: string; phone?: string };
  const { code, phone } = body;

  if (!code || !phone) {
    return NextResponse.json({ error: "Missing code or phone" }, { status: 400 });
  }

  // Validate E.164 phone format
  if (!/^\+\d{7,15}$/.test(phone)) {
    return NextResponse.json({ error: "Invalid phone format" }, { status: 400 });
  }

  const headers = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };

  // Look up the link code — reuses the same telegram_link_codes table
  const codeRes = await fetch(
    `${SUPABASE_URL}/rest/v1/telegram_link_codes?code=eq.${encodeURIComponent(code)}&used=eq.false&select=id,user_id,expires_at`,
    { headers }
  );

  if (!codeRes.ok) {
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const codes = await codeRes.json() as Array<{ id: string; user_id: string; expires_at: string }>;
  if (!codes.length) {
    return NextResponse.json({ error: "Invalid or expired code" }, { status: 404 });
  }

  const linkCode = codes[0];

  if (new Date(linkCode.expires_at) < new Date()) {
    return NextResponse.json({ error: "Code expired" }, { status: 410 });
  }

  // Mark code as used (single-use)
  await fetch(
    `${SUPABASE_URL}/rest/v1/telegram_link_codes?id=eq.${linkCode.id}`,
    { method: "PATCH", headers, body: JSON.stringify({ used: true }) }
  );

  // Set whatsapp_phone on the user's profile
  await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${linkCode.user_id}`,
    { method: "PATCH", headers, body: JSON.stringify({ whatsapp_phone: phone }) }
  );

  return NextResponse.json({ success: true });
}
