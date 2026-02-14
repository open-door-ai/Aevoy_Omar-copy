/**
 * Logging utilities with PII protection
 * SECURITY: All functions mask PII before logging to prevent data leaks
 */

/**
 * Mask phone number for logging (shows last 4 digits only)
 * Example: +17789008951 -> ***8951
 */
export function maskPhone(phone: string | undefined | null): string {
  if (!phone) return '***';
  const cleaned = phone.replace(/[^\d]/g, '');
  if (cleaned.length < 4) return '***';
  return `***${cleaned.slice(-4)}`;
}

/**
 * Mask email for logging (shows domain only)
 * Example: user@example.com -> ***@example.com
 */
export function maskEmail(email: string | undefined | null): string {
  if (!email) return '***';
  const parts = email.split('@');
  if (parts.length !== 2) return '***';
  return `***@${parts[1]}`;
}

/**
 * Mask user ID for logging (shows first 8 chars only)
 * Example: 11684ec6-80cd-4bb6-9aed-8f0947afd06a -> 11684ec6
 */
export function maskUserId(userId: string | undefined | null): string {
  if (!userId) return '***';
  return userId.slice(0, 8);
}

/**
 * Mask PIN/code for logging (shows length only)
 * Example: 123456 -> ******
 */
export function maskPin(pin: string | undefined | null): string {
  if (!pin) return '***';
  return '*'.repeat(pin.length);
}
