import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import QRCode from "qrcode";

function getJoinUrl(): string {
  const sandboxNumber = (process.env.TWILIO_WHATSAPP_SANDBOX_NUMBER || "+14155238886").replace(/\D/g, "");
  const sandboxCode = process.env.TWILIO_WHATSAPP_SANDBOX_CODE || "";
  const text = sandboxCode ? `join ${sandboxCode}` : "join";
  return `https://wa.me/${sandboxNumber}?text=${encodeURIComponent(text)}`;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("whatsapp_phone")
    .eq("id", user.id)
    .single();

  const joinUrl = getJoinUrl();
  let joinQrDataUrl = "";
  try {
    joinQrDataUrl = await QRCode.toDataURL(joinUrl, {
      width: 256,
      margin: 1,
      color: { dark: "#25D366", light: "#ffffff" }, // WhatsApp green
    });
  } catch (err) {
    console.error("[WHATSAPP] QR generation failed:", err);
  }

  return NextResponse.json({
    connected: !!profile?.whatsapp_phone,
    phone: profile?.whatsapp_phone || null,
    joinUrl,
    joinQrDataUrl,
    sandboxCode: process.env.TWILIO_WHATSAPP_SANDBOX_CODE || "",
    sandboxNumber: process.env.TWILIO_WHATSAPP_SANDBOX_NUMBER || "+14155238886",
  });
}

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
