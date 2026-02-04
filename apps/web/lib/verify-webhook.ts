import crypto from "crypto";

/**
 * Timing-safe webhook secret comparison.
 * Prevents timing attacks that could leak the secret character by character.
 */
export function verifyWebhookSecret(provided: string | null | undefined): boolean {
  const expected = process.env.AGENT_WEBHOOK_SECRET;
  if (!provided || !expected) return false;
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}
