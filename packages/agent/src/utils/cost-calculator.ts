/**
 * Cost Calculator
 *
 * Centralized cost calculation for all billable services.
 * All costs include a 20% platform markup applied at log time.
 */

// Platform billing markup (cost + 20%)
export const BILLING_MARKUP = 1.20;

// AI Model Costs (per 1M tokens) — verified Feb 2026
// Token counts are EXACT values from API responses. Rates are maintained constants.
// Source: provider pricing pages, last verified 2026-02-20.
export const AI_MODEL_COSTS = {
  groq: { input: 0.59, output: 0.79 },         // llama-3.3-70b-versatile
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

export function calculateVoiceCost(durationSeconds: number, isInternational: boolean = false): number {
  const minutes = Math.ceil(durationSeconds / 60);
  // Full cost stack per minute (ConversationRelay with ElevenLabs + Deepgram):
  // - Twilio carrier: $0.0085 inbound / $0.014 international
  // - ConversationRelay orchestration: $0.01/min
  // - ElevenLabs TTS (via Twilio): ~$0.024/min
  // - Deepgram STT (via Twilio): ~$0.01/min
  const carrierRate = isInternational ? 0.014 : 0.0085;
  const conversationRelayRate = 0.01;  // Twilio ConversationRelay
  const ttsRate = 0.024;               // ElevenLabs via Twilio
  const sttRate = 0.01;                // Deepgram via Twilio
  const ratePerMinute = carrierRate + conversationRelayRate + ttsRate + sttRate;
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
