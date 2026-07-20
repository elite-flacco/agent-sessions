import { describe, expect, test } from "vitest";
import {
  buildComparisonRows,
  canonicalCapabilityName,
  dedupeCapabilities,
} from "./normalize";
import type { AgentCapability, AgentInventory } from "./types";

function capability(overrides: Partial<AgentCapability> = {}): AgentCapability {
  return {
    id: "codex:skill:frontend-rules",
    name: "frontend-rules",
    kind: "skill",
    status: "installed",
    packaging: "standalone",
    origin: "unknown",
    sourcePath: "/tmp/source",
    canonicalSourcePath: "/tmp/source",
    ...overrides,
  };
}

function inventory(
  provider: AgentInventory["provider"],
  capabilities: AgentCapability[],
  instructionFile?: AgentInventory["instructionFile"],
): AgentInventory {
  return {
    provider,
    scope: "global",
    capabilities,
    instructionFile,
    warnings: [],
  };
}

function providerCapability(
  provider: AgentInventory["provider"],
  overrides: Partial<AgentCapability> = {},
): AgentCapability {
  return capability({
    id: `${provider}:skill:frontend-rules`,
    ...overrides,
  });
}

describe("canonicalCapabilityName", () => {
  test("trims and case-folds names for cross-provider matching", () => {
    expect(canonicalCapabilityName("  Frontend-Rules ")).toBe("frontend-rules");
  });
});

describe("dedupeCapabilities", () => {
  test("deduplicates a linked skill by canonical source and keeps stronger provenance", () => {
    const result = dedupeCapabilities([
      capability({
        id: "codex:skill:linked",
        origin: "unknown",
        sourcePath: "/tmp/link",
      }),
      capability({
        id: "codex:skill:tracked",
        origin: "skills_sh",
        sourcePath: "/tmp/source",
        sourceRepository: "vercel-labs/skills",
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.origin).toBe("skills_sh");
    expect(result[0]?.sourceRepository).toBe("vercel-labs/skills");
  });

  test("keeps same-named skills from different canonical sources", () => {
    const result = dedupeCapabilities([
      capability({ canonicalSourcePath: "/tmp/one" }),
      capability({
        id: "codex:skill:other",
        canonicalSourcePath: "/tmp/two",
      }),
    ]);

    expect(result).toHaveLength(2);
  });
});

describe("buildComparisonRows", () => {
  test("aligns equivalent capability names across providers", () => {
    const rows = buildComparisonRows([
      inventory("codex", [capability()]),
      inventory("claude", [
        capability({
          id: "claude:skill:frontend-rules",
          name: "Frontend-Rules",
        }),
      ]),
      inventory("zcode", []),
      inventory("pi", []),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.cells.codex?.name).toBe("frontend-rules");
    expect(rows[0]?.cells.claude?.name).toBe("Frontend-Rules");
  });

  test("marks presence and provenance differences as discrepancies", () => {
    const rows = buildComparisonRows([
      inventory("codex", [
        capability({ name: "agent-browser", origin: "skills_sh" }),
      ]),
      inventory("claude", [
        capability({
          id: "claude:skill:agent-browser",
          name: "agent-browser",
          origin: "personal",
        }),
      ]),
      inventory("zcode", []),
      inventory("pi", []),
    ]);

    expect(
      rows.find((row) => row.name === "agent-browser")?.isDiscrepancy,
    ).toBe(true);
  });

  test("compares instruction presence and content fingerprints", () => {
    const rows = buildComparisonRows([
      inventory("codex", [], {
        filename: "AGENTS.md",
        sourcePath: "/tmp/AGENTS.md",
        content: "Shared",
        contentFingerprint: "same",
      }),
      inventory("claude", [], {
        filename: "CLAUDE.md",
        sourcePath: "/tmp/CLAUDE.md",
        content: "Shared",
        contentFingerprint: "same",
      }),
      inventory("zcode", []),
      inventory("pi", []),
    ]);

    const instruction = rows.find((row) => row.kind === "instruction");
    expect(instruction?.isDiscrepancy).toBe(true);
    expect(instruction?.instructionCells?.codex?.contentFingerprint).toBe(
      "same",
    );
  });

  test("treats a capability missing only from Pi as consistent context", () => {
    const rows = buildComparisonRows([
      inventory("codex", [providerCapability("codex")]),
      inventory("claude", [providerCapability("claude")]),
      inventory("zcode", [providerCapability("zcode")]),
      inventory("pi", []),
    ]);

    expect(rows[0]?.assessment).toEqual({
      level: "context",
      reason: "consistent",
      message: "Consistent across all agents.",
    });
    expect(rows[0]?.isUniformAcrossProviders).toBe(false);
  });

  test("classifies a capability missing from one primary provider as a fix", () => {
    const rows = buildComparisonRows([
      inventory("codex", [providerCapability("codex")]),
      inventory("claude", [providerCapability("claude")]),
      inventory("zcode", []),
      inventory("pi", []),
    ]);

    expect(rows[0]?.assessment).toEqual({
      level: "fix",
      reason: "missing_from_one_provider",
      message: "Present on 2 of 3 agents; missing from Zcode.",
    });
    expect(rows[0]?.isUniformAcrossProviders).toBe(false);
  });

  test("gives unavailable capabilities precedence over presence consensus", () => {
    const rows = buildComparisonRows([
      inventory("codex", [
        providerCapability("codex", { status: "unavailable" }),
      ]),
      inventory("claude", []),
      inventory("zcode", []),
      inventory("pi", []),
    ]);

    expect(rows[0]?.assessment).toEqual({
      level: "fix",
      reason: "unavailable",
      message: "Unavailable on Codex.",
    });
  });

  test("does not let Pi presence inflate a single-primary capability to a review", () => {
    const rows = buildComparisonRows([
      inventory("codex", [providerCapability("codex")]),
      inventory("claude", []),
      inventory("zcode", []),
      inventory("pi", [providerCapability("pi")]),
    ]);

    expect(rows[0]?.assessment).toEqual({
      level: "context",
      reason: "provider_specific",
      message: "Only found on Codex.",
    });
  });

  test("classifies four-provider configuration drift for review", () => {
    const rows = buildComparisonRows([
      inventory("codex", [providerCapability("codex")]),
      inventory("claude", [
        providerCapability("claude", { origin: "personal" }),
      ]),
      inventory("zcode", [providerCapability("zcode")]),
      inventory("pi", [providerCapability("pi")]),
    ]);

    expect(rows[0]?.assessment).toEqual({
      level: "review",
      reason: "configuration_drift",
      message: "Installed across all agents with differing configuration.",
    });
    expect(rows[0]?.isUniformAcrossProviders).toBe(false);
  });

  test("classifies provider-specific capabilities as context", () => {
    const rows = buildComparisonRows([
      inventory("codex", [providerCapability("codex")]),
      inventory("claude", []),
      inventory("zcode", []),
      inventory("pi", []),
    ]);

    expect(rows[0]?.assessment).toEqual({
      level: "context",
      reason: "provider_specific",
      message: "Only found on Codex.",
    });
    expect(rows[0]?.isDiscrepancy).toBe(true);
  });

  test("marks matching four-provider capabilities as uniform context", () => {
    const rows = buildComparisonRows([
      inventory("codex", [providerCapability("codex")]),
      inventory("claude", [providerCapability("claude")]),
      inventory("zcode", [providerCapability("zcode")]),
      inventory("pi", [providerCapability("pi")]),
    ]);

    expect(rows[0]?.assessment).toEqual({
      level: "context",
      reason: "consistent",
      message: "Consistent across all agents.",
    });
    expect(rows[0]?.isUniformAcrossProviders).toBe(true);
  });

  test("classifies global instructions missing from a primary provider as a fix", () => {
    const instructionFile = {
      filename: "AGENTS.md",
      sourcePath: "/tmp/AGENTS.md",
      content: "Shared",
      contentFingerprint: "same",
    };
    const rows = buildComparisonRows([
      inventory("codex", [], instructionFile),
      inventory("claude", [], instructionFile),
      inventory("zcode", []),
      inventory("pi", []),
    ]);

    expect(rows[0]?.assessment).toEqual({
      level: "fix",
      reason: "missing_instruction",
      message: "Global instructions missing from Zcode.",
    });
  });

  test("treats global instructions missing only from Pi as context", () => {
    const instructionFile = {
      filename: "AGENTS.md",
      sourcePath: "/tmp/AGENTS.md",
      content: "Shared",
      contentFingerprint: "same",
    };
    const rows = buildComparisonRows([
      inventory("codex", [], instructionFile),
      inventory("claude", [], instructionFile),
      inventory("zcode", [], instructionFile),
      inventory("pi", []),
    ]);

    expect(rows[0]?.assessment).toEqual({
      level: "context",
      reason: "consistent",
      message: "Consistent across all agents.",
    });
  });

  test("classifies differing global instructions for review", () => {
    const rows = buildComparisonRows([
      inventory("codex", [], {
        filename: "AGENTS.md",
        sourcePath: "/tmp/codex/AGENTS.md",
        content: "Codex",
        contentFingerprint: "codex",
      }),
      inventory("claude", [], {
        filename: "CLAUDE.md",
        sourcePath: "/tmp/claude/CLAUDE.md",
        content: "Shared",
        contentFingerprint: "shared",
      }),
      inventory("zcode", [], {
        filename: "AGENTS.md",
        sourcePath: "/tmp/zcode/AGENTS.md",
        content: "Shared",
        contentFingerprint: "shared",
      }),
      inventory("pi", [], {
        filename: "AGENTS.md",
        sourcePath: "/tmp/pi/AGENTS.md",
        content: "Shared",
        contentFingerprint: "shared",
      }),
    ]);

    expect(rows[0]?.assessment).toEqual({
      level: "review",
      reason: "instruction_drift",
      message: "Global instruction contents differ across agents.",
    });
  });
});
