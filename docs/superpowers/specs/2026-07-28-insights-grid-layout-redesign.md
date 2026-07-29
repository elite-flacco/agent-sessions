# Insights grid layout redesign

**Date:** 2026-07-28
**Status:** Approved (pending spec review)
**Scope:** Layout only — no changes to card internals, data flow, or component structure.

## Problem

The `/insights` page has excessive whitespace. Verified against the live render at a 1600px viewport (computed DOM inspection), the root cause is **not** edge-to-edge stretching (the content fills its container by design and the user wants to keep that). It is the **equal-height card grid row**:

- `.insights-grid` currently lays out its three direct children — `#insight-cache`, `#insight-cost`, and the `#insight-capability` wrapper — as **three columns in a single implicit row**.
- Grid rows size to the tallest item, so all three cards stretch to the capability card's height (~571px). The Cache and Cost cards have less content and end up with large vertical emptiness inside them.
- The capability card's `grid-column: 1 / -1` rule (intended to make it span full width on its own row) lives on the **inner** `<section class="capability-insight">`, not on the grid's direct child (the `<div id="insight-capability">` wrapper). Because the wrapper flows in `auto` placement, the full-width span never takes effect and all three cards land in one row.

## Goal

Eliminate the vertical whitespace caused by the equal-height row, while **preserving**:

- the summary-spine architecture (SignalBand → HeroStrip → card grid),
- the content-width behavior (fills the container — no max-width cap),
- every card's internal markup and styling,
- all existing anchors (`#insight-cache`, `#insight-cost`, `#insight-capability`) and KPI tile anchors,
- scope limited to `/insights` (no changes to other pages).

## Design

A single CSS-driven change to `.insights-grid` and the capability wrapper.

### Target layout

```
.insights-grid (2 explicit rows, fills container width — no max-width)
  Row 1:  [ CacheCard ]  [ CostCard ]          ← 2 equal columns, fill width
  Row 2:  [ CapabilityUsageCard .............. ] ← full width, own row
```

Each card sizes to its **own content height**; no card is dragged tall to match a sibling.

### Changes

1. **`.insights-grid`** — replace the `auto-fit`/`minmax(0, 26rem)` column template with an explicit two-column layout that fills the available width:
   - `grid-template-columns: repeat(2, minmax(0, 1fr))`
   - Keep `gap` and `margin-top` at their current values.
   - The grid still fills the container width (no `max-width` added) per the user's decision.

2. **Capability wrapper full-width span** — the `#insight-capability` wrapper `<div>` (the grid's direct child) must carry the full-width span so it breaks to its own row. Apply `grid-column: 1 / -1` to the wrapper div (add a class hook to it if it doesn't have one). Remove the now-redundant `grid-column: 1 / -1` from `.capability-insight` in `globals.css` — the inner section is no longer a grid item, so leaving the rule there is dead CSS that could mislead future edits. The wrapper owns grid placement; the inner section keeps all its other styling.

3. **Responsive fallback** — at narrow widths where two columns can't fit (existing media query breakpoint), the grid collapses to a single column and all three cards stack vertically. This already works with `minmax(0, 1fr)` columns; confirm the existing media query still produces a clean single-column stack.

### Out of scope (explicitly)

- No `max-width` / content bounding — content continues to fill the container.
- No changes to `.relay-content`, `.relay-shell`, or any non-Insights page.
- No changes inside CacheCard, CostCard, or CapabilityUsageCard — markup, padding, meter bars, typography all stay as-is.
- No changes to the HeroStrip or SignalBand.
- No TSX restructuring beyond what's needed to put the full-width span on the correct element (if the span can be applied purely via CSS on the existing wrapper, no TSX change is needed; if the wrapper needs a class hook, that's the only markup addition).

## Verification

- Open `/insights` at a wide viewport (≥1280px): confirm Cache + Cost sit side-by-side filling the row, Capability spans full width beneath, and each card's height matches its own content (no stretched emptiness).
- Confirm the three cards' anchors still resolve and the KPI hero tiles still jump-link correctly.
- Confirm at a narrow viewport (existing mobile media query) all three cards stack into a single column.
- Confirm `/`, `/sessions`, `/usage` pages are visually unchanged.
- Run the project's checks (`npm run verify`).
