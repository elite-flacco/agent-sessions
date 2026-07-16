// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { AgentCapability, AgentInventory } from "@/lib/agent-inventory";
import { AgentSetupView, parseAgentSetupFilters } from "./agent-setup-view";

function skill(
  provider: AgentInventory["provider"],
  name: string,
  overrides: Partial<AgentCapability> = {},
): AgentCapability {
  return {
    id: `${provider}:skill:${name}`,
    name,
    kind: "skill",
    status: "installed",
    packaging: "standalone",
    origin: "personal",
    sourcePath: `/safe/${provider}/${name}`,
    ...overrides,
  };
}

const inventories: AgentInventory[] = [
  {
    provider: "codex",
    scope: "global",
    capabilities: [
      skill("codex", "frontend-rules"),
      skill("codex", "agent-browser", {
        origin: "skills_sh",
        sourceRepository: "vercel-labs/agent-browser",
      }),
      {
        id: "codex:mcp:langsmith",
        name: "langsmith",
        kind: "mcp",
        status: "enabled",
        packaging: "standalone",
        origin: "unknown",
      },
    ],
    instructionFile: {
      filename: "AGENTS.md",
      sourcePath: "/safe/.codex/AGENTS.md",
      content: "# Codex instructions\n",
      contentFingerprint: "codex-fingerprint",
    },
    warnings: [],
  },
  {
    provider: "claude",
    scope: "global",
    capabilities: [
      skill("claude", "frontend-rules"),
      skill("claude", "agent-browser", { origin: "skills_sh" }),
    ],
    instructionFile: {
      filename: "CLAUDE.md",
      sourcePath: "/safe/.claude/CLAUDE.md",
      content: "# Claude instructions\n",
      contentFingerprint: "claude-fingerprint",
    },
    warnings: [],
  },
  {
    provider: "zcode",
    scope: "global",
    capabilities: [skill("zcode", "frontend-rules")],
    warnings: [
      {
        sourcePath: "/safe/.zcode/config.json",
        code: "malformed",
        message: "Could not parse global provider configuration.",
      },
    ],
  },
  {
    provider: "pi",
    scope: "global",
    capabilities: [skill("pi", "frontend-rules")],
    warnings: [],
  },
];

describe("parseAgentSetupFilters", () => {
  test("accepts supported URL values and ignores invalid ones", () => {
    expect(
      parseAgentSetupFilters({
        view: "compare",
        provider: "codex",
        kind: "skill",
        status: "enabled",
        discrepancies: "1",
      }),
    ).toEqual({
      view: "compare",
      provider: "codex",
      kind: "skill",
      status: "enabled",
      discrepanciesOnly: true,
    });
    expect(
      parseAgentSetupFilters({ provider: "other" }).provider,
    ).toBeUndefined();
  });
});

describe("AgentSetupView", () => {
  test("comparison mode shows only discrepant rows when requested", () => {
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={inventories}
        filters={{ view: "compare", discrepanciesOnly: true }}
      />,
    );

    expect(html).toContain("agent-browser");
    expect(html).toContain("langsmith");
    expect(html).not.toContain(">frontend-rules<");
    expect(html).not.toContain("secret-command");
  });

  test("comparison rows use regular capability names and tagged statuses", () => {
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={inventories}
        filters={{ view: "compare", discrepanciesOnly: true }}
      />,
    );

    expect(html).toContain(
      '<div class="agent-comparison-name">langsmith</div>',
    );
    expect(html).not.toContain("<strong>langsmith</strong>");
    expect(html).toContain('<summary class="agent-status-tag');
    expect(html).toContain("agent-missing agent-status-tag");
  });

  test("comparison rows use the inventory type marker treatment", () => {
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={inventories}
        filters={{ view: "compare", discrepanciesOnly: true }}
      />,
    );

    expect(html).toContain(
      '<span class="agent-kind-label agent-kind-mcp agent-comparison-kind"><i aria-hidden="true"></i>MCP</span>',
    );
  });

  test("comparison rows show a shared capability source", () => {
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={inventories}
        filters={{ view: "compare" }}
      />,
    );

    expect(html).toContain(
      '<span class="badge badge-1 agent-origin-tag agent-comparison-origin">Personal</span>',
    );
  });

  test("comparison rows label differing capability sources as mixed", () => {
    const mixedSourceInventories = inventories.map((inventory) =>
      inventory.provider === "claude"
        ? {
            ...inventory,
            capabilities: inventory.capabilities.map((capability) =>
              capability.name === "frontend-rules"
                ? { ...capability, origin: "skills_sh" as const }
                : capability,
            ),
          }
        : inventory,
    );
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={mixedSourceInventories}
        filters={{ view: "compare" }}
      />,
    );

    expect(html).toContain(
      '<span class="badge agent-origin-tag agent-origin-mixed agent-comparison-origin">Mixed sources</span>',
    );
  });

  test("instruction cells use a compact summary with a visible path", () => {
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={inventories}
        filters={{ view: "compare", discrepanciesOnly: true }}
      />,
    );
    const summaryStart = html.indexOf(
      '<summary class="agent-instruction-summary">',
    );
    const summaryEnd = html.indexOf("</summary>", summaryStart);

    expect(summaryStart).toBeGreaterThanOrEqual(0);
    expect(html.slice(summaryStart, summaryEnd)).toContain(
      "<code>/safe/.codex/AGENTS.md</code>",
    );
  });

  test("comparison status tags distinguish enabled, disabled, unavailable, and missing", () => {
    const statusInventories = inventories.map((inventory) =>
      inventory.provider === "codex"
        ? {
            ...inventory,
            capabilities: [
              ...inventory.capabilities,
              {
                id: "codex:mcp:disabled-example",
                name: "disabled-example",
                kind: "mcp" as const,
                status: "disabled" as const,
                packaging: "standalone" as const,
                origin: "unknown" as const,
              },
              {
                id: "codex:mcp:unavailable-example",
                name: "unavailable-example",
                kind: "mcp" as const,
                status: "unavailable" as const,
                packaging: "standalone" as const,
                origin: "unknown" as const,
              },
            ],
          }
        : inventory,
    );
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={statusInventories}
        filters={{ view: "compare", discrepanciesOnly: true }}
      />,
    );

    expect(html).toContain('class="agent-status-tag badge-1"');
    expect(html).toContain('class="agent-status-tag badge-4"');
    expect(html).toContain(
      'class="agent-missing agent-status-tag agent-status-missing"',
    );
    const disabledLabel = html.indexOf("Disabled</summary>");
    const disabledSummary = html.lastIndexOf("<summary", disabledLabel);

    expect(disabledLabel).toBeGreaterThanOrEqual(0);
    expect(html.slice(disabledSummary, disabledLabel)).toContain(
      "lucide-circle-slash-2",
    );
    const unavailableLabel = html.indexOf("Unavailable</summary>");
    const unavailableSummary = html.lastIndexOf("<summary", unavailableLabel);

    expect(unavailableLabel).toBeGreaterThanOrEqual(0);
    expect(html.slice(unavailableSummary, unavailableLabel)).toContain(
      "lucide-circle-x",
    );
  });

  test("applies select filters when their value changes", () => {
    const requestSubmit = vi
      .spyOn(HTMLFormElement.prototype, "requestSubmit")
      .mockImplementation(() => undefined);

    render(
      <AgentSetupView
        inventories={inventories}
        filters={{ view: "compare" }}
      />,
    );
    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "plugin" },
    });

    expect(requestSubmit).toHaveBeenCalledOnce();
    requestSubmit.mockRestore();
  });

  test("submits search filters when Enter is pressed", () => {
    const requestSubmit = vi
      .spyOn(HTMLFormElement.prototype, "requestSubmit")
      .mockImplementation(() => undefined);

    const view = render(
      <AgentSetupView
        inventories={inventories}
        filters={{ view: "compare" }}
      />,
    );
    const search = view.container.querySelector<HTMLInputElement>(
      'input[type="search"]',
    );

    expect(search).not.toBeNull();
    fireEvent.keyDown(search!, {
      key: "Enter",
    });

    expect(requestSubmit).toHaveBeenCalledOnce();
    requestSubmit.mockRestore();
  });

  test("does not render a redundant filter submit button", () => {
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={inventories}
        filters={{ view: "compare" }}
      />,
    );

    expect(html).not.toContain("Apply filters");
  });

  test("inventory mode renders provider counts, provenance, warnings, and instructions", () => {
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={inventories}
        filters={{ view: "inventory" }}
      />,
    );

    expect(html).toContain("Agent setup");
    expect(html).toContain("Codex");
    expect(html).toContain("3 capabilities");
    expect(html).toContain("skills.sh");
    expect(html).toContain("vercel-labs/agent-browser");
    expect(html).toContain("Could not parse global provider configuration.");
    expect(html).toContain("# Codex instructions");
  });

  test("sorts inventory capabilities by type, source, then name", () => {
    const unsortedInventory: AgentInventory = {
      provider: "codex",
      scope: "global",
      capabilities: [
        skill("codex", "skill-personal"),
        skill("codex", "plugin-unknown", {
          kind: "plugin",
          status: "enabled",
          origin: "unknown",
        }),
        skill("codex", "z-plugin-personal", {
          kind: "plugin",
          status: "enabled",
        }),
        skill("codex", "plugin-built-in", {
          kind: "plugin",
          status: "enabled",
          origin: "built_in",
        }),
        skill("codex", "a-plugin-personal", {
          kind: "plugin",
          status: "enabled",
        }),
        skill("codex", "mcp-personal", {
          kind: "mcp",
          status: "enabled",
        }),
      ],
      warnings: [],
    };
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={[unsortedInventory]}
        filters={{ view: "inventory" }}
      />,
    );

    const orderedNames = [
      "plugin-built-in",
      "a-plugin-personal",
      "z-plugin-personal",
      "plugin-unknown",
      "skill-personal",
      "mcp-personal",
    ];
    const positions = orderedNames.map((name) =>
      html.indexOf(`<strong>${name}</strong>`),
    );

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual(
      [...positions].sort((left, right) => left - right),
    );
  });

  test("renders capability types as dot labels and sources as outlined tags", () => {
    const typeInventory: AgentInventory = {
      provider: "codex",
      scope: "global",
      capabilities: [
        skill("codex", "plugin-example", {
          kind: "plugin",
          status: "enabled",
        }),
        skill("codex", "skill-example"),
        skill("codex", "mcp-example", {
          kind: "mcp",
          status: "enabled",
        }),
      ],
      warnings: [],
    };
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={[typeInventory]}
        filters={{ view: "inventory" }}
      />,
    );

    expect(html).toContain(
      '<span class="agent-kind-label agent-kind-plugin"><i aria-hidden="true"></i>Plugin</span>',
    );
    expect(html).toContain(
      '<span class="agent-kind-label agent-kind-skill"><i aria-hidden="true"></i>Skill</span>',
    );
    expect(html).toContain(
      '<span class="agent-kind-label agent-kind-mcp"><i aria-hidden="true"></i>MCP</span>',
    );
    expect(html).toContain(
      '<span class="badge badge-1 agent-origin-tag">Personal</span>',
    );
  });

  test("uses comparison status tags in inventory rows", () => {
    const statusInventory: AgentInventory = {
      provider: "codex",
      scope: "global",
      capabilities: [
        skill("codex", "enabled-example", {
          kind: "mcp",
          status: "enabled",
        }),
        skill("codex", "disabled-example", {
          kind: "mcp",
          status: "disabled",
        }),
        skill("codex", "unavailable-example", {
          kind: "mcp",
          status: "unavailable",
        }),
      ],
      warnings: [],
    };
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={[statusInventory]}
        filters={{ view: "inventory" }}
      />,
    );

    expect(html).toContain('<span class="agent-status-tag badge-1">');
    expect(html).toContain('<span class="agent-status-tag badge-4">');
    const unavailableLabel = html.indexOf("Unavailable</span>");
    const unavailableTag = html.lastIndexOf("<span", unavailableLabel);

    expect(unavailableLabel).toBeGreaterThanOrEqual(0);
    expect(html.slice(unavailableTag, unavailableLabel)).toContain(
      "lucide-circle-x",
    );
    expect(html).not.toContain("status-label");
  });

  test("renders an explicit empty state for a filtered inventory", () => {
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={inventories}
        filters={{ view: "inventory", q: "does-not-exist" }}
      />,
    );

    expect(html).toContain("No capabilities match these filters.");
  });
});
