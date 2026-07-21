# Overview Patterns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three pattern visualizations to the Overview tab — an activity heatmap, a session-length histogram, and a compact week cost-at-a-glance — in a swapped two-column layout where patterns lead on the left.

**Architecture:** A new `getOverviewPatterns()` server query in `src/lib/queries.ts` returns a single `OverviewPatterns` shape covering all three views; `src/app/page.tsx` threads it into `OverviewView`, which renders three new client sub-components. The heatmap uses a new quantized `heat-fill-N` token family in `globals.css` (paralleling the existing `meter-fill`/`spark-fill` classes) so no inline styles are introduced.

**Tech Stack:** Next.js App Router (server components + one client component), SQLite via `better-sqlite3`, Drizzle schema, Vitest for query tests.

## Global Constraints

- **No raw palette colors, arbitrary values, inline styles, or `dark:` variants** in new UI. Use semantic tokens and component classes from `src/app/globals.css`. For dynamic chart fills, use quantized `meter-fill-N` / `spark-fill-N` / `heat-fill-N` classes. (AGENTS.md → "New UI must use semantic tokens…")
- **Queries live in `src/lib/queries.ts`** — the server-side read boundary. Client components may import **types only** from it. Runtime values shared with client code belong in `src/lib/types.ts`, `src/lib/labels.ts`, or `src/lib/format.ts`. (AGENTS.md → relay architecture)
- **Costs are derived at read time, never stored.** A session/week gets a dollar figure only when every usage row is priced (reported or table match); otherwise it shows "unavailable" and is excluded from dollar aggregates. (AGENTS.md → usage and cost)
- **Status is derived at query time**, not trusted from the stored column. Use the existing `statusExpression("status", "updated_at")` + `staleCutoff()` pattern where status matters. (AGENTS.md → session status)
- **Session status semantics:** `completed` (explicit completion), `interrupted` (explicit abort/cancel), `needs_attention` (explicit failure), `running` (last 10 min), `incomplete` (stale beyond 10 min). Inactivity alone never implies interruption.
- **Every task ends with `npm run verify`** passing (lint, typecheck, formatting, tests, build) unless the task is explicitly test-only.
- **Branch naming:** `zcode/feat/overview-patterns`.
- **Commit style:** match the repo's emoji-prefix convention (`✨ feat:`, `🎨 style:`, `📝 docs:`).

---

## File Structure

| File                               | Responsibility                                                                                                                                | Action |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `src/lib/queries.ts`               | Add `OverviewPatterns` interface + `getOverviewPatterns()` server query (heatmap grid, length histogram, week cost)                           | Modify |
| `src/lib/queries.test.ts`          | Add tests for `getOverviewPatterns()` covering heatmap counts, length buckets, cost null-on-unpriced                                          | Modify |
| `src/app/globals.css`              | Add `--heat-*` tokens in `:root` and `heat-fill-0`…`heat-fill-10` + `.heatmap`/`.heat-cell` component classes                                 | Modify |
| `src/components/overview-view.tsx` | Swap column order; remove "Agents this week" + "Last 14 days"; add three sub-components (`ActivityHeatmap`, `SessionLength`, `CostAtAGlance`) | Modify |
| `src/app/page.tsx`                 | Call `getOverviewPatterns()` and pass to `<OverviewView>`                                                                                     | Modify |
| `README.md`                        | Update `/` route description to mention pattern views                                                                                         | Modify |
| `AGENTS.md`                        | Update Pages entry for `/` to mention patterns section                                                                                        | Modify |

---

### Task 1: Heatmap + length + cost query (with tests)

**Files:**

- Modify: `src/lib/queries.ts` (append new interface + function at end of file)
- Modify: `src/lib/queries.test.ts` (add new `describe` block)

**Interfaces:**

- Consumes: `sqlite` (from `@/db/client`), `usageCostUsd` + `normalizeModel` (from `./pricing`), `UNKNOWN_PROJECT_KEY` (from `./types`) — all already imported in `queries.ts`.
- Produces: `OverviewPatterns` interface and `getOverviewPatterns()` function, used by Task 2 (page) and Task 4 (view).

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to the end of `src/lib/queries.test.ts` (after the closing of the `"usage and cost queries"` describe at line 357):

```typescript
describe("overview patterns", () => {
  it("builds a 7x24 heatmap with counts from recent sessions", () => {
    const patterns = queries.getOverviewPatterns();
    expect(patterns.heatmap).toHaveLength(7 * 24);
    // Each cell carries its grid coordinates.
    expect(patterns.heatmap[0]).toMatchObject({ dayOfWeek: 0, hour: 0 });
    expect(patterns.heatmap.at(-1)).toMatchObject({ dayOfWeek: 6, hour: 23 });
    // Three sessions started within the 30-day window; their cells are > 0.
    const total = patterns.heatmap.reduce((sum, cell) => sum + cell.count, 0);
    expect(total).toBe(3);
  });

  it("buckets session length and summarizes the long tail", () => {
    const patterns = queries.getOverviewPatterns();
    expect(patterns.length.buckets).toHaveLength(5);
    // Bucket labels are stable and ordered shortest to longest.
    expect(patterns.length.buckets.map((b) => b.label)).toEqual([
      "< 2 min",
      "2–10 min",
      "10–30 min",
      "30 min–1h",
      "1–2h",
    ]);
    expect(patterns.length.sessionCount).toBe(3);
    // All three week-window sessions are short (0 runtime): "< 2 min".
    expect(patterns.length.buckets[0]?.count).toBe(3);
  });

  it("reports week cost as null when any usage row is unpriced", () => {
    const patterns = queries.getOverviewPatterns();
    // Session 3 ("Stale runner", mystery-model) is in the 7-day window and
    // unpriced, so the week total must be unavailable even though other
    // sessions are priced.
    expect(patterns.costWeek.costUsd).toBeNull();
    // Token total still shows regardless of pricing.
    expect(patterns.costWeek.tokens).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/queries.test.ts -t "overview patterns"`
Expected: FAIL — `queries.getOverviewPatterns is not a function`.

- [ ] **Step 3: Add the `OverviewPatterns` interface to `queries.ts`**

Add immediately **above** the existing `OverviewData` interface (line 355):

```typescript
export interface OverviewPatterns {
  heatmap: { dayOfWeek: number; hour: number; count: number }[];
  length: {
    buckets: { label: string; count: number }[];
    medianMs: number | null;
    longestMs: number | null;
    longTailShare: number | null;
    sessionCount: number;
  };
  costWeek: {
    costUsd: number | null;
    tokens: number;
    topModels: { model: string; costUsd: number }[];
  };
}
```

- [ ] **Step 4: Add `getOverviewPatterns()` to the end of `queries.ts`**

Append at the very end of the file (after `getSyncState`). This reuses the same runtime expression, status convention, and pricing-trust rule used elsewhere in the file:

```typescript
const PATTERNS_HEATMAP_DAYS = 30;
const LENGTH_BUCKETS = [
  { label: "< 2 min", min: 0, max: 2 * 60_000 },
  { label: "2–10 min", min: 2 * 60_000, max: 10 * 60_000 },
  { label: "10–30 min", min: 10 * 60_000, max: 30 * 60_000 },
  { label: "30 min–1h", min: 30 * 60_000, max: 60 * 60_000 },
  { label: "1–2h", min: 60 * 60_000, max: 2 * 60 * 60_000 },
] as const;

/**
 * Derives the three overview "pattern" views from existing session and
 * usage tables. The heatmap aggregates started_at over the trailing 30 days
 * into a 7 (Mon=0) x 24 (hour) grid; the length histogram buckets the
 * runtime expression over the trailing 7 days; the week cost reuses the
 * pricing-trust rule (null when any usage row is unpriced).
 */
export function getOverviewPatterns(): OverviewPatterns {
  // --- heatmap: 7x24 grid of session-start counts over 30 days ---
  const heatStart = new Date(
    Date.now() - PATTERNS_HEATMAP_DAYS * DAY_MS,
  ).toISOString();
  const heatRows = sqlite
    .prepare(
      `SELECT
        (CAST(strftime('%w', started_at, 'weekday 1') AS INTEGER) + 6) % 7 AS dayOfWeek,
        CAST(strftime('%H', started_at) AS INTEGER) AS hour,
        COUNT(*) AS count
       FROM sessions WHERE started_at >= ?
       GROUP BY dayOfWeek, hour`,
    )
    .all(heatStart) as { dayOfWeek: number; hour: number; count: number }[];
  const heatMap = new Map(
    heatRows.map((row) => [row.dayOfWeek * 24 + row.hour, row.count]),
  );
  const heatmap = Array.from({ length: 7 * 24 }, (_, index) => ({
    dayOfWeek: Math.floor(index / 24),
    hour: index % 24,
    count: heatMap.get(index) ?? 0,
  }));

  // --- length histogram: bucket runtime over 7 days ---
  const lengthStart = new Date(Date.now() - 7 * DAY_MS).toISOString();
  const lengthRows = sqlite
    .prepare(
      `SELECT
        CAST((julianday(COALESCE(ended_at, updated_at)) - julianday(started_at)) * 86400000 AS INTEGER) AS runtimeMs
       FROM sessions
       WHERE started_at >= ? AND started_at <= ?`,
    )
    .all(lengthStart, new Date().toISOString()) as { runtimeMs: number }[];
  const runtimes = lengthRows.map((row) => row.runtimeMs).sort((a, b) => a - b);
  const buckets = LENGTH_BUCKETS.map((bucket) => ({
    label: bucket.label,
    count: runtimes.filter((ms) => ms >= bucket.min && ms < bucket.max).length,
  }));
  const medianMs =
    runtimes.length > 0 ? runtimes[Math.floor(runtimes.length / 2)] : null;
  const longestMs = runtimes.length > 0 ? runtimes.at(-1)! : null;
  const longRuntimeMs = runtimes
    .filter((ms) => ms >= 30 * 60_000)
    .reduce((sum, ms) => sum + ms, 0);
  const totalRuntimeMs = runtimes.reduce((sum, ms) => sum + ms, 0);
  const longTailShare =
    totalRuntimeMs > 0 ? longRuntimeMs / totalRuntimeMs : null;

  // --- week cost: reuse pricing-trust rule over 7-day window ---
  const weekStart = new Date(Date.now() - 7 * DAY_MS).toISOString();
  const usageRows = sqlite
    .prepare(`${USAGE_JOIN} WHERE s.started_at >= ?`)
    .all(weekStart) as UsageJoinRow[];
  let costUsd = 0;
  let tokens = 0;
  let priced = true;
  const byModel = new Map<string, { costUsd: number; priced: boolean }>();
  for (const row of usageRows) {
    const rowTokens =
      row.inputTokens +
      row.outputTokens +
      row.cacheReadTokens +
      row.cacheWriteTokens;
    tokens += rowTokens;
    const cost = rowCost(row);
    const modelKey = normalizeModel(row.model);
    const model = byModel.get(modelKey) ?? { costUsd: 0, priced: true };
    if (cost === undefined) {
      priced = false;
      model.priced = false;
    } else {
      costUsd += cost;
      model.costUsd += cost;
    }
    byModel.set(modelKey, model);
  }
  const topModels = [...byModel.entries()]
    .map(([model, totals]) => ({
      model,
      costUsd: totals.priced ? totals.costUsd : 0,
    }))
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, 3);

  return {
    heatmap,
    length: {
      buckets,
      medianMs,
      longestMs,
      longTailShare,
      sessionCount: runtimes.length,
    },
    costWeek: {
      costUsd: usageRows.length && priced ? costUsd : null,
      tokens,
      topModels,
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/queries.test.ts`
Expected: PASS — all existing tests plus the three new "overview patterns" tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries.ts src/lib/queries.test.ts
git commit -m "✨ feat: add overview patterns query (heatmap, length, week cost)"
```

---

### Task 2: Thread patterns into the Overview page

**Files:**

- Modify: `src/app/page.tsx`

**Interfaces:**

- Consumes: `getOverviewPatterns` (produced by Task 1).
- Produces: a `patterns` prop on `<OverviewView>` (consumed by Task 4).

- [ ] **Step 1: Import `getOverviewPatterns` and call it**

In `src/app/page.tsx`, add `getOverviewPatterns` to the import from `@/lib/queries`:

```typescript
import {
  getAttentionSessions,
  getCollectorHealth,
  getOverview,
  getOverviewPatterns,
  getProjects,
  getRunningSessions,
} from "@/lib/queries";
```

- [ ] **Step 2: Pass `patterns` to `<OverviewView>`**

Add the `patterns` prop to the `<OverviewView>` call:

```typescript
      <OverviewView
        overview={getOverview()}
        patterns={getOverviewPatterns()}
        running={getRunningSessions()}
        attention={getAttentionSessions()}
        recentProjects={getProjects()
          .filter((project) => project.category === "project")
          .slice(0, 5)}
      />
```

- [ ] **Step 3: Verify the build still compiles (it will fail typecheck — expected, Task 4 adds the prop)**

Run: `npx tsc --noEmit 2>&1 | grep page.tsx || echo "no page.tsx errors"`
Expected: The only `page.tsx` error references the missing `patterns` prop on `OverviewView` (which Task 4 resolves). This step is a checkpoint — do **not** run `npm run verify` yet.

- [ ] **Step 4: Commit** (the page compiles once Task 4 lands; stage it now to keep the diff cohesive)

```bash
git add src/app/page.tsx
git commit -m "✨ feat: thread overview patterns into the page server component"
```

---

### Task 3: Heatmap CSS tokens and component classes

**Files:**

- Modify: `src/app/globals.css` — add tokens to `:root` (after line 73, before the closing `}`) and add component classes inside the existing `@layer components` block (after the `spark-fill-10` rule, around line 1288).

**Interfaces:**

- Consumes: the existing `--accent` token and the `level()` helper convention (0–10 quantization).
- Produces: `.heatmap`, `.heatmap-row`, `.heat-cell`, `.heat-day-label`, `.heat-hour-label`, `.heat-legend`, and `heat-fill-0`…`heat-fill-10` classes, consumed by Task 4.

- [ ] **Step 1: Add `--heat-*` tokens to `:root`**

In `src/app/globals.css`, inside the `:root { … }` block, add these five tokens immediately **after** the `--badge-5-foreground` line (line 63) and before `--text-xs`:

```css
--heat-0: var(--muted);
--heat-1: color-mix(in srgb, var(--accent) 22%, var(--muted));
--heat-2: color-mix(in srgb, var(--accent) 40%, var(--muted));
--heat-3: color-mix(in srgb, var(--accent) 60%, var(--muted));
--heat-4: color-mix(in srgb, var(--accent) 85%, var(--muted));
```

- [ ] **Step 2: Add heatmap component classes inside `@layer components`**

Inside the existing `@layer components` block, immediately **after** the `.spark-fill-10 { … }` rule (around line 1288), add:

```css
.heatmap {
  display: grid;
  grid-template-columns: 1.6rem repeat(24, minmax(0, 1fr));
  gap: 0.15rem;
}
.heat-hour-label {
  color: var(--muted-foreground);
  font-size: 0.55rem;
  text-align: center;
}
.heat-day-label {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  color: var(--muted-foreground);
  font-size: var(--text-xs);
  padding-right: 0.3rem;
}
.heat-cell {
  aspect-ratio: 1;
  border-radius: 0.15rem;
  background: var(--heat-0);
}
.heatmap-legend {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.35rem;
  margin-top: 0.5rem;
  color: var(--muted-foreground);
  font-size: 0.55rem;
}
.heatmap-legend-cells {
  display: flex;
  gap: 0.15rem;
}
.heatmap-legend-cells span {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 0.15rem;
}
.heat-fill-0 {
  background: var(--heat-0);
}
.heat-fill-1 {
  background: var(--heat-1);
}
.heat-fill-2 {
  background: var(--heat-1);
}
.heat-fill-3 {
  background: var(--heat-2);
}
.heat-fill-4 {
  background: var(--heat-2);
}
.heat-fill-5 {
  background: var(--heat-3);
}
.heat-fill-6 {
  background: var(--heat-3);
}
.heat-fill-7 {
  background: var(--heat-4);
}
.heat-fill-8 {
  background: var(--heat-4);
}
.heat-fill-9 {
  background: var(--heat-4);
}
.heat-fill-10 {
  background: var(--accent);
}
```

Note: the `heat-fill-N` classes map the 0–10 quantization onto the 5-step `--heat-*` ramp (two levels per step, full accent at 10). This parallels how `spark-fill-N` quantizes the same accent.

- [ ] **Step 3: Run `npm run verify`**

Run: `npm run verify`
Expected: PASS (CSS-only change; no type or test impact). Confirm there are no PostCSS/Tailwind errors about `color-mix` — it's supported in the project's browser targets.

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css
git commit -m "🎨 style: add heatmap tokens and component classes"
```

---

### Task 4: Render the three pattern views and swap columns

**Files:**

- Modify: `src/components/overview-view.tsx`

**Interfaces:**

- Consumes: `OverviewPatterns` type (from `@/lib/queries`, types-only import), `patterns` prop (from Task 2), `heat-fill-N` / meter / spark classes (from Task 3), `formatCostUsd` + `formatTokens` + `runtime` (from `@/lib/format`).
- Produces: the final rendered Overview with patterns on the left.

- [ ] **Step 1: Update imports and props**

At the top of `src/components/overview-view.tsx`, add `OverviewPatterns` to the type import and add the format helpers:

```typescript
import {
  AlertTriangle,
  CircleDot,
  Clock3,
  FolderKanban,
  LayoutDashboard,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect } from "react";
import {
  elapsed,
  formatCostUsd,
  formatTokens,
  relativeTime,
  runtime,
} from "@/lib/format";
import { providerBadges, providerLabels, statusLabels } from "@/lib/labels";
import type {
  OverviewData,
  OverviewPatterns,
  ProjectSummary,
  SessionListItem,
} from "@/lib/queries";
```

(Note: `Clock3` is newly imported for the length card icon; it's used in Step 4.)

Update the `OverviewViewProps` interface and destructure `patterns`:

```typescript
interface OverviewViewProps {
  overview: OverviewData;
  patterns: OverviewPatterns;
  running: SessionListItem[];
  attention: SessionListItem[];
  recentProjects: ProjectSummary[];
}

export function OverviewView({
  overview,
  patterns,
  running,
  attention,
  recentProjects,
}: OverviewViewProps) {
```

- [ ] **Step 2: Replace the body of `OverviewView` (the JSX return)**

Replace the entire `<div className="overview-grid">…</div>` block (the two columns) with the swapped layout shown below. Keep the `<section>`, `<header>`, and `<div className="summary-grid">` blocks above it unchanged. The new grid puts patterns on the left and operational on the right:

```tsx
<div className="overview-grid">
  <div className="overview-column">
    <ActivityHeatmap cells={patterns.heatmap} />
    <SessionLength length={patterns.length} />
    <CostAtAGlance cost={patterns.costWeek} />
  </div>

  <div className="overview-column">
    <section className="card overview-card" aria-label="Running now">
      <div className="overview-card-head">
        <h3>Running now</h3>
        <Link href="/sessions?status=running">View all</Link>
      </div>
      {running.length ? (
        running.map((session) => (
          <SessionLine key={session.id} session={session} />
        ))
      ) : (
        <p className="overview-empty">No sessions are currently active.</p>
      )}
    </section>
    <section className="card overview-card" aria-label="Needs attention">
      <div className="overview-card-head">
        <h3>
          <AlertTriangle size={14} className="inline-icon" /> Needs attention
        </h3>
        <Link href="/sessions?status=interrupted">View all</Link>
      </div>
      {attention.length ? (
        attention.map((session) => (
          <SessionLine key={session.id} session={session} />
        ))
      ) : (
        <p className="overview-empty">
          Nothing needs attention in the last day.
        </p>
      )}
    </section>
    <section className="card overview-card" aria-label="Recent projects">
      <div className="overview-card-head">
        <h3>
          <FolderKanban size={14} className="inline-icon" /> Recent projects
        </h3>
        <Link href="/projects">View all</Link>
      </div>
      {recentProjects.map((project) => (
        <Link
          key={project.key}
          className="project-session-row"
          href={`/projects?selected=${encodeURIComponent(project.key)}`}
        >
          <span aria-hidden>
            <LayoutDashboard size={13} />
          </span>
          <div>
            <strong>{project.repository ?? "Unknown workspace"}</strong>
            <p>
              {project.sessionCount} sessions ·{" "}
              {runtime(project.totalRuntimeMs)}
            </p>
          </div>
          <time>{relativeTime(project.lastActivityAt)}</time>
        </Link>
      ))}
    </section>
  </div>
</div>
```

This removes the "Agents this week" and "Last 14 days" sections (per spec: the heatmap absorbs the daily strip, and `/usage` covers provider distribution). The `maxProvider`, `maxDaily`, and the now-unused `level` calls at the top of the component are addressed in Step 3.

- [ ] **Step 3: Remove the now-unused top-level computations**

The original component computes `maxProvider` and `maxDaily` (for the removed sections). Remove these two lines from the `OverviewView` function body, above the `return`:

```typescript
const maxProvider = Math.max(
  1,
  ...overview.providerCounts.map((entry) => entry.count),
);
const maxDaily = Math.max(1, ...overview.daily.map((entry) => entry.count));
```

The top-level `level()` helper function (line 27–30) **stays** — it is reused by the new sub-components below.

- [ ] **Step 4: Add the three sub-components at the end of the file**

Append these after the existing `SessionLine` function at the end of `src/components/overview-view.tsx`:

```tsx
function ActivityHeatmap({ cells }: { cells: OverviewPatterns["heatmap"] }) {
  const maxCount = Math.max(1, ...cells.map((cell) => cell.count));
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  // cells[] is in day-major order (dayOfWeek*24 + hour) from the query, so
  // direct indexing is O(1) and avoids a find() per cell.
  const hourLabel = (hour: number) =>
    hour % 3 === 0
      ? hour === 0
        ? "12a"
        : hour < 12
          ? `${hour}a`
          : hour === 12
            ? "12p"
            : `${hour - 12}p`
      : "";
  return (
    <section className="card overview-card" aria-label="Activity heatmap">
      <div className="overview-card-head">
        <h3>When you&apos;re active</h3>
        <span>last 30 days</span>
      </div>
      <div className="heatmap" role="img" aria-label="Sessions by day and hour">
        {/* header row: empty corner + 24 hour labels */}
        <span aria-hidden />
        {Array.from({ length: 24 }, (_, hour) => (
          <span key={`h${hour}`} className="heat-hour-label">
            {hourLabel(hour)}
          </span>
        ))}
        {/* 7 day rows: day label + 24 cells, each row = 25 grid items */}
        {days.map((day, dayIndex) => (
          <Fragment key={day}>
            <span className="heat-day-label">{day}</span>
            {Array.from({ length: 24 }, (_, hour) => {
              const cell = cells[dayIndex * 24 + hour];
              return (
                <span
                  key={`${dayIndex}-${hour}`}
                  className={`heat-cell heat-fill-${level(cell.count, maxCount)}`}
                  title={`${day} ${hour}:00 — ${cell.count} sessions`}
                />
              );
            })}
          </Fragment>
        ))}
      </div>
      <div className="heatmap-legend">
        <span>fewer</span>
        <span className="heatmap-legend-cells">
          <span className="heat-fill-0" />
          <span className="heat-fill-2" />
          <span className="heat-fill-4" />
          <span className="heat-fill-6" />
          <span className="heat-fill-10" />
        </span>
        <span>more</span>
      </div>
    </section>
  );
}

function SessionLength({ length }: { length: OverviewPatterns["length"] }) {
  const maxBucket = Math.max(
    1,
    ...length.buckets.map((bucket) => bucket.count),
  );
  return (
    <section className="card overview-card" aria-label="Session length">
      <div className="overview-card-head">
        <h3>
          <Clock3 size={14} className="inline-icon" /> Session length
        </h3>
        <span>last 7 days · {length.sessionCount} sessions</span>
      </div>
      <div className="hist-list">
        {length.buckets.map((bucket) => (
          <div
            key={bucket.label}
            className="hist-row"
            title={`${bucket.count} sessions`}
          >
            <span className="hist-label">{bucket.label}</span>
            <span className="meter" aria-hidden>
              <i className={`meter-fill-${level(bucket.count, maxBucket)}`} />
            </span>
            <span className="mono">{bucket.count}</span>
          </div>
        ))}
      </div>
      {length.medianMs !== null && length.longestMs !== null && (
        <p className="hist-footnote">
          Median <strong>{runtime(length.medianMs)}</strong> · longest{" "}
          <strong>{runtime(length.longestMs)}</strong>
          {length.longTailShare !== null && length.longTailShare > 0 && (
            <>
              {" · "}
              sessions over 30 min hold{" "}
              <strong>{Math.round(length.longTailShare * 100)}%</strong> of
              runtime
            </>
          )}
        </p>
      )}
    </section>
  );
}

function CostAtAGlance({ cost }: { cost: OverviewPatterns["costWeek"] }) {
  const maxModel = Math.max(1, ...cost.topModels.map((model) => model.costUsd));
  return (
    <section className="card overview-card" aria-label="Cost this week">
      <div className="overview-card-head">
        <h3>Cost this week</h3>
        <Link href="/usage">Full breakdown →</Link>
      </div>
      <div className="cost-total">
        <strong className="mono">
          {cost.costUsd === null ? "—" : formatCostUsd(cost.costUsd)}
        </strong>
        <span>
          {cost.costUsd === null
            ? `Unavailable · ${formatTokens(cost.tokens)}`
            : `estimated · ${formatTokens(cost.tokens)}`}
        </span>
      </div>
      {cost.topModels.length > 0 &&
        cost.topModels.map((model) => (
          <div
            key={model.model}
            className="cost-row"
            title={`${model.model}: ${formatCostUsd(model.costUsd)}`}
          >
            <span className="cost-label mono">{model.model}</span>
            <span className="meter" aria-hidden>
              <i className={`meter-fill-${level(model.costUsd, maxModel)}`} />
            </span>
            <span className="mono">{formatCostUsd(model.costUsd)}</span>
          </div>
        ))}
    </section>
  );
}
```

- [ ] **Step 5: Add the supporting CSS classes for the length and cost cards**

The heatmap classes were added in Task 3, but `.hist-list`, `.hist-row`, `.hist-label`, `.hist-footnote`, `.cost-total`, `.cost-row`, and `.cost-label` are new. Add them inside `@layer components` in `src/app/globals.css`, immediately after the `.heatmap-legend-cells span { … }` rule added in Task 3:

```css
.hist-list {
  display: grid;
  gap: 0.5rem;
}
.hist-row {
  display: grid;
  grid-template-columns: 5.5rem minmax(0, 1fr) 3.5rem;
  align-items: center;
  gap: 0.6rem;
}
.hist-label {
  color: var(--muted-foreground);
  font-size: var(--text-xs);
}
.hist-footnote {
  margin-top: 0.5rem;
  border-top: 1px solid var(--border);
  padding-top: 0.5rem;
  color: var(--muted-foreground);
  font-size: var(--text-xs);
}
.hist-footnote strong {
  color: var(--foreground);
  font-weight: 600;
}
.cost-total {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin-bottom: 0.6rem;
}
.cost-total strong {
  font-size: var(--text-2xl);
  font-weight: 600;
  letter-spacing: -0.02em;
}
.cost-row {
  display: grid;
  grid-template-columns: minmax(5rem, 8rem) minmax(0, 1fr) 3.5rem;
  align-items: center;
  gap: 0.6rem;
  padding-block: 0.35rem;
}
.cost-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-xs);
}
.cost-row .mono {
  text-align: right;
  color: var(--muted-foreground);
  font-size: var(--text-xs);
}
```

- [ ] **Step 6: Run `npm run verify`**

Run: `npm run verify`
Expected: PASS — lint, typecheck (the `patterns` prop now exists), formatting, tests, and build all green.

The heatmap renders as a CSS grid: a corner + 24 hour labels (header row = 25 items), then 7 × (day label + 24 cells = 25 items). `Fragment` groups each day row for React keying; the `level()` helper maps cell counts to `heat-fill-0…10` quantized classes — no inline styles.

- [ ] **Step 7: Commit**

```bash
git add src/components/overview-view.tsx src/app/globals.css
git commit -m "✨ feat: render overview patterns (heatmap, length, cost) and swap columns"
```

---

### Task 5: Update README and AGENTS.md

**Files:**

- Modify: `README.md` (the `/` row in the "Pages" table)
- Modify: `AGENTS.md` (the Pages line for `/`)

**Interfaces:**

- Consumes: the shipped feature from Tasks 1–4.
- Produces: accurate docs.

- [ ] **Step 1: Update the README `/` route row**

In `README.md`, replace the `/` row in the "Pages" table. Change the cell content from the current description to:

```markdown
| `/` | Overview — daily/weekly summaries, running and needs-attention sessions, and a patterns section (activity heatmap by day/hour, session-length histogram, week cost-at-a-glance). Cards link into filtered views. |
```

- [ ] **Step 2: Update the AGENTS.md `/` page entry**

In `AGENTS.md`, in the "Pages:" architecture bullet, update the `/` Overview parenthetical. Replace:

```
Pages: `/` Overview (`overview-view.tsx`), `/sessions` (`dashboard.tsx`), ...
```

with:

```
Pages: `/` Overview (`overview-view.tsx`; patterns via `getOverviewPatterns()` — heatmap, session length, week cost), `/sessions` (`dashboard.tsx`), ...
```

- [ ] **Step 3: Run `npm run verify`**

Run: `npm run verify`
Expected: PASS — docs-only change.

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md
git commit -m "📝 docs: document overview patterns in README and AGENTS.md"
```

---

## Self-Review Notes

**Spec coverage:**

- Heatmap → Task 1 (query) + Task 3 (CSS) + Task 4 (component). ✓
- Length histogram → Task 1 + Task 4. ✓
- Cost-at-a-glance → Task 1 + Task 4. ✓
- Column swap (patterns left, operational right) → Task 4 Step 2. ✓
- Remove "Agents this week" + "Last 14 days" → Task 4 Step 2/3. ✓
- Pricing-trust rule (null on unpriced) → Task 1 query + Task 1 test. ✓
- Semantic tokens / no inline styles → Task 3 `heat-fill-N` classes. ✓
- README + AGENTS.md update → Task 5. ✓
- `npm run verify` per task → every task. ✓

**Placeholder scan:** No TBD/TODO. All code blocks are complete.

**Type consistency:** `OverviewPatterns` (defined Task 1) → consumed as `patterns` prop (Task 2) → destructured into `OverviewPatterns["heatmap"]`/`["length"]`/`["costWeek"]` in Task 4 sub-components. Field names (`heatmap`, `length`, `costWeek`, `buckets`, `medianMs`, `longTailShare`, `topModels`) are consistent across all tasks.

**Known risk:** The heatmap's hour-label rendering in Task 4 Step 4 uses a flattened approach to fit the CSS grid (24 columns). The exact hour-label strategy (every 3rd hour labeled vs. all 24) is a presentation detail resolved in Step 6's verification — if the grid doesn't lay out cleanly, the fallback is a separate flex row of 8 labels above the 7×24 cell grid. This does not affect the query contract.
