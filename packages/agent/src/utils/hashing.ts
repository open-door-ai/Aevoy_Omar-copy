/**
 * Secure PIN hashing utilities
 * SECURITY: PINs should be hashed (like passwords), not encrypted
 *
 * Uses bcrypt for hashing to prevent rainbow table attacks
 */

import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12; // Higher = more secure but slower

/**
 * Hash a PIN for secure storage
 * Example: hashPin("123456") => "$2b$12$..."
 */
export async function hashPin(pin: string): Promise<string> {
  if (!pin || pin.length < 4 || pin.length > 8) {
    throw new Error("PIN must be 4-8 characters");
  }
  return bcrypt.hash(pin, SALT_ROUNDS);
}

/**
 * Verify an entered PIN against a hashed PIN
 * Constant-time comparison to prevent timing attacks
 */
export async function verifyPinHash(enteredPin: string, hashedPin: string): Promise<boolean> {
  try {
    return await bcrypt.compare(enteredPin, hashedPin);
  } catch (error) {
    console.error("[HASHING] PIN verification error:", error);
    return false;
  }
}

/**
 * Check if a string is already a bcrypt hash
 * Bcrypt hashes start with $2a$, $2b$, or $2y$
 */
export function isBcryptHash(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^\$2[aby]\$\d{2}\$/.test(value);
}
