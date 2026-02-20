import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const ENCRYPTION_KEY_HEX = process.env.ENCRYPTION_KEY || "";

function getKey(): Buffer {
  if (!ENCRYPTION_KEY_HEX || ENCRYPTION_KEY_HEX.length < 32) {
    throw new Error("ENCRYPTION_KEY not configured or too short");
  }
  // Use first 32 bytes as AES-256 key
  return Buffer.from(ENCRYPTION_KEY_HEX.slice(0, 64), "hex");
}

function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: iv(32 hex) + authTag(32 hex) + encrypted(hex)
  return iv.toString("hex") + authTag.toString("hex") + encrypted.toString("hex");
}

function decrypt(ciphertext: string): string {
  const key = getKey();
  const iv = Buffer.from(ciphertext.slice(0, 32), "hex");
  const authTag = Buffer.from(ciphertext.slice(32, 64), "hex");
  const encrypted = Buffer.from(ciphertext.slice(64), "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted).toString("utf8") + decipher.final("utf8");
}

function maskApiKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  return key.slice(0, 4) + "••••••••" + key.slice(-4);
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("user_settings")
    .select("openrouter_api_key, openrouter_enabled, openrouter_model_preset")
    .eq("user_id", user.id)
    .single();

  if (error && error.code !== "PGRST116") {
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }

  let maskedKey: string | null = null;
  let hasKey = false;
  if (data?.openrouter_api_key) {
    try {
      const decrypted = decrypt(data.openrouter_api_key);
      maskedKey = maskApiKey(decrypted);
      hasKey = true;
    } catch {
      hasKey = false;
    }
  }

  return NextResponse.json({
    hasKey,
    maskedKey,
    enabled: data?.openrouter_enabled ?? false,
    modelPreset: data?.openrouter_model_preset ?? "auto",
  });
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const updatePayload: Record<string, unknown> = {
      user_id: user.id,
      updated_at: new Date().toISOString(),
    };

    // API key update
    if (body.apiKey !== undefined) {
      if (body.apiKey === null || body.apiKey === "") {
        updatePayload.openrouter_api_key = null;
        updatePayload.openrouter_enabled = false;
      } else if (typeof body.apiKey === "string") {
        if (!body.apiKey.startsWith("sk-or-")) {
          return NextResponse.json(
            { error: "Invalid OpenRouter API key format. Keys start with sk-or-" },
            { status: 400 }
          );
        }
        updatePayload.openrouter_api_key = encrypt(body.apiKey);
      }
    }

    if (typeof body.enabled === "boolean") {
      updatePayload.openrouter_enabled = body.enabled;
    }

    if (typeof body.modelPreset === "string") {
      const validPresets = ["auto", "free", "quality", "balanced"];
      if (!validPresets.includes(body.modelPreset)) {
        return NextResponse.json({ error: "Invalid model preset" }, { status: 400 });
      }
      updatePayload.openrouter_model_preset = body.modelPreset;
    }

    const { error } = await supabase
      .from("user_settings")
      .upsert(updatePayload, { onConflict: "user_id" })
      .select()
      .single();

    if (error) {
      console.error("[OPENROUTER] Settings update error:", error);
      return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}

// DELETE — remove API key
export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("user_settings")
    .update({
      openrouter_api_key: null,
      openrouter_enabled: false,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: "Failed to remove API key" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
