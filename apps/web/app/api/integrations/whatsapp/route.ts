import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import QRCode from "qrcode";
import crypto from "crypto";

const RATE_LIMIT_PER_HOUR = 5;
const SANDBOX_NUMBER = (process.env.TWILIO_WHATSAPP_SANDBOX_NUMBER || "+14155238886").replace(/\D/g, "");
const SANDBOX_CODE = process.env.TWILIO_WHATSAPP_SANDBOX_CODE || "";

function getSandboxJoinUrl(): string {
  const text = SANDBOX_CODE ? `join ${SANDBOX_CODE}` : "join";
  return `https://wa.me/${SANDBOX_NUMBER}?text=${encodeURIComponent(text)}`;
}

function getLinkUrl(code: string): string {
  return `https://wa.me/${SANDBOX_NUMBER}?text=${encodeURIComponent(`AEVOY ${code}`)}`;
}

async function generateQR(url: string, color = "#25D366"): Promise<string> {
  try {
    return await QRCode.toDataURL(url, {
      width: 240,
      margin: 1,
      color: { dark: color, light: "#ffffff" },
    });
  } catch {
    return "";
  }
}

// GET — return connection status + QRs
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("whatsapp_phone")
    .eq("id", user.id)
    .single();

  // For the sandbox join QR (step 1 — one-time Twilio requirement)
  const joinUrl = getSandboxJoinUrl();
  const joinQrDataUrl = await generateQR(joinUrl);

  return NextResponse.json({
    connected: !!profile?.whatsapp_phone,
    phone: profile?.whatsapp_phone || null,
    joinUrl,
    joinQrDataUrl,
    sandboxNumber: `+${SANDBOX_NUMBER}`,
  });
}

// POST — generate a per-user link code + link QR (step 2)
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Rate limit: max 5 link codes per hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("telegram_link_codes") // reuse same table — codes are just codes
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", oneHourAgo);

  if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
    return NextResponse.json({ error: "Too many requests. Try again in an hour." }, { status: 429 });
  }

  // Generate cryptographically random link code (24 hex chars = 96 bits entropy)
  const code = crypto.randomBytes(12).toString("hex");

  // Store in telegram_link_codes (expires in 10 min, single-use)
  const { error } = await supabase
    .from("telegram_link_codes")
    .insert({ user_id: user.id, code });

  if (error) {
    return NextResponse.json({ error: "Failed to generate code" }, { status: 500 });
  }

  const linkUrl = getLinkUrl(code);
  const linkQrDataUrl = await generateQR(linkUrl);

  return NextResponse.json({
    code,
    linkUrl,
    linkQrDataUrl,
    expiresInMinutes: 10,
    sandboxNumber: `+${SANDBOX_NUMBER}`,
    sandboxJoinUrl: getSandboxJoinUrl(),
    sandboxJoinQr: await generateQR(getSandboxJoinUrl()),
  });
}

// DELETE — disconnect WhatsApp
export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await supabase
    .from("profiles")
    .update({ whatsapp_phone: null })
    .eq("id", user.id);

  return NextResponse.json({ success: true });
}
