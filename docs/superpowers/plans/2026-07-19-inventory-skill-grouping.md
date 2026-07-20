# Inventory Skill Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cluster multi-skill plugin and skills.sh sources into collapsed `<details>` groups in the `/agents` inventory view; single-skill sources and personal/built_in/unknown skills stay flat.

**Architecture:** A new pure helper `skillGroupKey(capability)` derives an optional group key for skills. `ProviderInventory` walks its already-sorted capability list, builds an ordered list of `{ row | group }` render items, and a new `CapabilityGroup` component renders each multi-skill group as a closed `<details>`. No data-model or URL changes.

**Tech Stack:** Next.js (App Router, server components), React, TypeScript, Vitest + @testing-library/react, CSS modules via `globals.css` semantic tokens.

**Spec:** `docs/superpowers/specs/2026-07-19-inventory-skill-grouping-design.md`

## Global Constraints

- Workspace rule: New UI must use semantic tokens and component classes from `src/app/globals.css`; do not introduce raw Tailwind palette colors, arbitrary values, inline styles, or `dark:` variants.
- Capability origin union: `"personal" | "skills_sh" | "marketplace" | "built_in" | "unknown"`. Capability kind union: `"plugin" | "skill" | "mcp"`. Capability status union: `"enabled" | "disabled" | "installed" | "unavailable"`.
- Inventory tests use `renderToStaticMarkup` from `react-dom/server`, which renders `<details>` closed by default.
- `npm run format:check`, `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build` must all pass before finishing. Use `npm run format` to fix prettier violations.

---

## File Structure

- Modify: `src/components/agent-setup-view.tsx` — add `skillGroupKey`, `SkillGroupSummary` type, `summarizeSkillGroup`, `CapabilityGroup` component; change `ProviderInventory` to consume grouped render items.
- Modify: `src/app/globals.css` — `.agent-capability-group`, `.agent-capability-group > summary`, `.agent-capability-group-members` styles next to `.agent-capability-row` (around line 1702).
- Modify: `src/components/agent-setup-view.test.tsx` — add 7 new test cases.

---

## Task 1: Add `skillGroupKey` helper and test

**Files:**

- Modify: `src/components/agent-setup-view.tsx` (add helper near `compareInventoryCapabilities`, ~line 216)
- Test: `src/components/agent-setup-view.test.tsx`

**Interfaces:**

- Produces: `skillGroupKey(capability: AgentCapability): string | undefined`

The helper encodes the rules:

```ts
/**
 * The optional group key for a capability in the inventory view. Skills
 * cluster under their contributing plugin (marketplace + sourcePlugin) or
 * skills.sh repository (skills_sh + sourceRepository); everything else —
 * plugins, MCPs, and personal/built_in/unknown-origin skills — returns
 * undefined and renders flat.
 */
function skillGroupKey(capability: AgentCapability): string | undefined {
  if (capability.kind !== "skill") return undefined;
  if (capability.origin === "marketplace" && capability.sourcePlugin) {
    return `plugin:${capability.sourcePlugin}`;
  }
  if (capability.origin === "skills_sh" && capability.sourceRepository) {
    return `skillssh:${capability.sourceRepository}`;
  }
  return undefined;
}
```

- [ ] **Step 1: Add the helper to `agent-setup-view.tsx`**

Insert immediately after `compareInventoryCapabilities` (currently ends at line 216):

```ts
/**
 * The optional group key for a capability in the inventory view. Skills
 * cluster under their contributing plugin (marketplace + sourcePlugin) or
 * skills.sh repository (skills_sh + sourceRepository); everything else —
 * plugins, MCPs, and personal/built_in/unknown-origin skills — returns
 * undefined and renders flat.
 */
function skillGroupKey(capability: AgentCapability): string | undefined {
  if (capability.kind !== "skill") return undefined;
  if (capability.origin === "marketplace" && capability.sourcePlugin) {
    return `plugin:${capability.sourcePlugin}`;
  }
  if (capability.origin === "skills_sh" && capability.sourceRepository) {
    return `skillssh:${capability.sourceRepository}`;
  }
  return undefined;
}
```

To make the helper testable without exporting it from the public module surface, export a tiny test-only helper alongside the existing exports near the bottom of the file:

```ts
// Exported for unit testing only; not part of the public component API.
export const __test = { skillGroupKey };
```

- [ ] **Step 2: Add tests for the helper**

Append a new `describe` block at the end of `agent-setup-view.test.tsx`:

```ts
describe("skillGroupKey", () => {
  const { skillGroupKey } = __test;

  test("returns undefined for plugins", () => {
    expect(
      skillGroupKey(
        skill("codex", "p", {
          kind: "plugin",
          status: "enabled",
          origin: "marketplace",
          sourcePlugin: "superpowers@mp",
        }),
      ),
    ).toBeUndefined();
  });

  test("returns undefined for MCPs", () => {
    expect(
      skillGroupKey(
        skill("codex", "m", {
          kind: "mcp",
          status: "enabled",
          origin: "marketplace",
          sourcePlugin: "superpowers@mp",
        }),
      ),
    ).toBeUndefined();
  });

  test("keys marketplace skills by sourcePlugin", () => {
    expect(
      skillGroupKey(
        skill("codex", "s", {
          origin: "marketplace",
          packaging: "plugin",
          sourcePlugin: "superpowers@claude-plugins-official",
          sourceRepository: "claude-plugins-official",
        }),
      ),
    ).toBe("plugin:superpowers@claude-plugins-official");
  });

  test("keys skills.sh skills by sourceRepository", () => {
    expect(
      skillGroupKey(
        skill("codex", "s", {
          origin: "skills_sh",
          sourceRepository: "vercel-labs/agent-browser",
        }),
      ),
    ).toBe("skillssh:vercel-labs/agent-browser");
  });

  test("returns undefined for marketplace skills without sourcePlugin", () => {
    expect(
      skillGroupKey(
        skill("codex", "s", {
          origin: "marketplace",
          sourceRepository: "some-marketplace",
        }),
      ),
    ).toBeUndefined();
  });

  test("returns undefined for personal skills", () => {
    expect(
      skillGroupKey(skill("codex", "s", { origin: "personal" })),
    ).toBeUndefined();
  });

  test("returns undefined for built_in skills", () => {
    expect(
      skillGroupKey(
        skill("codex", "s", { origin: "built_in", packaging: "built_in" }),
      ),
    ).toBeUndefined();
  });

  test("returns undefined for unknown-origin skills", () => {
    expect(
      skillGroupKey(skill("codex", "s", { origin: "unknown" })),
    ).toBeUndefined();
  });
});
```

Add to the import at the top of the test file:

```ts
import {
  AgentSetupView,
  parseAgentSetupFilters,
  __test,
} from "./agent-setup-view";
```

- [ ] **Step 3: Run tests**

Run: `npm test -- agent-setup-view`
Expected: all existing tests pass, plus 8 new tests in the `skillGroupKey` block pass.

- [ ] **Step 4: Run typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/agent-setup-view.tsx src/components/agent-setup-view.test.tsx
git commit -m "✨ feat(agents): add skillGroupKey helper for inventory grouping"
```

---

## Task 2: Add `SkillGroupSummary` type and `summarizeSkillGroup` helper

**Files:**

- Modify: `src/components/agent-setup-view.tsx`

**Interfaces:**

- Consumes: `skillGroupKey` from Task 1.
- Produces: `SkillGroupSummary` type, `summarizeSkillGroup` function.

- [ ] **Step 1: Add type and helper just below `skillGroupKey`**

```ts
interface SkillGroupSummary {
  key: string;
  kind: "plugin" | "skills_sh";
  name: string;
  memberCount: number;
  origin: "marketplace" | "skills_sh";
  statusAggregate:
    | { kind: "uniform"; status: CapabilityStatus }
    | { kind: "mixed"; notEnabledCount: number };
}

/**
 * Build the summary that `CapabilityGroup` renders in its <summary>. Members
 * must share a group key (caller's responsibility). Name, origin, and kind
 * are derived from the first member; status is aggregated across all
 * members so the summary stays informative when the group is collapsed.
 */
function summarizeSkillGroup(members: AgentCapability[]): SkillGroupSummary {
  const first = members[0]!;
  const key = skillGroupKey(first)!;
  const statuses = new Set(members.map((m) => m.status));
  const statusAggregate: SkillGroupSummary["statusAggregate"] =
    statuses.size === 1
      ? { kind: "uniform", status: members[0]!.status }
      : {
          kind: "mixed",
          notEnabledCount: members.filter((m) => m.status !== "enabled").length,
        };
  if (first.origin === "marketplace" && first.sourcePlugin) {
    return {
      key,
      kind: "plugin",
      name: first.sourcePlugin,
      memberCount: members.length,
      origin: "marketplace",
      statusAggregate,
    };
  }
  return {
    key,
    kind: "skills_sh",
    name: first.sourceRepository!,
    memberCount: members.length,
    origin: "skills_sh",
    statusAggregate,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit (optional — can fold into Task 3)**

This is a small helper that only Task 3 will use. Skipping its own commit is fine; bundle with Task 3.

---

## Task 3: Add `CapabilityGroup` component and grouped rendering in `ProviderInventory`

**Files:**

- Modify: `src/components/agent-setup-view.tsx`

**Interfaces:**

- Consumes: `skillGroupKey`, `summarizeSkillGroup`, `SkillGroupSummary`.
- Produces: `CapabilityGroup` React component; updated `ProviderInventory` that emits grouped render items.

- [ ] **Step 1: Add the grouped render-item builder**

Replace the existing capabilities rendering in `ProviderInventory` (currently lines 488–490 and 525–531):

Current code at lines 488–490:

```ts
const capabilities = inventory.capabilities
  .filter((capability) => matchesCapability(capability, filters))
  .sort(compareInventoryCapabilities);
```

Add a grouping pass right after the sort. Define `InventoryItem` near the top of the file with the other types/helpers (e.g. just above `ProviderInventory`):

```ts
type InventoryItem =
  | { kind: "row"; capability: AgentCapability }
  | { kind: "group"; summary: SkillGroupSummary; members: AgentCapability[] };

/**
 * Walk the sorted capability list and emit render items, collapsing runs of
 * two or more consecutive same-key skills into a single group item. Runs of
 * fewer than two (including all non-skill capabilities) emit one row item
 * each so single-skill plugins and personal/built_in/unknown skills render
 * flat.
 */
function buildInventoryItems(capabilities: AgentCapability[]): InventoryItem[] {
  const items: InventoryItem[] = [];
  let currentKey: string | undefined;
  let pending: AgentCapability[] = [];
  const flush = () => {
    if (pending.length === 0) return;
    if (currentKey === undefined || pending.length < 2) {
      for (const capability of pending) {
        items.push({ kind: "row", capability });
      }
    } else {
      items.push({
        kind: "group",
        summary: summarizeSkillGroup(pending),
        members: pending,
      });
    }
    pending = [];
  };
  for (const capability of capabilities) {
    const key = skillGroupKey(capability);
    if (key === currentKey) {
      pending.push(capability);
    } else {
      flush();
      pending = [capability];
      currentKey = key;
    }
  }
  flush();
  return items;
}
```

Then change `ProviderInventory` to consume it:

```ts
const capabilities = inventory.capabilities
  .filter((capability) => matchesCapability(capability, filters))
  .sort(compareInventoryCapabilities);
const items = buildInventoryItems(capabilities);
```

Note: the `inventory.capabilities.length`-based header count ("N shown") should still reflect the _filtered_ count, not the item count, because items collapse rows. Use `capabilities.length` (unchanged).

- [ ] **Step 2: Replace the render loop**

Replace this block in `ProviderInventory` (currently lines 525–531):

```tsx
{
  capabilities.length > 0 ? (
    <div className="agent-capability-list">
      {capabilities.map((capability) => (
        <CapabilityRow key={capability.id} capability={capability} />
      ))}
    </div>
  ) : null;
}
```

With:

```tsx
{
  items.length > 0 ? (
    <div className="agent-capability-list">
      {items.map((item) =>
        item.kind === "row" ? (
          <CapabilityRow
            key={`row:${item.capability.id}`}
            capability={item.capability}
          />
        ) : (
          <CapabilityGroup
            key={`group:${item.summary.key}`}
            summary={item.summary}
            members={item.members}
          />
        ),
      )}
    </div>
  ) : null;
}
```

- [ ] **Step 3: Add the `CapabilityGroup` component**

Add immediately below `CapabilityRow` (currently ends at line 580):

```tsx
function CapabilityGroup({
  summary,
  members,
}: {
  summary: SkillGroupSummary;
  members: AgentCapability[];
}) {
  const GroupIcon = summary.kind === "plugin" ? Plug : WandSparkles;
  const statusText =
    summary.statusAggregate.kind === "uniform"
      ? statusLabels[summary.statusAggregate.status]
      : `Mixed · ${summary.statusAggregate.notEnabledCount} not enabled`;
  const statusClass =
    summary.statusAggregate.kind === "uniform"
      ? statusBadges[summary.statusAggregate.status]
      : "badge-4";

  return (
    <details className="agent-capability-group">
      <summary>
        <GroupIcon aria-hidden="true" size={14} />
        <strong>{summary.name}</strong>
        <span>{countLabel(summary.memberCount, "skill")}</span>
        <span
          className={`badge ${originBadges[summary.origin]} agent-origin-tag`}
        >
          {originLabels[summary.origin]}
        </span>
        <span className={`agent-status-tag ${statusClass}`}>{statusText}</span>
      </summary>
      <div className="agent-capability-group-members">
        {members.map((capability) => (
          <CapabilityRow key={capability.id} capability={capability} />
        ))}
      </div>
    </details>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- agent-setup-view`
Expected: existing inventory tests pass. Existing comparison tests pass. The new `skillGroupKey` tests pass. No grouping tests yet (those come in Task 5).

- [ ] **Step 5: Run typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/agent-setup-view.tsx
git commit -m "✨ feat(agents): group multi-skill sources in inventory view"
```

---

## Task 4: Add CSS for `.agent-capability-group` and member rows

**Files:**

- Modify: `src/app/globals.css` (insert after `.agent-capability-row` rules, around line 1745)

- [ ] **Step 1: Add the group styles**

Insert immediately after the `.agent-kind-instruction svg { ... }` block (currently ends at line 1767), before `.status-disabled, .status-unavailable`:

```css
.agent-capability-group {
  border-top: 1px solid var(--border);
}
.agent-capability-group + .agent-capability-row,
.agent-capability-group + .agent-capability-group,
.agent-capability-row + .agent-capability-group {
  border-top: 1px solid var(--border);
}
.agent-capability-group > summary {
  list-style: none;
  display: grid;
  grid-template-columns:
    minmax(12rem, 1.8fr) minmax(4.5rem, 0.55fr) minmax(7rem, 0.75fr)
    minmax(6rem, 0.65fr);
  align-items: center;
  gap: 0.7rem;
  min-height: 3.8rem;
  padding: 0.65rem 0.9rem;
  cursor: pointer;
}
.agent-capability-group > summary::-webkit-details-marker {
  display: none;
}
.agent-capability-group > summary::before {
  content: "›";
  display: inline-block;
  width: 1rem;
  color: var(--muted-foreground);
  font-size: var(--text-lg);
  line-height: 1;
  transform: rotate(0deg);
  transition: transform var(--transition-fast, 0.15s) ease-in-out;
}
.agent-capability-group[open] > summary::before {
  transform: rotate(90deg);
}
.agent-capability-group > summary:hover {
  background: var(--card-hover);
}
.agent-capability-group > summary > strong {
  font-size: var(--text-sm);
}
.agent-capability-group > summary > span {
  color: var(--muted-foreground);
  font-size: var(--text-xs);
}
.agent-capability-group > summary > .agent-origin-tag,
.agent-capability-group > summary > .agent-status-tag {
  font-size: var(--text-xs);
}
.agent-capability-group-members {
  padding-inline-start: 1.5rem;
  border-inline-start: 0.125rem solid var(--border);
  margin-inline-start: 0.9rem;
}
.agent-capability-group-members > .agent-capability-row {
  border-top: 1px solid var(--border);
}
.agent-capability-group-members > .agent-capability-row:first-child {
  border-top: none;
}
```

Note on the grid template: `CapabilityRow` uses five columns; the summary uses four because it folds the icon into the first cell alongside the name (no separate kind label column — the kind is implied by the group). Verify column alignment visually after Task 5; if the summary's name cell doesn't align with flat rows' name cell, add a leading 1rem column for the chevron and shift subsequent columns.

- [ ] **Step 2: Add mobile responsive overrides**

At the existing mobile breakpoint near line 2091 (where `.agent-capability-row` already has overrides), add matching overrides. First, read lines 2080–2130 of `globals.css` to find the exact media query block, then add inside it:

```css
.agent-capability-group > summary {
  grid-template-columns: minmax(10rem, 1.8fr) minmax(6rem, 0.75fr);
}
.agent-capability-group > summary > :nth-child(n + 3) {
  grid-column: 1 / -1;
}
```

Mirror whatever pattern the existing `.agent-capability-row` mobile overrides use. If the breakpoint at 2091 uses a different column count, match it.

- [ ] **Step 3: Run the build**

Run: `npm run build`
Expected: clean build. PostCSS/Tailwind will not complain about unknown classes since these are plain CSS.

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css
git commit -m "🎨 style(agents): collapse multi-skill groups with disclosure summary"
```

---

## Task 5: Add tests for grouped rendering

**Files:**

- Modify: `src/components/agent-setup-view.test.tsx`

**Interfaces:**

- Consumes: `AgentSetupView` with `filters.view === "inventory"`.

The strategy: render via `renderToStaticMarkup` (so `<details>` is closed), then assert:

- Summary content (group name, count, origin, status) is in the HTML.
- Member rows exist in the HTML but only inside the `<details>` body (we slice the HTML from the summary to the closing `</details>`).

- [ ] **Step 1: Add a multi-skill plugin grouping test**

Append inside the `describe("AgentSetupView", ...)` block:

```ts
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

    // Summary contains the plugin name, member count, origin, and status.
    expect(html).toContain(
      '<strong>superpowers@claude-plugins-official</strong>',
    );
    expect(html).toContain("3 skills");
    expect(html).toContain(
      '<span class="badge badge-3 agent-origin-tag">Marketplace</span>',
    );
    expect(html).toContain(
      '<span class="agent-status-tag badge-1">Enabled</span>',
    );
    // The summary is a closed <details>.
    expect(html).toContain('<details class="agent-capability-group">');

    // Members are present in the body but not as direct flat rows.
    expect(html).toContain('<strong>alpha</strong>');
    expect(html).toContain('<strong>beta</strong>');
    expect(html).toContain('<strong>gamma</strong>');

    // Member rows are nested inside the group body container.
    const groupStart = html.indexOf('class="agent-capability-group"');
    const membersStart = html.indexOf(
      'class="agent-capability-group-members"',
      groupStart,
    );
    expect(membersStart).toBeGreaterThan(groupStart);
    expect(html.indexOf("<strong>alpha</strong>", membersStart)).toBeGreaterThan(
      membersStart,
    );
  });
```

- [ ] **Step 2: Add a single-skill plugin flatness test**

```ts
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
```

- [ ] **Step 3: Add a skills.sh grouping test**

```ts
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
```

- [ ] **Step 4: Add a mixed-status aggregate test**

```ts
  test("inventory summary aggregates mixed member statuses", () => {
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
        skill("codex", "gamma", {
          origin: "marketplace",
          packaging: "plugin",
          sourcePlugin: "superpowers@claude-plugins-official",
          status: "disabled",
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

    expect(html).toContain("Mixed · 1 not enabled");
  });
```

- [ ] **Step 5: Add a personal/built_in/unknown flatness test**

```ts
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
```

- [ ] **Step 6: Add a filter-narrowing test**

```ts
  test("inventory collapses a group below threshold when a search filter narrows it", () => {
    const groupedInventory: AgentInventory = {
      provider: "codex",
      scope: "global",
      capabilities: [
        skill("codex", "alpha", {
          name: "alpha-skill",
          origin: "marketplace",
          packaging: "plugin",
          sourcePlugin: "superpowers@claude-plugins-official",
          status: "enabled",
        } as Partial<AgentCapability>),
        skill("codex", "beta", {
          name: "beta-skill",
          origin: "marketplace",
          packaging: "plugin",
          sourcePlugin: "superpowers@claude-plugins-official",
          status: "enabled",
        } as Partial<AgentCapability>),
      ].map((c) => ({ ...c, name: c.name })) as AgentCapability[],
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
  });
```

Note: The test factory `skill(provider, name, overrides)` uses `name` as both the id key and the display name. To keep the display name controllable for the search filter, the override object spreads last, so `name: "alpha-skill"` in overrides wins. Simplify the test if that's how the existing factory behaves — re-read the factory at lines 9–24 of the test file before finalizing.

- [ ] **Step 7: Add a plugins/MCPs never-group test**

```ts
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
    const html = renderToStaticMarkup(
      <AgentSetupView
        inventories={[inventory]}
        filters={{ view: "inventory" }}
      />,
    );

    expect(html).not.toContain("agent-capability-group");
    expect(html).toContain("<strong>plugin-1</strong>");
    expect(html).toContain("<strong>mcp-2</strong>");
  });
```

- [ ] **Step 8: Run the full test suite**

Run: `npm test -- agent-setup-view`
Expected: all 7 new tests pass, all existing tests still pass.

If the existing "sorts inventory capabilities by type, source, then name" test fails because grouping moved capabilities around: re-read it. That test uses only personal-origin capabilities, so `skillGroupKey` returns `undefined` for all of them, no grouping occurs, and it should still pass. Investigate any actual failure rather than weakening the assertion.

- [ ] **Step 9: Commit**

```bash
git add src/components/agent-setup-view.test.tsx
git commit -m "✅ test(agents): cover inventory skill grouping behaviors"
```

---

## Task 6: Full verification and documentation sweep

**Files:**

- Verify: all checks pass.
- Modify: `README.md` if it documents the `/agents` inventory UI in detail.

- [ ] **Step 1: Run format**

Run: `npm run format`
Expected: any prettier violations fixed. Then `npm run format:check` passes.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Run build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 6: Review README.md and AGENTS.md**

Search `README.md` for `/agents` or "inventory" mentions. If the README describes the inventory view's row layout in detail, add a one-line note about grouping. The `/agents` page is described in `AGENTS.md` under the inventory paragraph ("Global agent setup inventory lives under `src/lib/agent-inventory/`..."). The change is presentation-only within the existing surface and doesn't change what the inventory _reads_; no `AGENTS.md` update is required. If README mentions row layout, update it.

- [ ] **Step 7: Final commit (if docs changed)**

```bash
git add README.md  # only if it changed
git commit -m "📝 docs(agents): note inventory skill grouping"
```

---

## Self-Review Notes

**Spec coverage:**

- Group key rules → Task 1.
- Group threshold (≥2) → Task 3 (`buildInventoryItems` flush rules).
- Group summary content → Task 2 (`summarizeSkillGroup`) and Task 3 (`CapabilityGroup`).
- Filter interaction → Task 3 (filter runs before grouping in `ProviderInventory`), tested in Task 5 Step 6.
- CSS for group + members → Task 4.
- Tests for all 7 cases → Task 5.
- Plugins/MCPs never group → Task 1 (helper returns undefined), Task 5 Step 7.

**Placeholder scan:** None.

**Type consistency:** `SkillGroupSummary` defined in Task 2, consumed in Task 3. `InventoryItem` defined and produced in Task 3. `skillGroupKey` produced in Task 1, consumed in Task 2 (`summarizeSkillGroup`) and Task 3 (`buildInventoryItems`). All signatures match.
