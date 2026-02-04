/**
 * Action Validator
 * 
 * Every action goes through this firewall.
 * Validates against the locked intent and checks for suspicious patterns.
 */

import { LockedIntent, validateAction } from './intent-lock.js';

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
