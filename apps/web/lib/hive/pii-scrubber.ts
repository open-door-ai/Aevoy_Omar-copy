// PII patterns for regex-based scrubbing
const PII_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  // Email addresses
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[EMAIL]' },
  // Phone numbers (various formats)
  { pattern: /(\+?1?[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, replacement: '[PHONE]' },
  // International phone numbers
  { pattern: /\+\d{1,3}[-.\s]?\d{4,14}/g, replacement: '[PHONE]' },
  // Credit card numbers (13-19 digits, with optional separators)
  { pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{1,7}\b/g, replacement: '[CARD]' },
  // SSN (XXX-XX-XXXX)
  { pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g, replacement: '[SSN]' },
  // IP addresses (IPv4)
  { pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, replacement: '[IP]' },
  // URLs with user-specific paths (account IDs, user IDs in paths)
  { pattern: /https?:\/\/[^\s]+\/(?:account|user|profile|order|booking|settings)\/[^\s]*/gi, replacement: '[URL]' },
  // Account/order numbers (6+ consecutive digits not part of a date)
  { pattern: /\b(?:account|order|booking|confirmation|reference|ref|id|#)\s*[:#]?\s*\d{6,}\b/gi, replacement: '[ACCOUNT]' },
  // Standalone long digit sequences (8+ digits, likely account numbers)
  { pattern: /\b\d{8,}\b/g, replacement: '[ACCOUNT]' },
  // Names preceded by titles
  { pattern: /\b(?:Mr|Mrs|Ms|Miss|Dr|Prof|Sir|Madam)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g, replacement: '[NAME]' },
  // Street addresses (number + street name pattern)
  { pattern: /\b\d{1,5}\s+(?:[A-Z][a-z]+\s+){1,3}(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Ln|Lane|Ct|Court|Way|Pl|Place|Cir|Circle)\b\.?/gi, replacement: '[ADDRESS]' },
  // Zip codes in address context
  { pattern: /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/g, replacement: '[ADDRESS]' },
];

/**
 * Strip all personally identifiable information from text using regex patterns.
 * This is the first pass — fast and deterministic.
 */
export function regexScrub(text: string): string {
  let scrubbed = text;
  for (const { pattern, replacement } of PII_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, replacement);
  }
  return scrubbed;
}

/**
 * Second pass: Use DeepSeek AI to catch any PII the regex missed.
 * Returns the cleaned text.
 */
export async function aiScrub(text: string): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    // If no API key, return regex-scrubbed only
    return text;
  }

  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: 'You are a PII detection assistant. Review the text and identify any remaining personal information. Replace any personal info (names, emails, phone numbers, addresses, account numbers, credit card numbers, SSNs, IP addresses, usernames, or any other identifying information) with [REDACTED]. If no personal info is found, return the text exactly as-is. Return ONLY the cleaned text, nothing else.',
          },
          {
            role: 'user',
            content: text,
          },
        ],
        temperature: 0,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      console.error('[PII-Scrubber] AI scrub failed, using regex-only result');
      return text;
    }

    const data = await response.json();
    const cleaned = data.choices?.[0]?.message?.content?.trim();
    return cleaned || text;
  } catch (error) {
    console.error('[PII-Scrubber] AI scrub error:', error);
    return text;
  }
}

/**
 * Full PII scrubbing pipeline: regex first, then AI review.
 */
export async function scrubPII(text: string): Promise<string> {
  // Step 1: Fast regex scrub
  const regexCleaned = regexScrub(text);
  // Step 2: AI review for anything missed
  const aiCleaned = await aiScrub(regexCleaned);
  return aiCleaned;
}

/**
 * Scrub all string fields in a structured object.
 * Recursively processes nested objects and arrays.
 */
export async function scrubObject(obj: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = await scrubPII(value);
    } else if (Array.isArray(value)) {
      result[key] = await Promise.all(
        value.map(async (item) => {
          if (typeof item === 'string') return scrubPII(item);
          if (typeof item === 'object' && item !== null) return scrubObject(item as Record<string, unknown>);
          return item;
        })
      );
    } else if (typeof value === 'object' && value !== null) {
      result[key] = await scrubObject(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}
