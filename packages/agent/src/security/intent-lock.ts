/**
 * Intent Locking System
 * 
 * Before ANY task, we lock what the AI is allowed to do.
 * This CANNOT be changed by web content or prompt injection.
 */

export interface LockedIntent {
  readonly id: string;
  readonly userId: string;
  readonly taskType: string;
  readonly goal: string;
  readonly allowedDomains: readonly string[];
  readonly allowedActions: readonly string[];
  readonly forbiddenActions: readonly string[];
  readonly successCondition: string;
  readonly maxBudget: number;
  readonly maxDuration: number;
  readonly maxActions: number;
  readonly createdAt: Date;
  readonly lockedAt: Date;
}

// Task type determines what actions are allowed
// Adaptive limits by task type
const TASK_LIMITS: Record<string, { maxDuration: number; maxActions: number }> = {
  research: { maxDuration: 120, maxActions: 50 },
  booking: { maxDuration: 600, maxActions: 200 },
  form: { maxDuration: 300, maxActions: 100 },
  shopping: { maxDuration: 600, maxActions: 200 },
  email: { maxDuration: 60, maxActions: 20 },
  writing: { maxDuration: 120, maxActions: 30 },
  reminder: { maxDuration: 60, maxActions: 20 },
  general: { maxDuration: 300, maxActions: 100 },
};

const TASK_PERMISSIONS: Record<string, { allowed: string[]; forbidden: string[] }> = {
  research: {
    allowed: ['navigate', 'scroll', 'screenshot', 'extract', 'search', 'click'],
    forbidden: ['fill', 'submit', 'login', 'payment']
  },
  booking: {
    allowed: ['navigate', 'click', 'fill', 'select', 'submit', 'screenshot', 'extract', 'login'],
    forbidden: ['payment', 'login_new_account']
  },
  form: {
    allowed: ['navigate', 'click', 'fill', 'select', 'submit', 'upload', 'screenshot'],
    forbidden: ['payment']
  },
  shopping: {
    allowed: ['navigate', 'click', 'fill', 'select', 'screenshot', 'extract'],
    forbidden: ['payment', 'checkout'] // Require explicit approval for payment
  },
  email: {
    allowed: ['compose', 'send'],
    forbidden: ['navigate', 'click', 'fill'] // Can only send email, nothing else
  },
  writing: {
    allowed: ['generate', 'format', 'send_email'],
    forbidden: ['navigate', 'click', 'fill', 'payment']
  },
  reminder: {
    allowed: ['schedule', 'send_email', 'remember'],
    forbidden: ['navigate', 'click', 'fill', 'payment']
  },
  general: {
    allowed: ['navigate', 'click', 'scroll', 'screenshot', 'extract', 'search', 'remember', 'browse'],
    forbidden: ['fill', 'submit', 'payment', 'login']
  }
};

export function createLockedIntent(params: {
  userId: string;
  taskType: string;
  goal: string;
  allowedDomains?: string[];
  allowedActions?: string[];
  forbiddenActions?: string[];
  successCondition?: string;
  maxBudget?: number;
  maxDuration?: number;
  maxActions?: number;
}): LockedIntent {
  const perms = TASK_PERMISSIONS[params.taskType] || TASK_PERMISSIONS.general;
  const limits = TASK_LIMITS[params.taskType] || TASK_LIMITS.general;

  // Custom allowedActions MERGE with defaults (union)
  const allowed = params.allowedActions
    ? [...new Set([...perms.allowed, ...params.allowedActions])]
    : [...perms.allowed];
  const forbidden = [...new Set([...perms.forbidden, ...(params.forbiddenActions || [])])];

  // Create FROZEN intent - cannot be modified
  return Object.freeze({
    id: crypto.randomUUID(),
    userId: params.userId,
    taskType: params.taskType,
    goal: params.goal,
    allowedDomains: Object.freeze(params.allowedDomains || []),
    allowedActions: Object.freeze(allowed),
    forbiddenActions: Object.freeze(forbidden),
    successCondition: params.successCondition || 'Task completed',
    maxBudget: params.maxBudget ?? 0,
    maxDuration: params.maxDuration || limits.maxDuration,
    maxActions: params.maxActions || limits.maxActions,
    createdAt: new Date(),
    lockedAt: new Date()
  });
}

export function validateAction(
  intent: LockedIntent, 
  action: { type: string; domain?: string; target?: string }
): { allowed: boolean; reason?: string } {
  // Check if action type is forbidden
  if (intent.forbiddenActions.includes(action.type)) {
    return { 
      allowed: false, 
      reason: `Action '${action.type}' is forbidden for task type '${intent.taskType}'` 
    };
  }
  
  // Check if action type is allowed
  if (!intent.allowedActions.includes(action.type)) {
    return { 
      allowed: false, 
      reason: `Action '${action.type}' not in allowed list for '${intent.taskType}'` 
    };
  }
  
  // Check domain if provided (allows subdomains and known related domains)
  if (action.domain && intent.allowedDomains.length > 0) {
    const domain = extractDomain(action.domain);
    const domainAllowed = intent.allowedDomains.some(d => {
      // Exact match
      if (domain === d) return true;
      // Subdomain match (e.g., www.example.com matches example.com)
      if (domain.endsWith('.' + d)) return true;
      // Related domain match (e.g., airline.com is allowed when booking via kayak.com)
      const baseDomain = d.replace(/^www\./, '');
      if (domain.replace(/^www\./, '') === baseDomain) return true;
      return false;
    });

    // Allow known redirect domains (CDNs, auth providers, payment processors)
    const knownRedirectDomains = [
      'accounts.google.com', 'login.microsoftonline.com', 'github.com',
      'appleid.apple.com', 'facebook.com', 'cloudflare.com',
      'stripe.com', 'paypal.com', 'recaptcha.net', 'gstatic.com',
    ];
    const isKnownRedirect = knownRedirectDomains.some(d => domain === d || domain.endsWith('.' + d));

    if (!domainAllowed && !isKnownRedirect) {
      return {
        allowed: false,
        reason: `Domain '${domain}' not in allowed list`
      };
    }
  }
  
  return { allowed: true };
}

function extractDomain(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
  } catch {
    return url;
  }
}

export function getTaskTypeFromClassification(taskType: string): string {
  const mapping: Record<string, string> = {
    'research': 'research',
    'booking': 'booking',
    'form': 'form',
    'shopping': 'shopping',
    'email': 'email',
    'writing': 'writing',
    'reminder': 'reminder',
    'document': 'writing',
    'monitor': 'research',
    'other': 'general'
  };
  
  return mapping[taskType] || 'general';
}
