/**
 * Phone Cost Calculator
 *
 * Calculates Twilio costs for voice calls and SMS based on:
 * - Call/SMS direction (inbound/outbound)
 * - Destination country
 * - Duration (for calls)
 * - Number type (local/toll-free)
 *
 * Pricing Source: https://www.twilio.com/en-us/voice/pricing/ca
 * Last Updated: 2026-02-15
 */

import { parsePhoneNumber, CountryCode } from "libphonenumber-js";

// ============================================================
// PRICING CONSTANTS (all in USD cents)
// ============================================================

/**
 * Monthly phone number costs
 */
export const PHONE_NUMBER_COSTS = {
  local: {
    base: 115, // $1.15/month for first 1,000 numbers
    volume: 57.5, // $0.575/month for 1,000+ numbers
  },
  tollFree: {
    base: 215, // $2.15/month for first 1,000 numbers
    volume: 161.3, // $1.613/month for 1,000+ numbers
  },
} as const;

/**
 * Voice call pricing (per minute in cents)
 */
export const VOICE_PRICING = {
  // Inbound calls (receiving calls on our number)
  inbound: {
    local: 0.85, // $0.0085/min for local numbers
    tollFree: 2.2, // $0.0220/min for toll-free numbers
  },
  // Outbound calls (making calls from our number)
  outbound: {
    northAmerica: 1.4, // $0.0140/min to US/Canada
    international: {
      // Per-country rates (most common destinations)
      UK: 2.2, // $0.022/min to UK landlines
      UKMobile: 6.7, // $0.067/min to UK mobiles
      France: 2.1,
      Germany: 2.2,
      Australia: 1.8,
      India: 1.5,
      China: 1.2,
      Brazil: 14.0, // $0.14/min
      // Default for countries not listed
      default: 10.0, // $0.10/min average
    },
  },
} as const;

/**
 * SMS pricing (per message in cents)
 */
export const SMS_PRICING = {
  // Inbound SMS (receiving texts)
  inbound: {
    base: 0.83, // $0.0083/message
    carrierFee: 1.2, // Average $0.012/message (ranges $0.0079-$0.017)
  },
  // Outbound SMS (sending texts)
  outbound: {
    northAmerica: {
      base: 0.83, // $0.0083/message
      carrierFee: 1.2, // Average $0.012/message
    },
    international: {
      // Per-country rates
      UK: 5.0,
      France: 5.5,
      Germany: 5.0,
      Australia: 3.5,
      India: 2.0,
      China: 3.0,
      Brazil: 4.5,
      // Default for countries not listed
      default: 5.0, // $0.05/message average
    },
  },
} as const;

/**
 * Twilio trial account limitations
 */
export const TRIAL_LIMITS = {
  maxDailySMS: 50,
  maxDailyVerifyCalls: 25,
  maxPhoneNumbers: 1,
  maxLifetimeUniqueNumbers: 3,
  region: "US1" as const, // US only
  requiresVerification: true, // Can only call/SMS verified numbers
} as const;

/**
 * When to upgrade from trial (recommendations)
 */
export const UPGRADE_TRIGGERS = {
  dailySMS: 40, // Close to 50 limit
  dailyCalls: 20, // Close to 25 limit
  needsInternational: true,
  needsMultipleNumbers: true,
} as const;

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Parse phone number and extract country code
 */
function getCountryFromPhone(phoneNumber: string): string | null {
  try {
    const parsed = parsePhoneNumber(phoneNumber);
    return parsed?.country || null;
  } catch {
    // If parsing fails, try to detect from prefix
    const cleaned = phoneNumber.replace(/\D/g, "");
    if (cleaned.startsWith("1")) return "US"; // US/Canada
    if (cleaned.startsWith("44")) return "UK";
    if (cleaned.startsWith("33")) return "FR";
    if (cleaned.startsWith("49")) return "DE";
    if (cleaned.startsWith("61")) return "AU";
    if (cleaned.startsWith("91")) return "IN";
    if (cleaned.startsWith("86")) return "CN";
    if (cleaned.startsWith("55")) return "BR";
    return null;
  }
}

/**
 * Check if number is in North America (US/Canada)
 */
function isNorthAmerica(phoneNumber: string): boolean {
  const country = getCountryFromPhone(phoneNumber);
  return country === "US" || country === "CA";
}

/**
 * Check if number is mobile (heuristic, not 100% accurate)
 */
function isMobile(phoneNumber: string, country: string | null): boolean {
  try {
    const parsed = parsePhoneNumber(phoneNumber);
    // This is a simplification - real implementation would use Twilio Lookup API
    // or a carrier database for accurate mobile detection
    return parsed?.getType() === "MOBILE";
  } catch {
    return false;
  }
}

// ============================================================
// COST CALCULATION FUNCTIONS
// ============================================================

/**
 * Calculate cost for an inbound voice call (someone calls our Twilio number)
 *
 * @param durationMinutes - Call duration in minutes (rounded up)
 * @param numberType - Type of our Twilio number ('local' or 'tollFree')
 * @returns Cost in USD cents
 */
export function calculateInboundCallCost(
  durationMinutes: number,
  numberType: "local" | "tollFree" = "local"
): number {
  const roundedMinutes = Math.ceil(durationMinutes);
  const perMinuteCost = VOICE_PRICING.inbound[numberType];
  return roundedMinutes * perMinuteCost;
}

/**
 * Calculate cost for an outbound voice call (we call someone)
 *
 * @param toPhoneNumber - Destination phone number (E.164 format)
 * @param durationMinutes - Call duration in minutes (rounded up)
 * @param fromNumberType - Type of our Twilio number ('local' or 'tollFree')
 * @returns Cost in USD cents and destination info
 */
export function calculateOutboundCallCost(
  toPhoneNumber: string,
  durationMinutes: number,
  fromNumberType: "local" | "tollFree" = "local"
): {
  costCents: number;
  destination: string;
  isInternational: boolean;
  perMinuteRate: number;
} {
  const roundedMinutes = Math.ceil(durationMinutes);
  const country = getCountryFromPhone(toPhoneNumber);
  const isNorthAm = isNorthAmerica(toPhoneNumber);

  let perMinuteRate: number;
  let destination: string;
  let isInternational: boolean;

  if (isNorthAm) {
    // US/Canada calls
    perMinuteRate = VOICE_PRICING.outbound.northAmerica;
    destination = country || "North America";
    isInternational = false;
  } else {
    // International calls
    const mobile = isMobile(toPhoneNumber, country);

    if (country === "GB" && mobile) {
      perMinuteRate = VOICE_PRICING.outbound.international.UKMobile;
    } else if (country && country in VOICE_PRICING.outbound.international) {
      perMinuteRate =
        VOICE_PRICING.outbound.international[
          country as keyof typeof VOICE_PRICING.outbound.international
        ];
    } else {
      perMinuteRate = VOICE_PRICING.outbound.international.default;
    }

    destination = country || "International";
    isInternational = true;
  }

  return {
    costCents: roundedMinutes * perMinuteRate,
    destination,
    isInternational,
    perMinuteRate,
  };
}

/**
 * Calculate cost for an inbound SMS (someone texts our Twilio number)
 *
 * @param fromPhoneNumber - Sender's phone number (for detecting international)
 * @returns Cost in USD cents
 */
export function calculateInboundSMSCost(fromPhoneNumber: string): number {
  // Twilio charges same rate regardless of sender's country
  return SMS_PRICING.inbound.base + SMS_PRICING.inbound.carrierFee;
}

/**
 * Calculate cost for an outbound SMS (we text someone)
 *
 * @param toPhoneNumber - Destination phone number (E.164 format)
 * @param segmentCount - Number of SMS segments (160 chars = 1 segment)
 * @returns Cost in USD cents and destination info
 */
export function calculateOutboundSMSCost(
  toPhoneNumber: string,
  segmentCount: number = 1
): {
  costCents: number;
  destination: string;
  isInternational: boolean;
  perSegmentRate: number;
} {
  const country = getCountryFromPhone(toPhoneNumber);
  const isNorthAm = isNorthAmerica(toPhoneNumber);

  let perSegmentRate: number;
  let destination: string;
  let isInternational: boolean;

  if (isNorthAm) {
    // US/Canada SMS
    perSegmentRate =
      SMS_PRICING.outbound.northAmerica.base +
      SMS_PRICING.outbound.northAmerica.carrierFee;
    destination = country || "North America";
    isInternational = false;
  } else {
    // International SMS
    if (country && country in SMS_PRICING.outbound.international) {
      perSegmentRate =
        SMS_PRICING.outbound.international[
          country as keyof typeof SMS_PRICING.outbound.international
        ];
    } else {
      perSegmentRate = SMS_PRICING.outbound.international.default;
    }

    destination = country || "International";
    isInternational = true;
  }

  return {
    costCents: segmentCount * perSegmentRate,
    destination,
    isInternational,
    perSegmentRate,
  };
}

/**
 * Calculate SMS segment count based on message length
 *
 * @param message - SMS message text
 * @returns Number of segments
 */
export function calculateSMSSegments(message: string): number {
  const length = message.length;

  // Single SMS: 160 characters (GSM-7) or 70 characters (UCS-2/Unicode)
  // Multi-part SMS: 153 characters (GSM-7) or 67 characters (UCS-2)
  const hasUnicode = /[^\x00-\x7F]/.test(message);

  if (hasUnicode) {
    // Unicode encoding
    if (length <= 70) return 1;
    return Math.ceil(length / 67);
  } else {
    // Standard GSM-7 encoding
    if (length <= 160) return 1;
    return Math.ceil(length / 153);
  }
}

/**
 * Get monthly phone number cost
 *
 * @param numberType - Type of number ('local' or 'tollFree')
 * @param quantity - How many numbers (for volume pricing)
 * @returns Cost in USD cents per month
 */
export function getPhoneNumberMonthlyCost(
  numberType: "local" | "tollFree" = "local",
  quantity: number = 1
): number {
  if (quantity >= 1000) {
    return PHONE_NUMBER_COSTS[numberType].volume * quantity;
  }
  return PHONE_NUMBER_COSTS[numberType].base * quantity;
}

// ============================================================
// TRIAL ACCOUNT HELPERS
// ============================================================

/**
 * Check if phone number can be called/texted from trial account
 *
 * @param phoneNumber - Phone number to check
 * @param verifiedNumbers - List of verified phone numbers
 * @returns Whether the number can be contacted
 */
export function canContactOnTrial(
  phoneNumber: string,
  verifiedNumbers: string[]
): boolean {
  // Trial accounts can only contact verified numbers
  const normalized = phoneNumber.replace(/\D/g, "");
  return verifiedNumbers.some((verified) => {
    const verifiedNormalized = verified.replace(/\D/g, "");
    return (
      normalized === verifiedNormalized ||
      normalized.endsWith(verifiedNormalized.slice(-10))
    );
  });
}

/**
 * Check if user should upgrade from trial account
 *
 * @param dailySMS - SMS sent today
 * @param dailyCalls - Calls made today
 * @param needsInternational - Whether user needs international calling
 * @param needsMultipleNumbers - Whether user needs multiple phone numbers
 * @returns Whether to recommend upgrade
 */
export function shouldUpgradeFromTrial(
  dailySMS: number,
  dailyCalls: number,
  needsInternational: boolean,
  needsMultipleNumbers: boolean
): { shouldUpgrade: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (dailySMS >= UPGRADE_TRIGGERS.dailySMS) {
    reasons.push(
      `Approaching daily SMS limit (${dailySMS}/${TRIAL_LIMITS.maxDailySMS})`
    );
  }

  if (dailyCalls >= UPGRADE_TRIGGERS.dailyCalls) {
    reasons.push(
      `Approaching daily call limit (${dailyCalls}/${TRIAL_LIMITS.maxDailyVerifyCalls})`
    );
  }

  if (needsInternational) {
    reasons.push("International calling/SMS requires paid account");
  }

  if (needsMultipleNumbers) {
    reasons.push(
      `Multiple phone numbers require paid account (trial max: ${TRIAL_LIMITS.maxPhoneNumbers})`
    );
  }

  return {
    shouldUpgrade: reasons.length > 0,
    reasons,
  };
}

// ============================================================
// INTERNATIONAL ROUTING RECOMMENDATIONS
// ============================================================

/**
 * Recommend phone number strategy based on user's needs
 *
 * @param userCountries - List of countries where users are located
 * @param monthlyCallVolume - Expected monthly call volume
 * @param monthlySMSVolume - Expected monthly SMS volume
 * @returns Recommended strategy
 */
export function recommendPhoneStrategy(
  userCountries: string[],
  monthlyCallVolume: number,
  monthlySMSVolume: number
): {
  strategy: "single-shared" | "regional-numbers" | "per-user-numbers";
  reasoning: string[];
  estimatedMonthlyCost: number;
} {
  const uniqueCountries = new Set(userCountries);
  const allNorthAmerica = Array.from(uniqueCountries).every((c) =>
    ["US", "CA"].includes(c)
  );
  const reasoning: string[] = [];

  // Strategy 1: Single shared number (simplest, works for NA-only)
  if (allNorthAmerica && monthlyCallVolume < 1000) {
    const numberCost = getPhoneNumberMonthlyCost("local", 1);
    const avgCallCost = monthlyCallVolume * VOICE_PRICING.outbound.northAmerica;
    const avgSMSCost =
      monthlySMSVolume *
      (SMS_PRICING.outbound.northAmerica.base +
        SMS_PRICING.outbound.northAmerica.carrierFee);

    reasoning.push("All users in North America");
    reasoning.push("Low call volume (<1000/month)");
    reasoning.push("Single BC number (+1 778-900-8951) works for everyone");
    reasoning.push("Inbound international calls NOT supported on trial");

    return {
      strategy: "single-shared",
      reasoning,
      estimatedMonthlyCost: numberCost + avgCallCost + avgSMSCost,
    };
  }

  // Strategy 2: Regional numbers (for multi-country user base)
  if (uniqueCountries.size > 2 && monthlyCallVolume > 1000) {
    const regionCount = Math.min(uniqueCountries.size, 5); // Cap at 5 regions
    const numberCost = getPhoneNumberMonthlyCost("local", regionCount);
    const avgCallCost =
      monthlyCallVolume * VOICE_PRICING.outbound.international.default;
    const avgSMSCost =
      monthlySMSVolume * SMS_PRICING.outbound.international.default;

    reasoning.push(
      `Users across ${uniqueCountries.size} countries: ${Array.from(uniqueCountries).join(", ")}`
    );
    reasoning.push("High call volume (>1000/month)");
    reasoning.push(`Provision ${regionCount} regional numbers`);
    reasoning.push("Route users to nearest regional number");
    reasoning.push("Reduces international calling costs");

    return {
      strategy: "regional-numbers",
      reasoning,
      estimatedMonthlyCost: numberCost + avgCallCost + avgSMSCost,
    };
  }

  // Strategy 3: Per-user numbers (current plan)
  const avgNumbersPerUser = 1;
  const numberCost = getPhoneNumberMonthlyCost(
    "local",
    avgNumbersPerUser * userCountries.length
  );
  const avgCallCost =
    (monthlyCallVolume / userCountries.length) *
    VOICE_PRICING.outbound.northAmerica *
    userCountries.length;
  const avgSMSCost =
    (monthlySMSVolume / userCountries.length) *
    (SMS_PRICING.outbound.northAmerica.base +
      SMS_PRICING.outbound.northAmerica.carrierFee) *
    userCountries.length;

  reasoning.push("Mixed international user base");
  reasoning.push("Each user gets their own phone number");
  reasoning.push("User chooses area code during onboarding");
  reasoning.push("Most flexible but highest monthly cost");

  return {
    strategy: "per-user-numbers",
    reasoning,
    estimatedMonthlyCost: numberCost + avgCallCost + avgSMSCost,
  };
}
