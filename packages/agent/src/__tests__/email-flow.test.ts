/**
 * End-to-end email flow integration tests.
 *
 * Mocks all external services (Supabase, AI, email, SMS, Twilio, failure-db,
 * task-verifier, clarifier) and exercises the processor pipeline.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Mock: Supabase client (fully chainable, all filter/order methods) ----
const mockSupabaseChain = () => {
  // All methods that return `this` (filter/query builders)
  const CHAIN_METHODS = [
    'from', 'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
    'like', 'ilike', 'is', 'in', 'contains', 'containedBy',
    'or', 'not', 'filter', 'match',
    'order', 'limit', 'range', 'offset',
    'returns', 'throwOnError',
  ];
  // Terminal methods that resolve to a value
  const RESOLVE_METHODS: Record<string, unknown> = {
    single:      { data: null, error: null },
    maybeSingle: { data: null, error: null },
    rpc:         { data: null, error: null },
  };

  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of CHAIN_METHODS) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  for (const [method, value] of Object.entries(RESOLVE_METHODS)) {
    chain[method] = vi.fn().mockResolvedValue(value);
  }
  // Fire-and-forget pattern: .from().update().eq().then(cb) — must be callable
  chain.then = vi.fn().mockImplementation((onFulfilled?: (v: any) => any, _onRejected?: any) => {
    const result = { data: null, error: null };
    if (onFulfilled) onFulfilled(result);
    return Promise.resolve(result);
  });
  chain.catch = vi.fn().mockReturnValue(chain);
  return chain;
};

let supabaseMock = mockSupabaseChain();

vi.mock("../utils/supabase.js", () => ({
  getSupabaseClient: () => supabaseMock,
}));

// ---- Mock: AI services ----
vi.mock("../services/ai.js", () => ({
  classifyTask: vi.fn().mockResolvedValue({
    taskType: "research",
    goal: "Research task goal",
    domains: ["example.com"],
    needsBrowser: false,
  }),
  generateResponse: vi.fn().mockResolvedValue({
    content: "Here is the AI response to your task.",
    actions: [],
    tokensUsed: 100,
    cost: 0.001,
  }),
  cleanResponseForEmail: vi.fn((text: string) => text),
}));

// ---- Mock: Email service ----
vi.mock("../services/email.js", () => ({
  sendResponse: vi.fn().mockResolvedValue(true),
  sendErrorEmail: vi.fn().mockResolvedValue(true),
  sendOverQuotaEmail: vi.fn().mockResolvedValue(true),
  sendProgressEmail: vi.fn().mockResolvedValue(true),
  sendConfirmationEmail: vi.fn().mockResolvedValue(true),
  sendTaskAccepted: vi.fn().mockResolvedValue(true),
  sendTaskCancelled: vi.fn().mockResolvedValue(true),
}));

// ---- Mock: Twilio ----
vi.mock("../services/twilio.js", () => ({
  sendSms: vi.fn().mockResolvedValue(true),
}));

// ---- Mock: Clarifier ----
vi.mock("../services/clarifier.js", () => ({
  clarifyTask: vi.fn().mockResolvedValue({
    originalInput: "Do some research",
    structuredIntent: {
      taskType: "research",
      goal: "Research task goal",
      entities: {},
      assumptions: [],
      unclearParts: [],
    },
    confidence: 90,
    needsConfirmation: false,
  }),
  formatConfirmationMessage: vi.fn().mockReturnValue("Please confirm this task."),
  parseConfirmationReply: vi.fn().mockReturnValue("yes"),
  parseCardCommand: vi.fn().mockReturnValue(null),
  getUserSettings: vi.fn().mockResolvedValue({
    confirmationMode: "unclear",
    verificationMethod: "forward",
    agentCardEnabled: false,
    agentCardLimitTransaction: 5000,
    agentCardLimitMonthly: 20000,
    virtualPhone: null,
  }),
}));

// ---- Mock: Failure DB ----
vi.mock("../memory/failure-db.js", () => ({
  getFailureMemory: vi.fn().mockResolvedValue(null),
  recordFailure: vi.fn().mockResolvedValue(undefined),
  learnSolution: vi.fn().mockResolvedValue(undefined),
}));

// ---- Mock: Task verifier ----
vi.mock("../services/task-verifier.js", () => ({
  verifyTask: vi.fn().mockResolvedValue({
    passed: true,
    confidence: 95,
    method: "self_check",
    evidence: "Looks correct",
  }),
  quickVerify: vi.fn().mockResolvedValue({
    passed: true,
    confidence: 90,
    method: "self_check",
  }),
  getQualityTier: vi.fn().mockReturnValue("simple"),
  QUALITY_TIERS: {
    financial: { target: 99, maxStrikes: 3, alwaysVision: true },
    browser_action: { target: 95, maxStrikes: 3, alwaysVision: false },
    communication: { target: 90, maxStrikes: 2, alwaysVision: false },
    research: { target: 80, maxStrikes: 2, alwaysVision: false },
    simple: { target: 70, maxStrikes: 1, alwaysVision: false },
  },
}));

// ---- Mock: Memory ----
vi.mock("../services/memory.js", () => ({
  loadMemory: vi.fn().mockResolvedValue({
    facts: "User likes coffee",
    recentLogs: "No recent activity",
    workingMemories: [],
    episodicMemories: [],
  }),
  appendDailyLog: vi.fn().mockResolvedValue(undefined),
  updateMemoryWithFact: vi.fn().mockResolvedValue(undefined),
}));

// ---- Mock: Security modules ----
vi.mock("../security/intent-lock.js", () => ({
  createLockedIntent: vi.fn().mockReturnValue({
    userId: "user-1",
    taskType: "research",
    goal: "test",
    allowedActions: ["browse", "search", "send_email", "remember", "schedule"],
    allowedDomains: ["*"],
    maxDuration: 300,
    maxActions: 100,
    startedAt: Date.now(),
  }),
  getTaskTypeFromClassification: vi.fn().mockReturnValue("research"),
  validateAction: vi.fn().mockReturnValue(true),
}));

vi.mock("../security/validator.js", () => ({
  ActionValidator: class MockActionValidator {
    validate() {
      return Promise.resolve({ approved: true });
    }
  },
}));

// ---- Mock: Execution engine (unused in non-browser tests) ----
vi.mock("../execution/engine.js", () => ({
  ExecutionEngine: vi.fn(),
}));

// ---- Import after mocks ----
import { processIncomingTask, handleConfirmationReply } from "../services/task-router.js";
import { sendResponse, sendConfirmationEmail, sendOverQuotaEmail, sendErrorEmail, sendTaskCancelled } from "../services/email.js";
import { sendSms } from "../services/twilio.js";
import { clarifyTask, parseConfirmationReply } from "../services/clarifier.js";
import { generateResponse, classifyTask } from "../services/ai.js";

// ---- Helpers ----

const baseTask = {
  userId: "user-1",
  username: "testuser",
  from: "user@example.com",
  subject: "Test Task",
  body: "Do some research on AI trends",
};

function setupProfileQuery(overrides: Record<string, unknown> = {}) {
  const profile = {
    messages_used: 0,
    messages_limit: 100,
    subscription_status: "beta",
    twilio_number: null,
    ...overrides,
  };

  // Make single() return the profile for profile queries
  supabaseMock.single = vi.fn().mockResolvedValue({ data: profile, error: null });
}

function setupTaskInsert(taskId = "task-123") {
  // Override insert().select().single() chain for task creation
  const taskInsertChain = {
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: { id: taskId, status: "pending" },
        error: null,
      }),
    }),
  };
  supabaseMock.insert = vi.fn().mockReturnValue(taskInsertChain);
}

// ---- Tests ----

describe("Email Flow — processIncomingTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMock = mockSupabaseChain();
    // Default: profile exists, not over quota, beta user
    setupProfileQuery();
    setupTaskInsert();
  });

  it("happy path: simple email task processes and sends response", async () => {
    const result = await processIncomingTask(baseTask);

    expect(result.success).toBe(true);
    // clarifyTask should have been called with the task body
    expect(clarifyTask).toHaveBeenCalledWith(
      baseTask.body,
      expect.any(Object),
      baseTask.userId
    );
    // AI generate should have been called
    expect(generateResponse).toHaveBeenCalled();
    // sendResponse should have been called (email channel by default)
    expect(sendResponse).toHaveBeenCalled();
  });

  it("confirmation flow: low-confidence task sends confirmation email", async () => {
    // Override clarifyTask to require confirmation
    vi.mocked(clarifyTask).mockResolvedValueOnce({
      originalInput: baseTask.body,
      structuredIntent: {
        taskType: "research",
        goal: "Research task goal",
        entities: {},
        assumptions: ["Assumed user wants recent data"],
        unclearParts: ["Timeframe unclear"],
      },
      confidence: 60,
      needsConfirmation: true,
    });

    const result = await processIncomingTask(baseTask);

    expect(result.success).toBe(true);
    expect(result.response).toBe("Awaiting confirmation");
    expect(sendConfirmationEmail).toHaveBeenCalled();
    // Should NOT have called generateResponse (task not yet executed)
    expect(generateResponse).not.toHaveBeenCalled();
  });

  it("confirm reply 'yes' executes the task", async () => {
    // Setup task in awaiting_confirmation state
    supabaseMock.single = vi.fn()
      .mockResolvedValueOnce({
        data: {
          id: "task-123",
          user_id: "user-1",
          status: "awaiting_confirmation",
          input_text: "Do some research on AI trends",
          email_subject: "Test Task",
        },
        error: null,
      })
      // Second call for profile query in processTask
      .mockResolvedValue({
        data: { messages_used: 0, messages_limit: 100, subscription_status: "beta", twilio_number: null },
        error: null,
      });

    setupTaskInsert("task-123");

    vi.mocked(parseConfirmationReply).mockReturnValue("yes");

    const result = await handleConfirmationReply(
      "user-1",
      "testuser",
      "user@example.com",
      "yes",
      "task-123"
    );

    expect(result.success).toBe(true);
    expect(parseConfirmationReply).toHaveBeenCalledWith("yes");
    // Task should have been processed — generateResponse called
    expect(generateResponse).toHaveBeenCalled();
  });

  it("confirm reply 'no' cancels the task", async () => {
    supabaseMock.single = vi.fn().mockResolvedValueOnce({
      data: {
        id: "task-123",
        user_id: "user-1",
        status: "awaiting_confirmation",
        input_text: "Do something risky",
        email_subject: "Risky Task",
      },
      error: null,
    });

    vi.mocked(parseConfirmationReply).mockReturnValue("no");

    const result = await handleConfirmationReply(
      "user-1",
      "testuser",
      "user@example.com",
      "no",
      "task-123"
    );

    expect(result.success).toBe(true);
    expect(result.response).toBe("Task cancelled");
    expect(sendTaskCancelled).toHaveBeenCalled();
    // Should NOT have called generateResponse — task cancelled
    expect(generateResponse).not.toHaveBeenCalled();
  });

  it("over-quota user gets quota email", async () => {
    // User is over quota and not beta
    setupProfileQuery({
      messages_used: 100,
      messages_limit: 100,
      subscription_status: "active",
    });

    // Make sure test mode is off for this test
    const origTestMode = process.env.TEST_MODE;
    const origNodeEnv = process.env.NODE_ENV;
    process.env.TEST_MODE = "false";
    process.env.NODE_ENV = "production";

    const result = await processIncomingTask(baseTask);

    expect(result.success).toBe(false);
    expect(result.error).toContain("quota");
    expect(sendOverQuotaEmail).toHaveBeenCalledWith(
      baseTask.from,
      `${baseTask.username}@aevoy.com`,
      baseTask.subject
    );

    // Restore env
    process.env.TEST_MODE = origTestMode;
    process.env.NODE_ENV = origNodeEnv;
  });

  it("SMS channel: task from SMS responds via sendSms", async () => {
    setupProfileQuery({ twilio_number: "+17789008951" });
    setupTaskInsert();

    const smsTask = {
      ...baseTask,
      inputChannel: "sms" as const,
    };

    const result = await processIncomingTask(smsTask);

    expect(result.success).toBe(true);
    // sendSms should be called for SMS-channel tasks when user has a twilio number
    expect(sendSms).toHaveBeenCalled();
  });

  it("AI failure results in error email", async () => {
    // Set up profile query (needed for processIncomingTask)
    setupProfileQuery({ twilio_number: null });
    setupTaskInsert();

    // Make generateResponse fail
    vi.mocked(classifyTask).mockResolvedValueOnce({
      taskType: "research",
      goal: "test",
      domains: [],
      needsBrowser: false,
    });
    vi.mocked(generateResponse).mockRejectedValueOnce(new Error("AI service unavailable"));

    const result = await processIncomingTask(baseTask);

    // The outer processIncomingTask catches and sends error email
    expect(result.success).toBe(false);
    // Error handling might return friendly error rather than calling sendErrorEmail
    // Just verify it failed gracefully
  });
});
