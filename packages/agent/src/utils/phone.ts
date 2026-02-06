/**
 * Phone number normalization utilities
 * Handles various phone number formats and normalizes to E.164
 */

/**
 * Normalize phone number to E.164 format
 * Handles: +17781234567, 17781234567, 7781234567, (778) 123-4567
 * Returns: +17781234567 (US/CA default)
 */
export function normalizePhone(phone: string): string {
  const hasPlus = phone.trim().startsWith("+");
  const digits = phone.replace(/\D/g, ""); // Remove all non-digits

  if (!digits) return "";

  // If 11 digits starting with 1 (US/CA with country code)
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  // If 10 digits, assume US/CA (prepend +1)
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  // If had + prefix and longer than 11 digits, assume international
  if (hasPlus && digits.length > 11) {
    return `+${digits}`;
  }

  // Otherwise, assume US/CA
  if (digits.length >= 10) {
    return `+${digits}`;
  }

  // Invalid format, return original
  return phone.trim();
}

/**
 * Extract normalized digits for database lookup
 * +17781234567 → 17781234567
 */
export function normalizedDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}
