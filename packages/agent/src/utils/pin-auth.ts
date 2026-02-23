/**
 * Unified PIN Authentication
 *
 * One PIN across all channels: Phone (DTMF), Email, SMS, Telegram, WhatsApp.
 * 5 wrong attempts = 1 hour lockout (shared counter via DB RPCs).
 *
 * PIN check order: unified_pin_hash (bcrypt) → voice_pin_hash (bcrypt) → voice_pin (legacy plaintext)
 * Auto-migrates legacy pins to unified_pin_hash on successful verification.
 */

import { getSupabaseClient } from "./supabase.js";
import { hashPin, verifyPinHash, isBcryptHash } from "./hashing.js";
import crypto from "crypto";

export type PinResult = "valid" | "invalid" | "locked" | "no_pin_set" | "error";

// In-memory session cache for Telegram/WhatsApp (linked accounts don't need PIN every message)
const sessionCache = new Map<string, { expiresAt: number }>();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Verify a user's PIN across all hash formats.
 * Handles lockout checking, attempt tracking, and auto-migration.
 */
export async function verifyUnifiedPin(userId: string, enteredPin: string): Promise<PinResult> {
  try {
    const supabase = getSupabaseClient();

    // 1. Check lockout via RPC
    const { data: isLocked } = await supabase.rpc("check_pin_lockout", { p_user_id: userId });
    if (isLocked) return "locked";

    // 2. Fetch all PIN fields
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, unified_pin_hash, voice_pin_hash, voice_pin")
      .eq("id", userId)
      .single();

    if (!profile) return "error";

    const hasAnyPin = profile.unified_pin_hash || profile.voice_pin_hash || profile.voice_pin;
    if (!hasAnyPin) return "no_pin_set";

    let pinMatch = false;

    // Priority 1: unified_pin_hash (bcrypt — canonical)
    if (profile.unified_pin_hash && isBcryptHash(profile.unified_pin_hash)) {
      pinMatch = await verifyPinHash(enteredPin, profile.unified_pin_hash);
    }

    // Priority 2: voice_pin_hash (bcrypt — old voice-specific)
    if (!pinMatch && profile.voice_pin_hash && isBcryptHash(profile.voice_pin_hash)) {
      pinMatch = await verifyPinHash(enteredPin, profile.voice_pin_hash);
    }

    // Priority 3: voice_pin (legacy plaintext or SHA-256)
    if (!pinMatch && profile.voice_pin) {
      const storedPin = profile.voice_pin;
      const isHashed = storedPin.length === 64 && /^[0-9a-f]{64}$/.test(storedPin);

      if (isHashed) {
        const enteredHash = crypto.createHash("sha256").update(`${profile.id}:${enteredPin}`).digest("hex");
        pinMatch = crypto.timingSafeEqual(Buffer.from(enteredHash), Buffer.from(storedPin));
      } else {
        // Plaintext comparison (timing-safe)
        const pinBuf = Buffer.from(enteredPin);
        const storedBuf = Buffer.from(storedPin);
        pinMatch = pinBuf.length === storedBuf.length && crypto.timingSafeEqual(pinBuf, storedBuf);
      }
    }

    if (pinMatch) {
      // Reset attempts on success
      await supabase.rpc("reset_pin_attempts", { p_user_id: userId });

      // Auto-migrate legacy pins to unified_pin_hash
      if (!profile.unified_pin_hash || !isBcryptHash(profile.unified_pin_hash)) {
        const bcryptHash = await hashPin(enteredPin);
        await supabase.from("profiles").update({
          unified_pin_hash: bcryptHash,
          voice_pin: null, // Clear plaintext
        }).eq("id", userId);
        console.log(`[PIN-AUTH] Migrated legacy pin to unified_pin_hash for ${userId.slice(0, 8)}`);
      }

      return "valid";
    }

    // Wrong PIN — increment attempts (locks at 5 for 1 hour via RPC)
    const { data: attempts } = await supabase.rpc("increment_pin_attempts", { p_user_id: userId });
    console.log(`[PIN-AUTH] Wrong PIN for ${userId.slice(0, 8)}, attempt ${attempts}/5`);

    if (attempts >= 5) return "locked";
    return "invalid";
  } catch (err) {
    console.error("[PIN-AUTH] Verification error:", err);
    return "error";
  }
}

/**
 * Check if a user has any PIN set.
 */
export async function hasPin(userId: string): Promise<boolean> {
  const { data: profile } = await getSupabaseClient()
    .from("profiles")
    .select("unified_pin_hash, voice_pin_hash, voice_pin")
    .eq("id", userId)
    .single();

  return !!(profile?.unified_pin_hash || profile?.voice_pin_hash || profile?.voice_pin);
}

/**
 * Check if a phone number belongs to the user.
 */
export async function isRegisteredPhone(userId: string, callerPhone: string): Promise<boolean> {
  const normalized = callerPhone.replace(/\D/g, "");
  if (!normalized) return false;

  const { data: profile } = await getSupabaseClient()
    .from("profiles")
    .select("phone_number")
    .eq("id", userId)
    .single();

  if (!profile?.phone_number) return false;
  return profile.phone_number.replace(/\D/g, "") === normalized;
}

/**
 * Check if an email address belongs to the user (registered email or @aevoy.com address).
 */
export async function isRegisteredEmail(userId: string, senderEmail: string): Promise<boolean> {
  const normalized = senderEmail.toLowerCase().trim();

  const { data: profile } = await getSupabaseClient()
    .from("profiles")
    .select("email, username")
    .eq("id", userId)
    .single();

  if (!profile) return false;

  // Check primary email
  if (profile.email && profile.email.toLowerCase() === normalized) return true;

  // Check @aevoy.com alias
  if (profile.username && `${profile.username.toLowerCase()}@aevoy.com` === normalized) return true;

  return false;
}

/**
 * Get remaining PIN attempts before lockout.
 */
export async function getRemainingAttempts(userId: string): Promise<number> {
  const { data: profile } = await getSupabaseClient()
    .from("profiles")
    .select("pin_attempts")
    .eq("id", userId)
    .single();

  return Math.max(0, 5 - (profile?.pin_attempts || 0));
}

/**
 * Session management for channels with persistent identity (Telegram/WhatsApp).
 * Once authenticated, the session lasts 24 hours.
 */
export function setSessionAuthenticated(channelKey: string): void {
  sessionCache.set(channelKey, { expiresAt: Date.now() + SESSION_TTL_MS });
}

export function isSessionAuthenticated(channelKey: string): boolean {
  const session = sessionCache.get(channelKey);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    sessionCache.delete(channelKey);
    return false;
  }
  return true;
}

export function clearSession(channelKey: string): void {
  sessionCache.delete(channelKey);
}
