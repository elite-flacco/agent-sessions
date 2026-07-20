import { describe, expect, test } from "vitest";
import {
  buildComparisonRows,
  canonicalCapabilityName,
  dedupeCapabilities,
  findComparisonDuplicates,
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

describe("findComparisonDuplicates", () => {
  test("labels same-content copies as redundant and different-content copies as shadowing", () => {
    const duplicates = findComparisonDuplicates([
      inventory("codex", [
        capability({
          id: "codex:skill:one",
          canonicalSourcePath: "/tmp/one",
          contentFingerprint: "same",
        }),
        capability({
          id: "codex:skill:two",
          canonicalSourcePath: "/tmp/two",
          contentFingerprint: "same",
        }),
      ]),
      inventory("claude", [
        capability({
          id: "claude:skill:one",
          name: "other-skill",
          canonicalSourcePath: "/tmp/three",
          contentFingerprint: "aaa",
        }),
        capability({
          id: "claude:skill:two",
          name: "other-skill",
          canonicalSourcePath: "/tmp/four",
          contentFingerprint: "bbb",
        }),
      ]),
      inventory("zcode", []),
      inventory("pi", []),
    ]);

    expect(duplicates).toEqual([
      expect.objectContaining({
        provider: "claude",
        name: "other-skill",
        identicalContent: false,
      }),
      expect.objectContaining({
        provider: "codex",
        name: "frontend-rules",
        identicalContent: true,
      }),
    ]);
  });

  test("ignores disabled copies when detecting duplicates", () => {
    // One active copy plus a copy inside a disabled plugin is not a conflict:
    // only one copy is in effect.
    const duplicates = findComparisonDuplicates([
      inventory("codex", [
        capability({
          id: "codex:skill:active",
          canonicalSourcePath: "/tmp/active",
        }),
        capability({
          id: "codex:skill:dormant",
          status: "disabled",
          canonicalSourcePath: "/tmp/dormant",
        }),
      ]),
      inventory("claude", []),
      inventory("zcode", []),
      inventory("pi", []),
    ]);

    expect(duplicates).toEqual([]);
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
    expect(rows[0]?.isDiscrepancy).toBe(false);
    expect(rows[0]?.isUniformAcrossProviders).toBe(false);
  });

  test("classifies a skills.sh capability missing from one primary provider as a fix", () => {
    const rows = buildComparisonRows([
      inventory("codex", [
        providerCapability("codex", { origin: "skills_sh" }),
      ]),
      inventory("claude", [
        providerCapability("claude", { origin: "skills_sh" }),
      ]),
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

  test("classifies a non-skills.sh capability missing from one primary provider as a review", () => {
    // A personal MCP or marketplace plugin on 2 of 3 agents is often a
    // deliberate choice — worth reviewing, but not "broken".
    const rows = buildComparisonRows([
      inventory("codex", [providerCapability("codex")]),
      inventory("claude", [providerCapability("claude")]),
      inventory("zcode", []),
      inventory("pi", []),
    ]);

    expect(rows[0]?.assessment).toEqual({
      level: "review",
      reason: "missing_from_one_provider",
      message: "Present on 2 of 3 agents; missing from Zcode.",
    });
    expect(rows[0]?.isUniformAcrossProviders).toBe(false);
  });

  test("does not flag installed versus enabled as configuration drift", () => {
    // Standalone skills read "installed" while plugin-contributed ones read
    // "enabled"; both mean "active" and must not drift against each other.
    const rows = buildComparisonRows([
      inventory("codex", [
        providerCapability("codex", { status: "installed" }),
      ]),
      inventory("claude", [
        providerCapability("claude", { status: "enabled" }),
      ]),
      inventory("zcode", [providerCapability("zcode", { status: "enabled" })]),
      inventory("pi", []),
    ]);

    expect(rows[0]?.assessment).toEqual({
      level: "context",
      reason: "consistent",
      message: "Consistent across all agents.",
    });
    expect(rows[0]?.isDiscrepancy).toBe(false);
  });

  test("flags skills whose content differs across providers as content drift", () => {
    // Status, origin, and packaging agree everywhere — only the skill body
    // differs, so this must read as content drift rather than a configuration
    // mismatch; the Needs Attention view sections the two separately.
    const rows = buildComparisonRows([
      inventory("codex", [
        providerCapability("codex", {
          contentFingerprint: "bbb",
          sourcePlugin: "superpowers@openai-curated",
        }),
      ]),
      inventory("claude", [
        providerCapability("claude", {
          contentFingerprint: "aaa",
          sourcePlugin: "superpowers@claude-plugins-official",
        }),
      ]),
      inventory("zcode", [
        providerCapability("zcode", {
          contentFingerprint: "aaa",
          sourcePlugin: "superpowers@claude-plugins-official",
        }),
      ]),
      inventory("pi", []),
    ]);

    expect(rows[0]?.assessment).toEqual({
      level: "review",
      reason: "content_drift",
      message: "Installed across all agents with differing content.",
    });
  });

  test("keeps configuration drift distinct from content drift", () => {
    // Origin differs, so this is a genuine configuration mismatch even though
    // the skill bodies are identical.
    const rows = buildComparisonRows([
      inventory("codex", [
        providerCapability("codex", {
          origin: "personal",
          contentFingerprint: "aaa",
        }),
      ]),
      inventory("claude", [
        providerCapability("claude", {
          origin: "skills_sh",
          contentFingerprint: "aaa",
        }),
      ]),
      inventory("zcode", [
        providerCapability("zcode", {
          origin: "skills_sh",
          contentFingerprint: "aaa",
        }),
      ]),
      inventory("pi", []),
    ]);

    expect(rows[0]?.assessment).toEqual({
      level: "review",
      reason: "configuration_drift",
      message: "Installed across all agents with differing configuration.",
    });
  });

  test("treats a deliberately disabled capability as present drift, not a missing fix", () => {
    const rows = buildComparisonRows([
      inventory("codex", [providerCapability("codex")]),
      inventory("claude", [providerCapability("claude")]),
      inventory("zcode", [providerCapability("zcode", { status: "disabled" })]),
      inventory("pi", []),
    ]);

    expect(rows[0]?.assessment).toEqual({
      level: "review",
      reason: "configuration_drift",
      message: "Installed across all agents with differing configuration.",
    });
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
