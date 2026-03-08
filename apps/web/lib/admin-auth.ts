import { getAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, createHash } from "crypto";

export interface AdminSession {
  id: string;
  session_token_hash: string;
  ip_address: string;
  fingerprint: string | null;
  expires_at: string;
  created_at: string;
  last_activity_at: string;
}

// Hash session token before DB storage/lookup (V03 fix)
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function getClientIP(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export function getFingerprint(request: NextRequest): string {
  const ua = request.headers.get("user-agent") || "";
  const lang = request.headers.get("accept-language") || "";
  return createHash("sha256").update(`${ua}|${lang}`).digest("hex").slice(0, 64);
}

// Sanitize search input for PostgREST .or()/.ilike() (V01 fix)
export function sanitizeSearch(input: string): string {
  // Strip characters that could break PostgREST filter syntax
  return input.replace(/[,().*%\\]/g, "").trim().slice(0, 100);
}

// Add security headers to admin responses (V38 fix)
export function secureResponse(data: unknown, status = 200): NextResponse {
  const res = NextResponse.json(data, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

export function secureError(error: string, status: number): NextResponse {
  return secureResponse({ error }, status);
}

const ABSOLUTE_SESSION_MAX_MS = 8 * 60 * 60 * 1000; // 8 hours (V30 fix)
const REFRESH_DEBOUNCE_MS = 5 * 60 * 1000; // 5 min (V35 fix)

export async function verifyAdminSession(request: NextRequest): Promise<AdminSession | null> {
  const token = request.cookies.get("admin-session")?.value;
  if (!token || token.length < 32) return null;

  const supabase = getAdminClient();
  const now = new Date();
  const tokenHash = hashToken(token);

  // V04 fix: Query by token hash
  const { data: session, error } = await supabase
    .from("admin_sessions")
    .select("*")
    .eq("session_token", tokenHash)
    .gt("expires_at", now.toISOString())
    .single();

  if (error || !session) return null;

  // IP binding: reject session if request IP differs from login IP.
  // This prevents stolen session cookies from being replayed from a different IP.
  // Gracefully skip check if session was created before IP was stored (ip_address is null).
  if (session.ip_address) {
    const currentIP = getClientIP(request);
    if (currentIP !== "unknown" && session.ip_address !== currentIP) {
      return null;
    }
  }

  // V30 fix: Enforce absolute session max (8 hours)
  const createdAt = new Date(session.created_at).getTime();
  if (now.getTime() - createdAt > ABSOLUTE_SESSION_MAX_MS) {
    await supabase.from("admin_sessions").delete().eq("id", session.id);
    return null;
  }

  // V35 fix: Only refresh if last activity > 5 min ago
  const lastActivity = new Date(session.last_activity_at).getTime();
  if (now.getTime() - lastActivity > REFRESH_DEBOUNCE_MS) {
    await supabase
      .from("admin_sessions")
      .update({
        expires_at: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
        last_activity_at: now.toISOString(),
      })
      .eq("id", session.id);
  }

  return session as AdminSession;
}

export async function requireAdmin(request: NextRequest): Promise<{ session: AdminSession } | { error: NextResponse }> {
  // V13 fix: Validate content-type for POST/PATCH
  if (request.method === "POST" || request.method === "PATCH") {
    const ct = request.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return { error: secureError("unsupported_media_type", 415) };
    }
  }

  const session = await verifyAdminSession(request);
  if (!session) {
    return { error: secureError("unauthorized", 401) };
  }
  return { session };
}

// V29 fix: Log errors from audit inserts
export async function logAdminAction(
  sessionId: string | undefined,
  action: string,
  targetType?: string,
  targetId?: string,
  notes?: string,
) {
  try {
    const supabase = getAdminClient();
    const { error } = await supabase.from("admin_audit_log").insert({
      admin_session_id: sessionId || null,
      action,
      target_type: targetType || null,
      target_id: targetId || null,
      notes: notes ? notes.slice(0, 2000) : null, // V12: length limit
    });
    if (error) console.error("Audit log insert failed:", error.message);
  } catch (err) {
    console.error("Audit log error:", err instanceof Error ? err.message : "unknown");
  }
}
