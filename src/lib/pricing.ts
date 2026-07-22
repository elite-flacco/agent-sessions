// Versioned local pricing table. Rates are USD per million tokens, recorded
// from public pricing pages on the retrieval date below; costs derived from
// them are API-equivalent estimates, not billed amounts (subscription plans
// don't meter per token). Update this table when providers change pricing —
// costs are computed at query time, so corrections apply retroactively.

import type { ModelUsage } from "./types";

export interface PricingEntry {
  model: string;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWritePerMTok: number;
  effectiveFrom: string;
  effectiveTo?: string;
  source: string;
  retrievedAt: string;
}

const ANTHROPIC_SOURCE =
  "https://platform.claude.com/docs/en/about-claude/models/overview";
const OPENAI_SOURCE = "https://developers.openai.com/api/docs/pricing";
const ZAI_SOURCE = "https://docs.z.ai/guides/overview/pricing";
const RETRIEVED = "2026-07-12";

// Anthropic cache rates: read 0.1x input, write 1.25x input (5-minute TTL,
// the Claude Code default). OpenAI publishes an explicit cache-write rate
// for the gpt-5.6 family (1.25x input); gpt-5.5 and earlier, like Z.ai,
// list no cache-write premium, so writes price as ordinary input there.
export const PRICING_TABLE: PricingEntry[] = [
  {
    model: "claude-fable-5",
    inputPerMTok: 10,
    outputPerMTok: 50,
    cacheReadPerMTok: 1,
    cacheWritePerMTok: 12.5,
    effectiveFrom: "2026-06-01",
    source: ANTHROPIC_SOURCE,
    retrievedAt: RETRIEVED,
  },
  {
    model: "claude-opus-4-8",
    inputPerMTok: 5,
    outputPerMTok: 25,
    cacheReadPerMTok: 0.5,
    cacheWritePerMTok: 6.25,
    effectiveFrom: "2026-01-01",
    source: ANTHROPIC_SOURCE,
    retrievedAt: RETRIEVED,
  },
  {
    model: "claude-opus-4-7",
    inputPerMTok: 5,
    outputPerMTok: 25,
    cacheReadPerMTok: 0.5,
    cacheWritePerMTok: 6.25,
    effectiveFrom: "2026-01-01",
    source: ANTHROPIC_SOURCE,
    retrievedAt: RETRIEVED,
  },
  {
    model: "claude-opus-4-6",
    inputPerMTok: 5,
    outputPerMTok: 25,
    cacheReadPerMTok: 0.5,
    cacheWritePerMTok: 6.25,
    effectiveFrom: "2025-11-01",
    source: ANTHROPIC_SOURCE,
    retrievedAt: RETRIEVED,
  },
  {
    model: "claude-sonnet-5",
    inputPerMTok: 2,
    outputPerMTok: 10,
    cacheReadPerMTok: 0.2,
    cacheWritePerMTok: 2.5,
    effectiveFrom: "2026-04-01",
    effectiveTo: "2026-08-31",
    source: ANTHROPIC_SOURCE,
    retrievedAt: RETRIEVED,
  },
  {
    model: "claude-sonnet-5",
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheReadPerMTok: 0.3,
    cacheWritePerMTok: 3.75,
    effectiveFrom: "2026-09-01",
    source: ANTHROPIC_SOURCE,
    retrievedAt: RETRIEVED,
  },
  {
    model: "claude-sonnet-4-6",
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheReadPerMTok: 0.3,
    cacheWritePerMTok: 3.75,
    effectiveFrom: "2025-11-01",
    source: ANTHROPIC_SOURCE,
    retrievedAt: RETRIEVED,
  },
  {
    model: "claude-haiku-4-5",
    inputPerMTok: 1,
    outputPerMTok: 5,
    cacheReadPerMTok: 0.1,
    cacheWritePerMTok: 1.25,
    effectiveFrom: "2025-10-01",
    source: ANTHROPIC_SOURCE,
    retrievedAt: RETRIEVED,
  },
  {
    model: "gpt-5.6-sol",
    inputPerMTok: 5,
    outputPerMTok: 30,
    cacheReadPerMTok: 0.5,
    cacheWritePerMTok: 6.25,
    effectiveFrom: "2026-06-01",
    source: OPENAI_SOURCE,
    retrievedAt: RETRIEVED,
  },
  {
    model: "gpt-5.6-terra",
    inputPerMTok: 2.5,
    outputPerMTok: 15,
    cacheReadPerMTok: 0.25,
    cacheWritePerMTok: 3.125,
    effectiveFrom: "2026-06-01",
    source: OPENAI_SOURCE,
    retrievedAt: RETRIEVED,
  },
  {
    model: "gpt-5.6-luna",
    inputPerMTok: 1,
    outputPerMTok: 6,
    cacheReadPerMTok: 0.1,
    cacheWritePerMTok: 1.25,
    effectiveFrom: "2026-06-01",
    source: OPENAI_SOURCE,
    retrievedAt: RETRIEVED,
  },
  {
    model: "gpt-5.5",
    inputPerMTok: 5,
    outputPerMTok: 30,
    cacheReadPerMTok: 0.5,
    cacheWritePerMTok: 5,
    effectiveFrom: "2026-02-01",
    source: OPENAI_SOURCE,
    retrievedAt: RETRIEVED,
  },
  {
    model: "gpt-5.5-pro",
    inputPerMTok: 30,
    outputPerMTok: 180,
    cacheReadPerMTok: 0,
    cacheWritePerMTok: 0,
    effectiveFrom: "2026-02-01",
    source: OPENAI_SOURCE,
    retrievedAt: RETRIEVED,
  },
  {
    model: "gpt-5.4",
    inputPerMTok: 2.5,
    outputPerMTok: 15,
    cacheReadPerMTok: 0.25,
    cacheWritePerMTok: 2.5,
    effectiveFrom: "2025-12-01",
    source: OPENAI_SOURCE,
    retrievedAt: RETRIEVED,
  },
  {
    model: "gpt-5.4-mini",
    inputPerMTok: 0.75,
    outputPerMTok: 4.5,
    cacheReadPerMTok: 0.075,
    cacheWritePerMTok: 0.75,
    effectiveFrom: "2025-12-01",
    source: OPENAI_SOURCE,
    retrievedAt: RETRIEVED,
  },
  {
    model: "gpt-5.4-nano",
    inputPerMTok: 0.2,
    outputPerMTok: 1.25,
    cacheReadPerMTok: 0.02,
    cacheWritePerMTok: 0,
    effectiveFrom: "2025-12-01",
    source: OPENAI_SOURCE,
    retrievedAt: RETRIEVED,
  },
  {
    model: "gpt-5.4-pro",
    inputPerMTok: 30,
    outputPerMTok: 180,
    cacheReadPerMTok: 0,
    cacheWritePerMTok: 0,
    effectiveFrom: "2025-12-01",
    source: OPENAI_SOURCE,
    retrievedAt: RETRIEVED,
  },
  {
    model: "gpt-5-mini",
    inputPerMTok: 0.25,
    outputPerMTok: 2,
    cacheReadPerMTok: 0.025,
    cacheWritePerMTok: 0.25,
    effectiveFrom: "2025-08-07",
    source: OPENAI_SOURCE,
    retrievedAt: RETRIEVED,
  },
  {
    model: "glm-5.2",
    inputPerMTok: 1.4,
    outputPerMTok: 4.4,
    cacheReadPerMTok: 0.26,
    cacheWritePerMTok: 1.4,
    effectiveFrom: "2026-05-01",
    source: ZAI_SOURCE,
    retrievedAt: RETRIEVED,
  },
];

export const PRICING_RETRIEVED_AT = RETRIEVED;

// Reduce raw provider model strings to the canonical ids used in the table:
// strip routing/plan prefixes ("z-ai/", "builtin:zai-coding-plan/", UUID
// prefixes), lowercase, and drop dated snapshot suffixes.
export function normalizeModel(raw: string): string {
  const last = raw.trim().split("/").at(-1) ?? raw;
  // Dated snapshot suffixes come dashed (gpt-5-mini-2025-08-07) or compact
  // (claude-haiku-4-5-20251001, Anthropic's pinned-id form).
  return last.toLowerCase().replace(/-(\d{4}-\d{2}-\d{2}|\d{8})$/, "");
}

export function findPricing(
  model: string,
  onDate: string,
): PricingEntry | undefined {
  const canonical = normalizeModel(model);
  const day = onDate.slice(0, 10);
  return PRICING_TABLE.find(
    (entry) =>
      entry.model === canonical &&
      entry.effectiveFrom <= day &&
      (!entry.effectiveTo || day <= entry.effectiveTo),
  );
}

// Cost of one normalized usage row: provider-reported cost wins; otherwise
// price it from the table; undefined when neither applies.
export function usageCostUsd(
  usage: ModelUsage,
  sessionDate: string,
): number | undefined {
  if (usage.reportedCostUsd !== undefined && usage.reportedCostUsd !== null)
    return usage.reportedCostUsd;
  const pricing = findPricing(usage.model, sessionDate);
  if (!pricing) return undefined;
  return (
    (usage.inputTokens * pricing.inputPerMTok +
      usage.outputTokens * pricing.outputPerMTok +
      usage.cacheReadTokens * pricing.cacheReadPerMTok +
      usage.cacheWriteTokens * pricing.cacheWritePerMTok) /
    1_000_000
  );
}
