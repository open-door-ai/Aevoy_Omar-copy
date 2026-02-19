/**
 * Intent Locking System
 *
 * Before ANY task, we lock what the AI is allowed to do.
 * This CANNOT be changed by web content or prompt injection.
 *
 * Philosophy: The agent should be able to go ANYWHERE on the web
 * and do ANYTHING needed to complete the task. Only truly dangerous
 * actions (payment, creating accounts) are restricted.
 * Domain restrictions are REMOVED — the agent navigates freely.
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

// All browser-capable task types get 20-minute execution windows
const TASK_LIMITS: Record<string, { maxDuration: number; maxActions: number }> = {
  research: { maxDuration: 1200, maxActions: 500 },
  booking:  { maxDuration: 1200, maxActions: 500 },
  form:     { maxDuration: 1200, maxActions: 500 },
  shopping: { maxDuration: 1200, maxActions: 500 },
  general:  { maxDuration: 1200, maxActions: 500 },
  email:    { maxDuration: 300,  maxActions: 100 },
  writing:  { maxDuration: 300,  maxActions: 100 },
  reminder: { maxDuration: 300,  maxActions: 100 },
};

// Full browser action set available to all browser-capable task types
const FULL_BROWSER_ACTIONS = [
  'navigate', 'click', 'fill', 'select', 'submit', 'scroll',
  'screenshot', 'extract', 'search', 'browse', 'remember',
  'wait', 'verify', 'login', 'upload', 'send_email', 'read_email', 'schedule',
];

const TASK_PERMISSIONS: Record<string, { allowed: string[]; forbidden: string[] }> = {
  research: {
    allowed: [...FULL_BROWSER_ACTIONS],
    forbidden: ['payment']
  },
  booking: {
    allowed: [...FULL_BROWSER_ACTIONS],
    forbidden: ['payment', 'login_new_account']
  },
  form: {
    allowed: [...FULL_BROWSER_ACTIONS],
    forbidden: ['payment']
  },
  shopping: {
    allowed: [...FULL_BROWSER_ACTIONS],
    forbidden: ['payment', 'checkout']
  },
  general: {
    allowed: [...FULL_BROWSER_ACTIONS],
    forbidden: ['payment']
  },
  email: {
    allowed: ['compose', 'send', 'send_email', 'read_email', 'remember', 'browse', 'search', 'navigate', 'extract', 'screenshot'],
    forbidden: ['payment']
  },
  writing: {
    allowed: ['generate', 'format', 'send_email', 'read_email', 'remember', 'browse', 'search', 'navigate', 'extract', 'screenshot'],
    forbidden: ['payment']
  },
  reminder: {
    allowed: ['schedule', 'send_email', 'read_email', 'remember', 'browse', 'search', 'navigate', 'extract', 'screenshot'],
    forbidden: ['payment']
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
    // Keep domains for reference/logging, but validation is permissive
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
    // Log but DON'T block — the AI should be able to try anything
    console.warn(`[INTENT] Action '${action.type}' not in standard list for '${intent.taskType}', allowing anyway`);
  }

  // Domain validation: LOG only, never block
  // The agent needs to navigate freely to complete complex tasks.
  // Rate limiting (in validator.ts) prevents abuse.
  if (action.domain && intent.allowedDomains.length > 0) {
    const domain = extractDomain(action.domain);
    const domainAllowed = intent.allowedDomains.some(d => {
      if (domain === d) return true;
      if (domain.endsWith('.' + d)) return true;
      const baseDomain = d.replace(/^www\./, '');
      if (domain.replace(/^www\./, '') === baseDomain) return true;
      return false;
    });

    if (!domainAllowed) {
      // Log for audit but allow navigation — the agent explores freely
      console.log(`[INTENT] Navigating to '${domain}' (outside initial domain list) — allowed`);
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
