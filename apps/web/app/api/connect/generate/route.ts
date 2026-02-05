import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const WEBHOOK_SECRET = process.env.AGENT_WEBHOOK_SECRET;

/**
 * POST /api/connect/generate — Generate a connect link for OAuth.
 * Called by the agent server (authenticated via webhook secret).
 *
 * Body: { userId, purpose, serviceName }
 * Returns: { url }
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (!token || !WEBHOOK_SECRET || token !== WEBHOOK_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { userId, purpose, serviceName } = await request.json();

    if (!userId || !purpose || !serviceName) {
      return NextResponse.json(
        { error: "Missing required fields: userId, purpose, serviceName" },
        { status: 400 }
      );
    }

    // Create a simple JWT-like token (signed with HMAC-SHA256)
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        userId,
        purpose,
        serviceName,
        exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour expiry
      })
    ).toString("base64url");

    const signature = crypto
      .createHmac("sha256", WEBHOOK_SECRET)
      .update(`${header}.${payload}`)
      .digest("base64url");

    const jwt = `${header}.${payload}.${signature}`;

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const url = `${baseUrl}/connect/${jwt}`;

    return NextResponse.json({ url });
  } catch (err) {
    console.error("[CONNECT] Generate link error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
