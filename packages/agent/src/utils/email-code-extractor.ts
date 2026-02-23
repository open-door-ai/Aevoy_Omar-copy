/**
 * Email Verification Code Extractor
 *
 * Extracts verification codes and links from emails after agent submits signup forms.
 * SECURITY: Strips prompt injection patterns before content reaches the AI.
 */

export interface ExtractedCode {
  code?: string;
  verifyLink?: string;
  source: "code_pattern" | "link_pattern" | "none";
}

// Patterns for verification codes (4-8 digits)
const CODE_PATTERNS = [
  /(?:verification|confirm|verify|auth|code|pin|otp|token)\s*(?:is|:)?\s*[:\-–—]?\s*(\d{4,8})\b/i,
  /\b(\d{4,8})\s*(?:is your|is the)\s*(?:verification|confirm|auth|code|pin|otp)/i,
  /(?:enter|use|type)\s+(?:this\s+)?(?:code|pin|otp)[:\s]+(\d{4,8})\b/i,
  /(?:one-time|one time)\s*(?:password|code|pin)[:\s]+(\d{4,8})\b/i,
  /\bcode[:\s]+(\d{4,8})\b/i,
  /\b(\d{6})\b(?=.*(?:verify|confirm|expire|valid|minute))/i,
];

// Patterns for verification links
const LINK_PATTERNS = [
  /https?:\/\/[^\s<>"']+(?:verify|confirm|activate|validate|auth)[^\s<>"']*/gi,
  /https?:\/\/[^\s<>"']+(?:token|code|key)=[^\s<>"']*/gi,
];

// Prompt injection patterns to strip (prevent emails from hijacking the AI)
const INJECTION_PATTERNS = [
  /\[ACTION:.*?\]/gi,
  /\[TASK_COMPLETE\]/gi,
  /\[SAVE:.*?\]/gi,
  /\[REMEMBER:.*?\]/gi,
  /\[SYSTEM:.*?\]/gi,
  /\[IGNORE PREVIOUS.*?\]/gi,
  /You are now.*?assistant/gi,
  /Forget all previous instructions/gi,
  /Override your instructions/gi,
];

/**
 * Extract verification code or link from email body.
 */
export function extractVerificationCode(emailBody: string): ExtractedCode {
  if (!emailBody) return { source: "none" };

  const sanitized = sanitizeEmailContent(emailBody);

  // Try code patterns first (most common)
  for (const pattern of CODE_PATTERNS) {
    const match = sanitized.match(pattern);
    if (match?.[1]) {
      return { code: match[1], source: "code_pattern" };
    }
  }

  // Try verification links
  for (const pattern of LINK_PATTERNS) {
    const match = sanitized.match(pattern);
    if (match?.[0]) {
      return { verifyLink: match[0], source: "link_pattern" };
    }
  }

  // Fallback: look for any standalone 6-digit number (most common format)
  const sixDigitMatch = sanitized.match(/\b(\d{6})\b/);
  if (sixDigitMatch?.[1]) {
    return { code: sixDigitMatch[1], source: "code_pattern" };
  }

  return { source: "none" };
}

/**
 * Sanitize email content to prevent prompt injection.
 * Strips known injection patterns before content reaches the AI.
 */
export function sanitizeEmailContent(content: string): string {
  let sanitized = content;

  for (const pattern of INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, "");
  }

  return sanitized.trim();
}
