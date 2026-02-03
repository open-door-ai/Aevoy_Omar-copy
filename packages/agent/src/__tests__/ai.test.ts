import { describe, it, expect } from "vitest";
import { parseActions } from "../services/ai.js";

describe("parseActions", () => {
  it("parses browse action", () => {
    const response = '[ACTION:browse("https://example.com")]';
    const actions = parseActions(response);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("browse");
    expect(actions[0].params.url).toBe("https://example.com");
  });

  it("parses search action", () => {
    const response = '[ACTION:search("best restaurants in Vancouver")]';
    const actions = parseActions(response);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("search");
    expect(actions[0].params.query).toBe("best restaurants in Vancouver");
  });

  it("parses remember action", () => {
    const response = '[ACTION:remember("user prefers dark mode")]';
    const actions = parseActions(response);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("remember");
    expect(actions[0].params.fact).toBe("user prefers dark mode");
  });

  it("parses screenshot action", () => {
    const response = '[ACTION:screenshot("https://google.com")]';
    const actions = parseActions(response);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("screenshot");
    expect(actions[0].params.url).toBe("https://google.com");
  });

  it("parses send_email action", () => {
    const response = '[ACTION:send_email("user@test.com", "Subject line", "Email body text")]';
    const actions = parseActions(response);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("send_email");
    expect(actions[0].params.to).toBe("user@test.com");
    expect(actions[0].params.subject).toBe("Subject line");
    expect(actions[0].params.body).toBe("Email body text");
  });

  it("parses schedule action", () => {
    const response = '[ACTION:schedule("Check emails", "0 8 * * 1")]';
    const actions = parseActions(response);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("schedule");
    expect(actions[0].params.description).toBe("Check emails");
    expect(actions[0].params.cron).toBe("0 8 * * 1");
  });

  it("parses multiple actions", () => {
    const response = `I'll help you with that!
[ACTION:browse("https://example.com")]
Let me remember this for you.
[ACTION:remember("user likes example.com")]`;
    const actions = parseActions(response);
    expect(actions).toHaveLength(2);
    expect(actions[0].type).toBe("browse");
    expect(actions[1].type).toBe("remember");
  });

  it("returns empty array for no actions", () => {
    const response = "Hello, how can I help you today?";
    const actions = parseActions(response);
    expect(actions).toHaveLength(0);
  });

  it("handles malformed actions gracefully", () => {
    const response = '[ACTION:unknown_type("params")]';
    const actions = parseActions(response);
    expect(actions).toHaveLength(0);
  });

  it("parses fill_form action with JSON fields", () => {
    const response = '[ACTION:fill_form("https://example.com/form", {"name": "John", "email": "john@test.com"})]';
    const actions = parseActions(response);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("fill_form");
    expect(actions[0].params.url).toBe("https://example.com/form");
    expect((actions[0].params.fields as Record<string, string>).name).toBe("John");
  });
});
