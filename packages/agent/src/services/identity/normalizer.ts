/**
 * Identity Normalizer
 *
 * Normalizes email addresses and phone numbers for consistent matching.
 */

/**
 * Normalize an email address:
 * - Lowercase
 * - Trim whitespace
 * - Gmail: remove dots and plus aliases from local part
 */
export function normalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const [localPart, domain] = trimmed.split("@");
  if (!localPart || !domain) return trimmed;

  // Gmail-specific: remove dots and plus aliases
  if (domain === "gmail.com" || domain === "googlemail.com") {
    const withoutPlus = localPart.split("+")[0];
    const withoutDots = withoutPlus.replace(/\./g, "");
    return `${withoutDots}@gmail.com`;
  }

  return `${localPart}@${domain}`;
}

/**
 * Normalize a phone number to E.164 format (+1XXXXXXXXXX for US/CA).
 * Strips all non-digit characters, ensures country code.
 */
export function normalizePhone(phone: string): string {
  // Strip everything except digits and leading +
  const hasPlus = phone.trim().startsWith("+");
  const digits = phone.replace(/\D/g, "");

  if (!digits) return "";

  // If already has country code (11+ digits starting with 1 for US/CA)
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  // If 10 digits, assume US/CA
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  // If had a + prefix, keep as-is (international)
  if (hasPlus) {
    return `+${digits}`;
  }

  // Otherwise, assume US and prepend +1
  if (digits.length >= 10) {
    return `+${digits}`;
  }

  return phone.trim(); // Can't normalize, return as-is
}
