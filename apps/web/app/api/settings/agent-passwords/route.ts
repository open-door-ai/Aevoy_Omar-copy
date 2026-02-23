import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import crypto from "crypto";

// AES-256-GCM encryption using ENCRYPTION_KEY env var
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error("ENCRYPTION_KEY must be a 64-character hex string");
  }
  return Buffer.from(key, "hex");
}

function encrypt(data: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(data, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decrypt(encryptedData: string): string {
  const key = getEncryptionKey();
  const [ivB64, authTagB64, dataB64] = encryptedData.split(":");
  if (!ivB64 || !authTagB64 || !dataB64) throw new Error("Invalid encrypted data");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

// GET: Returns which password slots are filled (never returns actual passwords)
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("agent_passwords_encrypted")
    .eq("id", user.id)
    .single();

  if (!profile?.agent_passwords_encrypted) {
    return NextResponse.json({ primary: false, secondary: false, tertiary: false });
  }

  try {
    const decrypted = JSON.parse(decrypt(profile.agent_passwords_encrypted));
    return NextResponse.json({
      primary: !!decrypted.primary,
      secondary: !!decrypted.secondary,
      tertiary: !!decrypted.tertiary,
    });
  } catch {
    return NextResponse.json({ primary: false, secondary: false, tertiary: false });
  }
}

// PUT: Save passwords (encrypt and store)
export async function PUT(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { primary, secondary, tertiary } = body;

    // Get existing passwords to merge
    const { data: profile } = await supabase
      .from("profiles")
      .select("agent_passwords_encrypted")
      .eq("id", user.id)
      .single();

    let existing: Record<string, string> = {};
    if (profile?.agent_passwords_encrypted) {
      try {
        existing = JSON.parse(decrypt(profile.agent_passwords_encrypted));
      } catch { /* start fresh */ }
    }

    // Merge: only update non-undefined fields
    if (primary !== undefined) existing.primary = primary || "";
    if (secondary !== undefined) existing.secondary = secondary || "";
    if (tertiary !== undefined) existing.tertiary = tertiary || "";

    // Remove empty slots
    if (!existing.primary) delete existing.primary;
    if (!existing.secondary) delete existing.secondary;
    if (!existing.tertiary) delete existing.tertiary;

    const encrypted = Object.keys(existing).length > 0
      ? encrypt(JSON.stringify(existing))
      : null;

    const { error } = await supabase
      .from("profiles")
      .update({ agent_passwords_encrypted: encrypted })
      .eq("id", user.id);

    if (error) {
      return NextResponse.json({ error: "Failed to save" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

// DELETE: Clear specific slot or all
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { slot } = body; // "primary", "secondary", "tertiary", or "all"

    if (slot === "all") {
      await supabase.from("profiles").update({ agent_passwords_encrypted: null }).eq("id", user.id);
      return NextResponse.json({ success: true });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("agent_passwords_encrypted")
      .eq("id", user.id)
      .single();

    if (!profile?.agent_passwords_encrypted) {
      return NextResponse.json({ success: true });
    }

    const existing = JSON.parse(decrypt(profile.agent_passwords_encrypted));
    delete existing[slot];

    const encrypted = Object.keys(existing).length > 0
      ? encrypt(JSON.stringify(existing))
      : null;

    await supabase.from("profiles").update({ agent_passwords_encrypted: encrypted }).eq("id", user.id);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
