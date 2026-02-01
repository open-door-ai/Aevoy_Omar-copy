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
  
  private checkSuspiciousPatterns(action: { value?: string }): { safe: boolean; reason?: string } {
    if (!action.value) return { safe: true };
    
    const patterns = [
      /ignore.*previous.*instructions/i,
      /forget.*everything/i,
      /system.*prompt/i,
      /you.*are.*now/i,
      /bypass.*security/i,
      /send.*to.*external/i,
      /transfer.*money/i,
      /password.*is/i,
      /admin.*access/i,
      /root.*access/i,
      /sudo/i,
      /rm\s+-rf/i,
      /delete.*all/i,
    ];
    
    for (const pattern of patterns) {
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
