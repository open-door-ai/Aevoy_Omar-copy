/**
 * Identity Resolver
 *
 * Resolves a user from a phone number or email address.
 * Uses normalized matching for consistent identity resolution across channels.
 */

import { getSupabaseClient } from "../../utils/supabase.js";
import { normalizeEmail, normalizePhone } from "./normalizer.js";
import type { ResolvedUser } from "../../types/index.js";

/**
 * Resolve a user from any identifier (email or phone).
 * Normalizes the identifier before querying.
 */
export async function resolveUser(identifier: string): Promise<ResolvedUser | null> {
  // Detect if identifier looks like a phone number or email
  const isPhone = /^\+?\d[\d\s\-().]{7,}$/.test(identifier.trim());

  if (isPhone) {
    return resolveByPhone(identifier);
  } else if (identifier.includes("@")) {
    return resolveByEmail(identifier);
  }

  return null;
}

/**
 * Resolve user by email address.
 */
async function resolveByEmail(email: string): Promise<ResolvedUser | null> {
  const normalized = normalizeEmail(email);

  const { data, error } = await getSupabaseClient()
    .from("profiles")
    .select("id, username, email, twilio_number")
    .eq("email", normalized)
    .single();

  if (error || !data) {
    // Try original email as fallback (in case normalization removed valid parts)
    const { data: fallback } = await getSupabaseClient()
      .from("profiles")
      .select("id, username, email, twilio_number")
      .eq("email", email.trim().toLowerCase())
      .single();

    if (!fallback) return null;
    return {
      userId: fallback.id,
      username: fallback.username,
      email: fallback.email,
      phone: fallback.twilio_number,
    };
  }

  return {
    userId: data.id,
    username: data.username,
    email: data.email,
    phone: data.twilio_number,
  };
}

/**
 * Resolve user by phone number.
 */
async function resolveByPhone(phone: string): Promise<ResolvedUser | null> {
  const normalized = normalizePhone(phone);

  const { data, error } = await getSupabaseClient()
    .from("profiles")
    .select("id, username, email, twilio_number")
    .eq("twilio_number", normalized)
    .single();

  if (error || !data) return null;

  return {
    userId: data.id,
    username: data.username,
    email: data.email,
    phone: data.twilio_number,
  };
}
