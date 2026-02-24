import { NextResponse } from "next/server";

/**
 * DEPRECATED: This endpoint used the old email_pin column (AES-256-GCM encrypted).
 * All PIN management now goes through /api/settings/unified-pin which uses bcrypt.
 * This redirect prevents old frontend code from silently writing to dead columns.
 */
export async function POST() {
  return NextResponse.json(
    { error: "This endpoint is deprecated. Use /api/settings/unified-pin instead." },
    { status: 410 }
  );
}
