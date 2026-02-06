import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { createCipheriv, randomBytes, scrypt } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

/**
 * Encrypt PIN for storage (4-6 digit numeric PIN)
 * Uses user ID as salt for deterministic encryption
 * This is a copy of encryptPin from agent/src/security/encryption.ts
 */
async function encryptPin(pin: string, userId: string): Promise<string> {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("ENCRYPTION_KEY not configured");
  }

  // Use user ID as part of salt for deterministic encryption
  const salt = Buffer.from(userId.slice(0, 16).padEnd(16, "0"));
  const key = (await scryptAsync(secret, salt, 32)) as Buffer;
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(pin, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const newPin = body.pin?.toString();

    if (!newPin || !/^\d{4,6}$/.test(newPin)) {
      return NextResponse.json({ error: "PIN must be 4-6 digits" }, { status: 400 });
    }

    // Encrypt PIN before storage
    const encryptedPin = await encryptPin(newPin, user.id);

    const { error } = await supabase
      .from("profiles")
      .update({
        email_pin: encryptedPin,
        email_pin_attempts: 0,
        email_pin_locked_until: null,
      })
      .eq("id", user.id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[SETTINGS] Email PIN update error:", error);
    return NextResponse.json({ error: "Failed to update email PIN" }, { status: 500 });
  }
}
