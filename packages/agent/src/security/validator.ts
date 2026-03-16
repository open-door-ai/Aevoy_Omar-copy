/**
 * Action Validator + Input Sanitizer
 *
 * Every action goes through this firewall.
 * Validates against the locked intent and checks for suspicious patterns.
 * Also provides input sanitization for incoming user messages.
 */

import { LockedIntent, validateAction } from './intent-lock.js';

// ---- Input Sanitization ----

const MAX_SUBJECT_LENGTH = 500;
const MAX_BODY_LENGTH = 15_000;

// Prompt injection patterns detected in user messages
const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /forget\s+(everything|all\s+previous)/i,
  /new\s+instructions?\s*:/i,
  /system\s+prompt\s*:/i,
  /you\s+(are\s+)?now\s+(a|an)\s+\w/i,
  /act\s+as\s+(a\s+)?(different|new|another)\s+(ai|assistant|bot|model)/i,
  /pretend\s+(you\s+are|to\s+be)\s+(a\s+)?(different|evil|uncensored|jailbroken)/i,
  /jailbreak\s*(mode)?/i,
  /dan\s+mode|developer\s+mode\s+enabled/i,
  /disregard\s+(your|all)\s+(previous\s+)?(instructions|guidelines|rules)/i,
  /override\s+(your\s+)?(safety|security|guidelines|instructions)/i,
  /repeat\s+(your\s+)?(system\s+prompt|instructions|training)/i,
  /print\s+(your\s+)?(system\s+prompt|hidden\s+instructions)/i,
  /reveal\s+(your\s+)?(system\s+prompt|hidden\s+instructions|api\s+key)/i,
  /what\s+are\s+your\s+(exact\s+)?(instructions|system\s+prompt|guidelines)/i,
  // Advanced prompt injection patterns
  /system\s*prompt/i,
  /you\s+are\s+now/i,
  /new\s+instructions?:/i,
  /override\s+(?:your|the|all)\s+(?:instructions|rules|settings)/i,
  /disregard\s+(?:previous|all|your)/i,
  /act\s+as\s+(?:if|though)/i,
  /pretend\s+(?:you|to\s+be)/i,
  /(?:reveal|show|display|output)\s+(?:your|the)\s+(?:system|initial|original)\s+(?:prompt|instructions)/i,
  /(?:what|tell\s+me)\s+(?:is|are)\s+your\s+(?:instructions|rules|prompt)/i,
  /jailbreak/i,
  /DAN\s+mode/i,
  /developer\s+mode\s+enabled/i,
];

// SSRF / path traversal patterns in URLs or values
const SSRF_PATTERNS: RegExp[] = [
  /file:\/\//i,
  /\bdata:text\/html/i,
  /\blocalhost\b/i,
  /\b127\.\d+\.\d+\.\d+/,
  /\b10\.\d+\.\d+\.\d+/,
  /\b172\.(1[6-9]|2\d|3[01])\.\d+\.\d+/,
  /\b192\.168\.\d+\.\d+/,
  /\b169\.254\.\d+\.\d+/, // Link-local
  /\b0\.0\.0\.0\b/,
  /\bmetadata\.google\.internal\b/i,
  /169\.254\.169\.254/, // AWS metadata endpoint
  /fd00:/i, // IPv6 private
];

export interface SanitizeResult {
  subject: string;
  body: string;
  injectionDetected: boolean;
  injectionPattern?: string;
}

/**
 * Sanitize incoming task subject + body.
 * - Truncates to max lengths
 * - Strips HTML/script tags
 * - Strips Unicode control characters (zero-width, RTL override, etc.)
 * - Detects prompt injection attempts
 * - Detects SSRF patterns in body
 */
export function sanitizeTaskInput(subject: string, body: string): SanitizeResult {
  // Truncate first (cheap check before regex)
  let cleanSubject = String(subject || '').slice(0, MAX_SUBJECT_LENGTH);
  let cleanBody = String(body || '').slice(0, MAX_BODY_LENGTH);

  // Strip HTML tags (prevent XSS if content ever rendered, and prevents HTML injection)
  cleanSubject = cleanSubject.replace(/<[^>]*>/g, ' ').trim();
  cleanBody = cleanBody.replace(/<[^>]*>/g, ' ').trim();

  // Strip dangerous Unicode: zero-width chars, RTL override, homoglyph confusables
  const stripUnicode = (s: string) =>
    s.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u00AD]/g, '');
  cleanSubject = stripUnicode(cleanSubject);
  cleanBody = stripUnicode(cleanBody);

  // Check for prompt injection in combined input
  const combined = `${cleanSubject} ${cleanBody}`;
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(combined)) {
      console.warn(`[SECURITY] Prompt injection pattern detected: pattern index ${PROMPT_INJECTION_PATTERNS.indexOf(pattern)}`);
      return {
        subject: cleanSubject,
        body: cleanBody,
        injectionDetected: true,
        injectionPattern: pattern.source,
      };
    }
  }

  // Check for SSRF patterns
  for (const pattern of SSRF_PATTERNS) {
    if (pattern.test(cleanBody)) {
      console.warn(`[SECURITY] SSRF pattern detected: pattern index ${SSRF_PATTERNS.indexOf(pattern)}`);
      return {
        subject: cleanSubject,
        body: cleanBody,
        injectionDetected: true,
        injectionPattern: `SSRF: ${pattern.source}`,
      };
    }
  }

  return { subject: cleanSubject, body: cleanBody, injectionDetected: false };
}

export class ActionValidator {
  private intent: LockedIntent;
  private actionsExecuted = 0;
  private startTime = new Date();
  
  constructor(intent: LockedIntent) {
    this.intent = intent;
  }
  
  async validate(action: { 
    type: string; 
    domain?: string; 
    target?: string; 
    value?: string 
  }): Promise<{ approved: boolean; reason?: string }> {
    // Check time limit
    const elapsed = (Date.now() - this.startTime.getTime()) / 1000;
    if (elapsed > this.intent.maxDuration) {
      return { 
        approved: false, 
        reason: `Task exceeded ${this.intent.maxDuration}s time limit` 
      };
    }
    
    // Check action limit (prevent infinite loops)
    this.actionsExecuted++;
    if (this.actionsExecuted > this.intent.maxActions) {
      return { 
        approved: false, 
        reason: `Too many actions (max ${this.intent.maxActions})` 
      };
    }
    
    // Validate against intent
    const intentCheck = validateAction(this.intent, action);
    if (!intentCheck.allowed) {
      return { approved: false, reason: intentCheck.reason };
    }
    
    // Check for prompt injection patterns
    const suspicious = this.checkSuspiciousPatterns(action);
    if (!suspicious.safe) {
      return { approved: false, reason: suspicious.reason };
    }
    
    return { approved: true };
  }
  
  private domainActionCounts: Map<string, { count: number; resetTime: number }> = new Map();
  private static readonly DOMAIN_RATE_LIMIT = 20; // max actions per domain per 60s
  private static readonly DOMAIN_RATE_WINDOW_MS = 60000;

  private checkSuspiciousPatterns(action: { type?: string; value?: string; domain?: string }): { safe: boolean; reason?: string } {
    // Per-domain rate limiting
    if (action.domain) {
      const domain = action.domain;
      const now = Date.now();
      const entry = this.domainActionCounts.get(domain);

      if (entry && now < entry.resetTime) {
        entry.count++;
        if (entry.count > ActionValidator.DOMAIN_RATE_LIMIT) {
          return { safe: false, reason: `Rate limit exceeded for domain ${domain} (${entry.count} actions in 60s)` };
        }
      } else {
        this.domainActionCounts.set(domain, { count: 1, resetTime: now + ActionValidator.DOMAIN_RATE_WINDOW_MS });
      }
    }

    if (!action.value) return { safe: true };

    // Context-aware: relax patterns for fill actions into text fields
    const isFillAction = action.type === 'fill';

    const patterns: Array<{ pattern: RegExp; skipForFill: boolean }> = [
      { pattern: /ignore.*previous.*instructions/i, skipForFill: false },
      { pattern: /forget.*everything/i, skipForFill: false },
      { pattern: /system.*prompt/i, skipForFill: false },
      { pattern: /you.*are.*now/i, skipForFill: false },
      { pattern: /bypass.*security/i, skipForFill: false },
      { pattern: /send.*to.*external/i, skipForFill: true },
      { pattern: /transfer.*money/i, skipForFill: true },
      { pattern: /password.*is/i, skipForFill: true },
      { pattern: /admin.*access/i, skipForFill: true },
      { pattern: /root.*access/i, skipForFill: true },
      { pattern: /sudo/i, skipForFill: true },
      { pattern: /rm\s+-rf/i, skipForFill: true },
      // Narrowed: only match "delete all" at start of value, not embedded in content
      { pattern: /^delete\s+all\b/i, skipForFill: true },
    ];

    for (const { pattern, skipForFill } of patterns) {
      if (isFillAction && skipForFill) continue;
      if (pattern.test(action.value)) {
        console.warn(`Suspicious pattern detected: ${pattern.source}`);
        return { safe: false, reason: 'Suspicious pattern detected in input' };
      }
    }

    return { safe: true };
  }
  
  getStats() {
    return {
      actionsExecuted: this.actionsExecuted,
      elapsedSeconds: (Date.now() - this.startTime.getTime()) / 1000,
      remainingActions: this.intent.maxActions - this.actionsExecuted,
      remainingSeconds: this.intent.maxDuration - (Date.now() - this.startTime.getTime()) / 1000
    };
  }
}
