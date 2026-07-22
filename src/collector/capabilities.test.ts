import { describe, expect, it } from "vitest";
import type { AgentInventory } from "@/lib/agent-inventory";
import {
  buildCapabilityLookups,
  explicitSkillUsage,
  matchedSkillReads,
  mcpUsage,
} from "./capabilities";

const inventories: AgentInventory[] = [
  {
    provider: "codex",
    scope: "global",
    warnings: [],
    capabilities: [
      {
        id: "codex:skill:frontend-rules",
        name: "frontend-rules",
        kind: "skill",
        status: "enabled",
        packaging: "standalone",
        origin: "personal",
        sourcePath: "/safe/links/frontend-rules",
        canonicalSourcePath: "/safe/source/frontend-rules",
      },
      {
        id: "codex:skill:disabled",
        name: "disabled-skill",
        kind: "skill",
        status: "disabled",
        packaging: "standalone",
        origin: "personal",
        canonicalSourcePath: "/safe/source/disabled-skill",
      },
      {
        id: "codex:skill:unavailable",
        name: "unavailable-skill",
        kind: "skill",
        status: "unavailable",
        packaging: "standalone",
        origin: "personal",
        canonicalSourcePath: "/safe/source/unavailable-skill",
      },
      {
        id: "codex:mcp:github",
        name: "github",
        kind: "mcp",
        status: "enabled",
        packaging: "plugin",
        origin: "marketplace",
      },
      {
        id: "codex:mcp:unavailable",
        name: "unavailable-mcp",
        kind: "mcp",
        status: "unavailable",
        packaging: "plugin",
        origin: "marketplace",
      },
    ],
  },
];

describe("capability normalization", () => {
  it("builds aliases only for active inventory capabilities", () => {
    const lookup = buildCapabilityLookups(inventories).codex;
    expect(lookup.skillFiles.get("/safe/source/frontend-rules/SKILL.md")).toBe(
      "frontend-rules",
    );
    expect(lookup.skillFiles.get("/safe/links/frontend-rules/SKILL.md")).toBe(
      "frontend-rules",
    );
    expect([...lookup.skillFiles.values()]).not.toContain("disabled-skill");
    expect([...lookup.skillFiles.values()]).not.toContain("unavailable-skill");
    expect(lookup.mcpNames.get("github")).toBe("github");
    expect(lookup.mcpNames.has("unavailable-mcp")).toBe(false);
  });

  it("accepts a native skill name without retaining other input", () => {
    expect(
      explicitSkillUsage("skill-1", "frontend-rules", "2026-07-22T10:00:00Z"),
    ).toEqual({
      externalId: "skill:skill-1",
      kind: "skill",
      name: "frontend-rules",
      occurredAt: "2026-07-22T10:00:00Z",
    });
    expect(
      explicitSkillUsage("skill-2", "/tmp/secret", "2026-07-22T10:00:00Z"),
    ).toBeUndefined();
  });

  it("rolls namespaced calls up to their MCP server", () => {
    expect(
      mcpUsage({
        externalId: "call-1",
        toolName: "mcp__github__search_prs",
        occurredAt: "2026-07-22T10:00:00Z",
      }),
    ).toMatchObject({ kind: "mcp", name: "github" });
    expect(
      mcpUsage({
        externalId: "call-2",
        toolName: "_search_prs",
        namespace: "mcp__codex_apps__github",
        occurredAt: "2026-07-22T10:00:00Z",
      }),
    ).toMatchObject({ kind: "mcp", name: "github" });
  });

  it("counts only read-like calls containing an exact inventory skill file", () => {
    const lookup = buildCapabilityLookups(inventories).codex;
    expect(
      matchedSkillReads({
        externalId: "read-1",
        toolName: "exec_command",
        input: {
          cmd: "sed -n '1,240p' /safe/links/frontend-rules/SKILL.md",
        },
        occurredAt: "2026-07-22T10:00:00Z",
        lookup,
      }),
    ).toEqual([
      {
        externalId: "skill-read:read-1:frontend-rules",
        kind: "skill",
        name: "frontend-rules",
        occurredAt: "2026-07-22T10:00:00Z",
      },
    ]);
    expect(
      matchedSkillReads({
        externalId: "write-1",
        toolName: "apply_patch",
        input: "*** Update File: /safe/source/frontend-rules/SKILL.md",
        occurredAt: "2026-07-22T10:00:00Z",
        lookup,
      }),
    ).toEqual([]);
  });

  it("rejects configured skill path suffixes", () => {
    const lookup = buildCapabilityLookups(inventories).codex;
    for (const suffix of [":backup", ".bak", "/extra"]) {
      expect(
        matchedSkillReads({
          externalId: `suffix-${suffix}`,
          toolName: "exec_command",
          input: {
            cmd: `cat /safe/source/frontend-rules/SKILL.md${suffix}`,
          },
          occurredAt: "2026-07-22T10:00:00Z",
          lookup,
        }),
      ).toEqual([]);
    }
  });

  it("rejects quoted configured skill path suffixes", () => {
    const lookup = buildCapabilityLookups(inventories).codex;
    for (const cmd of [
      "cat '/safe/source/frontend-rules/SKILL.md;backup'",
      'cat "/safe/source/frontend-rules/SKILL.md)backup"',
    ]) {
      expect(
        matchedSkillReads({
          externalId: cmd,
          toolName: "exec_command",
          input: { cmd },
          occurredAt: "2026-07-22T10:00:00Z",
          lookup,
        }),
      ).toEqual([]);
    }
  });

  it("matches complete quoted paths and paths followed by redirection", () => {
    const lookup = buildCapabilityLookups(inventories).codex;
    for (const cmd of [
      "cat '/safe/source/frontend-rules/SKILL.md'",
      "cat /safe/source/frontend-rules/SKILL.md>output.txt",
    ]) {
      expect(
        matchedSkillReads({
          externalId: cmd,
          toolName: "exec_command",
          input: { cmd },
          occurredAt: "2026-07-22T10:00:00Z",
          lookup,
        }),
      ).toHaveLength(1);
    }
  });
});
