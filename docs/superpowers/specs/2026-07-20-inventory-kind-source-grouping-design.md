# Inventory kind + source grouping

**Date:** 2026-07-20
**Status:** Approved (verbal)
**Scope:** `/agents` inventory view (`filters.view === "inventory"`)

## Problem

Every capability row in the inventory view carries a type badge (Skill / Plugin /
MCP) and an origin badge (Personal / skills.sh / Marketplace / …). Within a
provider section these repeat on row after row — e.g. a dozen skills.sh skills
each stamped `[Skill] [skills.sh]`. The badges convey information that is uniform
across long runs of rows, so they add visual noise instead of signal.

The existing repo/plugin sub-grouping ([2026-07-19-inventory-skill-grouping])
already hoists the _origin_ badge onto a group heading for multi-skill sources,
but the _type_ badge still repeats on every member row, and single-source
capabilities (plugins, MCPs, singleton skills) still render fully flat with both
badges.

## Goal

Introduce two grouping levels above the existing repo/plugin sub-group so each
badge is stated once at the level where it is uniform:

- **Type** is uniform within a **Kind bucket** → the type badge lives on the kind
  header, not on rows.
- **Origin** is uniform within a **Source group** → the origin badge lives on the
  source header, not on rows.

Rows collapse to just the capability name (plus the existing duplicate path
hint). Change is scoped to the inventory view only.

## Non-goals

- No changes to `ComparisonView` — it is keyed by capability, not by source, and
  renders as a flat table by design.
- No changes to the data model in `src/lib/agent-inventory/`.
- No URL param or React state for expand/collapse — native `<details>` only.
- No new forced nesting: singletons are never wrapped in a one-item sub-group.

## Hierarchy

Per provider section (`ProviderInventory`), capabilities render as a three-level
nesting for skills and two-level for plugins/MCPs:

```
Provider card — [Codex] · N shown
  ▾ Skills (18)                       Kind bucket: type icon + label + count. OPEN by default.
      ▸ skills.sh (12)  [skills.sh]     Source group: origin badge + count. COLLAPSED.
          ▸ superpowers (12)             existing repo/plugin sub-group. COLLAPSED.
                brainstorming             row: name only (+ path hint if duplicate)
                writing-plans
      ▸ personal (3)   [Personal]
            my-skill                      singleton skill: flat row under source (no repo level)
      ▸ marketplace (3) [Marketplace]
          ▸ chrome-devtools (3)
  ▾ Plugins (2)
      ▸ marketplace (2) [Marketplace]
            ralph-loop                    plugins have no repo level: Kind → Source → rows
  ▾ MCPs (5)
      ▸ personal (5)   [Personal]
            slack
```

### Level 1 — Kind bucket

- One collapsible `<details>` per capability kind present in the provider
  (`skill`, `plugin`, `mcp`), in fixed order: Skills → Plugins → MCPs.
- **Open by default.**
- Header: the kind icon (`kindIcons`) + kind label (`capabilityKindLabels`) +
  a count of capabilities in the bucket.
- This is where the per-row type badge moves. Rows below no longer render it.

### Level 2 — Source group

- Inside each kind bucket, one collapsible `<details>` per origin present
  (`personal`, `marketplace`, `skills_sh`, `built_in`, `unknown`).
- **Collapsed by default.**
- Ordering reuses the existing origin ordering used elsewhere in the view.
- Header: the origin badge (`originBadges` / `originLabels`) + count.
- This is where the per-row origin badge moves. Rows below no longer render it.

### Level 3 — Repo/plugin sub-group (skills only, unchanged behavior)

- Inside a source group, the existing `buildInventoryItems` logic collapses runs
  of **2+** skills that share a plugin (`plugin:<sourcePlugin>`) or skills.sh
  repo (`skillssh:<sourceRepository>`) into a collapsible `CapabilityGroup`.
- **Collapsed by default.**
- Only skills reach this level. Plugins and MCPs stop at level 2 and render their
  rows directly under the source group.
- No forcing: a source's skills that don't form a 2+ run render as flat rows
  directly under the source group (same rule as today, scoped within a source).

### Level 4 — Row

- `CapabilityRow` renders **name only**, plus the shortened `sourcePath` hint
  when the name is a duplicate within the visible inventory (existing behavior).
- Both the type badge (kind label) and the origin badge are removed from the row.

## Implementation shape

- `ProviderInventory` first partitions its filtered/sorted capabilities by
  `kind` into ordered buckets, then partitions each bucket by `origin` into
  ordered source groups, then runs the existing `buildInventoryItems` within each
  source group to produce rows + repo/plugin sub-groups.
- New presentational components (names indicative): `KindBucket` and
  `SourceGroup`, each a labeled collapsible `<details>`. `CapabilityGroup` (repo/
  plugin sub-group) is reused unchanged aside from no longer needing to sit at
  the top level.
- `CapabilityRow` drops the kind label `<span>` and the origin badge `<span>`.
- The duplicate-name detection (`duplicateNames`) stays computed once per
  provider over all visible capabilities and is threaded down to rows unchanged.
- Counts shown on headers reflect only capabilities visible under the current
  filters.

## Styling

- Semantic tokens and component classes only (per `globals.css` rules) — no raw
  Tailwind palette colors, arbitrary values, inline styles, or `dark:` variants.
- Add per-level left indentation so the three chevron levels read clearly. Reuse
  existing `.agent-capability-*` classes where they fit; add new semantic classes
  in `globals.css` for the kind bucket and source group headers as needed.

## Empty / filter behavior

- A kind bucket or source group with zero visible capabilities (after filters)
  is not rendered.
- The provider section's existing "N shown" count and warnings block are
  unchanged.
- The existing empty state (`matchCount === 0`) is unchanged.

## Testing

Extend `agent-setup-view.test.tsx`:

- The type badge appears once per kind bucket header, not per row.
- The origin badge appears once per source group header, not per row.
- Rows carry neither the type nor the origin badge.
- A skills.sh provider with a multi-skill repo renders the full three-level
  nesting (kind → source → repo → rows).
- A singleton skill renders as a flat row directly under its source group (no
  one-item sub-group).
- Plugins/MCPs render two levels (kind → source → rows) with no repo level.
- Kind buckets are open by default; source and repo groups are collapsed by
  default (assert via the `open` attribute on `<details>`).

## Docs to update

- `README.md` — inventory view behavior, if user-facing description changes.
- `AGENTS.md` — the `/agents` inventory bullet, to note kind→source→repo nesting.

[2026-07-19-inventory-skill-grouping]: ./2026-07-19-inventory-skill-grouping-design.md
