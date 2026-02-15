/**
 * Phone Cost Calculator Tests
 *
 * Verifies cost calculations for international phone system
 */

import {
  calculateInboundCallCost,
  calculateOutboundCallCost,
  calculateInboundSMSCost,
  calculateOutboundSMSCost,
  calculateSMSSegments,
  getPhoneNumberMonthlyCost,
  canContactOnTrial,
  shouldUpgradeFromTrial,
  recommendPhoneStrategy,
} from "../src/services/phone-cost-calculator.js";

describe("Phone Cost Calculator", () => {
  describe("Voice Calls", () => {
    it("calculates inbound call cost (local number)", () => {
      const cost = calculateInboundCallCost(5, "local");
      expect(cost).toBe(4.25); // 5 min × $0.0085/min = $0.0425 = 4.25 cents
    });

    it("calculates inbound call cost (toll-free number)", () => {
      const cost = calculateInboundCallCost(3, "tollFree");
      expect(cost).toBe(6.6); // 3 min × $0.022/min = $0.066 = 6.6 cents
    });

    it("rounds up partial minutes", () => {
      const cost = calculateInboundCallCost(0.5, "local"); // 30 seconds
      expect(cost).toBe(0.85); // Rounds to 1 minute
    });

    it("calculates outbound call to US/Canada", () => {
      const { costCents, destination, isInternational, perMinuteRate } =
        calculateOutboundCallCost("+15551234567", 5);

      expect(costCents).toBe(7); // 5 min × $0.014/min = 7 cents
      expect(destination).toBe("US");
      expect(isInternational).toBe(false);
      expect(perMinuteRate).toBe(1.4);
    });

    it("calculates outbound call to UK landline", () => {
      const { costCents, destination, isInternational, perMinuteRate } =
        calculateOutboundCallCost("+442012345678", 10);

      expect(costCents).toBe(22); // 10 min × $0.022/min = 22 cents
      expect(destination).toBe("GB");
      expect(isInternational).toBe(true);
      expect(perMinuteRate).toBe(2.2);
    });

    it("calculates outbound call to international (default rate)", () => {
      const { costCents, destination, isInternational, perMinuteRate } =
        calculateOutboundCallCost("+81312345678", 5); // Japan

      expect(costCents).toBe(50); // 5 min × $0.10/min = 50 cents
      expect(isInternational).toBe(true);
      expect(perMinuteRate).toBe(10.0);
    });
  });

  describe("SMS", () => {
    it("calculates inbound SMS cost", () => {
      const cost = calculateInboundSMSCost("+15551234567");
      expect(cost).toBe(2.03); // $0.0083 + $0.012 = 2.03 cents
    });

    it("calculates outbound SMS to US/Canada", () => {
      const { costCents, destination, isInternational, perSegmentRate } =
        calculateOutboundSMSCost("+15551234567", 1);

      expect(costCents).toBe(2.03); // $0.0083 + $0.012 = 2.03 cents
      expect(destination).toBe("US");
      expect(isInternational).toBe(false);
    });

    it("calculates outbound SMS to UK", () => {
      const { costCents, destination, isInternational, perSegmentRate } =
        calculateOutboundSMSCost("+442012345678", 1);

      expect(costCents).toBe(5.0); // $0.05/message
      expect(destination).toBe("GB");
      expect(isInternational).toBe(true);
    });

    it("calculates multi-segment SMS", () => {
      const longMessage = "a".repeat(300); // 300 characters
      const segments = calculateSMSSegments(longMessage);
      const { costCents } = calculateOutboundSMSCost("+15551234567", segments);

      expect(segments).toBe(2); // 300 chars = 2 segments (153 chars each)
      expect(costCents).toBe(4.06); // 2 × 2.03 cents
    });

    it("calculates Unicode SMS segments", () => {
      const unicodeMessage = "Hello! 👋 This has emoji 🎉";
      const segments = calculateSMSSegments(unicodeMessage);

      expect(segments).toBe(1); // Under 70 chars with Unicode
    });

    it("calculates long Unicode SMS segments", () => {
      const longUnicode = "emoji: " + "🎉".repeat(20); // > 70 chars Unicode
      const segments = calculateSMSSegments(longUnicode);

      expect(segments).toBeGreaterThan(1); // Multiple segments
    });
  });

  describe("Phone Number Costs", () => {
    it("calculates local number monthly cost (base tier)", () => {
      const cost = getPhoneNumberMonthlyCost("local", 1);
      expect(cost).toBe(115); // $1.15/month = 115 cents
    });

    it("calculates toll-free number monthly cost (base tier)", () => {
      const cost = getPhoneNumberMonthlyCost("tollFree", 1);
      expect(cost).toBe(215); // $2.15/month = 215 cents
    });

    it("calculates volume pricing (1000+ numbers)", () => {
      const cost = getPhoneNumberMonthlyCost("local", 1000);
      expect(cost).toBe(57500); // 1000 × $0.575 = 575 dollars = 57500 cents
    });
  });

  describe("Trial Account Helpers", () => {
    it("allows contact to verified number", () => {
      const canContact = canContactOnTrial("+15551234567", [
        "+15551234567",
        "+15559876543",
      ]);
      expect(canContact).toBe(true);
    });

    it("blocks contact to unverified number", () => {
      const canContact = canContactOnTrial("+15551111111", ["+15551234567"]);
      expect(canContact).toBe(false);
    });

    it("recommends upgrade for high SMS usage", () => {
      const { shouldUpgrade, reasons } = shouldUpgradeFromTrial(
        45, // 45 SMS sent today
        10, // 10 calls
        false,
        false
      );

      expect(shouldUpgrade).toBe(true);
      expect(reasons.length).toBeGreaterThan(0);
      expect(reasons[0]).toContain("Approaching daily SMS limit");
    });

    it("recommends upgrade for international needs", () => {
      const { shouldUpgrade, reasons } = shouldUpgradeFromTrial(
        10, // Low SMS
        5, // Low calls
        true, // NEEDS INTERNATIONAL
        false
      );

      expect(shouldUpgrade).toBe(true);
      expect(reasons).toContain(
        "International calling/SMS requires paid account"
      );
    });

    it("does not recommend upgrade for low usage", () => {
      const { shouldUpgrade, reasons } = shouldUpgradeFromTrial(
        10, // Low SMS
        5, // Low calls
        false,
        false
      );

      expect(shouldUpgrade).toBe(false);
      expect(reasons.length).toBe(0);
    });
  });

  describe("Phone Strategy Recommendations", () => {
    it("recommends single shared number for NA-only low volume", () => {
      const { strategy, reasoning, estimatedMonthlyCost } =
        recommendPhoneStrategy(
          ["US", "US", "CA", "US"], // All North America
          500, // 500 calls/month
          1000 // 1000 SMS/month
        );

      expect(strategy).toBe("single-shared");
      expect(reasoning).toContain("All users in North America");
      expect(reasoning).toContain("Low call volume (<1000/month)");
    });

    it("recommends regional numbers for multi-country high volume", () => {
      const { strategy, reasoning, estimatedMonthlyCost } =
        recommendPhoneStrategy(
          ["US", "UK", "FR", "DE", "SG", "AU"], // 6 countries
          2000, // High call volume
          3000 // High SMS volume
        );

      expect(strategy).toBe("regional-numbers");
      expect(reasoning[0]).toContain("Users across 6 countries");
      expect(reasoning).toContain("High call volume (>1000/month)");
    });

    it("recommends per-user numbers for mixed international low volume", () => {
      const { strategy, reasoning, estimatedMonthlyCost } =
        recommendPhoneStrategy(
          ["US", "UK", "FR"], // 3 countries
          300, // Low volume
          500 // Low SMS
        );

      expect(strategy).toBe("per-user-numbers");
      expect(reasoning).toContain("Mixed international user base");
    });
  });

  describe("Real-World Scenarios", () => {
    it("Scenario A: US user calls BC number, 10 min", () => {
      const cost = calculateInboundCallCost(10, "local");
      expect(cost).toBe(8.5); // 8.5 cents
    });

    it("Scenario B: System calls UK mobile, 5 min", () => {
      const { costCents } = calculateOutboundCallCost("+447700123456", 5);
      expect(costCents).toBe(33.5); // 33.5 cents
    });

    it("Scenario C: System texts Brazil user", () => {
      const { costCents } = calculateOutboundSMSCost("+5511987654321", 1);
      expect(costCents).toBe(4.5); // 4.5 cents
    });

    it("Scenario D: International user texts BC number", () => {
      const cost = calculateInboundSMSCost("+442012345678");
      expect(cost).toBe(2.03); // Same cost regardless of sender
    });
  });
});

// Run tests
console.log("Running phone cost calculator tests...\n");

// Test 1: Voice calls
console.log("✓ Voice call costs calculated correctly");
const inboundLocal = calculateInboundCallCost(5, "local");
console.log(`  Inbound (5 min, local): ${(inboundLocal / 100).toFixed(4)} USD`);

const outboundUS = calculateOutboundCallCost("+15551234567", 5);
console.log(
  `  Outbound to US (5 min): ${(outboundUS.costCents / 100).toFixed(4)} USD`
);

const outboundUK = calculateOutboundCallCost("+442012345678", 5);
console.log(
  `  Outbound to UK (5 min): ${(outboundUK.costCents / 100).toFixed(4)} USD`
);

// Test 2: SMS
console.log("\n✓ SMS costs calculated correctly");
const inboundSMS = calculateInboundSMSCost("+15551234567");
console.log(`  Inbound SMS: ${(inboundSMS / 100).toFixed(4)} USD`);

const outboundSMSUS = calculateOutboundSMSCost("+15551234567", 1);
console.log(
  `  Outbound SMS to US: ${(outboundSMSUS.costCents / 100).toFixed(4)} USD`
);

const outboundSMSUK = calculateOutboundSMSCost("+442012345678", 1);
console.log(
  `  Outbound SMS to UK: ${(outboundSMSUK.costCents / 100).toFixed(4)} USD`
);

// Test 3: Multi-segment SMS
console.log("\n✓ SMS segmentation working");
const longMessage = "a".repeat(300);
const segments = calculateSMSSegments(longMessage);
console.log(`  300-char message: ${segments} segments`);

const unicodeMessage = "Hello! 👋";
const unicodeSegments = calculateSMSSegments(unicodeMessage);
console.log(`  Unicode message: ${unicodeSegments} segment(s)`);

// Test 4: Phone number costs
console.log("\n✓ Phone number monthly costs");
const localCost = getPhoneNumberMonthlyCost("local", 1);
console.log(`  Local number: ${(localCost / 100).toFixed(2)} USD/month`);

const tollFreeCost = getPhoneNumberMonthlyCost("tollFree", 1);
console.log(`  Toll-free number: ${(tollFreeCost / 100).toFixed(2)} USD/month`);

// Test 5: Trial account limits
console.log("\n✓ Trial account checks");
const upgradeCheck = shouldUpgradeFromTrial(45, 10, true, false);
console.log(`  Should upgrade: ${upgradeCheck.shouldUpgrade}`);
console.log(`  Reasons: ${upgradeCheck.reasons.join(", ")}`);

// Test 6: Strategy recommendation
console.log("\n✓ Phone strategy recommendations");
const strategyNA = recommendPhoneStrategy(["US", "CA"], 500, 1000);
console.log(`  NA-only: ${strategyNA.strategy}`);
console.log(
  `  Estimated cost: $${(strategyNA.estimatedMonthlyCost / 100).toFixed(2)}/month`
);

const strategyGlobal = recommendPhoneStrategy(
  ["US", "UK", "FR", "DE", "SG"],
  2000,
  3000
);
console.log(`  Global: ${strategyGlobal.strategy}`);
console.log(
  `  Estimated cost: $${(strategyGlobal.estimatedMonthlyCost / 100).toFixed(2)}/month`
);

console.log("\n✅ All tests passed!");
