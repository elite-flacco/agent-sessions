# Inventory Kind + Source Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nest the `/agents` inventory view as Kind → Source → repo/plugin so the type and origin badges are stated once per group instead of on every row.

**Architecture:** Refactor `ProviderInventory` in `src/components/agent-setup-view.tsx`. After the existing filter+sort, partition capabilities by `kind` into open-by-default `KindBucket` collapsibles, then by `origin` into collapsed `SourceGroup` collapsibles, then run the existing `buildInventoryItems` within each source group to produce the current repo/plugin sub-groups and flat rows. `CapabilityRow` and `CapabilityGroup` drop their now-redundant badges. New CSS in `globals.css` styles the two new nesting levels.

**Tech Stack:** Next.js (React server components), TypeScript, Tailwind v4 semantic tokens in `globals.css`, Vitest + Testing Library, lucide-react icons.

## Global Constraints

- New/changed UI uses semantic tokens and component classes from `src/app/globals.css` only — no raw Tailwind palette colors, arbitrary values, inline styles, or `dark:` variants.
- Change is scoped to the inventory view (`filters.view === "inventory"`). `ComparisonView` and the data model in `src/lib/agent-inventory/` are untouched.
- Expand/collapse uses native `<details>` — no URL params or React state.
- No forced nesting: a source's skills that do not form a 2+ same-repo run render as flat rows directly under the source group.
- Every check the project provides must pass before finishing: `npm run verify` (Prettier, lint, typecheck, tests, build). Run Prettier with `--write` on any file the check flags.

---

## File Structure

- `src/components/agent-setup-view.tsx` — add `partitionByKind` / `partitionByOrigin` helpers and `KindBucket` / `SourceGroup` components; rewire `ProviderInventory`'s render; strip badges from `CapabilityRow` and the origin tag from `CapabilityGroup`.
- `src/components/agent-setup-view.test.tsx` — add inventory-nesting tests.
- `src/app/globals.css` — add `.agent-kind-bucket*` and `.agent-source-group*` styles; collapse `.agent-capability-row` / `.agent-capability-group > summary` grids to a single content column.
- `README.md`, `AGENTS.md` — document the new nesting.

---

## Task 1: Nest inventory rendering by kind and source

**Files:**

- Modify: `src/components/agent-setup-view.tsx` (`ProviderInventory` ~697-755, `CapabilityRow` ~757-798, `CapabilityGroup` ~800-836; add helpers/components nearby)
- Test: `src/components/agent-setup-view.test.tsx`

**Interfaces:**

- Consumes (existing, unchanged): `buildInventoryItems(capabilities: AgentCapability[]): InventoryItem[]`, `compareInventoryItems`, `kindSortOrder`, `originSortOrder`, `kindLabels` (plural), `capabilityKindLabels` (singular), `kindIcons`, `originLabels`, `originBadges`, `countLabel`, `CapabilityGroup`, `CapabilityRow`.
- Produces:
  - `partitionByKind(capabilities: AgentCapability[]): { kind: CapabilityKind; capabilities: AgentCapability[] }[]` — ordered by `kindSortOrder`.
  - `partitionByOrigin(capabilities: AgentCapability[]): { origin: AgentCapability["origin"]; capabilities: AgentCapability[] }[]` — ordered by `originSortOrder`.
  - `KindBucket({ kind, capabilities, duplicateNames })` — open `<details class="agent-kind-bucket">`.
  - `SourceGroup({ origin, capabilities, duplicateNames })` — collapsed `<details class="agent-source-group">`.

- [ ] **Step 1: Write the failing tests**

Add to `src/components/agent-setup-view.test.tsx`, inside the `describe("AgentSetupView", ...)` block (the `skill` helper and `render`/`screen` imports already exist at the top of the file):

```tsx
test("inventory nests kind → source → repo and hoists badges off rows", () => {
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

  // One kind bucket, open by default.
  const buckets = container.querySelectorAll(".agent-kind-bucket");
  expect(buckets).toHaveLength(1);
  expect(buckets[0]!.hasAttribute("open")).toBe(true);

  // One source group, collapsed by default.
  const sources = container.querySelectorAll(".agent-source-group");
  expect(sources).toHaveLength(1);
  expect(sources[0]!.hasAttribute("open")).toBe(false);

  // Type badge lives on the bucket, never on a row.
  expect(container.querySelectorAll(".agent-kind-label")).toHaveLength(0);

  // Origin badge appears once, on the source header.
  expect(
    container.querySelectorAll(".agent-source-group .agent-origin-tag"),
  ).toHaveLength(1);

  // Full three-level nesting for the 2-skill repo run.
  expect(
    container.querySelectorAll(
      ".agent-kind-bucket .agent-source-group .agent-capability-group .agent-capability-row",
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
  expect(container.querySelectorAll(".agent-capability-group")).toHaveLength(0);
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- agent-setup-view`
Expected: FAIL — no `.agent-kind-bucket` / `.agent-source-group` elements exist yet, so the length assertions fail.

- [ ] **Step 3: Add the partition helpers**

In `src/components/agent-setup-view.tsx`, add above `buildInventoryItems` (near line 363). `CapabilityKind` is already imported from `@/lib/agent-inventory`.

```tsx
/**
 * Partition capabilities by kind, ordered Skills → Plugins → MCPs via
 * kindSortOrder. Callers have already filtered/sorted; this only buckets.
 */
function partitionByKind(
  capabilities: AgentCapability[],
): { kind: CapabilityKind; capabilities: AgentCapability[] }[] {
  const byKind = new Map<CapabilityKind, AgentCapability[]>();
  for (const capability of capabilities) {
    const list = byKind.get(capability.kind) ?? [];
    list.push(capability);
    byKind.set(capability.kind, list);
  }
  return [...byKind.entries()]
    .sort(([left], [right]) => kindSortOrder[left] - kindSortOrder[right])
    .map(([kind, members]) => ({ kind, capabilities: members }));
}

/**
 * Partition capabilities by origin, ordered via originSortOrder so the source
 * groups read in the same order used elsewhere in the view.
 */
function partitionByOrigin(
  capabilities: AgentCapability[],
): { origin: AgentCapability["origin"]; capabilities: AgentCapability[] }[] {
  const byOrigin = new Map<AgentCapability["origin"], AgentCapability[]>();
  for (const capability of capabilities) {
    const list = byOrigin.get(capability.origin) ?? [];
    list.push(capability);
    byOrigin.set(capability.origin, list);
  }
  return [...byOrigin.entries()]
    .sort(([left], [right]) => originSortOrder[left] - originSortOrder[right])
    .map(([origin, members]) => ({ origin, capabilities: members }));
}
```

- [ ] **Step 4: Add the `KindBucket` and `SourceGroup` components**

In `src/components/agent-setup-view.tsx`, add immediately after `ProviderInventory` (before `CapabilityRow`, ~line 757):

```tsx
function KindBucket({
  kind,
  capabilities,
  duplicateNames,
}: {
  kind: CapabilityKind;
  capabilities: AgentCapability[];
  duplicateNames: Set<string>;
}) {
  const KindIcon = kindIcons[kind];
  return (
    <details className="agent-kind-bucket" open>
      <summary>
        <span className="agent-kind-bucket-primary">
          <KindIcon aria-hidden="true" size={14} />
          <strong>{kindLabels[kind]}</strong>
        </span>
        <span>{countLabel(capabilities.length, "item")}</span>
      </summary>
      <div className="agent-kind-bucket-body">
        {partitionByOrigin(capabilities).map((group) => (
          <SourceGroup
            key={group.origin}
            origin={group.origin}
            capabilities={group.capabilities}
            duplicateNames={duplicateNames}
          />
        ))}
      </div>
    </details>
  );
}

function SourceGroup({
  origin,
  capabilities,
  duplicateNames,
}: {
  origin: AgentCapability["origin"];
  capabilities: AgentCapability[];
  duplicateNames: Set<string>;
}) {
  const items = buildInventoryItems(capabilities).sort(compareInventoryItems);
  return (
    <details className="agent-source-group">
      <summary>
        <span className="agent-source-group-primary">
          <span className={`badge ${originBadges[origin]} agent-origin-tag`}>
            {originLabels[origin]}
          </span>
        </span>
        <span>{countLabel(capabilities.length, "item")}</span>
      </summary>
      <div className="agent-source-group-body">
        {items.map((item) =>
          item.kind === "row" ? (
            <CapabilityRow
              key={`row:${item.capability.id}`}
              capability={item.capability}
              duplicateNames={duplicateNames}
            />
          ) : (
            <CapabilityGroup
              key={`group:${item.summary.key}`}
              summary={item.summary}
              members={item.members}
              duplicateNames={duplicateNames}
            />
          ),
        )}
      </div>
    </details>
  );
}
```

- [ ] **Step 5: Rewire `ProviderInventory` to render buckets**

In `src/components/agent-setup-view.tsx`, replace the current `items` block in `ProviderInventory` (the `const items = buildInventoryItems(...)` line ~676 and the `{items.length > 0 ? (...) : null}` JSX block ~722-741). Delete the local `items` const. Keep the `duplicateNames` computation and the instruction/warnings blocks exactly as they are. The new JSX block that replaces `{items.length > 0 ? (...) : null}`:

```tsx
{
  capabilities.length > 0 ? (
    <div className="agent-capability-list">
      {partitionByKind(capabilities).map((bucket) => (
        <KindBucket
          key={bucket.kind}
          kind={bucket.kind}
          capabilities={bucket.capabilities}
          duplicateNames={duplicateNames}
        />
      ))}
    </div>
  ) : null;
}
```

`duplicateNames` is currently typed `Set<string>` and passed as an optional prop; keep passing it. It stays computed once over the provider's full visible `capabilities`, so duplicate hints still resolve across buckets.

- [ ] **Step 6: Strip badges from `CapabilityRow`**

In `src/components/agent-setup-view.tsx`, replace the `CapabilityRow` return (~776-797) so the row renders only the primary column. Remove the `const KindIcon = kindIcons[capability.kind];` line at the top of `CapabilityRow`.

```tsx
return (
  <div className="agent-capability-row">
    <div className="agent-capability-primary">
      <strong>{capability.name}</strong>
      <span>{sourceLine}</span>
      {showPathHint ? (
        <code className="agent-capability-path-hint">
          {shortenHomePath(capability.sourcePath!)}
        </code>
      ) : null}
    </div>
  </div>
);
```

- [ ] **Step 7: Remove the redundant origin tag from `CapabilityGroup`**

The repo/plugin sub-group now always sits under a `SourceGroup` that already states the origin, so its summary badge is redundant. In `CapabilityGroup` (~800-836), delete the origin `<span className={`badge ...`}>` (~819-823) from the `<summary>`. Keep the icon, name, and count. Resulting summary:

```tsx
<summary>
  <span className="agent-capability-group-primary">
    <GroupIcon aria-hidden="true" size={14} />
    <strong>{summary.name}</strong>
  </span>
  <span>{countLabel(summary.memberCount, "skill")}</span>
</summary>
```

- [ ] **Step 8: Remove now-unused symbols**

If `capabilityKindLabels` and `kindMarkers` are no longer referenced anywhere in the file after Step 6 (they were only used by the old `CapabilityRow` kind label), delete them (~72-84). Confirm first:

Run: `grep -n "capabilityKindLabels\|kindMarkers" src/components/agent-setup-view.tsx`
Expected: no matches outside their own declarations. If matches remain (e.g. Compare view uses them), leave them. Then let the typecheck/lint in Step 9 catch any truly-unused symbol.

- [ ] **Step 9: Run the tests and full verify**

Run: `npm run test -- agent-setup-view`
Expected: PASS — both new tests and all existing `agent-setup-view` tests.

Run: `npm run verify`
Expected: PASS (Prettier, lint, typecheck, tests, build). If Prettier flags files, run `npx prettier --write <files>` and re-run.

- [ ] **Step 10: Commit**

```bash
git add src/components/agent-setup-view.tsx src/components/agent-setup-view.test.tsx
git commit -m "$(cat <<'EOF'
✨ feat(agents): nest inventory by kind then source

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Style the new nesting levels

**Files:**

- Modify: `src/app/globals.css` (`.agent-capability-*` block ~1758-1912; responsive blocks ~2236-2247 and ~2370-2379)

**Interfaces:**

- Consumes: class names emitted in Task 1 — `.agent-kind-bucket`, `.agent-kind-bucket-primary`, `.agent-kind-bucket-body`, `.agent-source-group`, `.agent-source-group-primary`, `.agent-source-group-body`.
- Produces: styled, indented, chevron-bearing collapsibles.

- [ ] **Step 1: Collapse the row and group summary grids to a single content column**

The row and repo-group summary no longer have the type/origin columns. In `src/app/globals.css`, change `.agent-capability-row` (~1761-1766) and `.agent-capability-group > summary` (~1844-1856) from the three-column grid to a two-column layout (content + trailing count for the summary; single content column for the row).

For `.agent-capability-row`, replace the `grid-template-columns` with a single flexible column:

```css
.agent-capability-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: center;
  gap: 0.7rem;
  min-height: 3.8rem;
  padding: 0.65rem 0.9rem;
}
```

For `.agent-capability-group > summary`, use content + count:

```css
.agent-capability-group > summary {
  list-style: none;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.7rem;
  min-height: 3.8rem;
  padding: 0.65rem 0.9rem;
  cursor: pointer;
}
```

- [ ] **Step 2: Add kind bucket and source group styles**

In `src/app/globals.css`, add after the `.agent-capability-group-members` rule (~1912), reusing the existing chevron/hover idiom from `.agent-capability-group`:

```css
.agent-kind-bucket + .agent-kind-bucket {
  border-top: 1px solid var(--border);
}
.agent-kind-bucket > summary,
.agent-source-group > summary {
  list-style: none;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.7rem;
  min-height: 3.4rem;
  padding: 0.6rem 0.9rem;
  cursor: pointer;
}
.agent-kind-bucket > summary::-webkit-details-marker,
.agent-source-group > summary::-webkit-details-marker {
  display: none;
}
.agent-kind-bucket > summary:hover,
.agent-source-group > summary:hover {
  background: var(--card-hover);
}
.agent-kind-bucket-primary,
.agent-source-group-primary {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
}
.agent-kind-bucket-primary::before,
.agent-source-group-primary::before {
  content: "›";
  display: inline-block;
  width: 1rem;
  flex: 0 0 auto;
  color: var(--muted-foreground);
  font-size: var(--text-lg);
  line-height: 1;
  transform: rotate(0deg);
  transition: transform 0.15s ease-in-out;
}
.agent-kind-bucket[open] > summary .agent-kind-bucket-primary::before,
.agent-source-group[open] > summary .agent-source-group-primary::before {
  transform: rotate(90deg);
}
.agent-kind-bucket-primary svg {
  flex: 0 0 auto;
  color: var(--muted-foreground);
}
.agent-kind-bucket-primary strong {
  font-size: var(--text-sm);
}
.agent-kind-bucket > summary > span:not(.agent-kind-bucket-primary),
.agent-source-group > summary > span:not(.agent-source-group-primary) {
  color: var(--muted-foreground);
  font-size: var(--text-xs);
  white-space: nowrap;
}
.agent-source-group-primary .agent-origin-tag {
  font-size: var(--text-xs);
}
.agent-kind-bucket-body {
  border-inline-start: 0.125rem solid var(--border);
  margin-inline-start: 0.9rem;
}
.agent-source-group-body {
  border-inline-start: 0.125rem solid var(--border);
  margin-inline-start: 1.6rem;
}
```

- [ ] **Step 3: Prune stale responsive column rules**

The `@media` blocks that hide row/summary columns 3-5 (`.agent-capability-row > :nth-child(4)`, `:nth-child(5)`, `:nth-child(n + 3)`, and the matching `.agent-capability-group > summary > :nth-child(...)` selectors around lines 2236-2247 and 2370-2379) target columns that no longer exist. Remove those specific `:nth-child` selectors (leave any other rules in those media blocks intact). Confirm none remain:

Run: `grep -n "nth-child(4)\|nth-child(5)\|nth-child(n + 3)" src/app/globals.css`
Expected: no matches referencing `.agent-capability-row` or `.agent-capability-group > summary`.

- [ ] **Step 4: Verify in the browser**

Start the dev server and open `/agents`.

Use `preview_start` with the project's dev config, then navigate to `/agents`. Confirm visually:

- Kind buckets (Skills / Plugins / MCPs) render open with the type icon and count.
- Source groups render collapsed with the origin badge; clicking expands them.
- Expanding a source with a multi-skill repo shows the repo sub-group, then bare-name rows.
- No type or origin badge appears on individual rows.
- Indentation steps in clearly at each level; chevrons rotate on toggle.

Run `read_console_messages` (expect no errors) and take a screenshot for the report.

- [ ] **Step 5: Run verify and commit**

Run: `npm run verify`
Expected: PASS. Run `npx prettier --write src/app/globals.css` if flagged.

```bash
git add src/app/globals.css
git commit -m "$(cat <<'EOF'
💄 style(agents): style nested inventory kind/source groups

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Update docs

**Files:**

- Modify: `README.md`, `AGENTS.md`

- [ ] **Step 1: Update AGENTS.md**

In `AGENTS.md`, find the `/agents` inventory bullet describing skill grouping ("Skills are deduplicated by canonical source…" and the Inventory/Compare description). Add a sentence noting the inventory list nests capabilities as Kind bucket (Skills/Plugins/MCPs, open by default) → Source group (by origin, collapsed) → the existing repo/plugin skill sub-group, so the type badge is stated once per kind and the origin badge once per source rather than on every row. Keep the Compare view described as an unaffected flat table.

- [ ] **Step 2: Update README.md**

In `README.md`, find the section describing the `/agents` page inventory. Update any description of the flat/badge-per-row inventory to describe the collapsible Kind → Source → repo nesting.

- [ ] **Step 3: Verify docs formatting and commit**

Run: `npx prettier --check README.md AGENTS.md`
Expected: PASS (run `--write` if flagged).

```bash
git add README.md AGENTS.md
git commit -m "$(cat <<'EOF'
📝 docs(agents): document inventory kind/source nesting

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** Kind bucket (Task 1 Step 4), Source group (Task 1 Step 4), repo sub-group reuse + no forcing (Task 1 Steps 4-5 via `buildInventoryItems`), badges off rows (Task 1 Steps 6-7), open/collapsed defaults (Task 1 Step 4 + tests), styling/indentation (Task 2), empty/filter behavior (unchanged `ProviderInventory` guards, Task 1 Step 5), testing (Task 1 Step 1), docs (Task 3). One intentional deviation from the spec: the repo sub-group (`CapabilityGroup`) also drops its origin badge (Task 1 Step 7), because it now always nests under a `SourceGroup` that states origin — this serves the spec's "state each badge once" goal.
- **Placeholder scan:** none.
- **Type consistency:** `partitionByKind`/`partitionByOrigin` return `.capabilities`; `KindBucket`/`SourceGroup` consume `capabilities`. `duplicateNames` typed `Set<string>` throughout.
