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
        // provider is intentionally dropped on compare — see the dedicated test
        // below; compare always spans every provider.
        provider: "codex",
        kind: "skill",
        status: "enabled",
        discrepancies: "1",
      }),
    ).toMatchObject({
      view: "compare",
      provider: undefined,
      kind: "skill",
      status: "enabled",
      discrepanciesOnly: true,
    });
    expect(
      parseAgentSetupFilters({
        provider: "codex",
        kind: "skill",
        status: "enabled",
      }),
    ).toMatchObject({
      view: "inventory",
      provider: "codex",
      kind: "skill",
      status: "enabled",
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

  test("accepts inventory source filters and drops them outside inventory", () => {
    expect(parseAgentSetupFilters({ source: "plugin" })).toMatchObject({
      view: "inventory",
      source: "plugin",
    });
    expect(
      parseAgentSetupFilters({ source: "not-a-source" }).source,
    ).toBeUndefined();
    expect(
      parseAgentSetupFilters({ view: "compare", source: "plugin" }).source,
    ).toBeUndefined();
  });
});

describe("AgentSetupView", () => {
  test("skills inventory renders semantic source groups and compact aligned rows", () => {
    const sourceAware: AgentInventory[] = [
      {
        provider: "codex",
        scope: "global",
        warnings: [],
        capabilities: [
          skill("codex", "direct-skill", {
            origin: "unknown",
          }),
          skill("codex", "plugin-skill", {
            origin: "marketplace",
            packaging: "plugin",
            sourcePlugin: "superpowers@openai-curated",
            status: "enabled",
          }),
          skill("codex", "runtime-skill", {
            origin: "built_in",
            packaging: "built_in",
            status: "enabled",
          }),
          skill("codex", "managed-skill", {
            origin: "skills_sh",
            sourceRepository: "vercel-labs/skills",
          }),
          skill("codex", "personal-skill", {
            origin: "personal",
          }),
        ],
      },
    ];
    const { container } = render(
      <AgentSetupView
        inventories={sourceAware}
        filters={{ view: "inventory", provider: "codex", kind: "skill" }}
      />,
    );

    expect(screen.queryByText("Standalone skills")).not.toBeNull();
    expect(screen.queryByText("Plugin-provided skills")).not.toBeNull();
    expect(screen.queryByText("Built-in skills")).not.toBeNull();
    expect(screen.queryByText("Marketplace skills")).not.toBeNull();
    expect(screen.queryByText("Personal skills")).not.toBeNull();
    expect(
      screen.queryByText("Installed directly, not supplied by a plugin"),
    ).not.toBeNull();

    expect(screen.queryByText("Package / source")).not.toBeNull();
    expect(screen.queryAllByText("Status").length).toBeGreaterThan(0);
    expect(screen.queryByText("Location / detail")).not.toBeNull();
    expect(container.querySelectorAll(".agent-catalog-row")).toHaveLength(5);
    expect(
      container.querySelectorAll(".agent-catalog-row .agent-kind-label"),
    ).toHaveLength(0);
    expect(
      container.querySelectorAll(".agent-catalog-row .agent-row-source"),
    ).toHaveLength(5);
  });

  test("plugin-provided skills always stay under a collapsible plugin parent", () => {
    const singlePluginSkill: AgentInventory[] = [
      {
        provider: "codex",
        scope: "global",
        warnings: [],
        capabilities: [
          skill("codex", "only-skill", {
            origin: "marketplace",
            packaging: "plugin",
            sourcePlugin: "skill-creator@openai-curated",
            sourceRepository: "openai-curated",
            status: "enabled",
          }),
        ],
      },
    ];
    const { container } = render(
      <AgentSetupView
        inventories={singlePluginSkill}
        filters={{ view: "inventory", provider: "codex", kind: "skill" }}
      />,
    );

    const group = container.querySelector(".agent-plugin-group");
    expect(group).not.toBeNull();
    expect(group?.textContent).toContain("skill-creator@openai-curated");
    expect(group?.textContent).toContain("1 skill");
    expect(group?.textContent).toContain("Enabled");
    expect(group?.querySelector(".agent-catalog-row")?.textContent).toContain(
      "only-skill",
    );
  });

  test("inventory source filter narrows the catalog without removing source context", () => {
    const sourceFiltered: AgentInventory[] = [
      {
        provider: "codex",
        scope: "global",
        warnings: [],
        capabilities: [
          skill("codex", "direct-skill", { origin: "unknown" }),
          skill("codex", "managed-skill", {
            origin: "skills_sh",
            sourceRepository: "vercel-labs/skills",
          }),
        ],
      },
    ];
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={sourceFiltered}
        filters={{
          view: "inventory",
          provider: "codex",
          kind: "skill",
          source: "marketplace",
        }}
      />,
    );

    expect(html).toContain('name="source"');
    expect(html).toContain("Marketplace skills");
    expect(html).toContain("managed-skill");
    expect(html).toContain("Marketplace</span>");
    expect(html).not.toContain("Standalone skills");
    expect(html).not.toContain("direct-skill");
  });

  test("selected skill inspector names its parent plugin and duplicate installs", () => {
    vi.stubEnv("HOME", "/Users/example");
    try {
      const selectedInventory: AgentInventory[] = [
        {
          provider: "codex",
          scope: "global",
          warnings: [],
          capabilities: [
            skill("codex", "duplicate-skill", {
              id: "codex:skill:duplicate-skill:plugin",
              origin: "marketplace",
              packaging: "plugin",
              sourcePlugin: "superpowers@openai-curated",
              sourcePath:
                "/Users/example/.codex/plugins/cache/superpowers/skills/duplicate-skill",
              canonicalSourcePath:
                "/Users/example/.codex/plugins/cache/superpowers/skills/duplicate-skill",
              contentFingerprint: "same",
              status: "enabled",
            }),
            skill("codex", "duplicate-skill", {
              id: "codex:skill:duplicate-skill:direct",
              origin: "skills_sh",
              sourceRepository: "obra/superpowers",
              sourcePath: "/Users/example/.agents/skills/duplicate-skill",
              canonicalSourcePath:
                "/Users/example/.agents/skills/duplicate-skill",
              contentFingerprint: "same",
              status: "enabled",
            }),
          ],
        },
      ];
      const { container } = render(
        <AgentSetupView
          inventories={selectedInventory}
          filters={{
            view: "inventory",
            provider: "codex",
            kind: "skill",
            selected: "codex:skill:duplicate-skill:plugin",
          }}
        />,
      );

      const inspector = screen.getByRole("complementary", {
        name: "Selected capability",
      });
      expect(inspector.textContent).toContain("duplicate-skill");
      expect(inspector.textContent).toContain("Parent plugin");
      expect(inspector.textContent).toContain("superpowers@openai-curated");
      expect(inspector.textContent).toContain("Duplicate installs");
      expect(inspector.textContent).toContain("2 locations");
      expect(inspector.textContent).toContain(
        "~/.codex/plugins/cache/superpowers/skills/duplicate-skill",
      );
      expect(inspector.textContent).toContain(
        "~/.agents/skills/duplicate-skill",
      );
      expect(
        container.querySelector('.agent-catalog-row[aria-current="true"]')
          ?.textContent,
      ).toContain("duplicate-skill");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("inventory nests rail → source and keeps managed skills as direct rows", () => {
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

    // One semantic source section; non-plugin marketplace skills stay direct.
    const sources = container.querySelectorAll(".agent-source-group");
    expect(sources).toHaveLength(1);

    // Type badge never lands on a row.
    expect(container.querySelectorAll(".agent-kind-label")).toHaveLength(0);

    // Marketplace installs are not plugins, so they remain compact direct rows.
    expect(container.querySelectorAll(".agent-plugin-group")).toHaveLength(0);
    expect(
      container.querySelectorAll(
        ".agent-catalog .agent-source-group > .agent-source-group-body > .agent-catalog-row",
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

    // No plugin parent is forced for a personal skill.
    expect(container.querySelectorAll(".agent-plugin-group")).toHaveLength(0);
    // The row sits directly in the source group body.
    expect(
      container.querySelectorAll(
        ".agent-source-group-body > .agent-catalog-row",
      ),
    ).toHaveLength(1);
    // Row carries no redundant item-kind icon.
    expect(container.querySelectorAll(".agent-kind-label")).toHaveLength(0);
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
    const view = (
      <AgentSetupView
        inventories={inventories}
        filters={{ view: "compare", comparisonMode: "attention" }}
      />
    );
    const html = renderToStaticMarkup(view);
    render(view);
    const summary = screen.getByLabelText("Comparison summary");

    expect(html).toContain("Global instructions");
    expect(html).toContain("agent-browser");
    expect(html).not.toContain(">frontend-rules<");
    expect(html).not.toContain(">langsmith<");
    expect(summary.textContent).toContain("1 fix");
    expect(summary.textContent).toContain("1 review");
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
    render(
      <AgentSetupView
        inventories={multipleFixInventories}
        filters={{ view: "compare", comparisonMode: "attention" }}
      />,
    );
    const summary = screen.getByLabelText("Comparison summary");

    expect(summary.textContent).toContain("2 fixes");
    expect(summary.textContent).not.toContain("2 fixs");
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

    // Active states render as a filled chip; muted states render as a bare
    // icon-only glyph, and missing keeps its own hook class.
    expect(html).toContain(
      'class="agent-status-tag agent-status-tag--chip badge-1"',
    );
    expect(html).toContain('class="agent-missing agent-status-tag--bare"');

    // The status word is no longer rendered as visible text — the meaning
    // lives in the icon plus the title/aria-label.
    expect(html).not.toContain("Disabled</summary>");
    expect(html).not.toContain("Unavailable</summary>");

    const disabledStart = html.indexOf('title="Disabled"');
    expect(disabledStart).toBeGreaterThanOrEqual(0);
    expect(
      html.slice(disabledStart, html.indexOf("</summary>", disabledStart)),
    ).toContain("lucide-circle-slash-2");

    const unavailableStart = html.indexOf('title="Unavailable"');
    expect(unavailableStart).toBeGreaterThanOrEqual(0);
    expect(
      html.slice(
        unavailableStart,
        html.indexOf("</summary>", unavailableStart),
      ),
    ).toContain("lucide-circle-x");
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

  test("inventory mode hides disabled capabilities and excludes them from catalog counts", () => {
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
    expect(html).toContain("1 item");
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

    expect(html).toContain('title="Disabled"');
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

  test("inventory mode renders provider browsing, provenance, warnings, and instructions", () => {
    // The compact provider rail spans every provider; the body shows one at a
    // time. Instructions render only when that rail entry is selected.
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={inventories}
        filters={{ view: "inventory" }}
      />,
    );

    expect(html).toContain("Agent setup");
    expect(html).toContain("Codex");
    expect(html).toContain("2 items");
    expect(html).toContain("Marketplace skills");
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

  test("compare view has no Agent filter and always spans every provider", () => {
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={inventories}
        filters={{ view: "compare" }}
      />,
    );
    expect(html).not.toContain('name="provider"');
    expect(html).not.toContain("All agents</option>");
    // The Type and Status filters remain.
    expect(html).toContain('name="kind"');
    expect(html).toContain('name="status"');
  });

  test("compare drops a provider param at the parse boundary", () => {
    expect(
      parseAgentSetupFilters({ view: "compare", provider: "pi" }).provider,
    ).toBeUndefined();
    // Inventory still honours it — the rail/cards there are a real selector.
    expect(parseAgentSetupFilters({ provider: "pi" }).provider).toBe("pi");
  });

  test("compare replaces provider cards with a slim contextual summary", () => {
    const { container } = render(
      <AgentSetupView
        inventories={inventories}
        filters={{ view: "compare" }}
      />,
    );
    expect(container.querySelector(".agent-summary-grid")).toBeNull();
    const summary = screen.getByLabelText("Comparison summary");
    expect(summary.textContent).toContain("4 agents");
    expect(summary.textContent).toContain("1 fix");
    expect(summary.textContent).toContain("1 review");
    expect(summary.textContent).toContain("0 duplicate installs");
  });

  test("inventory shows selected-provider capability and source context", () => {
    const { container } = render(
      <AgentSetupView
        inventories={inventories}
        filters={{ view: "inventory", provider: "codex" }}
      />,
    );
    expect(container.querySelector(".agent-summary-grid")).toBeNull();
    const summary = screen.getByLabelText("Inventory summary");
    expect(summary.textContent).toContain("Codex inventory");
    expect(summary.textContent).toContain("3 capabilities");
    expect(summary.textContent).toContain("2 skills");
    expect(summary.textContent).toContain("2 sources");
    expect(summary.textContent).toContain("AGENTS.md");
  });

  test("keeps the Instructions rail entry when another kind is selected", () => {
    // The rail owns kind selection, so picking Skills/Plugins/MCPs must not
    // remove the entry that would take you back to Instructions.
    for (const kind of ["skill", "plugin", "mcp"] as const) {
      const html = renderToStaticMarkup(
        <AgentSetupView
          inventories={inventories}
          filters={{ view: "inventory", provider: "codex", kind }}
        />,
      );
      expect(html).toContain("kind=instruction");
      // Still only a rail link — the body stays on the selected kind.
      expect(html).not.toContain("# Codex instructions");
    }
  });

  test("keeps the Instructions rail entry under a status filter", () => {
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={inventories}
        filters={{ view: "inventory", provider: "codex", status: "enabled" }}
      />,
    );
    expect(html).toContain("kind=instruction");
  });

  test("opens the instruction pane even when filters match no capabilities", () => {
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={inventories}
        filters={{
          view: "inventory",
          provider: "codex",
          kind: "instruction",
          q: "zzz-no-such-capability",
        }}
      />,
    );
    expect(html).toContain("# Codex instructions");
    expect(html).not.toContain("No capabilities match these filters.");
  });

  test("still shows the empty state when nothing matches and instructions are not selected", () => {
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={inventories}
        filters={{
          view: "inventory",
          provider: "codex",
          q: "zzz-no-such-capability",
        }}
      />,
    );
    expect(html).toContain("No capabilities match these filters.");
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

    // The rail shows one kind per render, so verify the semantic source order
    // within each kind pane: Standalone → Built-in → Personal, then name.
    const pluginHtml = renderToStaticMarkup(
      <AgentSetupView
        inventories={[unsortedInventory]}
        filters={{ view: "inventory", kind: "plugin" }}
      />,
    );
    const pluginOrder = [
      "plugin-unknown",
      "plugin-built-in",
      "a-plugin-personal",
      "z-plugin-personal",
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

  test("keeps type icons in the rail and source labels in catalog rows", () => {
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
    expect(html).toContain("Personal skills");
    expect(html).toContain('<span class="agent-row-source">Personal</span>');
    expect(html).not.toContain("agent-catalog-row .agent-kind-label");
  });

  test("shows compact status tags in inventory rows", () => {
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

    // Disabled capabilities remain hidden, while active and unavailable rows
    // expose status in the aligned status column.
    expect(html).toContain("<strong>enabled-example</strong>");
    expect(html).toContain(">Enabled</span>");
    expect(html).toContain(">Unavailable</span>");
    expect(html).not.toContain("disabled-example");
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

    // Summary contains the plugin name, member count, source, and status.
    expect(html).toContain(
      "<strong>superpowers@claude-plugins-official</strong>",
    );
    expect(html).toContain("3 skills");
    expect(html).toContain("Plugin-provided skills");
    expect(html).toContain(">Enabled</span>");
    expect(html).toContain('<details class="agent-plugin-group">');

    // Member rows are nested inside the group body container.
    const groupStart = html.indexOf('class="agent-plugin-group"');
    const membersStart = html.indexOf(
      'class="agent-plugin-group-members"',
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
      html.match(/<details class="agent-plugin-group">/g) ?? []
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
      'class="agent-plugin-group-members"',
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
      'class="agent-plugin-group-members"',
      openaiGroupStart,
    );
    const openaiMembersEnd = html.indexOf("</details>", openaiMembersStart);
    const openaiBody = html.slice(openaiMembersStart, openaiMembersEnd);
    expect(openaiBody).toContain("<strong>banana</strong>");
    expect(openaiBody).toContain("<strong>date</strong>");
    expect(openaiBody).not.toContain("<strong>apple</strong>");
    expect(openaiBody).not.toContain("<strong>cherry</strong>");
  });

  test("inventory keeps single-skill plugins as collapsible parents", () => {
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

    expect(html).toContain('<details class="agent-plugin-group">');
    expect(html).toContain("1 skill");
    expect(html).toContain("<strong>only-one</strong>");
  });

  test("inventory lists managed skills directly with their repository source", () => {
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

    expect(html).toContain("Marketplace skills");
    expect(html.match(/vercel-labs\/skills/g)).toHaveLength(2);
    expect(html).not.toContain("agent-plugin-group");
  });

  test("inventory plugin summary reports the conservative overall status", () => {
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
    expect(html).toContain(">Installed</span>");
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

    expect(html).not.toContain("agent-plugin-group");
    expect(html).toContain("<strong>personal-1</strong>");
    expect(html).toContain("<strong>unknown-2</strong>");
  });

  test("inventory keeps the plugin parent when search narrows it to one skill", () => {
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

    // The plugin remains the management unit even with one matching child.
    expect(html).toContain('<details class="agent-plugin-group">');
    expect(html).toContain("1 skill");
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

    // The rail renders one kind at a time; only Skills use plugin parents.
    const pluginHtml = renderToStaticMarkup(
      <AgentSetupView
        inventories={[inventory]}
        filters={{ view: "inventory", kind: "plugin" }}
      />,
    );
    expect(pluginHtml).not.toContain("agent-plugin-group");
    expect(pluginHtml).toContain("<strong>plugin-1</strong>");
    expect(pluginHtml).toContain("<strong>plugin-2</strong>");

    const mcpHtml = renderToStaticMarkup(
      <AgentSetupView
        inventories={[inventory]}
        filters={{ view: "inventory", kind: "mcp" }}
      />,
    );
    expect(mcpHtml).not.toContain("agent-plugin-group");
    expect(mcpHtml).toContain("<strong>mcp-1</strong>");
    expect(mcpHtml).toContain("<strong>mcp-2</strong>");
  });

  test("inventory sorts plugin parents by name", () => {
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

    // Both installs remain plugin parents; alphabetical order keeps scanning
    // deterministic regardless of child count.
    const zetaGroupPosition = html.indexOf("zeta-bundle@mp");
    const alphaGroupPosition = html.indexOf("alpha-singleton@mp");
    expect(zetaGroupPosition).toBeGreaterThanOrEqual(0);
    expect(alphaGroupPosition).toBeGreaterThanOrEqual(0);
    expect(alphaGroupPosition).toBeLessThan(zetaGroupPosition);
    expect(html.match(/<details class="agent-plugin-group">/g)).toHaveLength(2);
  });

  test("inventory shows safe locations and flags duplicate-name skills", () => {
    // Every row has a useful location column; same-name installs additionally
    // carry duplicate context. HOME is stubbed for deterministic shortening.
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

      expect(html).toContain("<code>~/.agents/skills/ai-sdk</code>");
      expect(html).toContain(
        "<code>~/.codex/plugins/cache/openai-curated/vercel/skills/ai-sdk</code>",
      );
      expect(html).toContain("<code>~/.agents/skills/unique-skill</code>");
      expect(html.match(/agent-duplicate-inline/g)).toHaveLength(2);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("inventory does not flag cross-kind name collisions as duplicates", () => {
    // "github" exists as both a plugin and an MCP — two capabilities sharing a
    // name, but unique within each kind's pane. The path hint must fire only
    // for same-pane collisions, so neither pane should show it.
    vi.stubEnv("HOME", "/Users/example");
    try {
      const inventory: AgentInventory = {
        provider: "codex",
        scope: "global",
        capabilities: [
          skill("codex", "github", {
            kind: "plugin",
            status: "enabled",
            origin: "marketplace",
            sourcePlugin: "github@openai-curated",
            sourceRepository: "openai-curated",
            sourcePath: "/Users/example/.codex/plugins/cache/github",
          }),
          skill("codex", "github", {
            id: "codex:mcp:github",
            kind: "mcp",
            status: "enabled",
            origin: "marketplace",
            sourcePlugin: "github@openai-curated",
            sourceRepository: "openai-curated",
            sourcePath: "/Users/example/.codex/plugins/cache/github/mcp",
          }),
        ],
        warnings: [],
      };

      const pluginHtml = renderToStaticMarkup(
        <AgentSetupView
          inventories={[inventory]}
          filters={{ view: "inventory", kind: "plugin" }}
        />,
      );
      const mcpHtml = renderToStaticMarkup(
        <AgentSetupView
          inventories={[inventory]}
          filters={{ view: "inventory", kind: "mcp" }}
        />,
      );

      expect(pluginHtml).toContain("<strong>github</strong>");
      expect(pluginHtml).not.toContain("agent-duplicate-inline");
      expect(mcpHtml).toContain("<strong>github</strong>");
      expect(mcpHtml).not.toContain("agent-duplicate-inline");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("Scheduled tasks view", () => {
  const taskInventories: AgentInventory[] = [
    {
      provider: "codex",
      scope: "global",
      capabilities: [],
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
        {
          id: "nightly-cleanup",
          name: "Nightly cleanup",
          provider: "codex",
          scheduleRaw: "FREQ=DAILY;BYHOUR=2",
          scheduleHuman: "Daily at 02:00",
          scheduleMissing: false,
          status: "active",
          instructionFormat: "toml_prompt",
          sourcePath: "/safe/.codex/automations/cleanup/automation.toml",
          warnings: [],
        },
      ],
      warnings: [],
    },
    {
      provider: "claude",
      scope: "global",
      capabilities: [],
      scheduledTasks: [
        {
          id: "paused-monthly",
          name: "Monthly report",
          provider: "claude",
          scheduleRaw: "FREQ=MONTHLY;BYMONTHDAY=1",
          scheduleHuman: "Monthly on day 1 at 00:00",
          scheduleMissing: false,
          status: "paused",
          instructionFormat: "skill_md",
          sourcePath: "/safe/.claude/scheduled-tasks/report",
          warnings: [],
        },
      ],
      warnings: [],
    },
    {
      provider: "pi",
      scope: "global",
      capabilities: [],
      warnings: [],
    },
  ];

  test("renders the tab and task rows in a single table", () => {
    const { container } = render(
      <AgentSetupView
        inventories={taskInventories}
        filters={parseAgentSetupFilters({ view: "tasks" })}
      />,
    );
    expect(screen.getByRole("link", { name: "Scheduled tasks" })).toBeDefined();
    // No count summary line (removed); tasks render directly in the table.
    expect(container.textContent).not.toMatch(
      /\d+ scheduled tasks? across agents\./,
    );
    // Task names and schedules render in the table.
    screen.getByText("Weekly digest");
    screen.getByText("Mondays at 08:00");
    screen.getByText("Nightly cleanup");
    screen.getByText("Daily at 02:00");
    screen.getByText("Monthly report");
  });

  test("replaces provider cards with scheduled task health context", () => {
    const { container } = render(
      <AgentSetupView
        inventories={taskInventories}
        filters={parseAgentSetupFilters({ view: "tasks" })}
      />,
    );
    expect(container.querySelector(".agent-summary-grid")).toBeNull();
    const summary = screen.getByLabelText("Scheduled tasks summary");
    expect(summary.textContent).toContain("3 tasks");
    expect(summary.textContent).toContain("2 active");
    expect(summary.textContent).toContain("1 paused or disabled");
    expect(summary.textContent).toContain("0 targets missing");
  });

  test("presents task health as a structured view-level summary before filters", () => {
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={taskInventories}
        filters={parseAgentSetupFilters({ view: "tasks" })}
      />,
    );
    const tabsIndex = html.indexOf('aria-label="Agent setup view"');
    const summaryIndex = html.indexOf('aria-label="Scheduled tasks summary"');
    const filterIndex = html.indexOf("<form");
    expect(tabsIndex).toBeGreaterThanOrEqual(0);
    expect(summaryIndex).toBeGreaterThan(tabsIndex);
    expect(summaryIndex).toBeLessThan(filterIndex);

    render(
      <AgentSetupView
        inventories={taskInventories}
        filters={parseAgentSetupFilters({ view: "tasks" })}
      />,
    );
    const summary = screen.getByLabelText("Scheduled tasks summary");
    const metrics = summary.querySelector('[aria-label="Task health metrics"]');
    expect(metrics?.tagName).toBe("UL");
    expect(metrics?.querySelectorAll("li")).toHaveLength(4);
    expect(metrics?.querySelector("strong")?.textContent).toBe("3");
  });

  test("sorts by cadence: active daily before active weekly before paused", () => {
    render(
      <AgentSetupView
        inventories={taskInventories}
        filters={parseAgentSetupFilters({ view: "tasks" })}
      />,
    );
    // The task-name cells are <strong> elements; collect them in DOM order.
    const taskNames = Array.from(
      document.querySelectorAll(".agent-task-name"),
    ).map((el) => el.textContent);
    expect(taskNames).toEqual([
      "Nightly cleanup",
      "Weekly digest",
      "Monthly report",
    ]);
  });

  test("does not render per-provider provenance labels or Pi empty card", () => {
    const { container } = render(
      <AgentSetupView
        inventories={taskInventories}
        filters={parseAgentSetupFilters({ view: "tasks" })}
      />,
    );
    expect(container.textContent).not.toMatch(
      /Pi does not expose scheduled tasks/i,
    );
    expect(container.textContent).not.toMatch(/Read from ~\/\.codex/i);
  });

  test("uses exclusive accordion — details share one name", () => {
    render(
      <AgentSetupView
        inventories={taskInventories}
        filters={parseAgentSetupFilters({ view: "tasks" })}
      />,
    );
    const details = document.querySelectorAll("details.agent-task-row");
    expect(details.length).toBe(3);
    const names = new Set(
      Array.from(details).map((d) => d.getAttribute("name")),
    );
    expect(names.size).toBe(1);
  });

  test("shows model and instruction body inside detail", () => {
    const { container } = render(
      <AgentSetupView
        inventories={taskInventories}
        filters={parseAgentSetupFilters({ view: "tasks" })}
      />,
    );
    // jsdom renders <details> body content even when collapsed.
    expect(container.textContent).toContain("gpt-5.5");
    expect(container.textContent).toContain("Summarize the week.");
  });

  test("shows the resolved target project inside detail", () => {
    const withProject: AgentInventory[] = [
      {
        provider: "codex",
        scope: "global",
        capabilities: [],
        scheduledTasks: [
          {
            ...taskInventories[0].scheduledTasks![0],
            targetProject: "local-abc123",
            targetProjectName: "personal-site",
          },
        ],
        warnings: [],
      },
    ];
    const { container } = render(
      <AgentSetupView
        inventories={withProject}
        filters={parseAgentSetupFilters({ view: "tasks" })}
      />,
    );
    expect(container.textContent).toContain("personal-site");
    expect(document.querySelector(".agent-task-flag")).toBeNull();
  });

  test("flags a task whose target project no longer exists", () => {
    const orphaned: AgentInventory[] = [
      {
        provider: "codex",
        scope: "global",
        capabilities: [],
        scheduledTasks: [
          {
            ...taskInventories[0].scheduledTasks![0],
            targetProject: "edec41f7",
            warnings: [
              {
                sourcePath:
                  "/safe/.codex/automations/weekly-digest/automation.toml",
                code: "orphaned",
                message:
                  "Targets a project this agent no longer lists (edec41f7). The task still runs, but the agent cannot open it for editing.",
              },
            ],
          },
        ],
        warnings: [],
      },
    ];
    const { container } = render(
      <AgentSetupView
        inventories={orphaned}
        filters={parseAgentSetupFilters({ view: "tasks" })}
      />,
    );
    // Visible without expanding the row.
    expect(document.querySelector(".agent-task-flag")?.textContent).toBe(
      "Target missing",
    );
    // The reason and the unresolved id both render in the detail.
    expect(container.textContent).toContain(
      "Targets a project this agent no longer lists (edec41f7)",
    );
  });

  test("shows zero-state message when no tasks exist", () => {
    const empty: AgentInventory[] = [
      {
        provider: "codex",
        scope: "global",
        capabilities: [],
        scheduledTasks: [],
        warnings: [],
      },
    ];
    render(
      <AgentSetupView
        inventories={empty}
        filters={parseAgentSetupFilters({ view: "tasks" })}
      />,
    );
    screen.getByText("No scheduled tasks found across agents.");
  });
});

describe("parseAgentSetupFilters (tasks view)", () => {
  test("accepts view=tasks and defaults unknowns to inventory", () => {
    expect(parseAgentSetupFilters({ view: "tasks" }).view).toBe("tasks");
    expect(parseAgentSetupFilters({}).view).toBe("inventory");
    expect(parseAgentSetupFilters({ view: "unknown" }).view).toBe("inventory");
  });
});
