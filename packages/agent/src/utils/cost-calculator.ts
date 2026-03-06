/**
 * Cost Calculator
 *
 * Centralized cost calculation for all billable services.
 * All costs include a 20% platform markup applied at log time.
 */

// Platform billing markup (cost + 20%)
export const BILLING_MARKUP = 1.20;

// Twilio pricing (domestic North America)
export const TWILIO_RATES = {
  // Per-minute rates
  INBOUND_LOCAL_PER_MIN: 0.0085,
  OUTBOUND_NA_PER_MIN: 0.014,
  CONVERSATION_RELAY_PER_MIN: 0.01,
  ELEVENLABS_TTS_PER_MIN: 0.024,
  DEEPGRAM_STT_PER_MIN: 0.01,
  // Combined full bundle rate (what we actually pay per minute)
  FULL_BUNDLE_INBOUND_PER_MIN: 0.0525,  // inbound + relay + TTS + STT
  FULL_BUNDLE_OUTBOUND_PER_MIN: 0.0585, // outbound + relay + TTS + STT
  // SMS
  SMS_OUTBOUND_NA: 0.0079,
  SMS_INBOUND_NA: 0.0083,
  // Phone number monthly
  LOCAL_NUMBER_MONTHLY: 1.15,
  TOLL_FREE_MONTHLY: 2.15,
} as const;

// AI Model Costs (per 1M tokens) — verified Feb 2026
// Token counts are EXACT values from API responses. Rates are maintained constants.
// Source: provider pricing pages, last verified 2026-02-20.
export const AI_MODEL_COSTS = {
  groq: { input: 0.59, output: 0.79 },         // llama-4-scout / compound-mini
  deepseek: { input: 0.27, output: 1.10 },      // deepseek-chat (DeepSeek V3)
  kimi: { input: 0.60, output: 2.50 },           // kimi-k2 (moonshot)
  gemini: { input: 0, output: 0 },               // gemini-2.0-flash (free tier)
  sonnet: { input: 3.00, output: 15.00 },        // claude-sonnet-4-20250514
  haiku: { input: 0.80, output: 4.00 },          // claude-3-5-haiku-latest (NOT claude-3-haiku)
  ollama: { input: 0, output: 0 },               // local inference, free
  openrouter: { input: 0, output: 0 },           // per-model dynamic — see OpenRouter API
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

export function calculateVoiceCost(durationSeconds: number, direction: 'inbound' | 'outbound' | boolean = 'inbound'): number {
  const durationMinutes = Math.ceil(durationSeconds / 60); // Twilio rounds up to nearest minute
  // Support legacy boolean isInternational param (treated as outbound if true)
  let ratePerMin: number;
  if (direction === true) {
    // Legacy: isInternational=true → use outbound international rate
    ratePerMin = TWILIO_RATES.OUTBOUND_NA_PER_MIN + TWILIO_RATES.CONVERSATION_RELAY_PER_MIN + TWILIO_RATES.ELEVENLABS_TTS_PER_MIN + TWILIO_RATES.DEEPGRAM_STT_PER_MIN;
  } else if (direction === 'outbound') {
    ratePerMin = TWILIO_RATES.FULL_BUNDLE_OUTBOUND_PER_MIN;
  } else {
    // 'inbound' or false (legacy isInternational=false)
    ratePerMin = TWILIO_RATES.FULL_BUNDLE_INBOUND_PER_MIN;
  }
  return durationMinutes * ratePerMin * BILLING_MARKUP;
}

export function calculateSMSCost(to: string, messageLength: number = 160): number {
  const isInternational = !to.startsWith('+1');
  const segments = Math.ceil(messageLength / 160);
  const ratePerSegment = isInternational ? 0.0075 : TWILIO_RATES.SMS_OUTBOUND_NA;
  return segments * ratePerSegment;
}

/**
 * Calculate SMS cost by direction (for cost tracking).
 * @param direction - 'inbound' or 'outbound'
 * @param count - number of SMS messages
 */
export function calculateSMSCostByDirection(direction: 'inbound' | 'outbound' = 'outbound', count: number = 1): number {
  const rate = direction === 'inbound' ? TWILIO_RATES.SMS_INBOUND_NA : TWILIO_RATES.SMS_OUTBOUND_NA;
  return rate * count * BILLING_MARKUP;
}

export const BROWSER_SESSION_COSTS = {
  browserbase: 0.02,
  vps: 0.005,
  local: 0,
} as const;

export type BrowserProvider = keyof typeof BROWSER_SESSION_COSTS;

// Image Generation Costs (per image)
export const IMAGE_GENERATION_COSTS = {
  'dall-e-3': {
    '1024x1024': 0.04,
    '1024x1792': 0.08,
    '1792x1024': 0.08,
  },
  'gemini-2.0-flash-exp-image-generation': {
    '1024x1024': 0.039,
    '1024x1792': 0.039,
    '1792x1024': 0.039,
  },
} as const;

export function calculateImageCost(model: string, size: string): number {
  const costs = IMAGE_GENERATION_COSTS[model as keyof typeof IMAGE_GENERATION_COSTS];
  if (!costs) return 0.039; // default Gemini image generation
  return (costs as Record<string, number>)[size] || 0.039;
}

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
