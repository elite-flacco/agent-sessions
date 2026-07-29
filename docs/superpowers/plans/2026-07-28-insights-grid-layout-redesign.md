# Insights grid layout redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Break the Insights page's equal-height 3-up card row into a 2-card top row + full-width capability card below, eliminating vertical whitespace — without changing card internals.

**Architecture:** CSS-only layout change. `.insights-grid` switches from `auto-fit` to an explicit 2-column template that fills the container width; the `#insight-capability` wrapper div gets the `grid-column: 1 / -1` span (moved off the inner `.capability-insight` section, where it silently never applied) so capability breaks to its own row. A new media query collapses to one column at the existing 900px breakpoint. One class hook added to the wrapper div so the span targets the grid's direct child; no other TSX changes.

**Tech Stack:** Next.js 16, React, plain CSS in `globals.css` (semantic component classes — no Tailwind utilities, arbitrary values, or `dark:` variants per AGENTS.md), Vitest + React Testing Library (jsdom).

## Global Constraints

- New UI must use semantic tokens and component classes from `src/app/globals.css` — no raw Tailwind palette colors, arbitrary values, inline styles, or `dark:` variants. Spacing changes go in the component class definitions in `globals.css`.
- Card internals are out of scope: no changes to markup, padding, meter bars, or typography inside `CacheCard`, `CostCard`, or `CapabilityUsageCard`. Only the grid layout and the wrapper div's class hook change.
- Content continues to fill the container — no `max-width` / content bounding is added.
- Scope is `/insights` only: no changes to `.relay-content`, `.relay-shell`, or any other page.
- All anchors must keep working: `#insight-cache`, `#insight-cost`, `#insight-capability`, and the KPI tile `#insight-cost`/`#insight-cache`/`#insight-capability` jump links from `HeroStrip`.
- Project's existing `@media` breakpoints are 1200px / 900px / 640px. The 900px breakpoint is where `.relay-shell` collapses to a single column (sidebar stacks) — use it for the grid's single-column fallback.

---

### Task 1: Add the failing test for the capability wrapper hook

The layout fix hinges on the `grid-column: 1 / -1` span landing on the grid's direct child (the `#insight-capability` wrapper div), not the inner section. jsdom does not compute CSS layout, so we assert the DOM hook that carries the span: the wrapper div gets a class (`insight-capability-wrap`) that the CSS targets. This test pins that hook so a refactor can't silently drop it.

**Files:**
- Test: `src/components/insights-view.test.tsx`

**Interfaces:**
- Consumes: `InsightsView` is not currently exported (the test file imports `HeroStrip`, `InsightSparkline`, `SignalBand`). To test the grid wrapper we either export `InsightsView` or render the whole view. This task exports `InsightsView` from `insights-view.tsx` (Task 2 makes the class change; the export is needed for the test to compile). Add `InsightsView` to the import in the test.
- Produces: a failing test asserting the `#insight-capability` wrapper div carries class `insight-capability-wrap`.

- [ ] **Step 1: Add `InsightsView` to the test's import and write the failing test**

Append to the import on line 7 of `src/components/insights-view.test.tsx` and add a new `describe` block at the end of the file.

Change the import (line 7) from:
```ts
import { HeroStrip, InsightSparkline, SignalBand } from "./insights-view";
```
to:
```ts
import { HeroStrip, InsightsView, InsightSparkline, SignalBand } from "./insights-view";
```

Append this `describe` block at the end of the file (after the closing `});` of the `HeroStrip` block, line 134):

```tsx
describe("InsightsView", () => {
  test("the capability wrapper div carries the full-width grid hook", () => {
    const { container } = render(<InsightsView insights={baseInsights()} />);
    // The grid's direct child for capability must carry the span class so
    // grid-column: 1 / -1 targets the grid item, not the inner section.
    const wrap = container.querySelector("#insight-capability");
    expect(wrap).not.toBeNull();
    expect(wrap?.classList.contains("insight-capability-wrap")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/insights-view.test.tsx`
Expected: FAIL — either `InsightsView` is not exported (import error) or the wrapper div does not have class `insight-capability-wrap` (`.classList.contains(...)` is false). Both are expected; Task 2 fixes them.

- [ ] **Step 3: Commit the failing test**

```bash
git add src/components/insights-view.test.tsx
git commit -m "test(insights): pin the capability wrapper grid hook"
```

---

### Task 2: Move the full-width span to the wrapper and switch the grid to 2 columns

This is the core layout change: the wrapper div gets the hook class, `.insights-grid` switches to 2 explicit columns that fill the container, `.capability-insight` loses its dead `grid-column` rule, and a media query collapses to one column at 900px.

**Files:**
- Modify: `src/components/insights-view.tsx:54` (add class to wrapper div; export `InsightsView`)
- Modify: `src/app/globals.css:1246-1251` (`.insights-grid` column template)
- Modify: `src/app/globals.css:1351-1354` (`.capability-insight` — drop dead `grid-column`)
- Add class rule for `.insight-capability-wrap` and a `@media (max-width: 900px)` rule for `.insights-grid`.

**Interfaces:**
- Consumes: the test hook from Task 1 (`insight-capability-wrap` on `#insight-capability`).
- Produces: the 2-on-top / full-width-below grid layout; `InsightsView` exported for testing.

- [ ] **Step 1: Export `InsightsView` and add the wrapper class**

In `src/components/insights-view.tsx`:

1. Find the `InsightsView` function declaration (the component that returns `<section className="relay-content">`). It is currently NOT exported. Add `export` to its declaration. (Do not change any other export — `SignalBand`, `InsightSparkline`, `HeroStrip` stay as they are.)

2. On line 54, change:
```tsx
        <div id="insight-capability">
```
to:
```tsx
        <div id="insight-capability" className="insight-capability-wrap">
```

No other JSX changes. The `CacheCard`, `CostCard`, and `CapabilityUsageCard` internals are untouched.

- [ ] **Step 2: Switch `.insights-grid` to 2 explicit columns**

In `src/app/globals.css`, replace the `.insights-grid` rule at lines 1246–1251. Change:
```css
  .insights-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(0, 26rem));
    gap: 0.8rem;
    margin-top: 0.9rem;
  }
```
to:
```css
  .insights-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.8rem;
    margin-top: 0.9rem;
  }
```

This fills the container width with two equal columns. No `max-width` is added (content fills the container per the spec).

- [ ] **Step 3: Move the full-width span off `.capability-insight` onto the wrapper**

In `src/app/globals.css`, the `.capability-insight` rule at lines 1351–1354 currently reads:
```css
  .capability-insight {
    grid-column: 1 / -1;
    min-inline-size: 0;
  }
```
The `grid-column: 1 / -1` here is dead CSS: `.capability-insight` is the *inner* section, not the grid's direct child, so the span never applied (this is why all three cards landed in one row). Replace the block with a rule for the wrapper and a trimmed inner-section rule:
```css
  .insight-capability-wrap {
    grid-column: 1 / -1;
    min-inline-size: 0;
  }
  .capability-insight {
    min-inline-size: 0;
  }
```

- [ ] **Step 4: Add the single-column fallback at the 900px breakpoint**

The `auto-fit` template used to drop columns automatically; the fixed 2-column grid will not, so add an explicit fallback. Find the existing `@media (max-width: 900px)` block (it starts at line 2769) and add a rule for `.insights-grid` inside its `@layer components` block. After the existing `.relay-sidebar` rules in that block, add:

```css
    .insights-grid {
      grid-template-columns: minmax(0, 1fr);
    }
```

Place it inside the existing `@media (max-width: 900px) { @layer components { ... } }` block — do not create a second `@media (max-width: 900px)` block. At ≤900px the sidebar already stacks (`.relay-shell` becomes `1fr`), so one column for the grid matches.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/components/insights-view.test.tsx`
Expected: PASS — all existing tests still pass, and the new `InsightsView` test passes (wrapper div has `insight-capability-wrap`).

- [ ] **Step 6: Commit**

```bash
git add src/components/insights-view.tsx src/app/globals.css
git commit -m "✨ feat(insights): break card grid into 2-up + full-width capability row"
```

---

### Task 3: Verify in the browser and run the full check suite

Layout changes need a visual check — jsdom can't confirm columns actually render. This task verifies the real layout at wide and narrow viewports, then runs every project check.

**Files:** none modified.

**Interfaces:** none.

- [ ] **Step 1: Confirm the dev server is running**

Run: `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/insights`
Expected: `200`. If it returns connection refused, start it: `npm run dev` in the background and wait for "Ready".

- [ ] **Step 2: Open the page at a wide viewport and assert the layout**

Using `agent-browser` (or a manual browser check):
```bash
agent-browser open http://127.0.0.1:3000/insights
agent-browser set viewport 1600 1000
agent-browser wait --load networkidle
```
Then assert the structure via eval:
```bash
cat <<'EOF' | agent-browser eval --stdin --json
const grid = document.querySelector(".insights-grid");
const cs = getComputedStyle(grid);
const kids = Array.from(grid.children).map(c => ({
  id: c.id, cls: c.className,
  gridColumn: getComputedStyle(c).gridColumn,
  h: Math.round(c.getBoundingClientRect().height)
}));
({ gridCols: cs.gridTemplateColumns, children: kids });
EOF
```
Expected:
- `gridCols` is `"1fr 1fr"` (two equal columns filling the container).
- The cache and cost children have `gridColumn: "auto"` and their heights differ from the capability wrapper (no longer all equal — cards size to own content).
- The `#insight-capability` wrapper has `gridColumn: "1 / -1"`.

- [ ] **Step 3: Screenshot the wide layout**

```bash
agent-browser screenshot /tmp/insights-redesign-wide.png
```
Visually confirm: Cache and Cost sit side-by-side in row 1; Capability spans full width in row 2; no card has a large empty lower region.

- [ ] **Step 4: Resize to the 900px breakpoint and confirm single-column stack**

```bash
agent-browser set viewport 760 1000
agent-browser wait --load networkidle
```
Re-run the eval from Step 2. Expected: `gridCols` is now `"minmax(0, 1fr)"` (single column) and all three cards stack vertically.

- [ ] **Step 5: Confirm the KPI hero anchors still jump-link**

```bash
agent-browser set viewport 1600 1000
agent-browser click 'a[href="#insight-capability"]'
```
Expected: the page scrolls to / focuses the capability card. Repeat for `#insight-cache` and `#insight-cost`.

- [ ] **Step 6: Run the full project check suite**

Run: `npm run verify`
This runs lint, typecheck, format:check, test, and build. Expected: all pass. If `format:check` fails, run `npm run format` and re-run `verify`. If any other check fails, fix it before proceeding — do not move on with failing checks.

- [ ] **Step 7: Commit if formatting changed**

If `npm run format` rewrote anything in Step 6:
```bash
git add -A
git commit -m "💄 style(insights): apply prettier to grid layout changes"
```
Otherwise skip — no empty commits.

---

### Task 4: Update README and AGENTS.md

Per the plan-authoring rules, the final task reviews user-facing and architecture docs. This change shifts the Insights card layout from a single 3-up row to 2-up + full-width, which is an architecture/convention detail documented in AGENTS.md.

**Files:**
- Review: `README.md` (user-facing behavior)
- Modify: `AGENTS.md` (the Insights page layout description in the Relay architecture section)

**Interfaces:** none.

- [ ] **Step 1: Review README.md for Insights layout descriptions**

Read `README.md`. If it describes the Insights card layout (e.g. "three cards in a row" or similar), update it to reflect the new 2-up + full-width-capability layout. If README only describes the page at a feature level (what each card shows) without specifying the grid arrangement, no change is needed — note that in the commit message.

- [ ] **Step 2: Update the AGENTS.md Insights architecture description**

In `AGENTS.md` (the "Pages:" bullet, line 17), the `/insights` paragraph contains this exact sentence:
> The detail cards keep all their content; the strip only adds anchors and the band relocates their signals.

Append a new sentence immediately after it describing the new grid layout:
> The detail cards lay out as a 2-column top row (Cache, Cost) that fills the container width, with the Capability adoption card spanning full width beneath; the full-width span lives on the `#insight-capability` wrapper (the grid's direct child), not the inner `.capability-insight` section, and the grid collapses to one column at the 900px breakpoint.

Use `Edit` with the existing sentence as `old_string` (it is unique in the file) and the existing sentence + the new sentence as `new_string`. Match the surrounding prose density — no headings, no bullet lists.

- [ ] **Step 3: Commit the doc updates**

```bash
git add README.md AGENTS.md
git commit -m "📝 docs(insights): document the 2-up + full-width card grid layout"
```
If neither file needed changes after review, skip the commit — note "no doc changes required" in the session summary instead.
