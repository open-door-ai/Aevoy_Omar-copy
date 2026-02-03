import { describe, it, expect } from "vitest";
import { createLockedIntent, validateAction, getTaskTypeFromClassification } from "../security/intent-lock.js";

describe("createLockedIntent", () => {
  it("creates a frozen intent object", () => {
    const intent = createLockedIntent({
      userId: "test-user-123",
      taskType: "research",
      goal: "Find restaurants in Vancouver",
    });

    expect(intent.userId).toBe("test-user-123");
    expect(intent.taskType).toBe("research");
    expect(intent.goal).toBe("Find restaurants in Vancouver");
    expect(intent.id).toBeTruthy();
    expect(intent.createdAt).toBeInstanceOf(Date);
    expect(intent.lockedAt).toBeInstanceOf(Date);
    expect(Object.isFrozen(intent)).toBe(true);
  });

  it("sets correct permissions for research tasks", () => {
    const intent = createLockedIntent({
      userId: "test",
      taskType: "research",
      goal: "test",
    });

    expect(intent.allowedActions).toContain("navigate");
    expect(intent.allowedActions).toContain("scroll");
    expect(intent.allowedActions).toContain("extract");
    expect(intent.forbiddenActions).toContain("fill");
    expect(intent.forbiddenActions).toContain("payment");
  });

  it("sets correct permissions for shopping tasks", () => {
    const intent = createLockedIntent({
      userId: "test",
      taskType: "shopping",
      goal: "test",
    });

    expect(intent.allowedActions).toContain("navigate");
    expect(intent.allowedActions).toContain("click");
    expect(intent.forbiddenActions).toContain("payment");
    expect(intent.forbiddenActions).toContain("checkout");
  });

  it("uses general permissions for unknown task types", () => {
    const intent = createLockedIntent({
      userId: "test",
      taskType: "unknown_type",
      goal: "test",
    });

    expect(intent.allowedActions).toContain("navigate");
    expect(intent.forbiddenActions).toContain("payment");
  });

  it("freezes allowedDomains array", () => {
    const intent = createLockedIntent({
      userId: "test",
      taskType: "research",
      goal: "test",
      allowedDomains: ["example.com"],
    });

    expect(Object.isFrozen(intent.allowedDomains)).toBe(true);
  });

  it("merges custom permissions with defaults", () => {
    const intent = createLockedIntent({
      userId: "test",
      taskType: "research",
      goal: "test",
      allowedActions: ["custom_action"],
    });

    expect(intent.allowedActions).toContain("navigate");
    expect(intent.allowedActions).toContain("custom_action");
  });
});

describe("validateAction", () => {
  const researchIntent = createLockedIntent({
    userId: "test",
    taskType: "research",
    goal: "test",
    allowedDomains: ["example.com", "google.com"],
  });

  it("allows permitted actions", () => {
    const result = validateAction(researchIntent, { type: "navigate" });
    expect(result.allowed).toBe(true);
  });

  it("blocks forbidden actions", () => {
    const result = validateAction(researchIntent, { type: "fill" });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("forbidden");
  });

  it("blocks unlisted actions", () => {
    const result = validateAction(researchIntent, { type: "delete_everything" });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("not in allowed list");
  });

  it("allows actions to permitted domains", () => {
    const result = validateAction(researchIntent, {
      type: "navigate",
      domain: "https://example.com/page",
    });
    expect(result.allowed).toBe(true);
  });

  it("blocks actions to non-permitted domains", () => {
    const result = validateAction(researchIntent, {
      type: "navigate",
      domain: "https://evil.com",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("not in allowed list");
  });

  it("allows subdomain of permitted domain", () => {
    const result = validateAction(researchIntent, {
      type: "navigate",
      domain: "https://sub.example.com/page",
    });
    expect(result.allowed).toBe(true);
  });

  it("allows any domain when allowedDomains is empty", () => {
    const openIntent = createLockedIntent({
      userId: "test",
      taskType: "research",
      goal: "test",
    });
    const result = validateAction(openIntent, {
      type: "navigate",
      domain: "https://anything.com",
    });
    expect(result.allowed).toBe(true);
  });
});

describe("getTaskTypeFromClassification", () => {
  it("maps known classifications", () => {
    expect(getTaskTypeFromClassification("research")).toBe("research");
    expect(getTaskTypeFromClassification("booking")).toBe("booking");
    expect(getTaskTypeFromClassification("email")).toBe("email");
    expect(getTaskTypeFromClassification("document")).toBe("writing");
    expect(getTaskTypeFromClassification("monitor")).toBe("research");
  });

  it("maps unknown to general", () => {
    expect(getTaskTypeFromClassification("other")).toBe("general");
    expect(getTaskTypeFromClassification("anything")).toBe("general");
  });
});
