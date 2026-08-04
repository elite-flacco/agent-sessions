// Versioned local pricing table. Rates are USD per million tokens, recorded
// from the public pricing page each entry links as its source; costs derived
// from them are API-equivalent estimates, not billed amounts (subscription
// plans don't meter per token). Update this table when providers change pricing —
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
}

const ANTHROPIC_SOURCE =
  "https://platform.claude.com/docs/en/about-claude/models/overview";
const OPENAI_SOURCE = "https://developers.openai.com/api/docs/pricing";
const ZAI_SOURCE = "https://docs.z.ai/guides/overview/pricing";

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
  },
  {
    model: "claude-opus-5",
    inputPerMTok: 5,
    outputPerMTok: 25,
    cacheReadPerMTok: 0.5,
    cacheWritePerMTok: 6.25,
    effectiveFrom: "2026-08-01",
    source: ANTHROPIC_SOURCE,
  },
  {
    model: "claude-opus-4-8",
    inputPerMTok: 5,
    outputPerMTok: 25,
    cacheReadPerMTok: 0.5,
    cacheWritePerMTok: 6.25,
    effectiveFrom: "2026-01-01",
    source: ANTHROPIC_SOURCE,
  },
  {
    model: "claude-opus-4-7",
    inputPerMTok: 5,
    outputPerMTok: 25,
    cacheReadPerMTok: 0.5,
    cacheWritePerMTok: 6.25,
    effectiveFrom: "2026-01-01",
    source: ANTHROPIC_SOURCE,
  },
  {
    model: "claude-opus-4-6",
    inputPerMTok: 5,
    outputPerMTok: 25,
    cacheReadPerMTok: 0.5,
    cacheWritePerMTok: 6.25,
    effectiveFrom: "2025-11-01",
    source: ANTHROPIC_SOURCE,
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
  },
  {
    model: "claude-sonnet-5",
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheReadPerMTok: 0.3,
    cacheWritePerMTok: 3.75,
    effectiveFrom: "2026-09-01",
    source: ANTHROPIC_SOURCE,
  },
  {
    model: "claude-sonnet-4-6",
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheReadPerMTok: 0.3,
    cacheWritePerMTok: 3.75,
    effectiveFrom: "2025-11-01",
    source: ANTHROPIC_SOURCE,
  },
  {
    model: "claude-haiku-4-5",
    inputPerMTok: 1,
    outputPerMTok: 5,
    cacheReadPerMTok: 0.1,
    cacheWritePerMTok: 1.25,
    effectiveFrom: "2025-10-01",
    source: ANTHROPIC_SOURCE,
  },
  {
    model: "gpt-5.6-sol",
    inputPerMTok: 5,
    outputPerMTok: 30,
    cacheReadPerMTok: 0.5,
    cacheWritePerMTok: 6.25,
    effectiveFrom: "2026-06-01",
    source: OPENAI_SOURCE,
  },
  {
    model: "gpt-5.6-terra",
    inputPerMTok: 2.5,
    outputPerMTok: 15,
    cacheReadPerMTok: 0.25,
    cacheWritePerMTok: 3.125,
    effectiveFrom: "2026-06-01",
    source: OPENAI_SOURCE,
  },
  {
    model: "gpt-5.6-luna",
    inputPerMTok: 1,
    outputPerMTok: 6,
    cacheReadPerMTok: 0.1,
    cacheWritePerMTok: 1.25,
    effectiveFrom: "2026-06-01",
    source: OPENAI_SOURCE,
  },
  {
    model: "gpt-5.5",
    inputPerMTok: 5,
    outputPerMTok: 30,
    cacheReadPerMTok: 0.5,
    cacheWritePerMTok: 5,
    effectiveFrom: "2026-02-01",
    source: OPENAI_SOURCE,
  },
  {
    model: "gpt-5.5-pro",
    inputPerMTok: 30,
    outputPerMTok: 180,
    cacheReadPerMTok: 0,
    cacheWritePerMTok: 0,
    effectiveFrom: "2026-02-01",
    source: OPENAI_SOURCE,
  },
  {
    model: "gpt-5.4",
    inputPerMTok: 2.5,
    outputPerMTok: 15,
    cacheReadPerMTok: 0.25,
    cacheWritePerMTok: 2.5,
    effectiveFrom: "2025-12-01",
    source: OPENAI_SOURCE,
  },
  {
    model: "gpt-5.4-mini",
    inputPerMTok: 0.75,
    outputPerMTok: 4.5,
    cacheReadPerMTok: 0.075,
    cacheWritePerMTok: 0.75,
    effectiveFrom: "2025-12-01",
    source: OPENAI_SOURCE,
  },
  {
    model: "gpt-5.4-nano",
    inputPerMTok: 0.2,
    outputPerMTok: 1.25,
    cacheReadPerMTok: 0.02,
    cacheWritePerMTok: 0,
    effectiveFrom: "2025-12-01",
    source: OPENAI_SOURCE,
  },
  {
    model: "gpt-5.4-pro",
    inputPerMTok: 30,
    outputPerMTok: 180,
    cacheReadPerMTok: 0,
    cacheWritePerMTok: 0,
    effectiveFrom: "2025-12-01",
    source: OPENAI_SOURCE,
  },
  {
    model: "gpt-5-mini",
    inputPerMTok: 0.25,
    outputPerMTok: 2,
    cacheReadPerMTok: 0.025,
    cacheWritePerMTok: 0.25,
    effectiveFrom: "2025-08-07",
    source: OPENAI_SOURCE,
  },
  {
    model: "glm-5.2",
    inputPerMTok: 1.4,
    outputPerMTok: 4.4,
    cacheReadPerMTok: 0.26,
    cacheWritePerMTok: 1.4,
    effectiveFrom: "2026-05-01",
    source: ZAI_SOURCE,
  },
  // Distinct deployable source (a user-configured provider routing the same
  // underlying GLM-5.2 via "z-ai/"), kept separate from the built-in glm-5.2.
  // Rates mirror the built-in entry for now; update to the source's true rates.
  {
    model: "z-ai/glm-5.2",
    inputPerMTok: 1.4,
    outputPerMTok: 4.4,
    cacheReadPerMTok: 0.26,
    cacheWritePerMTok: 1.4,
    effectiveFrom: "2026-05-01",
    source: ZAI_SOURCE,
  },
];

// Reduce raw provider model strings to the canonical ids used in the table.
// Routing prefixes are stripped (a leading UUID segment from the Zcode routing
// layer, and any "builtin:.../" provider prefix), but a real source prefix like
// "z-ai/" is kept: it denotes a distinct deployable source (a user-configured
// API/MCP provider, not a built-in) that deserves its own canonical id and its
// own pricing entry. Dated snapshot suffixes are dropped either way.
export function normalizeModel(raw: string): string {
  let s = raw.trim();
  // Leading UUID segment ("315079d2-...-dfce453/"): a routing-layer artifact.
  s = s.replace(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//i,
    "",
  );
  // "builtin:<plan>/" prefix: a built-in provider whose model prices against
  // the bare canonical id (e.g. "builtin:zai-coding-plan/GLM-5.2" -> "glm-5.2").
  s = s.replace(/^builtin:[^/]*\//i, "");
  // Dated snapshot suffixes come dashed (gpt-5-mini-2025-08-07) or compact
  // (claude-haiku-4-5-20251001, Anthropic's pinned-id form).
  return s.toLowerCase().replace(/-(\d{4}-\d{2}-\d{2}|\d{8})$/, "");
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
