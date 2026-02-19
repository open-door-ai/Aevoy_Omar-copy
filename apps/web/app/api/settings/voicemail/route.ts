import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_AUDIO_TYPES = [
  "audio/mpeg",
  "audio/wav",
  "audio/webm",
  "audio/ogg",
];

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const MIME_TO_EXT: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
};

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("user_settings")
    .select(
      "voicemail_enabled, voicemail_greeting_text, voicemail_greeting_url"
    )
    .eq("user_id", user.id)
    .single();

  if (error && error.code !== "PGRST116") {
    console.error("[VOICEMAIL] Settings fetch error:", error);
    return NextResponse.json(
      { error: "Failed to load voicemail settings" },
      { status: 500 }
    );
  }

  // Generate fresh signed URL if a file path is stored
  let greetingUrl: string | null = null;
  if (data?.voicemail_greeting_url) {
    const { data: signedData } = await supabase.storage
      .from("voicemail-greetings")
      .createSignedUrl(data.voicemail_greeting_url, 60 * 60); // 1 hour
    greetingUrl = signedData?.signedUrl || null;
  }

  return NextResponse.json({
    voicemail_enabled: data?.voicemail_enabled ?? true,
    voicemail_greeting_text: data?.voicemail_greeting_text ?? null,
    voicemail_greeting_url: greetingUrl,
  });
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const updatePayload: Record<string, unknown> = {
      user_id: user.id,
      updated_at: new Date().toISOString(),
    };

    if (body.voicemail_enabled !== undefined) {
      if (typeof body.voicemail_enabled !== "boolean") {
        return NextResponse.json(
          { error: "voicemail_enabled must be a boolean" },
          { status: 400 }
        );
      }
      updatePayload.voicemail_enabled = body.voicemail_enabled;
    }

    if (body.voicemail_greeting_text !== undefined) {
      if (
        body.voicemail_greeting_text !== null &&
        typeof body.voicemail_greeting_text !== "string"
      ) {
        return NextResponse.json(
          { error: "voicemail_greeting_text must be a string or null" },
          { status: 400 }
        );
      }
      if (
        typeof body.voicemail_greeting_text === "string" &&
        body.voicemail_greeting_text.length > 1000
      ) {
        return NextResponse.json(
          { error: "voicemail_greeting_text must be 1000 characters or fewer" },
          { status: 400 }
        );
      }
      updatePayload.voicemail_greeting_text = body.voicemail_greeting_text;
    }

    const { error } = await supabase
      .from("user_settings")
      .upsert(updatePayload, { onConflict: "user_id" })
      .select()
      .single();

    if (error) {
      console.error("[VOICEMAIL] Settings update error:", error);
      return NextResponse.json(
        { error: "Failed to update voicemail settings" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    if (!ALLOWED_AUDIO_TYPES.includes(file.type)) {
      return NextResponse.json(
        {
          error: `Invalid file type: ${file.type}. Allowed: ${ALLOWED_AUDIO_TYPES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 5MB." },
        { status: 400 }
      );
    }

    const ext = MIME_TO_EXT[file.type] || "mp3";
    const filePath = `${user.id}/greeting.${ext}`;

    // Delete old file if it exists (ignore errors — file may not exist)
    const { data: existingFiles } = await supabase.storage
      .from("voicemail-greetings")
      .list(user.id);

    if (existingFiles && existingFiles.length > 0) {
      const filesToRemove = existingFiles.map(
        (f) => `${user.id}/${f.name}`
      );
      await supabase.storage
        .from("voicemail-greetings")
        .remove(filesToRemove);
    }

    // Upload new file
    const arrayBuffer = await file.arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from("voicemail-greetings")
      .upload(filePath, arrayBuffer, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      console.error("[VOICEMAIL] Upload error:", uploadError);
      return NextResponse.json(
        { error: "Failed to upload audio file" },
        { status: 500 }
      );
    }

    // Get signed URL (bucket is private)
    const { data: signedData, error: signError } = await supabase.storage
      .from("voicemail-greetings")
      .createSignedUrl(filePath, 60 * 60 * 24 * 365); // 1 year

    const url = signedData?.signedUrl || filePath;
    if (signError) {
      console.error("[VOICEMAIL] Signed URL error:", signError);
    }

    // Store the file path (not the signed URL) so we can re-sign later
    const { error: updateError } = await supabase
      .from("user_settings")
      .upsert(
        {
          user_id: user.id,
          voicemail_greeting_url: filePath,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      )
      .select()
      .single();

    if (updateError) {
      console.error("[VOICEMAIL] Settings update error:", updateError);
      return NextResponse.json(
        { error: "File uploaded but failed to update settings" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, url });
  } catch (err) {
    console.error("[VOICEMAIL] Upload handler error:", err);
    return NextResponse.json(
      { error: "Failed to process upload" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // List and delete all files in the user's voicemail directory
    const { data: existingFiles } = await supabase.storage
      .from("voicemail-greetings")
      .list(user.id);

    if (existingFiles && existingFiles.length > 0) {
      const filesToRemove = existingFiles.map(
        (f) => `${user.id}/${f.name}`
      );
      const { error: removeError } = await supabase.storage
        .from("voicemail-greetings")
        .remove(filesToRemove);

      if (removeError) {
        console.error("[VOICEMAIL] Storage delete error:", removeError);
        return NextResponse.json(
          { error: "Failed to delete audio file" },
          { status: 500 }
        );
      }
    }

    // Set voicemail_greeting_url to null
    const { error: updateError } = await supabase
      .from("user_settings")
      .update({
        voicemail_greeting_url: null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);

    if (updateError) {
      console.error("[VOICEMAIL] Settings update error:", updateError);
      return NextResponse.json(
        { error: "Failed to update settings" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[VOICEMAIL] Delete handler error:", err);
    return NextResponse.json(
      { error: "Failed to delete voicemail greeting" },
      { status: 500 }
    );
  }
}
