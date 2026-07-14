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
});
