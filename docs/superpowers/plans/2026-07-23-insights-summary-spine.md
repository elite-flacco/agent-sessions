# Insights Summary Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a summary spine — a unified signals band and a three-tile KPI hero strip — above the existing `/insights` detail cards, surfacing the already-computed `cache.trend`/`cost.trend` series.

**Architecture:** Purely presentational changes inside `src/components/insights-view.tsx` plus new component classes in `src/app/globals.css`. No query, schema, or data changes — every value read already exists on the `Insights` type. Two new small components (`SignalBand`, `HeroStrip` with `KpiTile`) render above the unchanged card grid; the inline `<Signal>` blocks move out of the cards into the band; hero tiles reuse the existing `.spark`/`spark-fill-N` and `.meter`/`meter-fill-N` primitives.

**Tech Stack:** Next.js (App Router, client component), React, TypeScript, Vitest + React Testing Library (jsdom), CSS custom-property design tokens in `globals.css`.

## Global Constraints

- UI must use semantic tokens and component classes from `src/app/globals.css`. No raw Tailwind palette colors, no arbitrary values, no inline styles, no `dark:` variants. Dynamic bar/spark fills use the quantized `meter-fill-N` / `spark-fill-N` classes.
- Sentence case for all copy. Two font weights only (400/500) — inherited from existing styles.
- `src/lib/queries.ts` is a server-side read boundary; client components import **types only** from it (already the case in `insights-view.tsx`).
- Signals never fabricate a trend: only cache has a scalar week-over-week delta. Cost and adoption tiles use shape (sparkline) or ratio (meter), never a percentage arrow.
- Final task must review and update `README.md` (user-facing behavior) and `AGENTS.md` (architecture/conventions).
- Verification before finishing: run the project's format, lint, typecheck, test, and build checks; fix failures caused by the change.

## File Structure

- `src/components/insights-view.tsx` — MODIFY. Add `SignalBand`, `InsightSparkline`, `KpiTile`, `HeroStrip`; render band + strip in `InsightsView`; remove inline `<Signal>` from `CacheCard`/`CostCard`; add `id` anchors to the three cards.
- `src/components/insights-view.test.tsx` — CREATE. Unit tests for the new presentational pieces.
- `src/app/globals.css` — MODIFY. Add `.insight-signal-band`, `.insight-hero`, `.insight-kpi*`, `.insight-spark` classes.
- `README.md`, `AGENTS.md` — MODIFY (final task).

The three detail cards (`CacheCard`, `CostCard`, `CapabilityUsageCard`) keep all current content; only the noted anchor/signal edits touch them.

---

### Task 1: Signals band, moved out of the cards

**Files:**

- Modify: `src/components/insights-view.tsx`
- Modify: `src/app/globals.css`
- Test: `src/components/insights-view.test.tsx` (create)

**Interfaces:**

- Consumes: `Insights` (`insights.cache.signal`, `insights.cost.signal`), existing `InsightSignal` type and `Signal` component, `Sparkles` icon (all already in the file).
- Produces: `SignalBand({ insights }: { insights: Insights })` — a React component that renders collected signals; exported for test.

- [ ] **Step 1: Write the failing test**

Create `src/components/insights-view.test.tsx`:

```tsx
// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Insights } from "@/lib/queries";
import { SignalBand } from "./insights-view";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(cleanup);

function baseInsights(overrides: Partial<Insights> = {}): Insights {
  return {
    capabilities: {
      range: "7d",
      used: [],
      unused: [],
      installedCount: 0,
      installedUsedCount: 0,
      coverage: [],
    },
    cache: {
      week: {
        hitRate: null,
        hitRateDeltaPts: null,
        savedUsd: null,
        savedSharePct: null,
        byModel: [],
      },
      trend: [],
      signal: null,
    },
    cost: {
      week: { totalUsd: null, top5SharePct: null, paretoSharePct: null },
      outliers: [],
      trend: [],
      signal: null,
    },
    ...overrides,
  } as Insights;
}

describe("SignalBand", () => {
  test("orders warnings before info and renders both", () => {
    const insights = baseInsights();
    insights.cache.signal = { tone: "info", text: "cache info" };
    insights.cost.signal = { tone: "warning", text: "cost warning" };
    const { container } = render(<SignalBand insights={insights} />);
    const texts = [...container.querySelectorAll(".insight-signal span")].map(
      (n) => n.textContent,
    );
    expect(texts).toEqual(["cost warning", "cache info"]);
  });

  test("renders nothing when there are no signals", () => {
    const { container } = render(<SignalBand insights={baseInsights()} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/insights-view.test.tsx`
Expected: FAIL — `SignalBand` is not exported from `./insights-view`.

- [ ] **Step 3: Add the `SignalBand` component**

In `src/components/insights-view.tsx`, add (place it just after the existing `Signal` function):

```tsx
export function SignalBand({ insights }: { insights: Insights }) {
  const signals = [insights.cache.signal, insights.cost.signal]
    .filter((s): s is InsightSignal => s !== null)
    .sort(
      (a, b) => (a.tone === "warning" ? 0 : 1) - (b.tone === "warning" ? 0 : 1),
    );

  if (signals.length === 0) return null;

  return (
    <div className="insight-signal-band">
      {signals.map((signal, i) => (
        <Signal key={`${signal.tone}-${i}`} signal={signal} />
      ))}
    </div>
  );
}
```

Note: `Array.prototype.sort` is stable, so cache-before-cost order is preserved within a tone.

- [ ] **Step 4: Render the band and remove the inline card signals**

In `InsightsView`, insert the band between the header and the grid:

```tsx
      </header>

      <SignalBand insights={insights} />

      <div className="insights-grid">
```

In `CacheCard`, delete the line `{cache.signal && <Signal signal={cache.signal} />}`.
In `CostCard`, delete the line `{cost.signal && <Signal signal={cost.signal} />}`.

- [ ] **Step 5: Add the band style**

In `src/app/globals.css`, immediately before the `.insight-signal {` rule (around line 1292), add:

```css
.insight-signal-band {
  display: grid;
  gap: 0.4rem;
  margin-top: 0.9rem;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/components/insights-view.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/components/insights-view.tsx src/components/insights-view.test.tsx src/app/globals.css
git commit -m "✨ feat(insights): hoist card signals into a unified band"
```

---

### Task 2: Compact sparkline component

**Files:**

- Modify: `src/components/insights-view.tsx`
- Modify: `src/app/globals.css`
- Test: `src/components/insights-view.test.tsx`

**Interfaces:**

- Consumes: existing module-scope `level(value, max)` helper in `insights-view.tsx`.
- Produces: `InsightSparkline({ values, label }: { values: (number | null)[]; label: string })` — renders a compact bar sparkline, or `null` when there is no non-null data. Exported for test.

- [ ] **Step 1: Write the failing test**

Append to `src/components/insights-view.test.tsx`:

```tsx
import { InsightSparkline } from "./insights-view";

describe("InsightSparkline", () => {
  test("renders one slot per value with quantized fills", () => {
    const { container } = render(
      <InsightSparkline values={[0, 5, 10]} label="trend" />,
    );
    const slots = container.querySelectorAll(".spark-slot");
    expect(slots).toHaveLength(3);
    expect(container.querySelector(".spark-fill-10")).not.toBeNull();
  });

  test("renders nothing when every value is null or empty", () => {
    const { container: a } = render(
      <InsightSparkline values={[]} label="trend" />,
    );
    expect(a.firstChild).toBeNull();
    const { container: b } = render(
      <InsightSparkline values={[null, null]} label="trend" />,
    );
    expect(b.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/insights-view.test.tsx -t InsightSparkline`
Expected: FAIL — `InsightSparkline` is not exported.

- [ ] **Step 3: Add the component**

In `src/components/insights-view.tsx`, add (after `SignalBand`):

```tsx
export function InsightSparkline({
  values,
  label,
}: {
  values: (number | null)[];
  label: string;
}) {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  const max = Math.max(...present, 0);

  return (
    <span className="spark insight-spark" role="img" aria-label={label}>
      {values.map((v, i) => (
        <span className="spark-slot" key={i}>
          <i className={`spark-fill-${level(v ?? 0, max)}`} />
        </span>
      ))}
    </span>
  );
}
```

- [ ] **Step 4: Add the compact-height style**

In `src/app/globals.css`, immediately after the `.spark {` rule block (after its closing brace, around line 1721), add:

```css
.insight-spark {
  height: 1.6rem;
  gap: 0.12rem;
  padding-top: 0;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/insights-view.test.tsx -t InsightSparkline`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/insights-view.tsx src/components/insights-view.test.tsx src/app/globals.css
git commit -m "✨ feat(insights): add compact sparkline for KPI tiles"
```

---

### Task 3: KPI hero strip and card anchors

**Files:**

- Modify: `src/components/insights-view.tsx`
- Modify: `src/app/globals.css`
- Test: `src/components/insights-view.test.tsx`

**Interfaces:**

- Consumes: `InsightSparkline` (Task 2); `formatCostUsd` (already imported); `level` helper; `Insights`.
- Produces: `HeroStrip({ insights }: { insights: Insights })`, exported for test. Renders three `<a>` tiles linking to `#insight-cost`, `#insight-cache`, `#insight-capability`.

- [ ] **Step 1: Write the failing test**

Append to `src/components/insights-view.test.tsx`:

```tsx
import { HeroStrip } from "./insights-view";

describe("HeroStrip", () => {
  test("renders cost, cache, and adoption tiles with values and anchors", () => {
    const insights = baseInsights();
    insights.cost.week.totalUsd = 48.2;
    insights.cost.trend = [
      { day: "2026-07-20", costUsd: 4 },
      { day: "2026-07-21", costUsd: 8 },
    ];
    insights.cache.week.hitRate = 0.54;
    insights.cache.trend = [
      { day: "2026-07-20", hitRate: 0.6 },
      { day: "2026-07-21", hitRate: 0.54 },
    ];
    insights.capabilities.installedCount = 14;
    insights.capabilities.installedUsedCount = 9;

    const { container } = render(<HeroStrip insights={insights} />);
    expect(screen.getByText("54%")).toBeInTheDocument();
    expect(screen.getByText("9 / 14")).toBeInTheDocument();
    expect(container.querySelector('a[href="#insight-cost"]')).not.toBeNull();
    expect(
      container.querySelector('a[href="#insight-capability"]'),
    ).not.toBeNull();
  });

  test("shows a bare used count when nothing qualifies for the ratio", () => {
    const insights = baseInsights();
    insights.capabilities.installedCount = 0;
    insights.capabilities.installedUsedCount = 0;
    insights.capabilities.used = [
      {
        kind: "skill",
        name: "x",
        invocations: 1,
        sessionCount: 1,
        lastUsedAt: "2026-07-21",
        providers: [],
        byProvider: {},
      },
    ];
    render(<HeroStrip insights={insights} />);
    expect(screen.getByText("1 used")).toBeInTheDocument();
  });

  test("renders em dash for null cost and cache headlines", () => {
    render(<HeroStrip insights={baseInsights()} />);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/insights-view.test.tsx -t HeroStrip`
Expected: FAIL — `HeroStrip` is not exported.

- [ ] **Step 3: Add the `KpiTile` and `HeroStrip` components**

In `src/components/insights-view.tsx`, add (after `InsightSparkline`):

```tsx
function KpiTile({
  href,
  label,
  value,
  children,
}: {
  href: string;
  label: string;
  value: string;
  children?: ReactNode;
}) {
  return (
    <a className="insight-kpi" href={href}>
      <span className="insight-kpi-label">{label}</span>
      <span className="insight-kpi-value">{value}</span>
      <span className="insight-kpi-trend">{children}</span>
    </a>
  );
}

export function HeroStrip({ insights }: { insights: Insights }) {
  const { cache, cost, capabilities } = insights;

  const costValue =
    cost.week.totalUsd === null ? "—" : formatCostUsd(cost.week.totalUsd);
  const hitValue =
    cache.week.hitRate === null
      ? "—"
      : `${Math.round(cache.week.hitRate * 100)}%`;

  const adoptionValue =
    capabilities.installedCount > 0
      ? `${capabilities.installedUsedCount} / ${capabilities.installedCount}`
      : `${capabilities.used.length} used`;
  const adoptionLevel =
    capabilities.installedCount > 0
      ? level(capabilities.installedUsedCount, capabilities.installedCount)
      : 0;

  return (
    <div className="insight-hero">
      <KpiTile href="#insight-cost" label="Week cost" value={costValue}>
        <InsightSparkline
          values={cost.trend.map((d) => d.costUsd)}
          label="Cost per day this week"
        />
      </KpiTile>
      <KpiTile href="#insight-cache" label="Cache hit rate" value={hitValue}>
        <InsightSparkline
          values={cache.trend.map((d) => d.hitRate)}
          label="Cache hit rate per day this week"
        />
      </KpiTile>
      <KpiTile
        href="#insight-capability"
        label="Capability adoption"
        value={adoptionValue}
      >
        {capabilities.installedCount > 0 ? (
          <span className="meter" aria-hidden>
            <i className={`meter-fill-${adoptionLevel}`} />
          </span>
        ) : null}
      </KpiTile>
    </div>
  );
}
```

The tile uses `ReactNode`. Change the existing React import at line 6 from:

```tsx
import { useEffect } from "react";
```

to:

```tsx
import { useEffect, type ReactNode } from "react";
```

and use `children?: ReactNode;` in `KpiTile` (as written above — do not use `React.ReactNode`).

- [ ] **Step 4: Render the strip and add card anchors**

In `InsightsView`, insert the strip between the band and the grid:

```tsx
      <SignalBand insights={insights} />

      <HeroStrip insights={insights} />

      <div className="insights-grid">
```

Add `id` to each card's root `<section>`:

- `CacheCard`: `<section className="card insight-card" id="insight-cache" aria-label="Cache effectiveness">`
- `CostCard`: `<section className="card insight-card" id="insight-cost" aria-label="Cost outliers">`
- `CapabilityUsageCard` call site: wrap or pass an id. In `insights-view.tsx` wrap it:

```tsx
<div id="insight-capability">
  <CapabilityUsageCard capabilities={insights.capabilities} />
</div>
```

- [ ] **Step 5: Add the hero + tile styles**

In `src/app/globals.css`, immediately after the `.insights-grid { ... }` rule (after its closing brace, around line 1249), add:

```css
.insight-hero {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(0, 12rem));
  gap: 0.8rem;
  margin-top: 0.9rem;
}
.insight-kpi {
  display: grid;
  gap: 0.35rem;
  align-content: start;
  padding: 0.85rem 1rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: var(--card);
  color: inherit;
  text-decoration: none;
}
.insight-kpi:hover {
  border-color: var(--border-hover);
  background: var(--card-hover);
}
.insight-kpi-label {
  color: var(--muted-foreground);
  font-size: var(--text-xs);
}
.insight-kpi-value {
  font-size: var(--text-xl);
  letter-spacing: -0.03em;
}
.insight-kpi-trend {
  min-height: 1.6rem;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/components/insights-view.test.tsx`
Expected: PASS (all suites: SignalBand, InsightSparkline, HeroStrip).

- [ ] **Step 7: Commit**

```bash
git add src/components/insights-view.tsx src/components/insights-view.test.tsx src/app/globals.css
git commit -m "✨ feat(insights): add KPI hero strip above the detail cards"
```

---

### Task 4: Verification and documentation

**Files:**

- Modify: `README.md`
- Modify: `AGENTS.md`

**Interfaces:**

- Consumes: nothing new. This task validates the whole change and updates docs.

- [ ] **Step 1: Run the full check suite**

Run each and confirm it passes (fix any failure caused by this change):

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

If the project exposes a combined check script, run that too. Expected: all green. (Formatting: run the project's formatter if one is configured, e.g. `npm run format`.)

- [ ] **Step 2: Update `README.md`**

Find the section describing the Insights page. Add a sentence that the tab now opens with a signals band (collected warning/info callouts) and a KPI hero strip (Week cost, Cache hit rate, Capability adoption) that jump-links to the matching detail card, above the unchanged Cache/Cost/Capability cards.

- [ ] **Step 3: Update `AGENTS.md`**

In the `Pages` bullet, update the `/insights` description: note that the page leads with a `SignalBand` (cache + cost signals hoisted out of the cards, warning before info, hidden when empty) and a `HeroStrip` of three jump-linked KPI tiles, and that the per-day `cache.trend`/`cost.trend` series (already computed by `getInsights()`) now render as compact sparklines in the tiles while the cost/adoption tiles avoid a fabricated scalar delta.

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md
git commit -m "📝 docs(insights): document the summary-spine redesign"
```

---

## Self-Review Notes

- **Spec coverage:** Signals band (Task 1) ✓; hero strip with three tiles + honest trend cues (Task 3) ✓; surfacing `cache.trend`/`cost.trend` (Tasks 2–3) ✓; cards keep detail, only signals removed + anchors added (Tasks 1, 3) ✓; empty/null handling — empty band, `—` headlines, empty sparkline, `installedCount===0` fallback (Tasks 1–3 tests) ✓; docs (Task 4) ✓.
- **No new data plumbing:** every field read exists on `Insights` (verified against `src/lib/queries.ts:1252`).
- **Type consistency:** `SignalBand`, `InsightSparkline`, `KpiTile`, `HeroStrip` signatures match between definition and test import; `level(value, max)` reused as-is; `InsightSignal` type guard matches the existing `type InsightSignal`.
- **Tokens:** all new CSS uses semantic tokens (`--card`, `--border`, `--muted-foreground`, `--text-xs`, `--text-xl`) and reuses `meter-fill-N`/`spark-fill-N`; no inline styles or raw palette.
