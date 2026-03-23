import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import crypto from "crypto";
import QRCode from "qrcode";

const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "AuroraBot";
const RATE_LIMIT_PER_HOUR = 3;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("telegram_chat_id")
    .eq("id", user.id)
    .single();

  return NextResponse.json({
    connected: !!profile?.telegram_chat_id,
    chatId: profile?.telegram_chat_id || null,
  });
}

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Rate limit: max 3 link code requests per hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("telegram_link_codes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", oneHourAgo);

  if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
    return NextResponse.json({ error: "Too many requests. Try again in an hour." }, { status: 429 });
  }

  // Generate a cryptographically secure link code
  const code = crypto.randomBytes(12).toString("hex"); // 24 chars hex

  // Store link code (expires_at set by DB default: now() + 10 minutes)
  const { error } = await supabase
    .from("telegram_link_codes")
    .insert({ user_id: user.id, code });

  if (error) {
    console.error("[TELEGRAM] Failed to create link code:", error);
    return NextResponse.json({ error: "Failed to generate link" }, { status: 500 });
  }

  const deepLink = `https://t.me/${BOT_USERNAME}?start=${code}`;

  // Generate QR code as data URL
  let qrCodeDataUrl = "";
  try {
    qrCodeDataUrl = await QRCode.toDataURL(deepLink, {
      width: 256,
      margin: 1,
      color: { dark: "#000000", light: "#ffffff" },
    });
  } catch (err) {
    console.error("[TELEGRAM] QR generation failed:", err);
  }

  return NextResponse.json({ botUsername: BOT_USERNAME, deepLink, qrCodeDataUrl, code });
}

export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await supabase
    .from("profiles")
    .update({ telegram_chat_id: null })
    .eq("id", user.id);

  return NextResponse.json({ success: true });
}
