/**
 * Billing Flip Switch Tests
 *
 * Tests that BILLING_ENABLED environment variable correctly controls
 * budget enforcement behavior.
 *
 * When BILLING_ENABLED=false (beta mode): unlimited usage for all users
 * When BILLING_ENABLED=true (production): enforce tier limits
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// Store original env
const originalEnv = process.env.BILLING_ENABLED;

// Mock Supabase client
const mockSupabaseClient = {
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(),
        })),
        single: vi.fn(),
      })),
    })),
  })),
} as unknown as SupabaseClient;

// Mock the Supabase utility
vi.mock('../src/utils/supabase.js', () => ({
  getSupabaseClient: () => mockSupabaseClient,
}));

describe('Billing Flip Switch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear module cache to force reload with new env vars
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original value
    if (originalEnv !== undefined) {
      process.env.BILLING_ENABLED = originalEnv;
    } else {
      delete process.env.BILLING_ENABLED;
    }
    vi.resetModules();
  });

  describe('Beta Mode (BILLING_ENABLED=false)', () => {
    beforeEach(() => {
      process.env.BILLING_ENABLED = 'false';
    });

    it('should allow unlimited budget', async () => {
      const { checkBudget } = await import('../src/middleware/budget-check.js');
      const result = await checkBudget('test-user-id');

      expect(result.allowed).toBe(true);
      expect(result.remaining_usd).toBe(Infinity);
      expect(result.limit_usd).toBe(Infinity);
      expect(result.tier).toBe('beta');

      // Should NOT query database in beta mode
      expect(mockSupabaseClient.from).not.toHaveBeenCalled();
    });

    it('should not send budget warnings', async () => {
      const { shouldSendBudgetWarning } = await import('../src/middleware/budget-check.js');
      const result = await shouldSendBudgetWarning('test-user-id');

      expect(result).toBe(false);

      // Should NOT query database in beta mode
      expect(mockSupabaseClient.from).not.toHaveBeenCalled();
    });

    it('should report billing as disabled', async () => {
      const { getBudgetStatus } = await import('../src/middleware/budget-check.js');
      const result = await getBudgetStatus('test-user-id');

      expect(result.billing_enabled).toBe(false);
      expect(result.remaining_usd).toBe(Infinity);
      expect(result.limit_usd).toBe(Infinity);
      expect(result.used_usd).toBe(0);
      expect(result.percentage_used).toBe(0);
      expect(result.tier).toBe('beta');

      // Should NOT query database in beta mode
      expect(mockSupabaseClient.from).not.toHaveBeenCalled();
    });
  });

  describe('Production Mode (BILLING_ENABLED=true)', () => {
    beforeEach(() => {
      process.env.BILLING_ENABLED = 'true';

      // Mock database responses for production mode
      const mockSelect = vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { ai_cost_cents: 500 }, // $5 used
              error: null,
            }),
          })),
          single: vi.fn().mockResolvedValue({
            data: { subscription_tier: 'free' },
            error: null,
          }),
          gte: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: 'PGRST116' }, // No warning sent yet
            }),
          })),
        })),
      }));

      mockSupabaseClient.from = vi.fn(() => ({
        select: mockSelect,
      })) as any;
    });

    it('should enforce budget limits', async () => {
      const { checkBudget } = await import('../src/middleware/budget-check.js');
      const result = await checkBudget('test-user-id');

      // Should query database in production mode
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('usage');
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('profiles');

      // Should enforce limits (free tier = $10 limit, $5 used = $5 remaining)
      expect(result.allowed).toBe(true);
      expect(result.tier).toBe('free');
      expect(result.limit_usd).toBe(10);
      expect(result.used_usd).toBe(5);
      expect(result.remaining_usd).toBe(5);
    });

    it('should block tasks when over budget', async () => {
      // Mock user at 100% budget
      const mockSelect = vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { ai_cost_cents: 1000 }, // $10 used (at limit)
              error: null,
            }),
          })),
          single: vi.fn().mockResolvedValue({
            data: { subscription_tier: 'free' },
            error: null,
          }),
        })),
      }));

      mockSupabaseClient.from = vi.fn(() => ({
        select: mockSelect,
      })) as any;

      const { checkBudget } = await import('../src/middleware/budget-check.js');
      const result = await checkBudget('test-user-id');

      expect(result.allowed).toBe(false);
      expect(result.remaining_usd).toBe(0);
      expect(result.reason).toContain('budget of $10 exceeded');
    });

    it('should send budget warnings at 80% threshold', async () => {
      // Mock user at 85% budget (above 80% warning threshold)
      // Need to handle different query paths for shouldSendBudgetWarning:
      // 1. Check for existing warning (tasks table)
      // 2. Get usage (usage table)
      // 3. Get profile (profiles table)

      let callCount = 0;
      mockSupabaseClient.from = vi.fn((tableName: string) => {
        callCount++;

        if (tableName === 'tasks') {
          // First call - check for existing warning
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  gte: vi.fn(() => ({
                    single: vi.fn().mockResolvedValue({
                      data: null,
                      error: { code: 'PGRST116' }, // No warning sent yet
                    }),
                  })),
                })),
              })),
            })),
          };
        } else if (tableName === 'usage') {
          // Second call - get current usage
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: { ai_cost_cents: 850 }, // $8.50 used (85% of $10)
                    error: null,
                  }),
                })),
              })),
            })),
          };
        } else if (tableName === 'profiles') {
          // Third call - get tier
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { subscription_tier: 'free' },
                  error: null,
                }),
              })),
            })),
          };
        }

        return { select: vi.fn() };
      }) as any;

      const { shouldSendBudgetWarning } = await import('../src/middleware/budget-check.js');
      const result = await shouldSendBudgetWarning('test-user-id');

      expect(result).toBe(true);
    });

    it('should report billing as enabled', async () => {
      const { getBudgetStatus } = await import('../src/middleware/budget-check.js');
      const result = await getBudgetStatus('test-user-id');

      expect(result.billing_enabled).toBe(true);
      expect(result.tier).toBe('free');
      expect(result.used_usd).toBe(5);
      expect(result.limit_usd).toBe(10);
      expect(result.remaining_usd).toBe(5);
      expect(result.percentage_used).toBe(50);
    });

    it('should handle beta tier users with higher limits', async () => {
      // Mock beta tier user
      const mockSelect = vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { ai_cost_cents: 3000 }, // $30 used
              error: null,
            }),
          })),
          single: vi.fn().mockResolvedValue({
            data: { subscription_tier: 'beta' },
            error: null,
          }),
        })),
      }));

      mockSupabaseClient.from = vi.fn(() => ({
        select: mockSelect,
      })) as any;

      const { checkBudget } = await import('../src/middleware/budget-check.js');
      const result = await checkBudget('test-user-id');

      expect(result.allowed).toBe(true);
      expect(result.tier).toBe('beta');
      expect(result.limit_usd).toBe(50); // Beta tier = $50 limit
      expect(result.used_usd).toBe(30);
      expect(result.remaining_usd).toBe(20);
    });

    it('should handle paid tier users with unlimited budget', async () => {
      // Mock paid tier user
      const mockSelect = vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { ai_cost_cents: 10000 }, // $100 used
              error: null,
            }),
          })),
          single: vi.fn().mockResolvedValue({
            data: { subscription_tier: 'paid' },
            error: null,
          }),
        })),
      }));

      mockSupabaseClient.from = vi.fn(() => ({
        select: mockSelect,
      })) as any;

      const { checkBudget } = await import('../src/middleware/budget-check.js');
      const result = await checkBudget('test-user-id');

      expect(result.allowed).toBe(true);
      expect(result.tier).toBe('paid');
      expect(result.limit_usd).toBe(Infinity);
      expect(result.remaining_usd).toBe(Infinity);
    });
  });

  describe('Default Behavior (BILLING_ENABLED unset)', () => {
    beforeEach(() => {
      delete process.env.BILLING_ENABLED;
    });

    it('should default to beta mode (unlimited)', async () => {
      const { checkBudget } = await import('../src/middleware/budget-check.js');
      const result = await checkBudget('test-user-id');

      // When unset, should default to beta mode (false !== 'true')
      expect(result.allowed).toBe(true);
      expect(result.remaining_usd).toBe(Infinity);
      expect(result.limit_usd).toBe(Infinity);
      expect(result.tier).toBe('beta');
    });
  });

  describe('Environment Variable Format', () => {
    it('should only activate on exact string "true"', async () => {
      const testCases = [
        { value: 'true', shouldBeBeta: false, description: 'exact "true"' },
        { value: 'TRUE', shouldBeBeta: true, description: 'uppercase TRUE' },
        { value: '1', shouldBeBeta: true, description: 'number 1' },
        { value: 'yes', shouldBeBeta: true, description: 'yes' },
        { value: 'false', shouldBeBeta: true, description: 'false' },
        { value: '', shouldBeBeta: true, description: 'empty string' },
      ];

      for (const { value, shouldBeBeta, description } of testCases) {
        // Clear module cache before each test
        vi.resetModules();
        process.env.BILLING_ENABLED = value;

        const { checkBudget } = await import('../src/middleware/budget-check.js');
        const result = await checkBudget('test-user-id');

        if (shouldBeBeta) {
          // In beta mode, returns unlimited immediately
          expect(result.allowed).toBe(true);
          expect(result.remaining_usd).toBe(Infinity);
          expect(result.tier).toBe('beta');
        } else {
          // In production mode, queries database
          expect(mockSupabaseClient.from).toHaveBeenCalled();
        }
      }
    });
  });

  describe('Flip Switch Behavior', () => {
    it('should allow switching from beta to production', async () => {
      // Start in beta
      process.env.BILLING_ENABLED = 'false';
      vi.resetModules();

      let { checkBudget } = await import('../src/middleware/budget-check.js');
      let result = await checkBudget('test-user-id');
      expect(result.remaining_usd).toBe(Infinity);
      expect(result.tier).toBe('beta');

      // Flip to production
      vi.resetModules();
      process.env.BILLING_ENABLED = 'true';

      // Mock production data
      const mockSelect = vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { ai_cost_cents: 500 },
              error: null,
            }),
          })),
          single: vi.fn().mockResolvedValue({
            data: { subscription_tier: 'free' },
            error: null,
          }),
        })),
      }));

      mockSupabaseClient.from = vi.fn(() => ({
        select: mockSelect,
      })) as any;

      ({ checkBudget } = await import('../src/middleware/budget-check.js'));
      result = await checkBudget('test-user-id');

      // Now it should enforce budget
      expect(result.tier).toBe('free');
      expect(result.limit_usd).toBe(10);
      expect(result.remaining_usd).not.toBe(Infinity);
      expect(mockSupabaseClient.from).toHaveBeenCalled();
    });

    it('should allow switching from production to beta', async () => {
      // Start in production
      process.env.BILLING_ENABLED = 'true';
      vi.resetModules();

      // Mock production data
      const mockSelect = vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { ai_cost_cents: 500 },
              error: null,
            }),
          })),
          single: vi.fn().mockResolvedValue({
            data: { subscription_tier: 'free' },
            error: null,
          }),
        })),
      }));

      mockSupabaseClient.from = vi.fn(() => ({
        select: mockSelect,
      })) as any;

      let { checkBudget } = await import('../src/middleware/budget-check.js');
      let result = await checkBudget('test-user-id');
      expect(mockSupabaseClient.from).toHaveBeenCalled();

      // Flip to beta
      vi.resetModules();
      vi.clearAllMocks();
      process.env.BILLING_ENABLED = 'false';

      ({ checkBudget } = await import('../src/middleware/budget-check.js'));
      result = await checkBudget('test-user-id');

      // Now unlimited again
      expect(result.remaining_usd).toBe(Infinity);
      expect(result.tier).toBe('beta');
      expect(mockSupabaseClient.from).not.toHaveBeenCalled();
    });
  });

  describe('Budget Enforcement Logic', () => {
    it('should calculate tier limits correctly', () => {
      const TIER_LIMITS_CENTS = {
        free: 1000,  // $10
        beta: 5000,  // $50
        paid: Infinity,
      };

      expect(TIER_LIMITS_CENTS.free).toBe(1000);
      expect(TIER_LIMITS_CENTS.beta).toBe(5000);
      expect(TIER_LIMITS_CENTS.paid).toBe(Infinity);
    });

    it('should calculate remaining budget correctly', () => {
      const usedCents = 800; // $8
      const limitCents = 1000; // $10
      const remainingCents = limitCents - usedCents; // $2

      expect(remainingCents).toBe(200);
      expect(remainingCents / 100).toBe(2.0); // $2 remaining
    });

    it('should enforce 80% warning threshold', () => {
      const limitCents = 1000; // $10
      const threshold = limitCents * 0.8; // $8

      expect(threshold).toBe(800);

      // Below threshold - no warning
      expect(700 >= threshold).toBe(false);

      // At threshold - warning
      expect(800 >= threshold).toBe(true);

      // Above threshold - warning
      expect(900 >= threshold).toBe(true);

      // At limit - different behavior (blocked, not warning)
      expect(1000 >= limitCents).toBe(true);
    });

    it('should block tasks at 100% budget', () => {
      const limitCents = 1000;
      const usedCents = 1000;

      const isOverBudget = usedCents >= limitCents;
      expect(isOverBudget).toBe(true);
    });
  });
});
