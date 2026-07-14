# Overview Patterns — Design Spec

**Date:** 2026-07-13
**Status:** Approved (layout, pending written-spec review)
**Scope:** Rebuild the Overview tab's two-column grid to surface usage *patterns* — when you're active, how long sessions take, and where cost/tokens concentrate — without duplicating the `/usage` page.

## Motivation

The Overview tab (`src/app/page.tsx` → `overview-view.tsx`) currently shows six sections: four metric cards plus a two-column grid of Running now / Needs attention / Agents this week / Last 14 days / Recent projects. It answers "what's happening" but not **"what are my patterns."** Three insights are missing and the data for all three already lives in the schema:

1. **When am I active?** — timestamps exist (`started_at`) but only a flat 14-day count strip visualizes recency, not rhythm.
2. **How long do sessions take?** — runtime is computed for projects and weekly totals but never *distributed*; there's no sense of typical-vs-outlier sessions.
3. **Where does cost go?** — `session_model_usage` + `pricing.ts` drive the entire `/usage` page, but Overview carries zero cost signal.

The goal is to add these three views to Overview in a way that reads as one cohesive "patterns" story rather than three more scattered cards.

## Approved layout

The two-column `.overview-grid` is reorganized. The metric cards at the top stay unchanged.

**Left column (wider, `minmax(0, 1.4fr)`): the patterns section**

1. **"When you're active" heatmap** — a 7-row (Mon–Sun) × 24-column (hour) grid where each cell is shaded by session count, quantized to the existing `spark-fill` ramp. Aggregated over the trailing 30 days. Replaces the current "Last 14 days" count sparkline, which it strictly generalizes (recency + rhythm). A "fewer → more" legend sits beneath.

2. **"Session length" histogram** — five duration buckets (`<2m`, `2–10m`, `10–30m`, `30m–1h`, `1–2h`) rendered as existing `.meter` bars, scaled to the max bucket. Window is the trailing 7 days. A one-line footnote summarizes the "long tail": median, longest, and the share of total runtime held by sessions over 30 minutes.

3. **"Cost this week" card** — a single week-total (estimated dollars + token count) with the top 3 models as `.meter` bars, linking to `/usage` for depth. Intentionally light; it is a pointer, not a duplicate of the cost page.

**Right column (narrower, `minmax(0, 1fr)`): operational (unchanged)**

4. Running now
5. Needs attention
6. Recent projects

**Removed from Overview:** "Agents this week" (the provider distribution meters). This data is already on `/usage` (by agent) and the metric cards cover session volume. Removing it prevents the left column from running long while the new patterns views are added. *(If the provider breakdown proves useful at-a-glance, it can return as a compact element inside the cost card — but YAGNI for v1.)*

## Data sources

All data comes from existing tables; no schema changes.

| View | Source rows | Aggregation |
| --- | --- | --- |
| Heatmap | `sessions.started_at` | Group by `dayofweek` × `hour`, count, over trailing 30 days |
| Length histogram | `sessions.started_at`, `ended_at`/`updated_at` | Bucket the existing runtime expression (`julianday(coalesce(ended_at,updated_at)) - julianday(started_at)`), over trailing 7 days |
| Cost card | `session_model_usage` joined to `sessions`, priced via `pricing.ts` | Reuse the `getUsageSummary` cost derivation for the week window + top-3 models |

## New query layer (`src/lib/queries.ts`)

The read boundary stays in `queries.ts`. A new `OverviewPatterns` shape is added to `getOverview()` (or a sibling `getOverviewPatterns()` function — see Open question below) and threaded into `OverviewView` via `page.tsx`, mirroring how `overview`, `running`, `attention`, and `recentProjects` are already passed.

```ts
export interface OverviewPatterns {
  // heatmap[r * 24 + c], r = day-of-week 0–6 (Mon–Sun), c = hour 0–23
  heatmap: { dayOfWeek: number; hour: number; count: number }[];
  length: {
    buckets: { label: string; count: number }[]; // always 5 buckets
    medianMs: number | null;
    longestMs: number | null;
    longTailShare: number | null; // fraction of runtime in sessions > 30 min
    sessionCount: number;
  };
  costWeek: {
    costUsd: number | null;   // null when any usage is unpriced — same rule as /usage
    tokens: number;
    topModels: { model: string; costUsd: number }[]; // up to 3
  };
}
```

**Pricing-trust rule carries over:** `costWeek.costUsd` is `null` (card shows "unavailable") when any usage row in the week is unpriced, exactly as `getUsageSummary` does. Token totals are shown regardless.

## Component changes (`src/components/overview-view.tsx`)

- `OverviewView` props gain `patterns: OverviewPatterns`.
- The grid's two `.overview-column` blocks swap order: patterns on the left, operational on the right.
- Three new sub-components render inside the left column:
  - `<ActivityHeatmap cells={patterns.heatmap} />` — a grid of quantized cells. Heat level is derived via the same `level()` helper used for meters/sparks (0–10), mapped to a new `heat-fill-N` class family (see CSS below) so fills stay token-based and avoid inline styles.
  - `<SessionLength length={patterns.length} />` — meter bars + footnote.
  - `<CostAtAGlance cost={patterns.costWeek} />` — total + top-3 meters + link to `/usage`.
- "Agents this week" section is removed (see layout rationale).
- "Last 14 days" sparkline is removed (absorbed by the heatmap).

## CSS changes (`src/app/globals.css`)

> **Note:** the brainstorming mockup used inline `rgba()` shades only to simulate the look in a standalone HTML file. The real implementation must **not** carry those inline styles — it uses the token classes below, per the AGENTS.md rule (no raw palette colors, arbitrary values, or inline styles).

The heatmap's shades are expressed as **semantic tokens**:

- Add a `--heat-*` token family in `:root` (5 steps) derived from the accent (`--accent`) at fixed opacities, matching how the existing `meter-fill`/`spark-fill` classes quantify a single accent color.
- Add `heat-fill-0` … `heat-fill-10` component classes under `@layer components`, paralleling the existing `spark-fill-N` classes but setting `background` instead of `height`/`width`. The `level()` helper already produces 0–10, so heatmap cells reuse it directly.
- Responsive: the heatmap's 24 columns must collapse gracefully on narrow widths. Reuse the existing `@media (max-width: 900px)` breakpoint pattern (the grid stacks to one column there already).

## Open question (to resolve in the plan)

**Where does the new query live?** Two options, to be settled during implementation planning:
- (a) Extend `getOverview()` to also return `heatmap`/`length`/`costWeek`. Pro: one call site. Con: the function grows and the cost query duplicates logic from `getUsageSummary`.
- (b) Add a sibling `getOverviewPatterns()`. Pro: focused; can reuse `getUsageSummary`'s week window. Con: a second DB round-trip from `page.tsx`.

Lean toward (b) for separation, since the cost derivation already has a well-tested home.

## Non-goals

- No new data collection or adapter changes — all data already ingested.
- No changes to `/usage`, `/sessions`, `/activity`, or `/projects`.
- No interactivity on the heatmap (click-to-filter) for v1 — it's a summary surface; drill-down lives on `/sessions` via the existing filters.
- No persistence of derived costs (unchanged architecture: costs are read-time only).

## Definition of Done

1. Overview renders the three new pattern views using only semantic tokens and component classes (no raw colors, arbitrary values, inline styles, or `dark:` variants). Heatmap fills use the quantized `heat-fill-N` family.
2. The left column shows patterns (heatmap, length, cost); the right column shows operational lists (running, attention, recent projects). The metric cards stay at top.
3. Removed sections ("Agents this week", "Last 14 days" sparkline) no longer appear.
4. Cost card shows "unavailable" when any week usage is unpriced; token totals always show; card links to `/usage`.
5. `npm run verify` passes (lint, typecheck, formatting, tests, build).
6. `README.md` Overview route description updated to mention the pattern views; `AGENTS.md` Pages entry for `/` updated if the query-layer convention changes.
