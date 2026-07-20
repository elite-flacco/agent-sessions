# Inventory skill grouping

**Date:** 2026-07-19
**Status:** Approved (verbal)
**Scope:** `/agents` inventory view (`filters.view === "inventory"`)

## Problem

The inventory view renders one row per capability, flat within each provider section. Plugins like `superpowers` ship 14+ skills, so a single plugin dominates the list. The plugin name is only surfaced as a per-row subtitle, so the user has to scan every row to realize those skills come from one source.

## Goal

Cluster multi-skill plugin and skills.sh sources into collapsible groups. Single-skill sources stay flat. The change is scoped to skills only — plugins and MCPs render exactly as today.

## Non-goals

- No changes to `ComparisonView` — it is keyed by capability, not by source.
- No changes to the data model in `src/lib/agent-inventory/`.
- No URL param or React state for expand/collapse — we use native `<details>`.
- No grouping of plugins or MCPs.

## Group key (skills only)

A new pure helper computes an optional group key for a capability:

```ts
function skillGroupKey(capability: AgentCapability): string | undefined;
```

Rules (in order):

1. If `capability.kind !== "skill"`, return `undefined` (plugins and MCPs never group).
2. If `origin === "marketplace"` **and** `sourcePlugin` is set, return `plugin:${sourcePlugin}`.
3. If `origin === "skills_sh"` **and** `sourceRepository` is set, return `skillssh:${sourceRepository}`.
4. Otherwise (`personal`, `built_in`, `unknown`, or marketplace skills without `sourcePlugin`), return `undefined`.

A capability with `undefined` group key renders flat, exactly as today.

## Rendering

### Group threshold

A group renders only when **two or more** consecutive same-key capabilities appear in the already-sorted list. If a key has exactly one member (which can happen when filters narrow the list), that member renders flat. This means single-skill plugins (e.g. `skill-creator`) never produce a one-row group.

### Build pipeline in `ProviderInventory`

Today: `capabilities.filter(...).sort(compareInventoryCapabilities)` then `.map(CapabilityRow)`.

Tomorrow: same filter + sort, then a grouping pass that walks the sorted array and emits an ordered list of render items:

```ts
type InventoryItem =
  | { kind: "row"; capability: AgentCapability }
  | { kind: "group"; summary: SkillGroupSummary; members: AgentCapability[] };
```

Walk rules:

- Maintain a `currentKey: string | undefined` and a `pendingMembers: AgentCapability[]`.
- For each capability, compute `key = skillGroupKey(capability)`.
  - If `key === currentKey`, push to `pendingMembers`.
  - Else, flush `pendingMembers` (see below), start a new `pendingMembers = [capability]`, set `currentKey = key`.
- After the loop, flush `pendingMembers`.

Flush rules for `pendingMembers` with key `K`:

- If `K === undefined` or `pendingMembers.length < 2`, emit one `{ kind: "row" }` per member.
- Else emit one `{ kind: "group", summary, members }`.

The sort must guarantee that all capabilities sharing a group key form a contiguous run, otherwise the run-based grouper would split them across flat rows. `compareInventoryCapabilities` therefore sorts in the order **kind → origin → group key → name → id**, where the group-key phase reuses `skillGroupKey` (undefined for non-groupable capabilities, normalized to the empty string for the comparator). This keeps the previous kind/origin/name ordering for everything else while ensuring every same-plugin or same-repo skill run lands adjacently. Within a group, the name/id phases still order members sensibly.

### Group summary

`SkillGroupSummary` is computed from the members:

```ts
interface SkillGroupSummary {
  key: string;
  kind: "plugin" | "skills_sh"; // which branch of skillGroupKey produced this
  name: string; // sourcePlugin or sourceRepository
  memberCount: number;
  origin: AgentCapability["origin"]; // always "marketplace" or "skills_sh"
  statusAggregate:
    | { kind: "uniform"; status: CapabilityStatus }
    | { kind: "mixed"; notEnabledCount: number };
}
```

- For `plugin:${id}` groups, `name = sourcePlugin` (e.g. `superpowers@claude-plugins-official`).
- For `skillssh:${repo}` groups, `name = sourceRepository`.
- `statusAggregate.kind === "uniform"` iff every member has the same `status`; otherwise `"mixed"` with `notEnabledCount` = number of members whose `status !== "enabled"` (i.e. `disabled`, `unavailable`, or `installed`).

### `CapabilityGroup` component

Renders one `<details className="agent-capability-group">`:

- `<summary>` styled as a grid matching `agent-capability-row` columns so it aligns with sibling flat rows. Inside the summary:
  - A disclosure chevron (CSS pseudo-element) as the first cell.
  - Group name as a `<strong>` (e.g. `superpowers@claude-plugins-official`).
  - Count label: `14 skills` via the existing `countLabel` helper.
  - Origin badge: `<span className="badge ${originBadges[origin]} agent-origin-tag">{originLabels[origin]}</span>` — uniform within a group.
  - Status aggregate: "Enabled" if uniform-enabled, otherwise the uniform status label, otherwise `Mixed · N not enabled`.
- Inside the `<details>` body, a `<div className="agent-capability-group-members">` containing one `CapabilityRow` per member. `CapabilityRow` is unchanged.

`<details>` is closed by default. Native disclosure handles toggle. No React state.

### Filter interaction

When `filters.q` matches a member of a group, the matching members render (per the existing `matchesCapability` filter applied _before_ grouping), but the group may shrink below the threshold of 2 and collapse back to flat rows. This is the desired behavior: search narrows the list, and there is no point showing a one-row group.

When `filters.kind === "skill"` is set, grouping still applies. When `filters.kind` is something else (plugin/mcp), no skills render anyway.

When `filters.status` is set, grouping applies to whatever members survive the filter. The status aggregate is computed from the _visible_ (filtered) members, not from the full underlying set — consistent with how the rest of the view treats filters.

## Grouped-first item ordering

After `buildInventoryItems` produces its render items, `ProviderInventory` sorts them with `compareInventoryItems` so that collapsed group items render before flat rows within the same kind/origin bucket. The comparator keys off the group's first member (for kind/origin/name) and assigns groups rank 0, flat rows rank 1. This lifts the collapsed `<details>` summaries to the top of each provider section and pushes single-skill plugins, lone skills.sh installs, and personal/built_in/unknown skills below them, while preserving relative order within each tier. The capability-level comparator (`compareInventoryCapabilities`) is unchanged from the run-preserving sort.

## Duplicate-name path hints

A skill can land in the inventory more than once via independent install mechanisms — e.g. skills.sh cloning `ai-sdk` from `vercel/ai` into `~/.agents/skills/ai-sdk`, and the Codex plugin cache independently pulling a copy via the `openai-curated` marketplace into `~/.codex/plugins/cache/openai-curated/vercel/<version>/skills/ai-sdk`. Both copies reclassify to `origin: "skills_sh"`, `sourceRepository: "vercel/ai"`, so their visible source line is identical and the rows look indistinguishable.

Rather than silently dedupe these, the inventory makes them easy to spot so the user can clean them up manually:

- `ProviderInventory` computes a `duplicateNames: Set<string>` from the filtered capabilities — every name that appears on more than one visible capability.
- `CapabilityRow` accepts `duplicateNames` as an optional prop. When the row's name is in the set and the capability carries a `sourcePath`, the row appends a `<code class="agent-capability-path-hint">` showing the shortened install path under the source line. Single-instance rows render unchanged.
- The path is shortened via `shortenHomePath` (`src/lib/format.ts`), which substitutes the user's home directory with `~` and collapses plugin-cache version directories (`~/.<provider>/plugins/cache/<marketplace>/<plugin>/<version>/skills/...` → `~/.<provider>/plugins/cache/<marketplace>/<plugin>/skills/...`) so the hint stays compact and the two install locations are visually distinct.
- Group member rows receive the same `duplicateNames` set, so duplicates inside a collapsed group (e.g. two `ai-sdk` rows grouped under `vercel/ai`) each show their own path hint when expanded.

This is a presentation-only change. The underlying dedupe logic in `src/lib/agent-inventory/normalize.ts` is untouched — duplicates remain in the data because they reflect genuinely distinct on-disk installs the user may want to reconcile.

## CSS

All additions go next to `.agent-capability-row` in `src/app/globals.css`. Semantic tokens only, no palette colors, no arbitrary values, no `dark:` variants.

- `.agent-capability-group` — block container; `+ .agent-capability-row, + .agent-capability-group { border-top: 1px solid var(--border); }` to maintain the divider rhythm against the existing `.agent-capability-row + .agent-capability-row` rule.
- `.agent-capability-group > summary` — `list-style: none; cursor: pointer; display: grid;` with the same column template as `.agent-capability-row` so the summary aligns with flat rows. `::-webkit-details-marker { display: none; }` to suppress the native triangle.
- `.agent-capability-group > summary::before` — a chevron drawn via `content` that rotates 90° when the parent `[open]`. Color `var(--muted-foreground)`.
- `.agent-capability-group > summary:hover { background: var(--card-hover); }` to match the flat row hover.
- `.agent-capability-group-members` — indented via `padding-inline-start` and a left border using `var(--border)` to visually nest member rows under the summary. Members get the same divider treatment via a scoped `.agent-capability-group-members > .agent-capability-row + .agent-capability-row` rule; the first member's top border is removed because the summary already separates header from body.
- Responsive overrides at the existing mobile breakpoints mirror the existing `.agent-capability-row` rules so the summary collapses cleanly on small screens.
- `.agent-capability-path-hint` — a third line inside `.agent-capability-primary` for duplicate-name skills. Monospace, `var(--text-xs)`, `var(--muted-foreground)` with `opacity: 0.85`, ellipsis on overflow. Rendered as a `<code>` element so it visually reads as a path.

## Tests

New and updated cases in `src/components/agent-setup-view.test.tsx`. Tests use `renderToStaticMarkup`, which renders `<details>` closed — so member assertions about "not in document" map to "not in static HTML before `</details>`".

New tests:

1. **Multi-skill plugin collapses into a group.** A plugin contributing 3 skills renders one `<details class="agent-capability-group">` with summary containing the plugin name and `3 skills`. Member names appear only inside the `<details>` body (still present in the HTML, but after the summary).
2. **Single-skill plugin renders flat.** A plugin with one skill renders a `CapabilityRow` directly, no `<details>`.
3. **skills.sh repo with multiple lockfile entries groups.** Two skills with the same `sourceRepository` and `origin: "skills_sh"` render as one group; summary shows the repo name and `2 skills`.
4. **Personal / built_in / unknown skills render flat.** No `<details>` even when several share an origin.
5. **Mixed-status group shows "Mixed · N not enabled".** A plugin group with 2 enabled + 1 disabled skills shows the mixed status aggregate.
6. **Filter narrows a group below threshold.** With `q` set to one member's name, that member renders as a flat row even though it would normally group.
7. **Plugins and MCPs never group.** Even when several plugins come from the same marketplace, they stay as flat rows.
8. **Grouped-first item sort.** A flat single-skill plugin whose group key would naturally sort ahead of a multi-skill plugin's group still renders _after_ the collapsed group.
9. **Path hint on duplicate names.** Two same-name skills with different `sourcePath`s each render a shortened `<code class="agent-capability-path-hint">`; a unique-name skill with a `sourcePath` renders no hint.

`src/lib/format.test.ts` gains a `shortenHomePath` describe block covering home substitution, plugin-cache version collapsing, and the non-home passthrough.

Updated test — "sorts inventory capabilities by type, source, then name": this test uses personal-origin capabilities (no group keys), so it should still pass unchanged. I will verify during implementation and only adjust if needed.

## Files touched

1. `src/components/agent-setup-view.tsx` — add `skillGroupKey`, `SkillGroupSummary` type, `buildInventoryItems`, `compareInventoryItems`, `CapabilityGroup` component; modify `ProviderInventory` to consume grouped items, compute `duplicateNames`, and pass it through to rows; modify `CapabilityRow` to render the path hint on collisions.
2. `src/lib/format.ts` — add `shortenHomePath`.
3. `src/app/globals.css` — `.agent-capability-group`, member styles, and `.agent-capability-path-hint`.
4. `src/components/agent-setup-view.test.tsx` — new tests above; verify existing tests still pass.
5. `src/lib/format.test.ts` — `shortenHomePath` describe block.

## Verification

Per workspace `AGENTS.md`:

- `npm run format:check` (and `format` if it reports violations)
- `npm run lint`
- `npm run typecheck` (or `npx tsc --noEmit`)
- `npm test`
- `npm run build`

## Definition of Done

- Multi-skill plugin and skills.sh sources render as collapsed `<details>` groups in the inventory view.
- Collapsed groups sort before flat rows within each kind/origin bucket.
- Duplicate-name skills show a shortened install path so the user can identify and clean up duplicates; single-instance skills are unaffected.
- Single-skill sources, and personal / built_in / unknown skills, render flat as before.
- Plugins and MCPs are unchanged.
- All checks pass.
- `README.md` and `AGENTS.md` reviewed and updated only if user-facing behavior or architecture conventions changed (the inventory grouping is a presentation change within an existing surface, so likely no `AGENTS.md` update; a one-line `README.md` note may be appropriate if the README documents the `/agents` page in detail).
