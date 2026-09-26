import { describe, expect, it } from "vitest";
import { findPricing, normalizeModel, usageCostUsd } from "./pricing";

describe("model normalization", () => {
  it.each([
    ["claude-fable-5", "claude-fable-5"],
    // z-ai/ is a distinct deployable source, kept separate from the built-in.
    ["z-ai/glm-5.2", "z-ai/glm-5.2"],
    // builtin: prefixes still collapse to the bare canonical id.
    ["builtin:zai-coding-plan/GLM-5.2", "glm-5.2"],
    ["builtin:zai-coding-plan/GLM-5.3", "glm-5.3"],
    ["315079d2-9bb1-4210-8a18-c8ac6dfce453/z-ai/glm-5.2", "z-ai/glm-5.2"],
    ["GLM-5.2", "glm-5.2"],
    ["gpt-5-mini-2025-08-07", "gpt-5-mini"],
    ["claude-haiku-4-5-20251001", "claude-haiku-4-5"],
    ["claude-sonnet-4-5-20250929", "claude-sonnet-4-5"],
  ])("normalizes %s to %s", (raw, canonical) => {
    expect(normalizeModel(raw)).toBe(canonical);
  });
});

describe("pricing lookup", () => {
  it("keeps the permanent Sonnet 5 rate after the cancelled increase", () => {
    // The planned 2026-09-01 increase to $3/$15 was cancelled on 2026-08-10.
    expect(findPricing("claude-sonnet-5", "2026-07-12")?.inputPerMTok).toBe(2);
    expect(findPricing("claude-sonnet-5", "2026-09-15")?.inputPerMTok).toBe(2);
  });

  it("prices claude-opus-5-5 with its special 0.05x cache-read rate", () => {
    expect(findPricing("claude-opus-5-5", "2026-09-26")).toMatchObject({
      inputPerMTok: 4,
      outputPerMTok: 20,
      cacheReadPerMTok: 0.2,
      cacheWritePerMTok: 5,
    });
  });

  it("applies the 2026-07-30 Terra/Luna cuts and the 2026-08-21 Sol promo", () => {
    expect(findPricing("gpt-5.6-terra", "2026-07-30")).toMatchObject({
      inputPerMTok: 2,
      outputPerMTok: 12,
      cacheWritePerMTok: 2.5,
    });
    expect(findPricing("gpt-5.6-luna", "2026-08-01")).toMatchObject({
      inputPerMTok: 0.2,
      outputPerMTok: 1.2,
      cacheWritePerMTok: 0.25,
    });
    expect(findPricing("gpt-5.6-sol", "2026-08-20")).toMatchObject({
      inputPerMTok: 5,
      outputPerMTok: 30,
    });
    expect(findPricing("gpt-5.6-sol", "2026-09-01")).toMatchObject({
      inputPerMTok: 4,
      outputPerMTok: 20,
      cacheWritePerMTok: 5,
    });
  });

  it("prices gpt-5.6-sol cache writes at the published 1.25x premium", () => {
    expect(findPricing("gpt-5.6-sol", "2026-07-12")?.cacheWritePerMTok).toBe(
      6.25,
    );
  });

  it.each([
    ["gpt-5.6-terra", 2.5, 15, 3.125],
    ["gpt-5.6-luna", 1, 6, 1.25],
    ["gpt-5.5-pro", 30, 180, 0],
    ["gpt-5.4-nano", 0.2, 1.25, 0],
    ["gpt-5.4-pro", 30, 180, 0],
    ["z-ai/glm-5.2", 1.4, 4.4, 1.4],
    ["glm-5.3", 1.4, 4.4, 1.4],
  ])(
    "prices %s with its rate on 2026-07-12",
    (model, inputPerMTok, outputPerMTok, cacheWritePerMTok) => {
      const pricing = findPricing(model, "2026-07-12");
      expect(pricing).toMatchObject({
        inputPerMTok,
        outputPerMTok,
        cacheWritePerMTok,
      });
    },
  );

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
