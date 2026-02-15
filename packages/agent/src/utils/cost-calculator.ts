/**
 * Cost Calculator
 *
 * Centralized cost calculation for all billable services.
 */

// AI Model Costs (per 1M tokens)
export const AI_MODEL_COSTS = {
  groq: { input: 0.59, output: 0.79 },
  deepseek: { input: 0.25, output: 0.38 },
  kimi: { input: 0.60, output: 2.50 },
  gemini: { input: 0, output: 0 },
  sonnet: { input: 3.00, output: 15.00 },
  haiku: { input: 0.25, output: 1.25 },
  ollama: { input: 0, output: 0 },
} as const;

// CAPTCHA Costs (per solve)
export const CAPTCHA_COSTS = {
  capsolver: {
    recaptcha_v2: 0.0008,
    recaptcha_v3: 0.003,
    hcaptcha: 0.0008,
    turnstile: 0.0012,
    funcaptcha: 0.002,
    geetest: 0.002,
    datadome: 0.0025,
    image: 0.0005,
  },
  '2captcha': {
    recaptcha_v2: 0.0025,
    recaptcha_v3: 0.0025,
    hcaptcha: 0.0025,
    turnstile: 0.0025,
    funcaptcha: 0.0025,
    geetest: 0.0025,
    datadome: 0.0025,
    image: 0.0025,
  },
  claude_vision: {
    image: 0.003,
  },
} as const;

export function calculateVoiceCost(durationSeconds: number, isInternational: boolean = false): number {
  const minutes = Math.ceil(durationSeconds / 60);
  const ratePerMinute = isInternational ? 0.014 : 0.0085;
  return minutes * ratePerMinute;
}

export function calculateSMSCost(to: string, messageLength: number = 160): number {
  const isInternational = !to.startsWith('+1');
  const segments = Math.ceil(messageLength / 160);
  const ratePerSegment = isInternational ? 0.0075 : 0.0079;
  return segments * ratePerSegment;
}

export const BROWSER_SESSION_COSTS = {
  browserbase: 0.02,
  vps: 0.005,
  local: 0,
} as const;

export type BrowserProvider = keyof typeof BROWSER_SESSION_COSTS;

export function calculateEmailCost(): number {
  return 0;
}

export function calculateAICost(
  provider: keyof typeof AI_MODEL_COSTS,
  inputTokens: number,
  outputTokens: number
): number {
  const rates = AI_MODEL_COSTS[provider];
  if (!rates) return 0;
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

export function calculateCaptchaCost(
  service: 'capsolver' | '2captcha' | 'claude_vision',
  captchaType: string
): number {
  const serviceCosts = CAPTCHA_COSTS[service];
  if (!serviceCosts) return 0.002;

  const normalizedType = captchaType.toLowerCase().replace(/-/g, '_') as keyof typeof serviceCosts;
  return serviceCosts[normalizedType] || 0.002;
}

export function calculateBrowserCost(provider: BrowserProvider): number {
  return BROWSER_SESSION_COSTS[provider] || 0;
}

export function formatCost(costUsd: number): string {
  if (costUsd < 0.001) return '<$0.001';
  if (costUsd < 0.01) return `$${costUsd.toFixed(4)}`;
  if (costUsd < 1) return `$${costUsd.toFixed(3)}`;
  return `$${costUsd.toFixed(2)}`;
}
