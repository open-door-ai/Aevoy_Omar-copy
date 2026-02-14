/**
 * PII Scrubber for Hive Mind Learning Uploads
 * Removes personally identifiable information before sharing to global hub
 */

// PII patterns to scrub
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /(\+?\d{1,3}[-.\s]?)?(\(?\d{3}\)?[-.\s]?)?[\d]{3}[-.\s]?[\d]{4}/g;
const SSN_REGEX = /\d{3}-\d{2}-\d{4}/g;
const CREDIT_CARD_REGEX = /\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}/g;
const IP_REGEX = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const URL_WITH_PARAMS_REGEX = /https?:\/\/[^\s]+\?[^\s]+/g; // URLs with query params (may contain tokens)

// Common PII field names to remove entirely
const PII_FIELDS = new Set([
  'email',
  'phone',
  'phoneNumber',
  'phone_number',
  'name',
  'firstName',
  'lastName',
  'first_name',
  'last_name',
  'address',
  'city',
  'state',
  'zip',
  'zipCode',
  'zip_code',
  'ssn',
  'password',
  'apiKey',
  'api_key',
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'secret',
  'creditCard',
  'credit_card',
  'cvv',
  'username',  // Keep action types like 'click' but scrub usernames in params
]);

/**
 * Scrub PII from a string value
 */
function scrubString(str: string): string {
  if (typeof str !== 'string') return str;

  return str
    .replace(EMAIL_REGEX, '[EMAIL_REDACTED]')
    .replace(PHONE_REGEX, '[PHONE_REDACTED]')
    .replace(SSN_REGEX, '[SSN_REDACTED]')
    .replace(CREDIT_CARD_REGEX, '[CARD_REDACTED]')
    .replace(IP_REGEX, '[IP_REDACTED]')
    .replace(URL_WITH_PARAMS_REGEX, (url) => {
      // Keep base URL but remove query params (may contain tokens/sessions)
      const baseUrl = url.split('?')[0];
      return `${baseUrl}?[PARAMS_REDACTED]`;
    });
}

/**
 * Scrub PII from an object (recursively)
 */
function scrubObject(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return scrubString(obj);
  if (typeof obj === 'number' || typeof obj === 'boolean') return obj;

  if (Array.isArray(obj)) {
    return obj.map(scrubObject);
  }

  if (typeof obj === 'object') {
    const scrubbed: any = {};

    for (const [key, value] of Object.entries(obj)) {
      // Skip PII fields entirely
      if (PII_FIELDS.has(key)) {
        scrubbed[key] = '[REDACTED]';
        continue;
      }

      // Recursively scrub nested values
      scrubbed[key] = scrubObject(value);
    }

    return scrubbed;
  }

  return obj;
}

/**
 * Scrub PII from action params before uploading to Hive Mind
 */
export function scrubActionParams(params: Record<string, unknown>): Record<string, unknown> {
  // Keep the structure but scrub sensitive data
  const scrubbed = scrubObject(params);

  // Special handling for common patterns
  if (scrubbed.selector && typeof scrubbed.selector === 'string') {
    // Keep CSS selectors but scrub any values in attribute selectors
    scrubbed.selector = (scrubbed.selector as string)
      .replace(/\[([a-zA-Z-]+)=["']([^"']+)["']\]/g, (match, attr, value) => {
        // Keep attribute name but scrub value if it looks like PII
        if (EMAIL_REGEX.test(value) || PHONE_REGEX.test(value)) {
          return `[${attr}="[REDACTED]"]`;
        }
        return match;
      });
  }

  return scrubbed;
}

/**
 * Check if user has opted in to Hive learning uploads
 */
export async function hasHiveLearningConsent(userId: string): Promise<boolean> {
  try {
    const { getSupabaseClient } = await import("./supabase.js");
    const { data } = await getSupabaseClient()
      .from('profiles')
      .select('allow_hive_learning')
      .eq('id', userId)
      .single();

    // Default to true if field doesn't exist (backwards compat)
    return data?.allow_hive_learning !== false;
  } catch (error) {
    console.error('[HIVE] Error checking learning consent:', error);
    // Fail open: allow learning uploads unless explicitly disabled
    return true;
  }
}
