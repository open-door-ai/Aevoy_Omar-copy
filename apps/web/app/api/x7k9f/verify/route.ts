import { NextRequest } from "next/server";
import { verifyAdminSession, secureResponse, secureError } from "@/lib/admin-auth";

/**
 * GET /api/x7k9f/verify
 * Lightweight session check for the admin dashboard layout.
 * Returns 200 if session is valid, 401 otherwise.
 */
export async function GET(request: NextRequest) {
  const session = await verifyAdminSession(request);
  if (!session) {
    return secureError("unauthorized", 401);
  }
  return secureResponse({ valid: true });
}
