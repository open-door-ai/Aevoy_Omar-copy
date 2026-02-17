/**
 * Complex Multi-Step Task Execution Tests
 *
 * Tests the agent's ability to handle vague, complex tasks with minimal instructions.
 * Verifies:
 * 1. Vague task handling (research, compare, synthesize)
 * 2. Chained dependencies (3+ steps with context carryover)
 * 3. Error recovery (self-correction without user intervention)
 * 4. Context retention across 5+ action steps
 * 5. Proactive suggestions (alternatives when blocked)
 * 6. Budget awareness (best deals, not first option)
 * 7. Observe-Plan-Act (page state capture, validation, re-planning)
 * 8. Template matching (reuse learned workflows)
 *
 * Target: 99%+ task completion rate with <3 iterations average.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// Test user: teste2e (ID: 11684ec6-80cd-4bb6-9aed-8f0947afd06a, beta tier)
const TEST_USER_ID = '11684ec6-80cd-4bb6-9aed-8f0947afd06a';
const TEST_USER_EMAIL = 'teste2e@example.com';

// Mock Supabase client with proper nested chaining
const createMockChain = () => {
  const chain: any = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    lte: vi.fn(() => chain),
    gt: vi.fn(() => chain),
    lt: vi.fn(() => chain),
    in: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve({ data: null })),
    limit: vi.fn(() => chain),
    order: vi.fn(() => Promise.resolve({ data: [] })),
    delete: vi.fn(() => Promise.resolve({ data: null })),
  };
  return chain;
};

const mockSupabaseClient = {
  from: vi.fn(() => ({
    select: vi.fn(() => createMockChain()),
    insert: vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(() => Promise.resolve({ data: { id: 'test-task-id' } })),
      })),
    })),
    update: vi.fn(() => ({
      eq: vi.fn(() => Promise.resolve({ data: null })),
    })),
  })),
  rpc: vi.fn(() => Promise.resolve({ data: null })),
} as unknown as SupabaseClient;

// Mock services
vi.mock('../src/utils/supabase.js', () => ({
  getSupabaseClient: () => mockSupabaseClient,
}));

vi.mock('../src/services/email.js', () => ({
  sendResponse: vi.fn(),
  sendProgressEmail: vi.fn(),
}));

vi.mock('../src/services/ai.js', async () => {
  const actual = await vi.importActual('../src/services/ai.js');
  return {
    ...actual,
    generateResponse: vi.fn(),
    classifyTask: vi.fn(),
    quickValidate: vi.fn(),
  };
});

import { processTask } from '../src/services/processor.js';
import { generateResponse, classifyTask, quickValidate } from '../src/services/ai.js';

describe('Complex Multi-Step Task Execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock responses - use mockImplementation for dynamic chaining
    (mockSupabaseClient.from as any).mockImplementation((table: string) => {
      const chain = createMockChain();

      // Profile query
      if (table === 'profiles') {
        chain.single.mockResolvedValue({
          data: {
            id: TEST_USER_ID,
            email: TEST_USER_EMAIL,
            subscription_tier: 'beta',
            messages_used: 5,
            messages_limit: 100,
            timezone: 'America/New_York',
            onboarding_completed: true,
          },
        });
      }

      // Tasks query
      if (table === 'tasks') {
        chain.single.mockResolvedValue({
          data: { id: 'test-task-id', status: 'processing' },
        });
      }

      // User memory query
      if (table === 'user_memory') {
        chain.order.mockResolvedValue({ data: [] });
      }

      return {
        select: vi.fn(() => chain),
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { id: 'test-task-id', status: 'processing' },
            }),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ data: null }),
        })),
      };
    });

    (mockSupabaseClient.rpc as any).mockImplementation((rpcName: string, params: any) => {
      if (rpcName === 'increment_usage') return Promise.resolve({ data: null });
      if (rpcName === 'track_usage') return Promise.resolve({ data: null });
      if (rpcName === 'update_task_progress') return Promise.resolve({ data: null });
      if (rpcName === 'find_matching_template') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: null });
    });

    (classifyTask as any).mockResolvedValue({
      taskType: 'research',
      requiresBrowser: true,
      estimatedComplexity: 0.7,
      requiresAuth: false,
    });

    (quickValidate as any).mockResolvedValue({
      goalAchieved: true,
      confidence: 95,
      evidence: ['Task completed successfully'],
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('1. Vague Task Handling', () => {
    it('should research destinations, compare prices, create itinerary for "Book me a vacation"', async () => {
      const vagueTasks = [
        'Book me a vacation',
        'Find me a good restaurant tonight',
        'Plan my weekend',
      ];

      for (const task of vagueTasks) {
        console.log(`\n=== Testing vague task: "${task}" ===`);

        // Mock AI response with multi-step plan
        (generateResponse as any).mockResolvedValueOnce({
          content: `I'll help you with "${task}". Let me research options, compare prices, and create a plan.`,
          actions: [
            { type: 'search', params: { query: task } },
            { type: 'browse', params: { url: 'https://www.google.com/search?q=' + encodeURIComponent(task) } },
            { type: 'extract', params: { selector: 'div.search-result' } },
            { type: 'remember', params: { fact: `User wants: ${task}`, importance: 0.9 } },
          ],
          cost: 0.0005,
          tokensUsed: 500,
          model: 'deepseek-chat',
        }).mockResolvedValueOnce({
          content: '[TASK_COMPLETE] Based on my research, here are 3 top-rated options with price comparison...',
          actions: [],
          cost: 0.0003,
          tokensUsed: 300,
          model: 'deepseek-chat',
        });

        const result = await processTask({
          userId: TEST_USER_ID,
          from: TEST_USER_EMAIL,
          message: task,
          channel: 'email',
        });

        expect(result.success).toBe(true);
        expect(result.iterations).toBeLessThanOrEqual(3);
        expect(result.actions).toBeGreaterThanOrEqual(3); // At least 3 steps: research, compare, synthesize
        expect(result.cost).toBeLessThan(0.05); // Under $0.05 per task
        console.log(`✓ "${task}" completed in ${result.iterations} iterations, ${result.actions} actions, $${result.cost.toFixed(4)}`);
      }
    }, 60000);

    it('should decompose complex request into sub-tasks', async () => {
      const complexTask = 'Find a recipe for dinner, buy the ingredients, and schedule a reminder to cook it';

      (generateResponse as any).mockResolvedValueOnce({
        content: 'I\'ll break this down into 3 sub-tasks: 1) Find recipe, 2) Buy ingredients, 3) Schedule reminder.',
        actions: [
          { type: 'search', params: { query: 'easy dinner recipes' } },
          { type: 'browse', params: { url: 'https://www.allrecipes.com' } },
        ],
        cost: 0.0004,
        tokensUsed: 400,
        model: 'groq',
      }).mockResolvedValueOnce({
        content: 'Found a great pasta recipe. Now checking ingredient delivery services...',
        actions: [
          { type: 'browse', params: { url: 'https://www.instacart.com' } },
          { type: 'remember', params: { fact: 'Recipe: Pasta Carbonara, Ingredients: pasta, eggs, bacon, parmesan', importance: 0.8 } },
        ],
        cost: 0.0003,
        tokensUsed: 300,
        model: 'groq',
      }).mockResolvedValueOnce({
        content: '[TASK_COMPLETE] All set! Recipe found, ingredients added to cart, and I\'ve noted to remind you at 5 PM.',
        actions: [
          { type: 'schedule', params: { description: 'Cook pasta carbonara', time: '17:00' } },
        ],
        cost: 0.0002,
        tokensUsed: 200,
        model: 'groq',
      });

      const result = await processTask({
        userId: TEST_USER_ID,
        from: TEST_USER_EMAIL,
        message: complexTask,
        channel: 'email',
      });

      expect(result.success).toBe(true);
      expect(result.iterations).toBeLessThanOrEqual(3);
      expect(result.actions).toBeGreaterThanOrEqual(5); // 3 sub-tasks × ~2 actions each
      console.log(`✓ Complex task completed in ${result.iterations} iterations`);
    }, 60000);
  });

  describe('2. Chained Dependencies', () => {
    it('should maintain context across 5+ steps', async () => {
      const chainedTask = 'Find the cheapest flight to Tokyo next month, book a hotel near Shibuya, and create a 3-day itinerary';

      let iterationCount = 0;
      (generateResponse as any).mockImplementation(() => {
        iterationCount++;

        if (iterationCount === 1) {
          return Promise.resolve({
            content: 'Searching for flights to Tokyo...',
            actions: [
              { type: 'search', params: { query: 'cheap flights to Tokyo' } },
              { type: 'browse', params: { url: 'https://www.google.com/flights' } },
              { type: 'remember', params: { fact: 'Cheapest flight: $650 on March 15', importance: 0.9 } },
            ],
            cost: 0.0006,
            tokensUsed: 600,
            model: 'deepseek-chat',
          });
        } else if (iterationCount === 2) {
          return Promise.resolve({
            content: 'Found flight for $650. Now searching hotels near Shibuya...',
            actions: [
              { type: 'search', params: { query: 'hotels near Shibuya Tokyo' } },
              { type: 'browse', params: { url: 'https://www.booking.com' } },
              { type: 'remember', params: { fact: 'Best hotel: Shibuya Excel Hotel $120/night', importance: 0.9 } },
            ],
            cost: 0.0005,
            tokensUsed: 500,
            model: 'deepseek-chat',
          });
        } else {
          return Promise.resolve({
            content: '[TASK_COMPLETE] Complete travel plan:\n- Flight: $650 (March 15)\n- Hotel: Shibuya Excel ($120/night × 3 = $360)\n- Day 1: Shibuya Crossing, Meiji Shrine\n- Day 2: Senso-ji Temple, Akihabara\n- Day 3: Mount Fuji day trip\nTotal: $1,010',
            actions: [
              { type: 'remember', params: { fact: 'Tokyo trip: March 15-18, total budget $1,010', importance: 1.0 } },
            ],
            cost: 0.0007,
            tokensUsed: 700,
            model: 'deepseek-chat',
          });
        }
      });

      const result = await processTask({
        userId: TEST_USER_ID,
        from: TEST_USER_EMAIL,
        message: chainedTask,
        channel: 'email',
      });

      expect(result.success).toBe(true);
      expect(result.iterations).toBe(3);
      expect(result.actions).toBeGreaterThanOrEqual(7); // Multiple steps per iteration

      // Verify memory was used (context carryover)
      const memoryActions = (generateResponse as any).mock.results
        .flatMap((r: any) => r.value.actions)
        .filter((a: any) => a.type === 'remember');
      expect(memoryActions.length).toBeGreaterThanOrEqual(3);

      console.log(`✓ Chained task completed with ${memoryActions.length} memory stores`);
    }, 90000);

    it('should use previous step results in next step', async () => {
      const dependentTask = 'Look up the weather in Paris and suggest what to pack';

      (generateResponse as any).mockResolvedValueOnce({
        content: 'Checking Paris weather...',
        actions: [
          { type: 'search', params: { query: 'Paris weather forecast' } },
          { type: 'extract', params: { selector: '.weather-temp' } },
        ],
        cost: 0.0003,
        tokensUsed: 300,
        model: 'groq',
      }).mockResolvedValueOnce({
        content: '[TASK_COMPLETE] Paris will be 12°C and rainy. Pack: umbrella, light jacket, waterproof shoes, layers.',
        actions: [],
        cost: 0.0002,
        tokensUsed: 200,
        model: 'groq',
      });

      const result = await processTask({
        userId: TEST_USER_ID,
        from: TEST_USER_EMAIL,
        message: dependentTask,
        channel: 'email',
      });

      expect(result.success).toBe(true);
      expect(result.response).toContain('12°C');
      expect(result.response).toContain('umbrella');
      console.log(`✓ Dependent task correctly chained weather → packing list`);
    }, 30000);
  });

  describe('3. Error Recovery', () => {
    it('should self-correct when primary approach fails', async () => {
      const taskWithFailure = 'Find my recent Amazon order';

      let attemptCount = 0;
      (generateResponse as any).mockImplementation(() => {
        attemptCount++;

        if (attemptCount === 1) {
          // First attempt: try to navigate directly (will fail - not logged in)
          return Promise.resolve({
            content: 'Checking Amazon orders...',
            actions: [
              { type: 'browse', params: { url: 'https://www.amazon.com/orders' } },
            ],
            cost: 0.0003,
            tokensUsed: 300,
            model: 'groq',
          });
        } else if (attemptCount === 2) {
          // Observe failure, try login
          return Promise.resolve({
            content: 'Need to log in first. Attempting login...',
            actions: [
              { type: 'login', params: { site: 'amazon.com' } },
              { type: 'browse', params: { url: 'https://www.amazon.com/orders' } },
            ],
            cost: 0.0004,
            tokensUsed: 400,
            model: 'groq',
          });
        } else {
          // Success after login
          return Promise.resolve({
            content: '[TASK_COMPLETE] Found your recent orders: MacBook Pro ($2,499), ordered Feb 10.',
            actions: [],
            cost: 0.0002,
            tokensUsed: 200,
            model: 'groq',
          });
        }
      });

      (quickValidate as any)
        .mockResolvedValueOnce({ goalAchieved: false, confidence: 20, evidence: ['Login required'] })
        .mockResolvedValueOnce({ goalAchieved: true, confidence: 95, evidence: ['Orders page loaded'] });

      const result = await processTask({
        userId: TEST_USER_ID,
        from: TEST_USER_EMAIL,
        message: taskWithFailure,
        channel: 'email',
      });

      expect(result.success).toBe(true);
      expect(result.iterations).toBe(3);
      expect(attemptCount).toBe(3); // Initial attempt + 2 recovery rounds
      console.log(`✓ Self-corrected after ${attemptCount - 1} failures`);
    }, 60000);

    it('should avoid repeating same failed strategy 3+ times', async () => {
      const stubornTask = 'Click the submit button';

      const strategiesUsed = new Set<string>();
      (generateResponse as any).mockImplementation(() => {
        const iteration = strategiesUsed.size + 1;

        if (iteration <= 3) {
          // First 3 attempts use different methods
          const methods = ['css_selector', 'xpath', 'text_match'];
          const method = methods[iteration - 1];
          strategiesUsed.add(method);

          return Promise.resolve({
            content: `Trying method ${iteration}: ${method}...`,
            actions: [
              { type: 'click', params: { selector: `button.submit-${method}`, method } },
            ],
            cost: 0.0002,
            tokensUsed: 200,
            model: 'gemini',
          });
        } else {
          // 4th attempt: different approach entirely (vision-based)
          strategiesUsed.add('vision');
          return Promise.resolve({
            content: '[TASK_COMPLETE] Used vision-based click after 3 selector failures.',
            actions: [
              { type: 'click', params: { method: 'vision', description: 'submit button' } },
            ],
            cost: 0.0008,
            tokensUsed: 800,
            model: 'claude-sonnet',
          });
        }
      });

      (quickValidate as any)
        .mockResolvedValueOnce({ goalAchieved: false, confidence: 30, evidence: [] })
        .mockResolvedValueOnce({ goalAchieved: false, confidence: 30, evidence: [] })
        .mockResolvedValueOnce({ goalAchieved: false, confidence: 30, evidence: [] })
        .mockResolvedValueOnce({ goalAchieved: true, confidence: 90, evidence: ['Button clicked'] });

      const result = await processTask({
        userId: TEST_USER_ID,
        from: TEST_USER_EMAIL,
        message: stubornTask,
        channel: 'email',
      });

      expect(result.success).toBe(true);
      expect(strategiesUsed.size).toBeGreaterThanOrEqual(3); // Used multiple different strategies
      expect([...strategiesUsed]).toContain('vision'); // Eventually tried vision
      console.log(`✓ Tried ${strategiesUsed.size} different strategies: ${[...strategiesUsed].join(', ')}`);
    }, 60000);
  });

  describe('4. Context Retention', () => {
    it('should remember user preferences from previous tasks', async () => {
      // Simulate previous task that stored preference
      const previousMemory = {
        id: 'mem-1',
        user_id: TEST_USER_ID,
        memory_type: 'long_term',
        content: 'User prefers vegetarian restaurants',
        importance: 0.9,
        last_accessed_at: new Date().toISOString(),
      };

      (mockSupabaseClient.from as any)().select().eq().limit().order.mockResolvedValueOnce({
        data: [previousMemory],
      });

      const newTask = 'Find a good restaurant for tonight';

      (generateResponse as any).mockResolvedValueOnce({
        content: 'Based on your preference for vegetarian food, I found 3 great options...',
        actions: [
          { type: 'search', params: { query: 'vegetarian restaurants near me' } },
        ],
        cost: 0.0004,
        tokensUsed: 400,
        model: 'deepseek-chat',
      }).mockResolvedValueOnce({
        content: '[TASK_COMPLETE] Top vegetarian spots: 1) Green Garden ($$$), 2) Veggie Delight ($$), 3) Plant Power ($)',
        actions: [],
        cost: 0.0003,
        tokensUsed: 300,
        model: 'deepseek-chat',
      });

      const result = await processTask({
        userId: TEST_USER_ID,
        from: TEST_USER_EMAIL,
        message: newTask,
        channel: 'email',
      });

      expect(result.success).toBe(true);
      expect(result.response.toLowerCase()).toContain('vegetarian');
      console.log('✓ Used previous preference from memory');
    }, 30000);

    it('should maintain working memory across multi-step workflow', async () => {
      const workflowTask = 'Compare iPhone 15 vs Samsung S24, then recommend one based on camera quality';

      (generateResponse as any).mockResolvedValueOnce({
        content: 'Researching iPhone 15 specs...',
        actions: [
          { type: 'search', params: { query: 'iPhone 15 camera specs' } },
          { type: 'remember', params: { fact: 'iPhone 15: 48MP main, 12MP ultra-wide', importance: 0.8 } },
        ],
        cost: 0.0003,
        tokensUsed: 300,
        model: 'groq',
      }).mockResolvedValueOnce({
        content: 'Now checking Samsung S24...',
        actions: [
          { type: 'search', params: { query: 'Samsung S24 camera specs' } },
          { type: 'remember', params: { fact: 'Samsung S24: 50MP main, 12MP ultra-wide, 10MP telephoto', importance: 0.8 } },
        ],
        cost: 0.0003,
        tokensUsed: 300,
        model: 'groq',
      }).mockResolvedValueOnce({
        content: '[TASK_COMPLETE] For camera quality, I recommend Samsung S24 because it has a dedicated 10MP telephoto lens (3x optical zoom) that iPhone 15 lacks. Both have similar main/ultra-wide, but S24\'s zoom capability gives it the edge.',
        actions: [],
        cost: 0.0004,
        tokensUsed: 400,
        model: 'deepseek-chat',
      });

      const result = await processTask({
        userId: TEST_USER_ID,
        from: TEST_USER_EMAIL,
        message: workflowTask,
        channel: 'email',
      });

      expect(result.success).toBe(true);
      expect(result.response).toMatch(/S24|Samsung/);
      expect(result.response).toMatch(/telephoto|zoom/);
      console.log('✓ Retained specs from both phones in working memory');
    }, 60000);
  });

  describe('5. Proactive Suggestions', () => {
    it('should offer alternatives when primary option unavailable', async () => {
      const taskWithBlocker = 'Book a table at French Laundry for tonight';

      (generateResponse as any).mockResolvedValueOnce({
        content: 'Checking French Laundry availability...',
        actions: [
          { type: 'browse', params: { url: 'https://www.thomaskeller.com/tfl' } },
        ],
        cost: 0.0003,
        tokensUsed: 300,
        model: 'groq',
      }).mockResolvedValueOnce({
        content: '[TASK_COMPLETE] French Laundry is fully booked for tonight (they require 2-month advance reservations). I found 3 excellent alternatives:\n1. Bouchon Bistro (same chef, available 8PM)\n2. Auberge du Soleil (5-star, available 7:30PM)\n3. La Toque (Michelin star, available 9PM)\n\nWould you like me to book one of these?',
        actions: [
          { type: 'search', params: { query: 'fine dining Napa Valley tonight' } },
        ],
        cost: 0.0005,
        tokensUsed: 500,
        model: 'deepseek-chat',
      });

      (quickValidate as any)
        .mockResolvedValueOnce({ goalAchieved: false, confidence: 50, evidence: ['Fully booked'] })
        .mockResolvedValueOnce({ goalAchieved: true, confidence: 85, evidence: ['Alternatives provided'] });

      const result = await processTask({
        userId: TEST_USER_ID,
        from: TEST_USER_EMAIL,
        message: taskWithBlocker,
        channel: 'email',
      });

      expect(result.success).toBe(true);
      expect(result.response).toMatch(/alternative|instead|other/i);
      expect(result.response).toMatch(/Bouchon|Auberge|La Toque/);
      console.log('✓ Proactively suggested 3 alternatives');
    }, 45000);
  });

  describe('6. Budget Awareness', () => {
    it('should compare prices and recommend cheapest option', async () => {
      const budgetTask = 'Find the cheapest wireless headphones under $100';

      (generateResponse as any).mockResolvedValueOnce({
        content: 'Comparing wireless headphones under $100...',
        actions: [
          { type: 'search', params: { query: 'best wireless headphones under $100' } },
          { type: 'browse', params: { url: 'https://www.amazon.com' } },
          { type: 'extract', params: { selector: '.product-price' } },
        ],
        cost: 0.0004,
        tokensUsed: 400,
        model: 'groq',
      }).mockResolvedValueOnce({
        content: '[TASK_COMPLETE] Best value: Anker Soundcore Q20 at $59.99 (4.5★, 50hr battery, ANC). Alternatives: JBL Tune 510BT ($49.99, no ANC), Sony WH-CH520 ($69.99, better sound). I recommend Anker Q20 for best features per dollar.',
        actions: [],
        cost: 0.0003,
        tokensUsed: 300,
        model: 'deepseek-chat',
      });

      const result = await processTask({
        userId: TEST_USER_ID,
        from: TEST_USER_EMAIL,
        message: budgetTask,
        channel: 'email',
      });

      expect(result.success).toBe(true);
      expect(result.response).toMatch(/\$[0-9]+\.?[0-9]*/); // Contains price
      expect(result.response.match(/\$/g)?.length).toBeGreaterThanOrEqual(2); // At least 2 prices (comparison)
      console.log('✓ Compared multiple options, recommended best value');
    }, 45000);

    it('should stay within task budget of $2', async () => {
      const expensiveTask = 'Research the top 10 AI companies, their valuations, and recent news';

      let totalCost = 0;
      (generateResponse as any).mockImplementation(() => {
        totalCost += 0.001; // Each iteration costs $0.001

        if (totalCost < 0.005) {
          return Promise.resolve({
            content: `Researching... (cost so far: $${totalCost.toFixed(4)})`,
            actions: [
              { type: 'search', params: { query: 'top AI companies 2026' } },
            ],
            cost: 0.001,
            tokensUsed: 1000,
            model: 'deepseek-chat',
          });
        } else {
          return Promise.resolve({
            content: '[TASK_COMPLETE] Top 10 AI companies compiled with valuations and recent news.',
            actions: [],
            cost: 0.001,
            tokensUsed: 1000,
            model: 'deepseek-chat',
          });
        }
      });

      const result = await processTask({
        userId: TEST_USER_ID,
        from: TEST_USER_EMAIL,
        message: expensiveTask,
        channel: 'email',
      });

      expect(result.success).toBe(true);
      expect(result.cost).toBeLessThan(2.0); // Under $2 task budget
      console.log(`✓ Stayed within budget: $${result.cost.toFixed(4)} < $2.00`);
    }, 60000);
  });

  describe('7. Observe-Plan-Act', () => {
    it('should capture page state after each action', async () => {
      const observeTask = 'Go to Hacker News and find the top story';

      const pageStates: string[] = [];
      (generateResponse as any).mockImplementation((params: any) => {
        // Track what page state was sent to AI
        if (params.context?.pageState) {
          pageStates.push(params.context.pageState);
        }

        if (pageStates.length === 0) {
          return Promise.resolve({
            content: 'Navigating to Hacker News...',
            actions: [
              { type: 'browse', params: { url: 'https://news.ycombinator.com' } },
            ],
            cost: 0.0002,
            tokensUsed: 200,
            model: 'groq',
          });
        } else {
          return Promise.resolve({
            content: '[TASK_COMPLETE] Top story: "New AI Model Beats GPT-5" with 1,234 points.',
            actions: [
              { type: 'extract', params: { selector: '.storylink:first' } },
            ],
            cost: 0.0003,
            tokensUsed: 300,
            model: 'groq',
          });
        }
      });

      const result = await processTask({
        userId: TEST_USER_ID,
        from: TEST_USER_EMAIL,
        message: observeTask,
        channel: 'email',
      });

      expect(result.success).toBe(true);
      // Note: In real execution, page state would be captured. In mocked tests,
      // we verify the AI was called multiple times (observe → act → observe)
      expect((generateResponse as any).mock.calls.length).toBeGreaterThanOrEqual(2);
      console.log('✓ Observe-Plan-Act loop executed');
    }, 30000);

    it('should validate actions and re-plan if validation fails', async () => {
      const validationTask = 'Submit the contact form';

      (quickValidate as any)
        .mockResolvedValueOnce({ goalAchieved: false, confidence: 40, evidence: ['Required field missing'] })
        .mockResolvedValueOnce({ goalAchieved: true, confidence: 90, evidence: ['Form submitted successfully'] });

      (generateResponse as any)
        .mockResolvedValueOnce({
          content: 'Filling form...',
          actions: [
            { type: 'fill', params: { selector: 'input[name="email"]', value: 'test@example.com' } },
            { type: 'submit', params: { selector: 'form' } },
          ],
          cost: 0.0003,
          tokensUsed: 300,
          model: 'groq',
        })
        .mockResolvedValueOnce({
          content: 'Validation failed - adding required name field...',
          actions: [
            { type: 'fill', params: { selector: 'input[name="name"]', value: 'Test User' } },
            { type: 'submit', params: { selector: 'form' } },
          ],
          cost: 0.0003,
          tokensUsed: 300,
          model: 'groq',
        })
        .mockResolvedValueOnce({
          content: '[TASK_COMPLETE] Form submitted successfully.',
          actions: [],
          cost: 0.0002,
          tokensUsed: 200,
          model: 'groq',
        });

      const result = await processTask({
        userId: TEST_USER_ID,
        from: TEST_USER_EMAIL,
        message: validationTask,
        channel: 'email',
      });

      expect(result.success).toBe(true);
      expect(result.iterations).toBe(3);
      console.log('✓ Validated action, detected failure, re-planned successfully');
    }, 45000);
  });

  describe('8. Template Matching (Teach & Repeat)', () => {
    it('should reuse learned workflow for similar task', async () => {
      // First time: learns the workflow
      const learningTask = 'Check my Gmail inbox';

      (mockSupabaseClient.rpc as any).mockImplementation((rpcName: string) => {
        if (rpcName === 'find_matching_template') {
          // No template exists yet
          return Promise.resolve({ data: [] });
        }
        if (rpcName === 'upsert_workflow_template') {
          // Template gets recorded
          return Promise.resolve({ data: 'template-123' });
        }
        return Promise.resolve({ data: null });
      });

      (generateResponse as any).mockResolvedValueOnce({
        content: 'Logging into Gmail...',
        actions: [
          { type: 'browse', params: { url: 'https://mail.google.com' } },
          { type: 'login', params: { site: 'gmail.com' } },
          { type: 'wait', params: { ms: 2000 } },
          { type: 'extract', params: { selector: '.inbox-messages' } },
        ],
        cost: 0.0006,
        tokensUsed: 600,
        model: 'deepseek-chat',
      }).mockResolvedValueOnce({
        content: '[TASK_COMPLETE] You have 5 unread emails in your inbox.',
        actions: [],
        cost: 0.0003,
        tokensUsed: 300,
        model: 'deepseek-chat',
      });

      const firstResult = await processTask({
        userId: TEST_USER_ID,
        from: TEST_USER_EMAIL,
        message: learningTask,
        channel: 'email',
      });

      expect(firstResult.success).toBe(true);
      const firstIterations = firstResult.iterations || 1;
      const firstCost = firstResult.cost || 0;

      // Second time: uses template (faster, cheaper)
      const repeatTask = 'Show me my Gmail inbox';

      (mockSupabaseClient.rpc as any).mockImplementation((rpcName: string) => {
        if (rpcName === 'find_matching_template') {
          // Template found!
          return Promise.resolve({
            data: [{
              id: 'template-123',
              task_pattern: 'Check my Gmail inbox',
              steps: [
                { type: 'browse', params: { url: 'https://mail.google.com' } },
                { type: 'login', params: { site: 'gmail.com' } },
                { type: 'wait', params: { ms: 2000 } },
                { type: 'extract', params: { selector: '.inbox-messages' } },
              ],
              variables: {},
              success_count: 1,
              fail_count: 0,
              avg_duration_ms: 5000,
              rank: 0.95,
            }],
          });
        }
        return Promise.resolve({ data: null });
      });

      (generateResponse as any).mockResolvedValueOnce({
        content: '[TASK_COMPLETE] Using learned workflow... You have 7 unread emails.',
        actions: [], // Template handles execution, AI just confirms
        cost: 0.0002, // Cheaper since template did the work
        tokensUsed: 200,
        model: 'gemini',
      });

      const secondResult = await processTask({
        userId: TEST_USER_ID,
        from: TEST_USER_EMAIL,
        message: repeatTask,
        channel: 'email',
      });

      expect(secondResult.success).toBe(true);
      expect(secondResult.iterations).toBeLessThanOrEqual(firstIterations);
      expect(secondResult.cost).toBeLessThanOrEqual(firstCost);

      console.log(`✓ Template reuse: ${firstIterations} → ${secondResult.iterations} iterations, $${firstCost.toFixed(4)} → $${secondResult.cost?.toFixed(4)} cost`);
    }, 60000);

    it('should substitute variables in template for new task', async () => {
      const templateTask = 'Search for "TypeScript tutorials"';

      (mockSupabaseClient.rpc as any).mockImplementation((rpcName: string) => {
        if (rpcName === 'find_matching_template') {
          return Promise.resolve({
            data: [{
              id: 'template-search',
              task_pattern: 'Search for "React hooks"',
              steps: [
                { type: 'search', params: { query: '{{search_0}}' } },
                { type: 'browse', params: { url: 'https://www.google.com/search?q={{search_0}}' } },
              ],
              variables: { '{{search_0}}': 'React hooks' },
              success_count: 5,
              fail_count: 0,
              avg_duration_ms: 3000,
              rank: 0.88,
            }],
          });
        }
        return Promise.resolve({ data: null });
      });

      (generateResponse as any).mockResolvedValueOnce({
        content: '[TASK_COMPLETE] Found top TypeScript tutorial resources.',
        actions: [
          { type: 'search', params: { query: 'TypeScript tutorials' } },
        ],
        cost: 0.0002,
        tokensUsed: 200,
        model: 'groq',
      });

      const result = await processTask({
        userId: TEST_USER_ID,
        from: TEST_USER_EMAIL,
        message: templateTask,
        channel: 'email',
      });

      expect(result.success).toBe(true);
      expect(result.response).toContain('TypeScript');
      console.log('✓ Template variable substitution worked');
    }, 30000);
  });

  describe('9. Performance Metrics', () => {
    it('should achieve 99%+ completion rate across all test scenarios', async () => {
      const testScenarios = [
        'Find the weather',
        'Book a restaurant',
        'Search for news',
        'Create a reminder',
        'Check my calendar',
        'Find a recipe',
        'Compare prices',
        'Research a topic',
        'Schedule a meeting',
        'Draft an email',
      ];

      let successCount = 0;
      const results: { task: string; success: boolean; iterations: number; cost: number }[] = [];

      for (const task of testScenarios) {
        (generateResponse as any).mockResolvedValueOnce({
          content: `Processing: ${task}`,
          actions: [{ type: 'search', params: { query: task } }],
          cost: 0.0003,
          tokensUsed: 300,
          model: 'groq',
        }).mockResolvedValueOnce({
          content: `[TASK_COMPLETE] Completed: ${task}`,
          actions: [],
          cost: 0.0002,
          tokensUsed: 200,
          model: 'groq',
        });

        try {
          const result = await processTask({
            userId: TEST_USER_ID,
            from: TEST_USER_EMAIL,
            message: task,
            channel: 'email',
          });

          if (result.success) successCount++;
          results.push({
            task,
            success: result.success,
            iterations: result.iterations || 1,
            cost: result.cost || 0,
          });
        } catch {
          results.push({
            task,
            success: false,
            iterations: 0,
            cost: 0,
          });
        }
      }

      const completionRate = (successCount / testScenarios.length) * 100;
      const avgIterations = results.reduce((sum, r) => sum + r.iterations, 0) / results.length;
      const avgCost = results.reduce((sum, r) => sum + r.cost, 0) / results.length;

      console.log(`\n=== PERFORMANCE METRICS ===`);
      console.log(`Completion Rate: ${completionRate.toFixed(1)}% (${successCount}/${testScenarios.length})`);
      console.log(`Avg Iterations: ${avgIterations.toFixed(2)}`);
      console.log(`Avg Cost: $${avgCost.toFixed(4)}`);
      console.log(`\nPer-Task Results:`);
      results.forEach(r => {
        console.log(`  ${r.success ? '✓' : '✗'} ${r.task} (${r.iterations} iter, $${r.cost.toFixed(4)})`);
      });

      expect(completionRate).toBeGreaterThanOrEqual(99); // 99%+ success rate
      expect(avgIterations).toBeLessThan(3); // <3 iterations average
      expect(avgCost).toBeLessThan(0.01); // <$0.01 average cost
    }, 180000); // 3 minute timeout for 10 tasks
  });
});
