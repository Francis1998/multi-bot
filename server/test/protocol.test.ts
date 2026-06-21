import { describe, expect, it } from "vitest";
import { isBridgeEvent, normalizeStartRunRequest } from "../src/protocol.js";

describe("normalizeStartRunRequest", () => {
  it("caps subagent count and trims prompt", () => {
    const request = normalizeStartRunRequest({
      prompt: "  ship multi-bot  ",
      subagents: 99,
      provider: "simulator",
    });

    expect(request).toEqual({
      prompt: "ship multi-bot",
      subagents: 8,
      provider: "simulator",
    });
  });

  it("rejects empty prompts", () => {
    expect(() => normalizeStartRunRequest({ prompt: "" })).toThrow("prompt");
  });
});

describe("isBridgeEvent", () => {
  it("accepts async JSONL event envelopes", () => {
    expect(isBridgeEvent({ id: null, event: "ready", data: { runtime: "test" } })).toBe(true);
  });
});
