/**
 * CAPTCHA Autonomous Workarounds Test Suite
 *
 * Verifies that the CAPTCHA system:
 * 1. NEVER emails users for manual solving
 * 2. Uses CapSolver/2Captcha/Claude Vision fallback chain
 * 3. Tries autonomous workarounds when all services fail
 * 4. Enforces 1-hour timeout
 * 5. Handles graceful failures without user interruption
 *
 * Target: 95%+ autonomous solve rate, 0 user emails sent
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Page } from 'playwright';
import {
  detectCaptcha,
  solveCaptcha,
  handleCaptchaIfPresent,
  type CaptchaType,
} from '../src/execution/captcha';

// Mock dependencies
vi.mock('../src/services/ai.js', () => ({
  generateVisionResponse: vi.fn(async () => ({
    content: 'ABC123',
    cost: 0.002,
  })),
}));

vi.mock('../src/utils/supabase.js', () => ({
  getSupabaseClient: vi.fn(() => ({
    from: vi.fn(() => ({
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          gte: vi.fn(() => ({
            ilike: vi.fn().mockResolvedValue({ data: [{ cost_usd: 0.5 }], error: null }),
          })),
          single: vi.fn().mockResolvedValue({
            data: { email: 'test@example.com', username: 'testuser' },
            error: null,
          }),
        })),
      })),
    })),
  })),
}));

vi.mock('../src/services/email.js', () => ({
  sendResponse: vi.fn(async () => ({ success: true })),
}));

// Mock Page object
const createMockPage = (options: {
  captchaType?: CaptchaType;
  siteKey?: string;
  imageUrl?: string;
  hasSkipButton?: boolean;
  hasContent?: boolean;
  captchaDisappearsOnReload?: boolean;
}) => {
  let reloadCount = 0;
  const mockPage = {
    url: () => 'https://example.com/test',

    evaluate: vi.fn(async (fn: Function) => {
      // Simulate CAPTCHA detection
      if (fn.toString().includes('g-recaptcha')) {
        if (options.captchaDisappearsOnReload && reloadCount > 0) {
          return { type: 'none' as const, siteKey: undefined };
        }

        return {
          type: options.captchaType || 'none' as const,
          siteKey: options.siteKey,
          imageUrl: options.imageUrl,
        };
      }
      // For token injection
      return undefined;
    }),

    $: vi.fn(async (selector: string) => {
      if (selector.includes('Skip') || selector.includes('Continue')) {
        return options.hasSkipButton ? {
          click: vi.fn(),
        } : null;
      }

      if (selector.includes('captcha')) {
        return options.captchaType !== 'none' ? {
          screenshot: vi.fn(async () => Buffer.from('fake-screenshot-data')),
          fill: vi.fn(),
        } : null;
      }

      return null;
    }),

    reload: vi.fn(async () => {
      reloadCount++;
      return undefined;
    }),

    waitForTimeout: vi.fn(async () => undefined),

    content: vi.fn(async () => {
      return options.hasContent
        ? 'x'.repeat(15000) // Substantial content
        : '<html><body>Minimal</body></html>';
    }),
  } as unknown as Page;

  return mockPage;
};

describe('CAPTCHA Detection', () => {
  it('should detect no CAPTCHA on clean page', async () => {
    const page = createMockPage({ captchaType: 'none' });
    const result = await detectCaptcha(page);

    expect(result.type).toBe('none');
    expect(result.pageUrl).toBe('https://example.com/test');
  });

  it('should detect reCAPTCHA v2 with sitekey', async () => {
    const page = createMockPage({
      captchaType: 'recaptcha_v2',
      siteKey: '6LeTestKey',
    });
    const result = await detectCaptcha(page);

    expect(result.type).toBe('recaptcha_v2');
    expect(result.siteKey).toBe('6LeTestKey');
  });

  it('should detect hCaptcha', async () => {
    const page = createMockPage({
      captchaType: 'hcaptcha',
      siteKey: 'hcaptcha-test-key',
    });
    const result = await detectCaptcha(page);

    expect(result.type).toBe('hcaptcha');
    expect(result.siteKey).toBe('hcaptcha-test-key');
  });

  it('should detect Cloudflare Turnstile', async () => {
    const page = createMockPage({
      captchaType: 'turnstile',
      siteKey: 'turnstile-key',
    });
    const result = await detectCaptcha(page);

    expect(result.type).toBe('turnstile');
    expect(result.siteKey).toBe('turnstile-key');
  });

  it('should detect image CAPTCHA', async () => {
    const page = createMockPage({
      captchaType: 'image',
      imageUrl: 'https://example.com/captcha.png',
    });
    const result = await detectCaptcha(page);

    expect(result.type).toBe('image');
    expect(result.imageUrl).toBe('https://example.com/captcha.png');
  });
});

describe('CAPTCHA Service Fallback Chain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should attempt CapSolver first when API key is available', async () => {
    const originalEnv = process.env.CAPSOLVER_API_KEY;
    process.env.CAPSOLVER_API_KEY = 'test-capsolver-key';

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        json: async () => ({ errorId: 0, taskId: 'task-123' }),
      } as Response)
      .mockResolvedValueOnce({
        json: async () => ({
          errorId: 0,
          status: 'ready',
          solution: { gRecaptchaResponse: 'solved-token-123' },
        }),
      } as Response);

    const page = createMockPage({
      captchaType: 'recaptcha_v2',
      siteKey: 'test-key',
    });

    const result = await solveCaptcha(page, {
      type: 'recaptcha_v2',
      siteKey: 'test-key',
      pageUrl: 'https://example.com',
    }, 'user-123', 'task-456');

    expect(result.success).toBe(true);
    expect(result.service).toBe('capsolver');
    expect(result.solution).toBe('solved-token-123');

    process.env.CAPSOLVER_API_KEY = originalEnv;
  });

  it('should fall back to 2Captcha when CapSolver fails', async () => {
    const originalEnv = {
      capsolver: process.env.CAPSOLVER_API_KEY,
      twocaptcha: process.env.TWOCAPTCHA_API_KEY,
    };

    process.env.CAPSOLVER_API_KEY = 'test-capsolver-key';
    process.env.TWOCAPTCHA_API_KEY = 'test-2captcha-key';

    global.fetch = vi.fn()
      // CapSolver fails (3 retries)
      .mockResolvedValueOnce({
        json: async () => ({ errorId: 1, errorDescription: 'CapSolver error' }),
      } as Response)
      .mockResolvedValueOnce({
        json: async () => ({ errorId: 1, errorDescription: 'CapSolver error' }),
      } as Response)
      .mockResolvedValueOnce({
        json: async () => ({ errorId: 1, errorDescription: 'CapSolver error' }),
      } as Response)
      // 2Captcha succeeds
      .mockResolvedValueOnce({
        json: async () => ({ errorId: 0, taskId: 'task-2captcha' }),
      } as Response)
      .mockResolvedValueOnce({
        json: async () => ({
          errorId: 0,
          status: 'ready',
          solution: { gRecaptchaResponse: '2captcha-token' },
        }),
      } as Response);

    const page = createMockPage({
      captchaType: 'recaptcha_v2',
      siteKey: 'test-key',
    });

    const result = await solveCaptcha(page, {
      type: 'recaptcha_v2',
      siteKey: 'test-key',
      pageUrl: 'https://example.com',
    }, 'user-123', 'task-456');

    expect(result.success).toBe(true);
    expect(result.service).toBe('2captcha');

    process.env.CAPSOLVER_API_KEY = originalEnv.capsolver;
    process.env.TWOCAPTCHA_API_KEY = originalEnv.twocaptcha;
  });

  it('should fall back to Claude Vision for image CAPTCHAs', async () => {
    const originalEnv = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-claude-key';

    // Disable other services
    delete process.env.CAPSOLVER_API_KEY;
    delete process.env.TWOCAPTCHA_API_KEY;

    const page = createMockPage({
      captchaType: 'image',
      imageUrl: 'https://example.com/captcha.png',
    });

    const result = await solveCaptcha(page, {
      type: 'image',
      pageUrl: 'https://example.com',
    }, 'user-123', 'task-456');

    expect(result.success).toBe(true);
    expect(result.service).toBe('claude_vision');
    expect(result.solution).toBe('ABC123');

    process.env.ANTHROPIC_API_KEY = originalEnv;
  });
});

describe('Autonomous Workarounds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    delete process.env.CAPSOLVER_API_KEY;
    delete process.env.TWOCAPTCHA_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('Strategy 1: should succeed when CAPTCHA disappears on reload', async () => {
    const page = createMockPage({
      captchaType: 'recaptcha_v2',
      siteKey: 'test-key',
      captchaDisappearsOnReload: true,
    });

    const promise = solveCaptcha(page, {
      type: 'recaptcha_v2',
      siteKey: 'test-key',
      pageUrl: 'https://example.com',
    }, 'user-123', 'task-456');

    // Fast-forward through the 30s wait
    await vi.advanceTimersByTimeAsync(30000);

    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.solution).toBe('captcha_disappeared');
    expect(page.reload).toHaveBeenCalledWith({ waitUntil: 'networkidle' });
  });

  it('Strategy 2: should succeed when skip button is found', async () => {
    const page = createMockPage({
      captchaType: 'recaptcha_v2',
      siteKey: 'test-key',
      hasSkipButton: true,
    });

    // Mock the skip button to make CAPTCHA disappear after click
    let skipClicked = false;
    page.$ = vi.fn(async (selector: string) => {
      if (selector.includes('Skip') && !skipClicked) {
        return {
          click: vi.fn(async () => {
            skipClicked = true;
          }),
        };
      }
      return null;
    });

    page.evaluate = vi.fn(async () => {
      if (skipClicked) {
        return { type: 'none' as const, siteKey: undefined };
      }
      return { type: 'recaptcha_v2' as const, siteKey: 'test-key' };
    });

    const promise = solveCaptcha(page, {
      type: 'recaptcha_v2',
      siteKey: 'test-key',
      pageUrl: 'https://example.com',
    }, 'user-123', 'task-456');

    // Fast-forward through the 30s wait
    await vi.advanceTimersByTimeAsync(32000);

    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.solution).toBe('skip_button');
  });

  it('Strategy 3: should succeed when content is extractable without solving', async () => {
    const page = createMockPage({
      captchaType: 'recaptcha_v2',
      siteKey: 'test-key',
      hasContent: true, // Page has substantial content
    });

    const promise = solveCaptcha(page, {
      type: 'recaptcha_v2',
      siteKey: 'test-key',
      pageUrl: 'https://example.com',
    }, 'user-123', 'task-456');

    // Fast-forward through the 30s wait
    await vi.advanceTimersByTimeAsync(32000);

    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.solution).toBe('content_extraction');
  });

  it('should enforce 1-hour timeout for autonomous workarounds', async () => {
    const page = createMockPage({
      captchaType: 'recaptcha_v2',
      siteKey: 'test-key',
    });

    // Mock Date.now() to simulate 1 hour elapsed
    const originalDateNow = Date.now;
    const startTime = 1000000000000;
    let callCount = 0;

    Date.now = vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        return startTime; // First call (startTime in solveCaptcha)
      }
      return startTime + (61 * 60 * 1000); // 61 minutes later
    });

    const result = await solveCaptcha(page, {
      type: 'recaptcha_v2',
      siteKey: 'test-key',
      pageUrl: 'https://example.com',
    }, 'user-123', 'task-456');

    expect(result.success).toBe(false);
    expect(result.error).toContain('1 hour');

    Date.now = originalDateNow;
  });

  it('should fail gracefully after all workarounds exhausted', async () => {
    const page = createMockPage({
      captchaType: 'recaptcha_v2',
      siteKey: 'test-key',
      captchaDisappearsOnReload: false,
      hasSkipButton: false,
      hasContent: false,
    });

    const promise = solveCaptcha(page, {
      type: 'recaptcha_v2',
      siteKey: 'test-key',
      pageUrl: 'https://example.com',
    }, 'user-123', 'task-456');

    // Fast-forward through the 30s wait
    await vi.advanceTimersByTimeAsync(32000);

    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toContain('autonomous workarounds');
  });
});

describe('No User Emails Policy', () => {
  it('should NEVER call sendResponse for manual CAPTCHA solving', async () => {
    const { sendResponse } = await import('../src/services/email.js');
    vi.clearAllMocks();

    const page = createMockPage({
      captchaType: 'recaptcha_v2',
      siteKey: 'test-key',
    });

    // Disable all services to force autonomous workarounds
    delete process.env.CAPSOLVER_API_KEY;
    delete process.env.TWOCAPTCHA_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    await solveCaptcha(page, {
      type: 'recaptcha_v2',
      siteKey: 'test-key',
      pageUrl: 'https://example.com',
    }, 'user-123', 'task-456');

    // Verify sendResponse was NEVER called for manual solve requests
    const calls = (sendResponse as ReturnType<typeof vi.fn>).mock.calls;
    const manualSolveCalls = calls.filter(call =>
      call[0]?.subject?.includes('manual') ||
      call[0]?.body?.includes('solve this CAPTCHA')
    );

    expect(manualSolveCalls).toHaveLength(0);
  });

  it('should only send email for daily cost alerts (>$5)', async () => {
    const { sendResponse } = await import('../src/services/email.js');
    const { getSupabaseClient } = await import('../src/utils/supabase.js');
    vi.clearAllMocks();

    // Mock high daily cost
    (getSupabaseClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn(() => ({
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            gte: vi.fn(() => ({
              ilike: vi.fn().mockResolvedValue({
                data: [
                  { cost_usd: 3.0 },
                  { cost_usd: 2.5 },
                ], // Total $5.50
                error: null,
              }),
            })),
            single: vi.fn().mockResolvedValue({
              data: { email: 'test@example.com', username: 'testuser' },
              error: null,
            }),
          })),
        })),
      })),
    });

    process.env.CAPSOLVER_API_KEY = 'test-key';
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        json: async () => ({ errorId: 0, taskId: 'task-123' }),
      } as Response)
      .mockResolvedValueOnce({
        json: async () => ({
          errorId: 0,
          status: 'ready',
          solution: { gRecaptchaResponse: 'solved' },
        }),
      } as Response);

    const page = createMockPage({
      captchaType: 'recaptcha_v2',
      siteKey: 'test-key',
    });

    await solveCaptcha(page, {
      type: 'recaptcha_v2',
      siteKey: 'test-key',
      pageUrl: 'https://example.com',
    }, 'user-123', 'task-456');

    // Should send cost alert email
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('High CAPTCHA Costs'),
      })
    );

    delete process.env.CAPSOLVER_API_KEY;
  });
});

describe('handleCaptchaIfPresent Integration', () => {
  it('should return true when no CAPTCHA detected', async () => {
    const page = createMockPage({ captchaType: 'none' });
    const result = await handleCaptchaIfPresent(page, 'user-123', 'task-456');

    expect(result).toBe(true);
  });

  it('should solve CAPTCHA and return true on success', async () => {
    process.env.CAPSOLVER_API_KEY = 'test-key';

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        json: async () => ({ errorId: 0, taskId: 'task-123' }),
      } as Response)
      .mockResolvedValueOnce({
        json: async () => ({
          errorId: 0,
          status: 'ready',
          solution: { gRecaptchaResponse: 'solved' },
        }),
      } as Response);

    const page = createMockPage({
      captchaType: 'recaptcha_v2',
      siteKey: 'test-key',
    });

    const result = await handleCaptchaIfPresent(page, 'user-123', 'task-456');

    expect(result).toBe(true);

    delete process.env.CAPSOLVER_API_KEY;
  });

  it('should return false when CAPTCHA solving fails completely', async () => {
    delete process.env.CAPSOLVER_API_KEY;
    delete process.env.TWOCAPTCHA_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const page = createMockPage({
      captchaType: 'recaptcha_v2',
      siteKey: 'test-key',
      captchaDisappearsOnReload: false,
      hasSkipButton: false,
      hasContent: false,
    });

    const result = await handleCaptchaIfPresent(page, 'user-123', 'task-456');

    expect(result).toBe(false);
  });
});

describe('Cost Tracking', () => {
  it('should track CapSolver costs to ai_cost_log', async () => {
    const { getSupabaseClient } = await import('../src/utils/supabase.js');
    vi.clearAllMocks();

    process.env.CAPSOLVER_API_KEY = 'test-key';

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        json: async () => ({ errorId: 0, taskId: 'task-123' }),
      } as Response)
      .mockResolvedValueOnce({
        json: async () => ({
          errorId: 0,
          status: 'ready',
          solution: { gRecaptchaResponse: 'solved' },
        }),
      } as Response);

    const page = createMockPage({
      captchaType: 'recaptcha_v2',
      siteKey: 'test-key',
    });

    await solveCaptcha(page, {
      type: 'recaptcha_v2',
      siteKey: 'test-key',
      pageUrl: 'https://example.com',
    }, 'user-123', 'task-456');

    expect(getSupabaseClient).toHaveBeenCalled();

    delete process.env.CAPSOLVER_API_KEY;
  });
});

describe('Real-World Scenario Simulations', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('Scenario: Cloudflare challenge page with temporary CAPTCHA', async () => {
    const page = createMockPage({
      captchaType: 'turnstile',
      siteKey: 'cloudflare-key',
      captchaDisappearsOnReload: true, // Cloudflare often auto-solves after wait
    });

    delete process.env.CAPSOLVER_API_KEY;

    const promise = solveCaptcha(page, {
      type: 'turnstile',
      siteKey: 'cloudflare-key',
      pageUrl: 'https://example.com',
    });

    await vi.advanceTimersByTimeAsync(32000);

    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.solution).toBe('captcha_disappeared');
  });

  it('Scenario: Site with login bypass link', async () => {
    const page = createMockPage({
      captchaType: 'recaptcha_v2',
      siteKey: 'test-key',
      hasSkipButton: true,
    });

    // Mock skip button behavior
    let skipClicked = false;
    page.$ = vi.fn(async (selector: string) => {
      if (selector.includes('Skip') && !skipClicked) {
        return {
          click: vi.fn(async () => {
            skipClicked = true;
          }),
        };
      }
      return null;
    });

    page.evaluate = vi.fn(async () => {
      if (skipClicked) {
        return { type: 'none' as const, siteKey: undefined };
      }
      return { type: 'recaptcha_v2' as const, siteKey: 'test-key' };
    });

    delete process.env.CAPSOLVER_API_KEY;

    const promise = solveCaptcha(page, {
      type: 'recaptcha_v2',
      siteKey: 'test-key',
      pageUrl: 'https://example.com/login',
    });

    await vi.advanceTimersByTimeAsync(32000);

    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.solution).toBe('skip_button');
  });

  it('Scenario: Data extraction page with visible content', async () => {
    const page = createMockPage({
      captchaType: 'recaptcha_v2',
      siteKey: 'test-key',
      hasContent: true, // Content already loaded
    });

    delete process.env.CAPSOLVER_API_KEY;

    const promise = solveCaptcha(page, {
      type: 'recaptcha_v2',
      siteKey: 'test-key',
      pageUrl: 'https://example.com/data',
    });

    await vi.advanceTimersByTimeAsync(32000);

    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.solution).toBe('content_extraction');
  });

  it('Scenario: Persistent CAPTCHA wall (ultimate failure case)', async () => {
    const page = createMockPage({
      captchaType: 'recaptcha_v2',
      siteKey: 'test-key',
      captchaDisappearsOnReload: false,
      hasSkipButton: false,
      hasContent: false,
    });

    delete process.env.CAPSOLVER_API_KEY;
    delete process.env.TWOCAPTCHA_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const promise = solveCaptcha(page, {
      type: 'recaptcha_v2',
      siteKey: 'test-key',
      pageUrl: 'https://example.com',
    });

    await vi.advanceTimersByTimeAsync(32000);

    const result = await promise;

    // Should fail gracefully WITHOUT emailing user
    expect(result.success).toBe(false);
    expect(result.error).toContain('autonomous workarounds');

    const { sendResponse } = await import('../src/services/email.js');
    const calls = (sendResponse as ReturnType<typeof vi.fn>).mock.calls;
    const manualSolveCalls = calls.filter(call =>
      call[0]?.subject?.toLowerCase().includes('captcha') &&
      !call[0]?.subject?.includes('Cost')
    );

    expect(manualSolveCalls).toHaveLength(0);
  });
});

describe('Regression Tests', () => {
  it('should never reference requestUserManualSolve function', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');

    const captchaFile = await fs.readFile(
      path.join(__dirname, '../src/execution/captcha.ts'),
      'utf-8'
    );

    expect(captchaFile).not.toContain('requestUserManualSolve');
  });

  it('should handle undefined startTime gracefully', async () => {
    vi.useFakeTimers();

    // This test verifies the bug fix where startTime was missing from
    // tryAutonomousWorkarounds function signature

    const page = createMockPage({
      captchaType: 'recaptcha_v2',
      siteKey: 'test-key',
    });

    delete process.env.CAPSOLVER_API_KEY;

    // Should not throw, even if startTime tracking has issues
    const promise = solveCaptcha(page, {
      type: 'recaptcha_v2',
      siteKey: 'test-key',
      pageUrl: 'https://example.com',
    });

    await vi.advanceTimersByTimeAsync(32000);

    await expect(promise).resolves.toBeDefined();

    vi.useRealTimers();
  });
});
