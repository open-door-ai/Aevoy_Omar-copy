import { NextResponse } from "next/server";
import crypto from "crypto";

const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function timingSafeCompare(a: string, b: string): boolean {
  try {
    const aBuf = Buffer.from(a, "utf8");
    const bBuf = Buffer.from(b, "utf8");
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  // Validate webhook secret
  const secret = request.headers.get("x-telegram-link-secret") || "";
  if (!timingSafeCompare(secret, WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { code, chatId } = await request.json() as { code: string; chatId: string };
  if (!code || !chatId) {
    return NextResponse.json({ error: "Missing code or chatId" }, { status: 400 });
  }

  // Look up the link code via service role (bypasses RLS)
  const headers = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };

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

  // Check expiry
  if (new Date(linkCode.expires_at) < new Date()) {
    return NextResponse.json({ error: "Code expired" }, { status: 410 });
  }

  // Mark code as used
  await fetch(
    `${SUPABASE_URL}/rest/v1/telegram_link_codes?id=eq.${linkCode.id}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ used: true }),
    }
  );

  // Link the Telegram chat ID to the user's profile
  await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${linkCode.user_id}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ telegram_chat_id: chatId }),
    }
  );

  return NextResponse.json({ success: true, userId: linkCode.user_id });
}
