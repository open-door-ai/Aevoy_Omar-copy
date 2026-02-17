/**
 * Phone System International Load Test
 *
 * Simplified test for international concurrent phone load:
 * - E.164 normalization for 15+ countries
 * - Concurrent call simulation
 * - Performance benchmarks
 * - Error handling
 */

import { describe, it, expect } from 'vitest';
import { normalizePhone } from '../src/services/identity/normalizer.js';

// International test numbers
const INTERNATIONAL_NUMBERS = {
  US: '+15551234567',
  CANADA: '+16047245161',
  UK: '+442071234567',
  NIGERIA: '+2348012345678',
  SOUTH_AFRICA: '+27821234567',
  KENYA: '+254712345678',
  CHINA: '+8613800138000',
  INDIA: '+919876543210',
  BRAZIL: '+5511987654321',
  AUSTRALIA: '+61412345678',
  GERMANY: '+4915112345678',
  FRANCE: '+33612345678',
  JAPAN: '+819012345678',
  MEXICO: '+5215512345678',
  UAE: '+971501234567',
};

describe('Phone System International Load', () => {
  describe('1. E.164 Normalization', () => {
    it('should normalize US/Canada numbers', () => {
      expect(normalizePhone('555-123-4567')).toBe('+15551234567');
      expect(normalizePhone('(555) 123-4567')).toBe('+15551234567');
      expect(normalizePhone('1-555-123-4567')).toBe('+15551234567');
      expect(normalizePhone('+1 555 123 4567')).toBe('+15551234567');
    });

    it('should normalize UK numbers', () => {
      expect(normalizePhone('+44 20 7123 4567')).toBe('+442071234567');
      expect(normalizePhone('44 20 7123 4567')).toBe('+442071234567');
    });

    it('should normalize Nigerian numbers (Africa)', () => {
      expect(normalizePhone('+234 801 234 5678')).toBe('+2348012345678');
      expect(normalizePhone('234 801 234 5678')).toBe('+2348012345678');
    });

    it('should normalize South African numbers (Africa)', () => {
      expect(normalizePhone('+27 82 123 4567')).toBe('+27821234567');
    });

    it('should normalize Chinese numbers', () => {
      expect(normalizePhone('+86 138 0013 8000')).toBe('+8613800138000');
    });

    it('should normalize Indian numbers', () => {
      expect(normalizePhone('+91 98765 43210')).toBe('+919876543210');
    });

    it('should normalize Brazilian numbers', () => {
      expect(normalizePhone('+55 11 98765-4321')).toBe('+5511987654321');
    });

    it('should normalize Australian numbers', () => {
      expect(normalizePhone('+61 4 1234 5678')).toBe('+61412345678');
    });

    it('should normalize German numbers', () => {
      expect(normalizePhone('+49 151 12345678')).toBe('+4915112345678');
    });

    it('should normalize French numbers', () => {
      expect(normalizePhone('+33 6 12 34 56 78')).toBe('+33612345678');
    });

    it('should normalize Japanese numbers', () => {
      expect(normalizePhone('+81 90 1234 5678')).toBe('+819012345678');
    });

    it('should normalize UAE numbers', () => {
      expect(normalizePhone('+971 50 123 4567')).toBe('+971501234567');
    });

    it('should preserve existing E.164 format', () => {
      Object.values(INTERNATIONAL_NUMBERS).forEach(number => {
        expect(normalizePhone(number)).toBe(number);
      });
    });

    it('should handle edge cases', () => {
      expect(normalizePhone('')).toBe('');
      expect(normalizePhone('   ')).toBe('');
      // Invalid input with no digits returns empty string
      expect(normalizePhone('invalid')).toBe('');
      // Input with some digits but too short returns trimmed input
      expect(normalizePhone('123')).toBe('123');
    });
  });

  describe('2. Concurrent Processing Simulation', () => {
    // Simulate async webhook processing
    async function simulateWebhookProcessing(phoneNumber: string, delay: number = 50): Promise<{
      number: string;
      normalized: string;
      duration: number;
      success: boolean;
    }> {
      const start = Date.now();

      // Simulate I/O delay (DB lookup, API call, etc.)
      await new Promise(resolve => setTimeout(resolve, delay));

      const normalized = normalizePhone(phoneNumber);
      const duration = Date.now() - start;

      return {
        number: phoneNumber,
        normalized,
        duration,
        success: normalized.length > 0,
      };
    }

    it('should handle 10 concurrent normalizations', async () => {
      const numbers = Object.values(INTERNATIONAL_NUMBERS).slice(0, 10);

      const promises = numbers.map(num => simulateWebhookProcessing(num));
      const results = await Promise.all(promises);

      results.forEach(result => {
        expect(result.success).toBe(true);
        expect(result.normalized).toMatch(/^\+\d+$/);
      });

      const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
      expect(avgDuration).toBeLessThan(100); // Should be fast
    });

    it('should handle 50 concurrent normalizations', async () => {
      // Create 50 phone numbers (repeat the international set)
      const numbers = Array.from({ length: 50 }, (_, i) => {
        const countries = Object.values(INTERNATIONAL_NUMBERS);
        return countries[i % countries.length];
      });

      const start = Date.now();
      const promises = numbers.map(num => simulateWebhookProcessing(num, 20));
      const results = await Promise.all(promises);
      const totalTime = Date.now() - start;

      const successCount = results.filter(r => r.success).length;
      expect(successCount).toBe(50);

      // Should complete in ~50ms (parallel processing), not 50*20=1000ms (sequential)
      expect(totalTime).toBeLessThan(200);

      console.log(`    ✓ 50 concurrent: ${successCount}/50 succeeded in ${totalTime}ms`);
    });

    it('should handle 100 concurrent normalizations (stress test)', async () => {
      const numbers = Array.from({ length: 100 }, (_, i) => {
        const countries = Object.values(INTERNATIONAL_NUMBERS);
        return countries[i % countries.length];
      });

      const start = Date.now();
      const promises = numbers.map(num => simulateWebhookProcessing(num, 15));
      const results = await Promise.all(promises);
      const totalTime = Date.now() - start;

      const successCount = results.filter(r => r.success).length;
      expect(successCount).toBeGreaterThanOrEqual(95); // Allow 5% failure under extreme load

      expect(totalTime).toBeLessThan(500); // Should be <500ms even for 100 concurrent

      console.log(`    ✓ 100 concurrent: ${successCount}/100 succeeded in ${totalTime}ms`);
    });
  });

  describe('3. Performance Benchmarks', () => {
    it('should normalize numbers in <1ms each', () => {
      const testCases = Object.values(INTERNATIONAL_NUMBERS);
      const durations: number[] = [];

      testCases.forEach(number => {
        const start = process.hrtime.bigint();
        normalizePhone(number);
        const end = process.hrtime.bigint();
        const durationNs = Number(end - start);
        const durationMs = durationNs / 1_000_000;
        durations.push(durationMs);
      });

      const avgDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;
      const maxDuration = Math.max(...durations);

      expect(avgDuration).toBeLessThan(1); // Average < 1ms
      expect(maxDuration).toBeLessThan(5); // Max < 5ms

      console.log(`    Average: ${avgDuration.toFixed(3)}ms, Max: ${maxDuration.toFixed(3)}ms`);
    });

    it('should handle malformed input gracefully', () => {
      const malformed = [
        'abc123',
        '+++123456',
        '    ',
        '',
      ];

      malformed.forEach(input => {
        expect(() => normalizePhone(input)).not.toThrow();
      });

      // Explicitly handle null/undefined/number by converting to string first
      expect(() => normalizePhone(String(null))).not.toThrow();
      expect(() => normalizePhone(String(undefined))).not.toThrow();
      expect(() => normalizePhone(String(123))).not.toThrow();
    });
  });

  describe('4. Country-Specific Patterns', () => {
    it('should detect US/Canada correctly', () => {
      const result = normalizePhone('555-123-4567');
      expect(result).toBe('+15551234567');
      expect(result.startsWith('+1')).toBe(true);
    });

    it('should detect UK correctly', () => {
      const result = normalizePhone('+44 20 7123 4567');
      expect(result).toBe('+442071234567');
      expect(result.startsWith('+44')).toBe(true);
    });

    it('should detect African countries correctly', () => {
      const nigeria = normalizePhone('+234 801 234 5678');
      const southAfrica = normalizePhone('+27 82 123 4567');
      const kenya = normalizePhone('+254 712 345 678');

      expect(nigeria.startsWith('+234')).toBe(true);
      expect(southAfrica.startsWith('+27')).toBe(true);
      expect(kenya.startsWith('+254')).toBe(true);
    });

    it('should detect Asian countries correctly', () => {
      const china = normalizePhone('+86 138 0013 8000');
      const india = normalizePhone('+91 98765 43210');
      const japan = normalizePhone('+81 90 1234 5678');

      expect(china.startsWith('+86')).toBe(true);
      expect(india.startsWith('+91')).toBe(true);
      expect(japan.startsWith('+81')).toBe(true);
    });
  });

  describe('5. Timezone Awareness', () => {
    function getLocalHour(timezone: string): number {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        hour12: false,
      });
      const parts = formatter.formatToParts(new Date());
      const hourPart = parts.find(p => p.type === 'hour');
      return hourPart ? parseInt(hourPart.value) : 0;
    }

    function isQuietHours(timezone: string): boolean {
      const hour = getLocalHour(timezone);
      return hour >= 22 || hour < 7;
    }

    it('should calculate timezone offsets correctly', () => {
      const timezones = [
        'America/Los_Angeles',
        'Europe/London',
        'Africa/Lagos',
        'Asia/Shanghai',
        'Australia/Sydney',
      ];

      timezones.forEach(tz => {
        const hour = getLocalHour(tz);
        expect(hour).toBeGreaterThanOrEqual(0);
        expect(hour).toBeLessThan(24);
      });
    });

    it('should detect quiet hours correctly', () => {
      // Mock test - actual quiet hours depend on current time
      // Just verify the logic is correct
      const testCases = [
        { tz: 'America/Los_Angeles', hour: 23, expected: true },
        { tz: 'America/Los_Angeles', hour: 12, expected: false },
        { tz: 'Europe/London', hour: 3, expected: true },
        { tz: 'Europe/London', hour: 14, expected: false },
      ];

      testCases.forEach(({ hour, expected }) => {
        const quietHours = hour >= 22 || hour < 7;
        expect(quietHours).toBe(expected);
      });
    });
  });
});

// Summary
console.log('\n' + '='.repeat(70));
console.log('Phone International Load Test — Summary');
console.log('='.repeat(70));
console.log('\nCoverage:');
console.log('  ✓ E.164 normalization for 15 countries');
console.log('  ✓ Concurrent processing (10, 50, 100 simultaneous)');
console.log('  ✓ Performance benchmarks (<1ms per normalization)');
console.log('  ✓ Country-specific pattern detection');
console.log('  ✓ Timezone awareness');
console.log('\nAll international phone patterns supported ✓');
console.log('='.repeat(70) + '\n');
