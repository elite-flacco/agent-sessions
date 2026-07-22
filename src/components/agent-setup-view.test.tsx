// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { AgentCapability, AgentInventory } from "@/lib/agent-inventory";
import { AgentSetupView, parseAgentSetupFilters } from "./agent-setup-view";

// The file mixes render() (DOM-mounting) and renderToStaticMarkup() (string)
// tests; without cleanup, DOM nodes from one render() test leak into the
// next and break global `screen` queries in later tests.
afterEach(() => {
  cleanup();
});

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
    scheduledTasks: [
      {
        id: "weekly-digest",
        name: "Weekly digest",
        provider: "codex",
        scheduleRaw: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=8",
        scheduleHuman: "Mondays at 08:00",
        scheduleMissing: false,
        status: "active",
        model: "gpt-5.5",
        instructionBody: "Summarize the week.",
        instructionFormat: "toml_prompt",
        sourcePath: "/safe/.codex/automations/weekly-digest/automation.toml",
        warnings: [],
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
    instructionFile: {
      filename: "AGENTS.md",
      sourcePath: "/safe/.zcode/AGENTS.md",
      content: "# Zcode instructions\n",
      contentFingerprint: "zcode-fingerprint",
    },
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

  test("accepts the disabled status filter", () => {
    expect(parseAgentSetupFilters({ status: "disabled" }).status).toBe(
      "disabled",
    );
  });

  test("parses the consensus attention comparison mode", () => {
    expect(
      parseAgentSetupFilters({
        view: "compare",
        comparison: "attention",
      }),
    ).toMatchObject({
      view: "compare",
      comparisonMode: "attention",
    });
  });
});

describe("AgentSetupView", () => {
  test("inventory nests rail → source → repo and hoists badges off rows", () => {
    const nested: AgentInventory[] = [
      {
        provider: "codex",
        scope: "global",
        warnings: [],
        capabilities: [
          skill("codex", "brainstorming", {
            origin: "skills_sh",
            sourceRepository: "superpowers",
          }),
          skill("codex", "writing-plans", {
            origin: "skills_sh",
            sourceRepository: "superpowers",
          }),
        ],
      },
    ];
    const { container } = render(
      <AgentSetupView
        inventories={nested}
        filters={{ view: "inventory", provider: "codex" }}
      />,
    );

    // No kind bucket — the vertical rail owns kind selection.
    expect(container.querySelectorAll(".agent-kind-bucket")).toHaveLength(0);

    // One source group, open by default so its repo sub-groups are visible.
    const sources = container.querySelectorAll(".agent-source-group");
    expect(sources).toHaveLength(1);
    expect(sources[0]!.hasAttribute("open")).toBe(true);

    // Type badge never lands on a row.
    expect(container.querySelectorAll(".agent-kind-label")).toHaveLength(0);

    // Origin badge appears once, on the source header.
    expect(
      container.querySelectorAll(".agent-source-group .agent-origin-tag"),
    ).toHaveLength(1);

    // Full three-level nesting under the rail content for the 2-skill run.
    expect(
      container.querySelectorAll(
        ".agent-kind-rail-content .agent-source-group .agent-capability-group .agent-capability-row",
      ),
    ).toHaveLength(2);
  });

  test("inventory renders singletons flat under their source group", () => {
    const flat: AgentInventory[] = [
      {
        provider: "codex",
        scope: "global",
        warnings: [],
        capabilities: [skill("codex", "my-skill", { origin: "personal" })],
      },
    ];
    const { container } = render(
      <AgentSetupView
        inventories={flat}
        filters={{ view: "inventory", provider: "codex" }}
      />,
    );

    // No repo/plugin sub-group is forced for a lone skill.
    expect(container.querySelectorAll(".agent-capability-group")).toHaveLength(
      0,
    );
    // The row sits directly in the source group body.
    expect(
      container.querySelectorAll(
        ".agent-source-group-body > .agent-capability-row",
      ),
    ).toHaveLength(1);
    // Row carries neither badge.
    expect(container.querySelectorAll(".agent-kind-label")).toHaveLength(0);
    expect(
      container.querySelectorAll(".agent-capability-row .agent-origin-tag"),
    ).toHaveLength(0);
  });

  test("opens the primary Compare tab in Needs attention mode", () => {
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={inventories}
        filters={{ view: "inventory" }}
      />,
    );

    expect(html).toContain(
      'href="/agents?view=compare&amp;comparison=attention"',
    );
  });

  test("Needs attention includes fixes and reviews but excludes context rows", () => {
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={inventories}
        filters={{ view: "compare", comparisonMode: "attention" }}
      />,
    );

    expect(html).toContain("Global instructions");
    expect(html).toContain("agent-browser");
    expect(html).not.toContain(">frontend-rules<");
    expect(html).not.toContain(">langsmith<");
    expect(html).toContain("1 fix");
    expect(html).toContain("1 review");
    expect(html.indexOf("agent-browser")).toBeLessThan(
      html.indexOf("Global instructions"),
    );
    expect(html).toContain(
      '<tr class="agent-comparison-group-row agent-comparison-group-fix"><th scope="rowgroup" colSpan="5"><span>Fixes</span><span>1</span></th></tr>',
    );
    expect(html).toContain(
      '<tr class="agent-comparison-group-row agent-comparison-group-review"><th scope="rowgroup" colSpan="5"><span>Reviews · Instruction drift</span><span>1</span></th></tr>',
    );
    expect(html).not.toContain(
      "Present on 2 of 4 agents; review whether parity is intended.",
    );
  });

  test("Needs attention splits reviews into one section per reason", () => {
    // Content drift and a missing install have different remedies, so they
    // must not share a section — and content drift leads, being the more
    // actionable of the two.
    const driftInventories: AgentInventory[] = (
      ["codex", "claude", "zcode"] as const
    ).map((provider) => ({
      provider,
      scope: "global",
      capabilities: [
        skill(provider, "drifted", {
          origin: "marketplace",
          packaging: "plugin",
          sourcePlugin: `superpowers@${provider === "codex" ? "openai-curated" : "claude-plugins-official"}`,
          contentFingerprint: provider === "codex" ? "bbb" : "aaa",
        }),
        ...(provider === "zcode"
          ? []
          : [skill(provider, "lopsided", { origin: "marketplace" })]),
      ],
      warnings: [],
    }));
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={driftInventories}
        filters={{ view: "compare", comparisonMode: "attention" }}
      />,
    );

    const contentSection = html.indexOf("Reviews · Different content");
    const missingSection = html.indexOf("Reviews · Missing from one agent");

    expect(contentSection).toBeGreaterThanOrEqual(0);
    expect(missingSection).toBeGreaterThan(contentSection);
    // Empty reasons render no heading at all.
    expect(html).not.toContain("Reviews · Different configuration");
    // The section heading and the provider cells already carry the reason and
    // the specifics, so review rows render no assessment message.
    expect(html).not.toContain("agent-assessment-reason");
    expect(html.indexOf(">drifted<")).toBeLessThan(missingSection);
    expect(html.indexOf(">lopsided<")).toBeGreaterThan(missingSection);
  });

  test("Needs attention surfaces configuration warnings once, deduplicated", () => {
    const shared = {
      sourcePath: "/safe/.agents/.skill-lock.json",
      code: "stale" as const,
      message: 'Skill "ghost" is tracked in the lockfile but not installed.',
    };
    const warned: AgentInventory[] = [
      {
        provider: "codex",
        scope: "global",
        capabilities: [],
        warnings: [shared],
      },
      {
        provider: "claude",
        scope: "global",
        capabilities: [],
        warnings: [shared],
      },
      {
        provider: "zcode",
        scope: "global",
        capabilities: [],
        warnings: [
          {
            sourcePath: "/safe/.zcode/config.json",
            code: "malformed",
            message: "Could not parse global provider configuration.",
          },
        ],
      },
      { provider: "pi", scope: "global", capabilities: [], warnings: [] },
    ];
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={warned}
        filters={{ view: "compare", comparisonMode: "attention" }}
      />,
    );

    expect(html).toContain("Configuration warnings");
    expect(html).toContain("Could not parse global provider configuration.");
    // The shared lockfile warning appears on multiple provider inventories but
    // must render only once in the attention list.
    expect(html.split("ghost").length - 1).toBe(1);
  });

  test("Needs attention surfaces per-provider duplicate installs with content framing", () => {
    const duplicated: AgentInventory[] = [
      {
        provider: "codex",
        scope: "global",
        capabilities: [
          skill("codex", "twice-installed", {
            id: "codex:skill:twice-installed:one",
            sourcePath: "/safe/one",
            canonicalSourcePath: "/safe/one",
            contentFingerprint: "same",
          }),
          skill("codex", "twice-installed", {
            id: "codex:skill:twice-installed:two",
            sourcePath: "/safe/two",
            canonicalSourcePath: "/safe/two",
            contentFingerprint: "same",
          }),
          skill("codex", "shadowed", {
            id: "codex:skill:shadowed:one",
            sourcePath: "/safe/shadow-one",
            canonicalSourcePath: "/safe/shadow-one",
            contentFingerprint: "aaa",
          }),
          skill("codex", "shadowed", {
            id: "codex:skill:shadowed:two",
            sourcePath: "/safe/shadow-two",
            canonicalSourcePath: "/safe/shadow-two",
            contentFingerprint: "bbb",
          }),
        ],
        warnings: [],
      },
      { provider: "claude", scope: "global", capabilities: [], warnings: [] },
      { provider: "zcode", scope: "global", capabilities: [], warnings: [] },
      { provider: "pi", scope: "global", capabilities: [], warnings: [] },
    ];
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={duplicated}
        filters={{ view: "compare", comparisonMode: "attention" }}
      />,
    );

    expect(html).toContain("Duplicate installs");
    expect(html).toContain("twice-installed");
    // Identical copies read as plain "Redundant"; only differing copies carry
    // the amber "Shadowed" badge, keeping color proportional to real risk.
    expect(html).toContain("Redundant");
    expect(html).toContain("Removing all but one is safe.");
    expect(html).toContain("shadowed");
    expect(html).toContain("Shadowed");
    expect(html).toContain("Copies differ — pick which one wins.");
    expect(html).toContain("/safe/one");
    expect(html).toContain("/safe/two");
    // Agent-local hygiene leads; the cross-agent matrix region follows. This
    // fixture has no Fix/Review rows, so that region is the empty state.
    expect(html.indexOf("Duplicate installs")).toBeLessThan(
      html.indexOf("No consensus drift needs attention."),
    );
  });

  test("uses the correct plural for multiple fixes", () => {
    const multipleFixInventories = inventories.map((inventory) => ({
      ...inventory,
      capabilities: [
        ...inventory.capabilities,
        skill(inventory.provider, "broken-shared-skill", {
          status: "unavailable",
        }),
      ],
    }));
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={multipleFixInventories}
        filters={{ view: "compare", comparisonMode: "attention" }}
      />,
    );

    expect(html).toContain("2 fixes");
    expect(html).not.toContain("2 fixs");
  });

  test("Complete matrix preserves context rows and legacy discrepancies", () => {
    const complete = renderToStaticMarkup(
      <AgentSetupView
        inventories={inventories}
        filters={{ view: "compare" }}
      />,
    );
    const discrepancies = renderToStaticMarkup(
      <AgentSetupView
        inventories={inventories}
        filters={{ view: "compare", discrepanciesOnly: true }}
      />,
    );

    expect(complete).toContain("frontend-rules");
    expect(complete).toContain("langsmith");
    expect(discrepancies).toContain("langsmith");
    expect(discrepancies).not.toContain(">frontend-rules<");
  });

  test("comparison tables expose compact capability and provider columns", () => {
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={inventories}
        filters={{ view: "compare" }}
      />,
    );

    expect(html).toContain('<col class="agent-comparison-capability-column"/>');
    expect(html.match(/agent-comparison-provider-column/g)).toHaveLength(4);
  });

  test("Complete matrix collapses unanimous capabilities into one all-agent cell", () => {
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={inventories}
        filters={{ view: "compare" }}
      />,
    );
    const rowStart = html.indexOf(">frontend-rules<");
    const rowEnd = html.indexOf("</tr>", rowStart);
    const row = html.slice(rowStart, rowEnd);

    expect(row).toContain('<td colSpan="4"');
    expect(row).toContain("All agents");
  });

  test("Needs attention empty state links to the complete matrix", () => {
    const uniformInventories: AgentInventory[] = [
      "codex",
      "claude",
      "zcode",
      "pi",
    ].map((provider) => ({
      provider: provider as AgentInventory["provider"],
      scope: "global",
      capabilities: [skill(provider as AgentInventory["provider"], "shared")],
      warnings: [],
    }));
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={uniformInventories}
        filters={{ view: "compare", comparisonMode: "attention" }}
      />,
    );

    expect(html).toContain("No consensus drift needs attention");
    expect(html).toContain('href="/agents?view=compare"');
    expect(html).toContain("Complete matrix");
  });

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
      'class="lucide lucide-waypoints" aria-hidden="true"',
    );
    expect(html).toContain("MCP</span>");
    expect(html).toContain('<div class="agent-comparison-metadata">');
  });

  test("comparison detail cells show the contributing plugin for plugin-packaged capabilities", () => {
    const pluginSkill = (
      provider: AgentInventory["provider"],
    ): AgentCapability =>
      skill(provider, "brainstorming", {
        packaging: "plugin",
        sourcePlugin: "superpowers@claude-plugins-official",
      });
    const pluginInventories: AgentInventory[] = [
      "codex",
      "claude",
      "zcode",
      "pi",
    ].map((provider) => ({
      provider: provider as AgentInventory["provider"],
      scope: "global" as const,
      capabilities: [pluginSkill(provider as AgentInventory["provider"])],
      warnings: [],
    }));

    const completeHtml = renderToStaticMarkup(
      <AgentSetupView
        inventories={pluginInventories}
        filters={{ view: "compare" }}
      />,
    );

    // Uniform row collapses into one all-agents cell; the plugin name renders
    // as an always-visible .agent-compare-source sibling of the <details>, so
    // it is visible without expanding the summary.
    const uniformDetailStart = completeHtml.indexOf(
      'class="agent-compare-detail agent-all-agents-detail"',
    );
    const uniformDetailEnd = completeHtml.indexOf(
      "</details>",
      uniformDetailStart,
    );
    // Inside the collapsed <details> body, the plugin name must NOT appear...
    expect(
      completeHtml.slice(uniformDetailStart, uniformDetailEnd),
    ).not.toContain("superpowers@claude-plugins-official");
    // ...it renders as a visible sibling instead.
    expect(completeHtml).toContain(
      '<span class="agent-compare-source">superpowers@claude-plugins-official</span>',
    );

    // A split presence row renders three per-provider detail cells; each cell
    // surfaces the plugin name as a visible .agent-compare-source sibling.
    const splitInventories = pluginInventories.map((inventory, index) =>
      index === 3 ? { ...inventory, capabilities: [] } : inventory,
    );
    const splitHtml = renderToStaticMarkup(
      <AgentSetupView
        inventories={splitInventories}
        filters={{ view: "compare" }}
      />,
    );
    const detailCount = (splitHtml.match(/class="agent-compare-detail"/g) ?? [])
      .length;
    expect(detailCount).toBe(3);
    expect(splitHtml).toContain(
      '<span class="agent-compare-source">superpowers@claude-plugins-official</span>',
    );
  });

  test("comparison detail cells show the skills.sh repository for skills.sh-installed standalone skills", () => {
    const skillsShSkill = (
      provider: AgentInventory["provider"],
    ): AgentCapability =>
      skill(provider, "agent-browser", {
        origin: "skills_sh",
        sourceRepository: "vercel-labs/agent-browser",
      });
    const skillsShInventories: AgentInventory[] = [
      "codex",
      "claude",
      "zcode",
      "pi",
    ].map((provider) => ({
      provider: provider as AgentInventory["provider"],
      scope: "global" as const,
      capabilities: [skillsShSkill(provider as AgentInventory["provider"])],
      warnings: [],
    }));

    const completeHtml = renderToStaticMarkup(
      <AgentSetupView
        inventories={skillsShInventories}
        filters={{ view: "compare" }}
      />,
    );

    // The skills.sh repository renders as the visible source line; the body
    // does not duplicate it.
    const uniformDetailStart = completeHtml.indexOf(
      'class="agent-compare-detail agent-all-agents-detail"',
    );
    const uniformDetailEnd = completeHtml.indexOf(
      "</details>",
      uniformDetailStart,
    );
    expect(
      completeHtml.slice(uniformDetailStart, uniformDetailEnd),
    ).not.toContain("vercel-labs/agent-browser");
    expect(completeHtml).toContain(
      '<span class="agent-compare-source">vercel-labs/agent-browser</span>',
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
      '<span class="agent-comparison-origin">Personal</span>',
    );
    expect(html).toContain(
      '<span class="agent-comparison-separator" aria-hidden="true">·</span><span class="agent-comparison-origin">Personal</span>',
    );
    expect(html).not.toContain(
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
      '<span class="agent-comparison-origin agent-origin-mixed">Mixed sources</span>',
    );
  });

  test("instruction cells keep paths out of the compact summary", () => {
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
    expect(html.slice(summaryStart, summaryEnd)).not.toContain("<code>");
    expect(html.slice(summaryEnd)).toContain(
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

  test("inventory mode hides disabled capabilities and excludes them from counts", () => {
    const withDisabled: AgentInventory[] = [
      {
        provider: "codex",
        scope: "global",
        capabilities: [
          skill("codex", "active-skill"),
          skill("codex", "dormant-skill", { status: "disabled" }),
        ],
        warnings: [],
      },
      { provider: "claude", scope: "global", capabilities: [], warnings: [] },
      { provider: "zcode", scope: "global", capabilities: [], warnings: [] },
      { provider: "pi", scope: "global", capabilities: [], warnings: [] },
    ];
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={withDisabled}
        filters={{ view: "inventory" }}
      />,
    );

    expect(html).toContain("active-skill");
    expect(html).not.toContain("dormant-skill");
    expect(html).toContain("1 capabilities");
  });

  test("offers the Disabled status filter only in compare mode", () => {
    const inventoryHtml = renderToStaticMarkup(
      <AgentSetupView
        inventories={inventories}
        filters={{ view: "inventory" }}
      />,
    );
    const compareHtml = renderToStaticMarkup(
      <AgentSetupView
        inventories={inventories}
        filters={{ view: "compare" }}
      />,
    );

    expect(inventoryHtml).not.toContain('<option value="disabled">');
    expect(compareHtml).toContain('<option value="disabled">');
  });

  test("compare mode still renders disabled cells", () => {
    const withDisabled: AgentInventory[] = [
      {
        provider: "codex",
        scope: "global",
        capabilities: [skill("codex", "shared-skill", { status: "disabled" })],
        warnings: [],
      },
      {
        provider: "claude",
        scope: "global",
        capabilities: [skill("claude", "shared-skill", { status: "enabled" })],
        warnings: [],
      },
      { provider: "zcode", scope: "global", capabilities: [], warnings: [] },
      { provider: "pi", scope: "global", capabilities: [], warnings: [] },
    ];
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={withDisabled}
        filters={{ view: "compare" }}
      />,
    );

    expect(html).toContain("Disabled</summary>");
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
    // Summary cards span every provider; the body shows one at a time. The
    // default pane is the first non-empty kind (Skills), so instructions render
    // only when the Instructions rail entry is selected.
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
    // The selected provider (codex, the default) shows the Instructions rail
    // entry but not the instruction body on the default Skills pane; the zcode
    // warning text only appears when zcode is the selected provider.
    expect(html).toContain("Instructions");
    expect(html).not.toContain("# Codex instructions");
    expect(html).not.toContain(
      "Could not parse global provider configuration.",
    );

    const codexInstructionHtml = renderToStaticMarkup(
      <AgentSetupView
        inventories={inventories}
        filters={{ view: "inventory", provider: "codex", kind: "instruction" }}
      />,
    );
    expect(codexInstructionHtml).toContain("# Codex instructions");

    const zcodeHtml = renderToStaticMarkup(
      <AgentSetupView
        inventories={inventories}
        filters={{ view: "inventory", provider: "zcode" }}
      />,
    );
    expect(zcodeHtml).toContain(
      "Could not parse global provider configuration.",
    );
  });

  test("uses compact typography for instruction filenames", () => {
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={inventories}
        filters={{ view: "inventory", provider: "claude", kind: "instruction" }}
      />,
    );

    expect(html).toContain(
      '<strong class="agent-instruction-title">CLAUDE.md</strong>',
    );
  });

  test("sorts each kind pane by source then name", () => {
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

    // The rail shows one kind per render, so verify ordering within each kind
    // pane separately. Plugins: built-in → personal(a, z) → unknown; skills
    // and MCPs each have a single personal member.
    const pluginHtml = renderToStaticMarkup(
      <AgentSetupView
        inventories={[unsortedInventory]}
        filters={{ view: "inventory", kind: "plugin" }}
      />,
    );
    const pluginOrder = [
      "plugin-built-in",
      "a-plugin-personal",
      "z-plugin-personal",
      "plugin-unknown",
    ];
    const pluginPositions = pluginOrder.map((name) =>
      pluginHtml.indexOf(`<strong>${name}</strong>`),
    );
    expect(pluginPositions.every((p) => p >= 0)).toBe(true);
    expect(pluginPositions).toEqual(
      [...pluginPositions].sort((left, right) => left - right),
    );

    const skillHtml = renderToStaticMarkup(
      <AgentSetupView
        inventories={[unsortedInventory]}
        filters={{ view: "inventory", kind: "skill" }}
      />,
    );
    expect(skillHtml).toContain("<strong>skill-personal</strong>");
    expect(skillHtml).not.toContain("plugin-personal");

    const mcpHtml = renderToStaticMarkup(
      <AgentSetupView
        inventories={[unsortedInventory]}
        filters={{ view: "inventory", kind: "mcp" }}
      />,
    );
    expect(mcpHtml).toContain("<strong>mcp-personal</strong>");
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

    expect(html).toContain('class="lucide lucide-plug" aria-hidden="true"');
    expect(html).toContain(
      'class="lucide lucide-wand-sparkles" aria-hidden="true"',
    );
    expect(html).toContain(
      'class="lucide lucide-waypoints" aria-hidden="true"',
    );
    expect(html).toContain(
      '<span class="badge badge-1 agent-origin-tag">Personal</span>',
    );
  });

  test("omits status tags in inventory rows", () => {
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

    // The inventory hides disabled capabilities, so a per-row status tag adds
    // no signal; status stays a Compare-view and Needs Attention concern.
    expect(html).toContain("<strong>enabled-example</strong>");
    expect(html).not.toContain("agent-status-tag");
    expect(html).not.toContain("Unavailable</span>");
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

  test("inventory groups multi-skill plugins into a collapsed <details>", () => {
    const groupedInventory: AgentInventory = {
      provider: "codex",
      scope: "global",
      capabilities: [
        skill("codex", "alpha", {
          origin: "marketplace",
          packaging: "plugin",
          sourcePlugin: "superpowers@claude-plugins-official",
          sourceRepository: "claude-plugins-official",
          status: "enabled",
        }),
        skill("codex", "beta", {
          origin: "marketplace",
          packaging: "plugin",
          sourcePlugin: "superpowers@claude-plugins-official",
          sourceRepository: "claude-plugins-official",
          status: "enabled",
        }),
        skill("codex", "gamma", {
          origin: "marketplace",
          packaging: "plugin",
          sourcePlugin: "superpowers@claude-plugins-official",
          sourceRepository: "claude-plugins-official",
          status: "enabled",
        }),
      ],
      warnings: [],
    };
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={[groupedInventory]}
        filters={{ view: "inventory" }}
      />,
    );

    // Summary contains the plugin name, member count, and origin.
    expect(html).toContain(
      "<strong>superpowers@claude-plugins-official</strong>",
    );
    expect(html).toContain("3 skills");
    expect(html).toContain(
      '<span class="badge badge-3 agent-origin-tag">Marketplace</span>',
    );
    expect(html).not.toContain("agent-status-tag");
    expect(html).toContain('<details class="agent-capability-group">');

    // Member rows are nested inside the group body container.
    const groupStart = html.indexOf('class="agent-capability-group"');
    const membersStart = html.indexOf(
      'class="agent-capability-group-members"',
      groupStart,
    );
    expect(membersStart).toBeGreaterThan(groupStart);
    expect(
      html.indexOf("<strong>alpha</strong>", membersStart),
    ).toBeGreaterThan(membersStart);
    expect(html.indexOf("<strong>beta</strong>", membersStart)).toBeGreaterThan(
      membersStart,
    );
    expect(
      html.indexOf("<strong>gamma</strong>", membersStart),
    ).toBeGreaterThan(membersStart);
  });

  test("inventory collapses interleaved plugins into separate groups", () => {
    // Names are assigned so alphabetical sort interleaves the two plugins:
    // vercel owns apple + cherry, openai-developers owns banana + date.
    // Alphabetical order is apple(v), banana(o), cherry(v), date(o). Without
    // the group-preserving sort, buildInventoryItems would see V.O.V.O and
    // emit four flat rows instead of two groups.
    const interleavedInventory: AgentInventory = {
      provider: "codex",
      scope: "global",
      capabilities: [
        skill("codex", "apple", {
          origin: "marketplace",
          packaging: "plugin",
          sourcePlugin: "vercel@openai-curated",
          sourceRepository: "openai-curated",
          status: "enabled",
        }),
        skill("codex", "banana", {
          origin: "marketplace",
          packaging: "plugin",
          sourcePlugin: "openai-developers@openai-curated",
          sourceRepository: "openai-curated",
          status: "enabled",
        }),
        skill("codex", "cherry", {
          origin: "marketplace",
          packaging: "plugin",
          sourcePlugin: "vercel@openai-curated",
          sourceRepository: "openai-curated",
          status: "enabled",
        }),
        skill("codex", "date", {
          origin: "marketplace",
          packaging: "plugin",
          sourcePlugin: "openai-developers@openai-curated",
          sourceRepository: "openai-curated",
          status: "enabled",
        }),
      ],
      warnings: [],
    };
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={[interleavedInventory]}
        filters={{ view: "inventory" }}
      />,
    );

    // Two separate collapsed <details> groups, one per plugin.
    const groupCount = (
      html.match(/<details class="agent-capability-group">/g) ?? []
    ).length;
    expect(groupCount).toBe(2);

    // Both plugin headers render, each with its own "2 skills" count.
    expect(html).toContain("<strong>vercel@openai-curated</strong>");
    expect(html).toContain("<strong>openai-developers@openai-curated</strong>");
    const twoSkillsMatches = html.match(/2 skills/g) ?? [];
    expect(twoSkillsMatches).toHaveLength(2);

    // Member rows are nested under the right group: the vercel group's body
    // contains apple and cherry; the openai-developers group's body contains
    // banana and date.
    const vercelGroupStart = html.indexOf("vercel@openai-curated");
    const vercelMembersStart = html.indexOf(
      'class="agent-capability-group-members"',
      vercelGroupStart,
    );
    const vercelMembersEnd = html.indexOf("</details>", vercelMembersStart);
    const vercelBody = html.slice(vercelMembersStart, vercelMembersEnd);
    expect(vercelBody).toContain("<strong>apple</strong>");
    expect(vercelBody).toContain("<strong>cherry</strong>");
    expect(vercelBody).not.toContain("<strong>banana</strong>");
    expect(vercelBody).not.toContain("<strong>date</strong>");

    const openaiGroupStart = html.indexOf("openai-developers@openai-curated");
    const openaiMembersStart = html.indexOf(
      'class="agent-capability-group-members"',
      openaiGroupStart,
    );
    const openaiMembersEnd = html.indexOf("</details>", openaiMembersStart);
    const openaiBody = html.slice(openaiMembersStart, openaiMembersEnd);
    expect(openaiBody).toContain("<strong>banana</strong>");
    expect(openaiBody).toContain("<strong>date</strong>");
    expect(openaiBody).not.toContain("<strong>apple</strong>");
    expect(openaiBody).not.toContain("<strong>cherry</strong>");
  });

  test("inventory keeps single-skill plugins as flat rows", () => {
    const flatInventory: AgentInventory = {
      provider: "codex",
      scope: "global",
      capabilities: [
        skill("codex", "only-one", {
          origin: "marketplace",
          packaging: "plugin",
          sourcePlugin: "skill-creator@zcode-plugins-official",
          sourceRepository: "zcode-plugins-official",
          status: "enabled",
        }),
      ],
      warnings: [],
    };
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={[flatInventory]}
        filters={{ view: "inventory" }}
      />,
    );

    expect(html).not.toContain("agent-capability-group");
    expect(html).toContain("<strong>only-one</strong>");
  });

  test("inventory groups skills.sh skills by repository", () => {
    const groupedInventory: AgentInventory = {
      provider: "codex",
      scope: "global",
      capabilities: [
        skill("codex", "html-to-email", {
          origin: "skills_sh",
          sourceRepository: "vercel-labs/skills",
          status: "enabled",
        }),
        skill("codex", "html-to-email-pro", {
          origin: "skills_sh",
          sourceRepository: "vercel-labs/skills",
          status: "enabled",
        }),
      ],
      warnings: [],
    };
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={[groupedInventory]}
        filters={{ view: "inventory" }}
      />,
    );

    expect(html).toContain("<strong>vercel-labs/skills</strong>");
    expect(html).toContain("2 skills");
    expect(html).toContain(
      '<span class="badge badge-2 agent-origin-tag">skills.sh</span>',
    );
  });

  test("inventory group summary reports no status for mixed members", () => {
    const groupedInventory: AgentInventory = {
      provider: "codex",
      scope: "global",
      capabilities: [
        skill("codex", "alpha", {
          origin: "marketplace",
          packaging: "plugin",
          sourcePlugin: "superpowers@claude-plugins-official",
          status: "enabled",
        }),
        skill("codex", "beta", {
          origin: "marketplace",
          packaging: "plugin",
          sourcePlugin: "superpowers@claude-plugins-official",
          status: "enabled",
        }),
        // "installed" (unknown enable state) is the non-enabled status that
        // still renders in the inventory; disabled members are hidden there.
        skill("codex", "gamma", {
          origin: "marketplace",
          packaging: "plugin",
          sourcePlugin: "superpowers@claude-plugins-official",
          status: "installed",
        }),
      ],
      warnings: [],
    };
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={[groupedInventory]}
        filters={{ view: "inventory" }}
      />,
    );

    expect(html).toContain("3 skills");
    expect(html).not.toContain("Mixed");
    expect(html).not.toContain("agent-status-tag");
  });

  test("inventory keeps personal/built_in/unknown skills flat even when several share an origin", () => {
    const flatInventory: AgentInventory = {
      provider: "codex",
      scope: "global",
      capabilities: [
        skill("codex", "personal-1", { origin: "personal" }),
        skill("codex", "personal-2", { origin: "personal" }),
        skill("codex", "unknown-1", { origin: "unknown" }),
        skill("codex", "unknown-2", { origin: "unknown" }),
      ],
      warnings: [],
    };
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={[flatInventory]}
        filters={{ view: "inventory" }}
      />,
    );

    expect(html).not.toContain("agent-capability-group");
    expect(html).toContain("<strong>personal-1</strong>");
    expect(html).toContain("<strong>unknown-2</strong>");
  });

  test("inventory collapses a group below threshold when a search filter narrows it", () => {
    const groupedInventory: AgentInventory = {
      provider: "codex",
      scope: "global",
      capabilities: [
        skill("codex", "alpha-skill", {
          origin: "marketplace",
          packaging: "plugin",
          sourcePlugin: "superpowers@claude-plugins-official",
          status: "enabled",
        }),
        skill("codex", "beta-skill", {
          origin: "marketplace",
          packaging: "plugin",
          sourcePlugin: "superpowers@claude-plugins-official",
          status: "enabled",
        }),
      ],
      warnings: [],
    };
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={[groupedInventory]}
        filters={{ view: "inventory", q: "beta" }}
      />,
    );

    // Only the matching member survives the filter; with one survivor it
    // renders flat rather than as a one-row group.
    expect(html).not.toContain("agent-capability-group");
    expect(html).toContain("<strong>beta-skill</strong>");
    expect(html).not.toContain("<strong>alpha-skill</strong>");
  });

  test("inventory never groups plugins or MCPs", () => {
    const inventory: AgentInventory = {
      provider: "codex",
      scope: "global",
      capabilities: [
        skill("codex", "plugin-1", {
          kind: "plugin",
          status: "enabled",
          origin: "marketplace",
          sourcePlugin: "shared-marketplace@mp",
          sourceRepository: "shared-marketplace",
        }),
        skill("codex", "plugin-2", {
          kind: "plugin",
          status: "enabled",
          origin: "marketplace",
          sourcePlugin: "shared-marketplace@mp",
          sourceRepository: "shared-marketplace",
        }),
        skill("codex", "mcp-1", {
          kind: "mcp",
          status: "enabled",
          origin: "marketplace",
          sourcePlugin: "shared-marketplace@mp",
          sourceRepository: "shared-marketplace",
        }),
        skill("codex", "mcp-2", {
          kind: "mcp",
          status: "enabled",
          origin: "marketplace",
          sourcePlugin: "shared-marketplace@mp",
          sourceRepository: "shared-marketplace",
        }),
      ],
      warnings: [],
    };

    // The rail renders one kind at a time; each pane lists its members flat,
    // never collapsed into a capability group.
    const pluginHtml = renderToStaticMarkup(
      <AgentSetupView
        inventories={[inventory]}
        filters={{ view: "inventory", kind: "plugin" }}
      />,
    );
    expect(pluginHtml).not.toContain("agent-capability-group");
    expect(pluginHtml).toContain("<strong>plugin-1</strong>");
    expect(pluginHtml).toContain("<strong>plugin-2</strong>");

    const mcpHtml = renderToStaticMarkup(
      <AgentSetupView
        inventories={[inventory]}
        filters={{ view: "inventory", kind: "mcp" }}
      />,
    );
    expect(mcpHtml).not.toContain("agent-capability-group");
    expect(mcpHtml).toContain("<strong>mcp-1</strong>");
    expect(mcpHtml).toContain("<strong>mcp-2</strong>");
  });

  test("inventory renders collapsed groups before flat rows", () => {
    // The flat single-skill plugin "alpha-singleton" sorts ahead of the
    // grouped "zeta-bundle" plugin by group key, so without the grouped-first
    // item sort the flat row would render first. The item sort lifts the
    // collapsed group above flat singletons within the same origin bucket.
    const inventory: AgentInventory = {
      provider: "codex",
      scope: "global",
      capabilities: [
        skill("codex", "alpha-only", {
          origin: "marketplace",
          packaging: "plugin",
          sourcePlugin: "alpha-singleton@mp",
          sourceRepository: "mp",
          status: "enabled",
        }),
        skill("codex", "zeta-one", {
          origin: "marketplace",
          packaging: "plugin",
          sourcePlugin: "zeta-bundle@mp",
          sourceRepository: "mp",
          status: "enabled",
        }),
        skill("codex", "zeta-two", {
          origin: "marketplace",
          packaging: "plugin",
          sourcePlugin: "zeta-bundle@mp",
          sourceRepository: "mp",
          status: "enabled",
        }),
      ],
      warnings: [],
    };
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={[inventory]}
        filters={{ view: "inventory" }}
      />,
    );

    // The zeta-bundle group should render before the alpha-singleton flat row.
    const zetaGroupPosition = html.indexOf("zeta-bundle@mp");
    const alphaFlatPosition = html.indexOf("<strong>alpha-only</strong>");
    expect(zetaGroupPosition).toBeGreaterThanOrEqual(0);
    expect(alphaFlatPosition).toBeGreaterThanOrEqual(0);
    expect(zetaGroupPosition).toBeLessThan(alphaFlatPosition);
  });

  test("inventory surfaces a shortened sourcePath only for duplicate-name skills", () => {
    // Two same-name skills from different install paths. Both get the path
    // hint so the user can tell them apart; a third singleton skill with a
    // unique name does not get a hint even though it has a sourcePath. HOME
    // is stubbed so the home-substitution is deterministic regardless of the
    // machine running the test.
    vi.stubEnv("HOME", "/Users/example");
    try {
      const inventory: AgentInventory = {
        provider: "codex",
        scope: "global",
        capabilities: [
          skill("codex", "ai-sdk", {
            origin: "skills_sh",
            sourceRepository: "vercel/ai",
            sourcePath: "/Users/example/.agents/skills/ai-sdk",
            status: "enabled",
          }),
          skill("codex", "ai-sdk", {
            id: "codex:skill:ai-sdk-dupe",
            origin: "skills_sh",
            sourceRepository: "vercel/ai",
            sourcePath:
              "/Users/example/.codex/plugins/cache/openai-curated/vercel/d6169bef/skills/ai-sdk",
            status: "enabled",
          }),
          skill("codex", "unique-skill", {
            origin: "skills_sh",
            sourceRepository: "other/repo",
            sourcePath: "/Users/example/.agents/skills/unique-skill",
            status: "enabled",
          }),
        ],
        warnings: [],
      };
      const html = renderToStaticMarkup(
        <AgentSetupView
          inventories={[inventory]}
          filters={{ view: "inventory" }}
        />,
      );

      // Both ai-sdk rows show a path hint; the singleton does not.
      expect(html).toContain(
        '<code class="agent-capability-path-hint">~/.agents/skills/ai-sdk</code>',
      );
      expect(html).toContain(
        '<code class="agent-capability-path-hint">~/.codex/plugins/cache/openai-curated/vercel/skills/ai-sdk</code>',
      );
      expect(html).not.toContain(
        '<code class="agent-capability-path-hint">~/.agents/skills/unique-skill</code>',
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("Scheduled tasks view", () => {
  test("renders third tab and per-provider cards", () => {
    render(
      <AgentSetupView
        inventories={inventories}
        filters={parseAgentSetupFilters({ view: "tasks" })}
      />,
    );
    // The Scheduled tasks nav tab exists.
    expect(screen.getByRole("link", { name: "Scheduled tasks" })).toBeDefined();
    // The codex fixture task renders with its humanized schedule and model.
    screen.getByText("Weekly digest");
    screen.getByText("Mondays at 08:00");
    screen.getByText("gpt-5.5");
    // Pi has no scheduled tasks; its empty card renders the header source label.
    expect(
      screen.getByText(/Pi does not expose scheduled tasks/i),
    ).toBeDefined();
  });
});

describe("parseAgentSetupFilters (tasks view)", () => {
  test("accepts view=tasks and defaults unknowns to inventory", () => {
    expect(parseAgentSetupFilters({ view: "tasks" }).view).toBe("tasks");
    expect(parseAgentSetupFilters({}).view).toBe("inventory");
    expect(parseAgentSetupFilters({ view: "unknown" }).view).toBe("inventory");
  });
});
