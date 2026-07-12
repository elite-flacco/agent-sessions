import { describe, expect, it } from "vitest";
import { findPricing, normalizeModel, usageCostUsd } from "./pricing";

describe("model normalization", () => {
  it.each([
    ["claude-fable-5", "claude-fable-5"],
    ["z-ai/glm-5.2", "glm-5.2"],
    ["builtin:zai-coding-plan/GLM-5.2", "glm-5.2"],
    ["315079d2-9bb1-4210-8a18-c8ac6dfce453/z-ai/glm-5.2", "glm-5.2"],
    ["GLM-5.2", "glm-5.2"],
    ["gpt-5-mini-2025-08-07", "gpt-5-mini"],
  ])("normalizes %s to %s", (raw, canonical) => {
    expect(normalizeModel(raw)).toBe(canonical);
  });
});

describe("pricing lookup", () => {
  it("selects the introductory Sonnet 5 rate inside its window", () => {
    expect(findPricing("claude-sonnet-5", "2026-07-12")?.inputPerMTok).toBe(2);
    expect(findPricing("claude-sonnet-5", "2026-09-15")?.inputPerMTok).toBe(3);
  });

  it("returns undefined for unknown models and pre-launch dates", () => {
    expect(findPricing("kimi-k2.6", "2026-07-12")).toBeUndefined();
    expect(findPricing("claude-fable-5", "2020-01-01")).toBeUndefined();
  });
});

describe("usage cost", () => {
  const usage = {
    model: "claude-opus-4-8",
    inputTokens: 1_000_000,
    outputTokens: 100_000,
    cacheReadTokens: 2_000_000,
    cacheWriteTokens: 400_000,
  };

  it("prices all four token classes", () => {
    // 1M*$5 + 0.1M*$25 + 2M*$0.5 + 0.4M*$6.25 = 5 + 2.5 + 1 + 2.5
    expect(usageCostUsd(usage, "2026-07-12")).toBeCloseTo(11, 10);
  });

  it("prefers provider-reported cost over the table", () => {
    expect(
      usageCostUsd({ ...usage, reportedCostUsd: 0.42 }, "2026-07-12"),
    ).toBe(0.42);
  });

  it("returns undefined when no pricing entry matches", () => {
    expect(
      usageCostUsd({ ...usage, model: "mystery-model" }, "2026-07-12"),
    ).toBeUndefined();
  });
});
