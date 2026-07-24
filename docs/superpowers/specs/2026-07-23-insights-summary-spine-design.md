# Insights tab summary spine — design

Date: 2026-07-23
Status: Approved for planning

## Problem

The `/insights` tab is a flat three-tile grid — Cache effectiveness, Cost
outliers, and the redesigned Capability adoption card. Every tile competes
equally and the page has no summary layer: there is nothing to read *before*
dropping into a card's detail. Two consequences:

1. **No orientation.** A user cannot glance at the tab and know "cost is up,
   cache is down, adoption held steady" without reading three separate cards.
2. **Signals are buried.** Each card renders its own `InsightSignal`
   (warning/info) inline, so the actionable "what changed" prose is scattered
   one-per-card instead of surfaced together.

A recent redesign made the Capability card a rich mini-dashboard; the other two
cards and the page as a whole did not keep up.

## Goals

- Add a **summary spine** above the existing cards: a unified signals band, then
  a KPI hero strip. Both are **additive** — the three detail cards keep all
  their current content (by-model hit rates, the ranked session list, the
  capability tabs and heat grid).
- Surface the per-day `cache.trend` and `cost.trend` series, which
  `getInsights()` already computes but the UI never renders.
- Remove the now-duplicated inline signals from inside the cards.

## Non-goals

- No new query/data plumbing beyond reading fields that already exist on the
  `Insights` type. No schema, collector, or pricing changes.
- No new capability-level signal (the band starts with up to two signals; it
  grows naturally if one is added later).
- No Pareto-curve replacement for the cost session list — the list is the value.
- No change to the Capability adoption card itself.

## Data (all already present on `Insights` — `src/lib/queries.ts`)

- `cache.week.hitRate`, `cache.week.hitRateDeltaPts`, `cache.week.byModel`,
  `cache.week.savedUsd`, `cache.trend: { day, hitRate|null }[]`, `cache.signal`.
- `cost.week.totalUsd`, `cost.week.top5SharePct`, `cost.outliers[]`,
  `cost.trend: { day, costUsd|null }[]`, `cost.signal`.
- `capabilities.installedCount`, `capabilities.installedUsedCount`.

Honesty constraint: only cache has a scalar week-over-week delta
(`hitRateDeltaPts`). Cost and adoption have no comparable scalar, so their tiles
use shape (sparkline) or ratio, never a fabricated percentage arrow.

## Layout (top to bottom, `insights-view.tsx`)

1. Page header — unchanged.
2. **Signals band** — new.
3. **Hero strip** — new, three KPI tiles.
4. **Cache effectiveness**, **Cost outliers**, **Capability adoption** cards —
   unchanged except the inline `<Signal>` is removed from the first two.

The three cards each gain an `id` (`#insight-cache`, `#insight-cost`,
`#insight-capability`) so hero tiles can jump-link to them.

## Components

### `SignalBand`

- Input: the ordered list `[cache.signal, cost.signal].filter(Boolean)` —
  warnings first, then info (stable sort by tone, cache before cost within a
  tone).
- Renders nothing when the list is empty.
- Each row reuses the existing `.insight-signal is-<tone>` markup and the
  `Sparkles`/alert iconography already in `insights-view.tsx`. `role="alert"`
  for warning, `role="status"` otherwise (as today).
- Lives directly under the page header, full width above the grid.

### `HeroStrip` + `KpiTile`

A row of three tiles (`repeat(auto-fit, minmax(...))`, wraps on narrow widths).
Each tile is an in-page anchor (`<a href="#insight-...">`) with:

- a muted label,
- a headline value (reusing `formatCostUsd` / percent formatting already in the
  file),
- a compact trend cue:
  - **Week cost** → sparkline of `cost.trend` (`costUsd` per day; nulls break
    the line). Value = `cost.week.totalUsd` or `—`.
  - **Cache hit rate** → sparkline of `cache.trend` (`hitRate` per day). Value =
    `hitRate%` or `—`.
  - **Capability adoption** → a two-segment used/unused bar sized by
    `installedUsedCount / installedCount`. Value = `used / installed`, or a bare
    used count when `installedCount === 0` (mirrors the card's own rule).

The sparkline is a small presentational SVG component (`InsightSparkline`)
taking `number[]` (or `(number|null)[]`) and a tone; it is `aria-hidden` with the
real information carried by the adjacent value and label.

## Card adjustments

- **CacheCard**: remove the inline `{cache.signal && <Signal/>}`. Keep the
  headline, `hitRateDeltaPts` line, saved-$ block, and by-model rows. The tile
  carries the *shape*; the card keeps the *specifics*. Add `id="insight-cache"`.
- **CostCard**: remove the inline `{cost.signal && <Signal/>}`. Keep the "Top 5 =
  X%" headline and the ranked outlier list. Add `id="insight-cost"`.
- **CapabilityUsageCard**: add `id="insight-capability"` on its outer section
  (via a prop or wrapper); no internal change.

## Styling (`src/app/globals.css`)

New semantic component classes only — no raw palette, no inline styles, no
`dark:` variants:

- `.insight-hero` — the KPI row grid.
- `.insight-kpi` — a tile (label / value / trend cue), an anchor with hover
  affordance matching existing card-link patterns.
- `.insight-kpi-trend`, `.insight-spark` — the sparkline slot.
- `.insight-adoption-bar` + its two segments (reuse meter tokens where
  possible).
- Sparkline strokes use existing semantic color tokens (accent for positive
  framing, muted for neutral); dynamic fills, if any, use the quantized
  `spark-fill-N` / `meter-fill-N` classes per the project rule.

## Error / empty handling

- Empty signals list → band renders nothing (no empty container).
- `null` headline values → `—`, matching current card behavior.
- Empty or all-null trend arrays → tile shows the value with no sparkline (an
  empty sparkline slot, not a broken path).
- `installedCount === 0` → adoption tile shows the bare used count and no ratio
  bar, consistent with the card.

## Testing

- Extend `insights-view` coverage (or a new `signal-band` / `hero-strip`
  test) for: signal ordering (warning before info; empty → nothing rendered),
  the three tile value/formatting rules including the `installedCount === 0`
  fallback, and sparkline null-handling (empty series → no path).
- Reuse the existing `capability-usage-card.test.tsx` patterns for React
  Testing Library setup.

## Documentation

- `README.md`: update any user-facing description of the Insights page to
  mention the summary strip and signals band.
- `AGENTS.md`: the `/insights` bullet in the Pages section describes the card
  set; update it to note the signals band + hero strip spine and that
  `cache.trend`/`cost.trend` now surface in the UI.
