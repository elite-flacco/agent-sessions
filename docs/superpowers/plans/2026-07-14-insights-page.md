# Insights Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/insights` page with two actionable efficiency cards — Cache Effectiveness and Cost Outliers — computed entirely from data already collected, to help the user use coding agents more productively.

**Architecture:** A new server-side `getInsights()` read-boundary function in `src/lib/queries.ts` derives both cards from `session_model_usage` + `session_model_usage` joined to `sessions`, using the existing `usageCostUsd`/`findPricing` pricing layer. A new server route `/insights` passes the result to a client `InsightsView` component that renders a responsive grid of two self-contained cards, reusing the existing `meter-fill-N` / `spark-fill-N` CSS ramps (no charting library). Signals are curated rule-based (hit-rate drop ≥ 15 pts; Pareto top-3 ≥ 50%).

**Tech Stack:** Next.js 16 App Router (server + client components), React 19, TypeScript, Drizzle ORM over SQLite (`better-sqlite3`), Tailwind v4 with semantic CSS classes, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-14-insights-page-design.md`

## Global Constraints

- **No schema changes, no new collection.** Both cards derive from existing `session_model_usage` (columns `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `reported_cost_usd`) joined to `sessions` (`started_at`, `ended_at`, `updated_at`, `title`, `model`, `status`).
- **No new charting dependency.** Reuse the quantized `meter-fill-0..10` and `spark-fill-0..10` CSS ramps already in `src/app/globals.css`.
- **Styling rules (AGENTS.md):** semantic tokens + component classes only. No raw Tailwind palette colors, no arbitrary values, no inline styles, no `dark:` variants.
- **Pricing-trust rule:** any dollar figure that depends on a complete price set reads `null` / "unavailable" when any contributing usage row is unpriced. Cache *hit rate* is token-only and always computable; *$ saved by caching*, *cost totals*, and *cost outliers* can be null.
- **Cache hit rate definition:** `cache_read_tokens / (cache_read_tokens + input_tokens)`. `cache_write_tokens` excluded (an investment, not a hit/miss).
- **Windows:** "this week" = trailing 7 calendar days; "prior week" = the 7 days before; "trend" = trailing 30 days daily. Match existing Overview/Usage framing.
- **Cost per runtime** = `costUsd / max(runtimeMinutes, 1)`; `runtimeMs` = `(julianday(COALESCE(ended_at, updated_at)) - julianday(started_at)) * 86400000` (same expression used in `getOverviewPatterns`).
- **Completion bar:** `npm run verify` must pass (runs lint + typecheck + format:check + test:run + build). Definition of Done: `docs/superpowers/plan-dod.md`.

---

## File Structure

**Create:**
- `src/app/insights/page.tsx` — server component; fetches `getInsights()` + `getCollectorHealth()`, renders shell.
- `src/components/insights-view.tsx` — client component; renders the two-card grid + 15s auto-refresh.
- `src/lib/insights.test.ts` — unit tests for `getInsights()` math, signals, pricing-trust, edge cases.

**Modify:**
- `src/lib/queries.ts` — add the `Insights` / `InsightSignal` interfaces and `getInsights()` function.
- `src/components/sidebar.tsx` — add the `/insights` `NavLink`.
- `src/app/globals.css` — add `.insights-grid`, `.insight-card`, and `.insight-signal` (warning/info) component classes.
- `README.md` — document the new `/insights` route.
- `AGENTS.md` — document the new page + `getInsights()` read boundary.

**Responsibilities:**
- `getInsights()` owns all aggregation and signal derivation; it is the only server-side read boundary for this feature and imports the SQLite client (so client components may import **types only**).
- `InsightsView` is purely presentational — it receives the fully-derived `Insights` object and renders it. No recomputation in the component.

---

## Task 1: `getInsights()` query — types + cache-effectiveness math

This task adds the `Insights` types and the cache-effectiveness half of `getInsights()`, with the cost half stubbed to a safe empty value. It is independently testable: the cache math (hit rate, $ saved, signals) has the most surface area, so it gets its own test cycle before the cost half is layered on.

**Files:**
- Modify: `src/lib/queries.ts` (append after `getOverviewPatterns`, ~line 1003)
- Test: `src/lib/insights.test.ts` (create)

**Interfaces:**
- Consumes: `usageCostUsd`, `findPricing`, `normalizeModel` from `./pricing`; `sqlite` from `@/db/client`; `DAY_MS` and `USAGE_JOIN` / `UsageJoinRow` (already defined in `queries.ts`).
- Produces: `Insights`, `InsightSignal`, `getInsights()` — exact shapes below. Task 2's UI consumes `Insights`; Task 3's cost half fills in the `cost` fields this task stubs.

```ts
export type InsightSignal = {
  tone: "warning" | "info";
  text: string;
};

export interface Insights {
  cache: {
    week: {
      hitRate: number | null; // weighted 0..1; null when no read+input tokens
      hitRateDeltaPts: number | null; // vs prior 7d, in percentage points
      savedUsd: number | null; // null when any row unpriced
      savedSharePct: number | null; // saved / gross cost; null when unpriced
      byModel: { model: string; hitRate: number; tokens: number }[];
    };
    trend: { day: string; hitRate: number | null }[]; // 30d daily
    signal: InsightSignal | null;
  };
  cost: {
    week: { totalUsd: number | null; paretoSharePct: number | null };
    outliers: {
      id: number;
      title: string;
      model: string | null;
      costUsd: number;
      runtimeMs: number;
      usdPerMin: number;
    }[];
    trend: { day: string; costUsd: number | null }[]; // reused from getUsageSummary().daily
    signal: InsightSignal | null;
  };
}
```

- [ ] **Step 1: Write the failing test** for cache-effectiveness math. Create `src/lib/insights.test.ts`:

```ts
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let directory = "";
let sqlite: (typeof import("@/db/client"))["sqlite"];
let queries: typeof import("./queries");

beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "relay-insights-"));
  process.env.RELAY_DATABASE_PATH = path.join(directory, "relay.db");
  vi.resetModules();
  ({ sqlite } = await import("@/db/client"));
  queries = await import("./queries");

  const now = new Date();
  const iso = (offsetMs: number) => new Date(now.getTime() - offsetMs).toISOString();
  const insertSession = sqlite.prepare(`INSERT INTO sessions
    (external_id, provider, title, model, status, started_at, updated_at, ended_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertUsage = sqlite.prepare(`INSERT INTO session_model_usage
    (session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reported_cost_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);

  // Session 1: this week, 75% cache hit (cache_read 300 / (300 + 100 input)).
  // Priced via pricing table (gpt-5.5) so $-saved is computed.
  insertSession.run("s1", "codex", "Cache-friendly run", "gpt-5.5", "completed", iso(0), iso(0), iso(0));
  insertUsage.run(1, "gpt-5.5", 100, 50, 300, 0, null);
  // Session 2: this week, priced, 0% cache hit (no cache reads).
  insertSession.run("s2", "codex", "Cold run", "gpt-5.5", "completed", iso(0), iso(0), iso(0));
  insertUsage.run(2, "gpt-5.5", 400, 50, 0, 0, null);
  // Session 3: prior week, high cache hit — establishes a baseline the delta measures against.
  // 9 days ago = outside this-week window, inside prior-week window.
  insertSession.run("s3", "codex", "Prior good cache", "gpt-5.5", "completed", iso(9 * 24 * 60 * 60_000), iso(9 * 24 * 60 * 60_000), iso(9 * 24 * 60 * 60_000));
  insertUsage.run(3, "gpt-5.5", 10, 0, 990, 0, null);
  // Session 4: this week, unpriced model — forces $-saved to null but still counts toward hit rate.
  insertSession.run("s4", "codex", "Unpriced run", "mystery-model", "completed", iso(0), iso(0), iso(0));
  insertUsage.run(4, "mystery-model", 100, 0, 100, 0, null);
});

afterAll(async () => {
  sqlite.close();
  delete process.env.RELAY_DATABASE_PATH;
  await fs.rm(directory, { recursive: true, force: true });
});

describe("getInsights — cache effectiveness", () => {
  it("computes a weighted hit rate across this week's tokens", () => {
    const { cache } = queries.getInsights();
    // This week: s1 read=300 in=100; s2 read=0 in=400; s4 read=100 in=100.
    // Weighted hit = (300 + 0 + 100) / (400 + 400 + 200) = 400/1000 = 0.4
    expect(cache.week.hitRate).toBeCloseTo(0.4, 5);
  });

  it("returns a by-model hit-rate breakdown", () => {
    const { cache } = queries.getInsights();
    const gpt = cache.week.byModel.find((m) => m.model === "gpt-5.5");
    expect(gpt).toBeDefined();
    // gpt-5.5 this week (s1 read=300 in=100, s2 read=0 in=400): 300/800 -> 0.375
    expect(gpt!.hitRate).toBeCloseTo(0.375, 5);
    expect(gpt!.tokens).toBe(900); // input+output+cacheRead+cacheWrite across s1+s2
  });

  it("reports $ saved as null when any this-week row is unpriced", () => {
    const { cache } = queries.getInsights();
    expect(cache.week.savedUsd).toBeNull();
    expect(cache.week.savedSharePct).toBeNull();
  });

  it("computes a week-over-week hit-rate delta in points", () => {
    const { cache } = queries.getInsights();
    // Prior week: s3 read=990 in=10 -> 0.99. This week: 0.4. Delta = -59 pts.
    expect(cache.week.hitRateDeltaPts).not.toBeNull();
    expect(cache.week.hitRateDeltaPts!).toBeCloseTo(-59, 0);
  });

  it("fires a warning signal on a >=15pt hit-rate drop", () => {
    const { cache } = queries.getInsights();
    expect(cache.signal).not.toBeNull();
    expect(cache.signal!.tone).toBe("warning");
    expect(cache.signal!.text).toMatch(/dropped/i);
  });

  it("produces a 30-day daily trend series", () => {
    const { cache } = queries.getInsights();
    expect(cache.trend).toHaveLength(30);
    expect(cache.trend[0]).toHaveProperty("day");
    expect(cache.trend.every((d) => typeof d.hitRate === "number" || d.hitRate === null)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/insights.test.ts`
Expected: FAIL — `queries.getInsights is not a function` (or import error).

- [ ] **Step 3: Implement the types + cache half of `getInsights()`**

Append to `src/lib/queries.ts` (after `getOverviewPatterns`, ~line 1003):

```ts
const INSIGHTS_TREND_DAYS = 30;
// Hit-rate drop (percentage points) that fires a warning signal.
const CACHE_DROP_THRESHOLD_PTS = 15;

export type InsightSignal = {
  tone: "warning" | "info";
  text: string;
};

export interface Insights {
  cache: {
    week: {
      hitRate: number | null;
      hitRateDeltaPts: number | null;
      savedUsd: number | null;
      savedSharePct: number | null;
      byModel: { model: string; hitRate: number; tokens: number }[];
    };
    trend: { day: string; hitRate: number | null }[];
    signal: InsightSignal | null;
  };
  cost: {
    week: { totalUsd: number | null; paretoSharePct: number | null };
    outliers: {
      id: number;
      title: string;
      model: string | null;
      costUsd: number;
      runtimeMs: number;
      usdPerMin: number;
    }[];
    trend: { day: string; costUsd: number | null }[];
    signal: InsightSignal | null;
  };
}

// Aggregate cache hit-rate and $-saved over a window of usage rows.
// hitRate = sum(cacheRead) / sum(cacheRead + input). savedUsd requires every
// row priced: it is the gap between actual cost and the counterfactual where
// cache_read_tokens are re-priced at the full input rate.
function aggregateCache(rows: UsageJoinRow[]) {
  let read = 0;
  let input = 0;
  let grossCost = 0; // actual cost (cache reads at cache-read rate)
  let counterfactual = 0; // if cache reads were priced as full input
  let priced = true;
  const byModel = new Map<
    string,
    { read: number; input: number; tokens: number }
  >();
  for (const row of rows) {
    read += row.cacheReadTokens;
    input += row.inputTokens;
    const cost = rowCost(row);
    if (cost === undefined) {
      priced = false;
    } else {
      const pricing = findPricing(row.model, row.startedAt);
      // $ saved only meaningful when we can price both the actual read rate
      // and the counterfactual input rate. rowCost being defined guarantees
      // pricing exists; recompute the cache-read contribution explicitly.
      if (pricing) {
        grossCost += cost;
        counterfactual +=
          cost +
          (row.cacheReadTokens *
            (pricing.inputPerMTok - pricing.cacheReadPerMTok)) /
            1_000_000;
      } else if (row.reportedCostUsd !== null) {
        // Reported cost with no pricing table entry: can't build a
        // counterfactual, so treat as unpriced for $-saved purposes.
        priced = false;
      }
    }
    const key = normalizeModel(row.model);
    const model = byModel.get(key) ?? { read: 0, input: 0, tokens: 0 };
    model.read += row.cacheReadTokens;
    model.input += row.inputTokens;
    model.tokens +=
      row.inputTokens +
      row.outputTokens +
      row.cacheReadTokens +
      row.cacheWriteTokens;
    byModel.set(key, model);
  }
  const hitRate = read + input > 0 ? read / (read + input) : null;
  const savedUsd = priced && counterfactual > grossCost ? counterfactual - grossCost : null;
  const savedSharePct =
    savedUsd !== null && counterfactual > 0
      ? (savedUsd / counterfactual) * 100
      : null;
  const byModelOut = [...byModel.entries()]
    .map(([model, m]) => ({
      model,
      hitRate: m.read + m.input > 0 ? m.read / (m.read + m.input) : 0,
      tokens: m.tokens,
    }))
    .sort((a, b) => b.tokens - a.tokens);
  return { hitRate, savedUsd, savedSharePct, byModel: byModelOut, read, input };
}

/**
 * Two actionable efficiency cards derived from existing usage data.
 * Cache hit rate is token-only and always available; $-saved and all cost
 * figures follow the pricing-trust rule (null when any row is unpriced).
 * Signals are curated and rule-based.
 */
export function getInsights(): Insights {
  const weekStart = new Date(Date.now() - 7 * DAY_MS).toISOString();
  const priorWeekStart = new Date(Date.now() - 14 * DAY_MS).toISOString();
  const trendStart = new Date(
    Date.now() - INSIGHTS_TREND_DAYS * DAY_MS,
  ).toISOString();

  const weekRows = sqlite
    .prepare(`${USAGE_JOIN} WHERE s.started_at >= ?`)
    .all(weekStart) as UsageJoinRow[];
  const priorRows = sqlite
    .prepare(`${USAGE_JOIN} WHERE s.started_at >= ? AND s.started_at < ?`)
    .all(priorWeekStart, weekStart) as UsageJoinRow[];
  const trendRows = sqlite
    .prepare(`${USAGE_JOIN} WHERE s.started_at >= ?`)
    .all(trendStart) as UsageJoinRow[];

  // --- cache effectiveness ---
  const weekCache = aggregateCache(weekRows);
  const priorCache = aggregateCache(priorRows);
  const hitRateDeltaPts =
    weekCache.hitRate !== null && priorCache.hitRate !== null
      ? (weekCache.hitRate - priorCache.hitRate) * 100
      : null;
  const cacheSignal: InsightSignal | null =
    hitRateDeltaPts !== null && hitRateDeltaPts <= -CACHE_DROP_THRESHOLD_PTS
      ? {
          tone: "warning",
          text: `Cache hit rate dropped ${Math.round(Math.abs(hitRateDeltaPts))} points week-over-week — long sessions may be losing context.`,
        }
      : null;

  // 30-day daily hit-rate trend, grouped by session start day.
  const trendByDay = new Map<string, { read: number; input: number }>();
  for (const row of trendRows) {
    const day = row.startedAt.slice(0, 10);
    const entry = trendByDay.get(day) ?? { read: 0, input: 0 };
    entry.read += row.cacheReadTokens;
    entry.input += row.inputTokens;
    trendByDay.set(day, entry);
  }
  const cacheTrend = Array.from({ length: INSIGHTS_TREND_DAYS }, (_, index) => {
    const date = new Date(
      Date.now() - (INSIGHTS_TREND_DAYS - 1 - index) * DAY_MS,
    )
      .toISOString()
      .slice(0, 10);
    const entry = trendByDay.get(date);
    return {
      day: date,
      hitRate:
        entry && entry.read + entry.input > 0
          ? entry.read / (entry.read + entry.input)
          : null,
    };
  });

  // Cost half is filled in by Task 3; stubbed to empty/safe values here.
  return {
    cache: {
      week: {
        hitRate: weekCache.hitRate,
        hitRateDeltaPts,
        savedUsd: weekCache.savedUsd,
        savedSharePct: weekCache.savedSharePct,
        byModel: weekCache.byModel,
      },
      trend: cacheTrend,
      signal: cacheSignal,
    },
    cost: {
      week: { totalUsd: null, paretoSharePct: null },
      outliers: [],
      trend: [],
      signal: null,
    },
  };
}
```

- [ ] **Step 4: Run the cache tests to verify they pass**

Run: `npx vitest run src/lib/insights.test.ts`
Expected: PASS — all 6 cache-effectiveness tests green.

- [ ] **Step 5: Verify the full suite still passes**

Run: `npm run verify`
Expected: PASS (lint, typecheck, format:check, test:run, build all green). The stubbed cost half returns safe empties, so no existing behavior is affected.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries.ts src/lib/insights.test.ts
git commit -m "✨ feat(insights): add getInsights cache-effectiveness aggregation"
```

---

## Task 2: `getInsights()` query — cost-outliers half

Layer in the cost half: week total + Pareto share, top-5 cost outliers with $/min, cost trend (reused from `getUsageSummary().daily`), and the Pareto concentration signal. Replaces the stubs from Task 1.

**Files:**
- Modify: `src/lib/queries.ts` (the `getInsights()` return's `cost:` block)
- Test: `src/lib/insights.test.ts` (append a `describe("getInsights — cost outliers")` block)

**Interfaces:**
- Consumes: `rowCost`, `USAGE_JOIN`, `UsageJoinRow`, `getUsageSummary` (for the reused daily trend). The session runtime SQL uses the same `julianday(...)` expression as `getOverviewPatterns`.
- Produces: the filled-in `cost` half of `Insights` (final shape; no further changes).

- [ ] **Step 1: Append the failing cost tests**

Add to `src/lib/insights.test.ts` (inside the module, after the existing `describe` blocks, still using the shared `beforeAll` fixtures). Note the fixtures already inserted sessions 1–4 in the **current** week with priced/unpriced mixes; add two more priced sessions so Pareto is meaningful:

```ts
describe("getInsights — cost outliers", () => {
  beforeAll(() => {
    const now = new Date();
    const iso = (offsetMs: number) =>
      new Date(now.getTime() - offsetMs).toISOString();
    // s5, s6: this week, priced, so a total + Pareto share exist. Insert via
    // a fresh prepared statement (the ones in the top-level beforeAll are out
    // of scope here).
    const insertSession = sqlite.prepare(`INSERT INTO sessions
      (external_id, provider, title, model, status, started_at, updated_at, ended_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertUsage = sqlite.prepare(`INSERT INTO session_model_usage
      (session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reported_cost_usd)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    insertSession.run("s5", "codex", "Big spend", "gpt-5.5", "completed", iso(0), iso(0), iso(0));
    insertUsage.run(5, "gpt-5.5", 2_000_000, 200_000, 0, 0, 1.0); // reported $1.00
    insertSession.run("s6", "codex", "Small spend", "gpt-5.5", "completed", iso(0), iso(0), iso(0));
    insertUsage.run(6, "gpt-5.5", 20_000, 0, 0, 0, 0.01); // reported $0.01
  });

  it("reports null week totals when any this-week session is unpriced", () => {
    // s4 (mystery-model) is unpriced and in this-week window.
    const { cost } = queries.getInsights();
    expect(cost.week.totalUsd).toBeNull();
    expect(cost.week.paretoSharePct).toBeNull();
  });

  it("lists cost outliers with $/min even when the week total is unpriced", () => {
    // Outliers are ranked by per-row cost; pricing-trust does not gate the
    // list (rows with a cost contribute, rows without are skipped).
    const { cost } = queries.getInsights();
    expect(cost.outliers.length).toBeGreaterThan(0);
    const big = cost.outliers.find((o) => o.title === "Big spend");
    expect(big).toBeDefined();
    expect(big!.costUsd).toBe(1.0);
    expect(big!.usdPerMin).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/insights.test.ts`
Expected: FAIL — cost-outlier tests fail (outliers list is empty, stubs return null/empty).

- [ ] **Step 3: Implement the cost half**

In `src/lib/queries.ts`, replace the stubbed `cost:` return block inside `getInsights()`. First, add a new query near the top of `getInsights()` (after `trendRows` is prepared) to fetch per-session cost + runtime for the week:

```ts
  // --- cost outliers: per-session cost + runtime over the week window ---
  interface CostRow {
    id: number;
    title: string;
    model: string | null;
    provider: AgentProvider;
    startedAt: string;
    runtimeMs: number;
  }
  const costSessionRows = sqlite
    .prepare(
      `SELECT s.id, s.title, s.model, s.provider, s.started_at startedAt,
        CAST((julianday(COALESCE(s.ended_at, s.updated_at)) - julianday(s.started_at)) * 86400000 AS INTEGER) AS runtimeMs
       FROM sessions s WHERE s.started_at >= ?`,
    )
    .all(weekStart) as CostRow[];
```

Then, after the cache section and before the `return`, compute the cost half. Replace the stubbed `cost:` block of the return statement with this implementation (and add the supporting computation just above the `return`):

```ts
  // Per-session usage cost over the week, keyed by session id. A session's
  // cost is the sum of its priced usage rows; unpriced rows contribute nothing
  // to that session's cost. runtimeMs comes from costSessionRows.
  const sessionCost = new Map<number, number>();
  let weekTotalUsd: number | null = 0;
  let anyUnpriced = false;
  for (const row of weekRows) {
    const cost = rowCost(row);
    if (cost === undefined) {
      anyUnpriced = true;
      continue;
    }
    weekTotalUsd += cost; // accumulate the priced grand total
    sessionCost.set(row.sessionId, (sessionCost.get(row.sessionId) ?? 0) + cost);
  }
  if (anyUnpriced) weekTotalUsd = null; // trust rule: null when any row unpriced

  // Outliers: top 5 by session cost. usdPerMin excludes zero/negative runtime.
  const runtimeById = new Map(
    costSessionRows.map((r) => [r.id, { row: r, runtimeMs: r.runtimeMs }]),
  );
  const outliers = [...sessionCost.entries()]
    .map(([id, costUsd]) => {
      const meta = runtimeById.get(id);
      const runtimeMs = meta?.runtimeMs ?? 0;
      const minutes = Math.max(runtimeMs / 60_000, 1);
      return {
        id,
        title: meta?.row.title ?? "Untitled",
        model: meta?.row.model ?? null,
        costUsd,
        runtimeMs,
        usdPerMin: costUsd / minutes,
      };
    })
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, 5);

  // Pareto: share of week cost held by the top 3 sessions. Null when the
  // week total is unpriced (trust rule) or there is no priced spend.
  const top3Cost = outliers
    .slice(0, 3)
    .reduce((sum, o) => sum + o.costUsd, 0);
  let paretoSharePct: number | null = null;
  if (weekTotalUsd !== null && weekTotalUsd > 0) {
    paretoSharePct = (top3Cost / weekTotalUsd) * 100;
  }
  const costSignal: InsightSignal | null =
    paretoSharePct !== null && paretoSharePct >= 50
      ? {
          tone: "warning",
          text: `Three sessions drove ${Math.round(paretoSharePct)}% of this week's cost — inspect them for loops or retries.`,
        }
      : null;

  // Cost trend reuses the existing getUsageSummary daily series rather than
  // recomputing it (keeps a single source of truth for daily cost).
  const costTrend = getUsageSummary().daily.map((d) => ({
    day: d.date,
    costUsd: d.costUsd,
  }));
```

Then update the `return` statement's `cost:` block to use these values:

```ts
    cost: {
      week: { totalUsd: weekTotalUsd, paretoSharePct },
      outliers,
      trend: costTrend,
      signal: costSignal,
    },
```

- [ ] **Step 4: Run the cost tests to verify they pass**

Run: `npx vitest run src/lib/insights.test.ts`
Expected: PASS — both cost tests green, and the earlier 6 cache tests still green.

- [ ] **Step 5: Run the full verification**

Run: `npm run verify`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries.ts src/lib/insights.test.ts
git commit -m "✨ feat(insights): add cost-outlier aggregation to getInsights"
```

---

## Task 3: CSS component classes for the insights grid

Add the layout + signal styling as reusable component classes. This is separated from the component task so the component can reference stable class names, and so visual style can be reviewed/tuned independently.

**Files:**
- Modify: `src/app/globals.css` (append within the existing `@layer components` block, near the `.overview-grid` rules ~line 1108)

**Interfaces:**
- Produces CSS classes: `.insights-grid`, `.insight-card`, `.insight-signal`, `.insight-signal.is-warning`, `.insight-signal.is-info`, `.insight-delta`, `.insight-delta.is-up`, `.insight-delta.is-down`. Task 4's component uses exactly these class names.

- [ ] **Step 1: Add the CSS classes**

In `src/app/globals.css`, inside the existing `@layer components` block, add immediately after the `.overview-grid` ruleset (after line ~1113):

```css
  .insights-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(0, 26rem));
    gap: 0.8rem;
    margin-top: 0.9rem;
  }
  .insight-card {
    display: grid;
    gap: 0.7rem;
    align-content: start;
    padding: 1rem 1.1rem;
  }
  .insight-card-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .insight-card-head h3 {
    font-size: var(--text-sm);
  }
  .insight-card-head .mono {
    font-size: var(--text-xs);
  }
  .insight-headline {
    font-size: var(--text-xl);
    letter-spacing: -0.03em;
  }
  .insight-sub {
    color: var(--muted-foreground);
    font-size: var(--text-xs);
  }
  .insight-delta {
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  .insight-delta.is-up {
    color: var(--success);
  }
  .insight-delta.is-down {
    color: var(--destructive);
  }
  .insight-signal {
    display: flex;
    align-items: flex-start;
    gap: 0.4rem;
    padding: 0.5rem 0.65rem;
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    font-size: var(--text-xs);
  }
  .insight-signal.is-warning {
    border-color: var(--destructive);
    color: var(--destructive);
  }
  .insight-signal.is-info {
    border-color: var(--accent);
    color: var(--accent);
  }
  .insight-signal > span {
    color: var(--foreground);
  }
```

- [ ] **Step 2: Verify the build picks up the CSS**

Run: `npm run build`
Expected: PASS — build succeeds; no CSS errors. (Visual review happens with the component in Task 4.)

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "🎨 style(insights): add insight-card and signal component classes"
```

---

## Task 4: `/insights` route + `InsightsView` component + sidebar entry

Wire the page end-to-end: server route, the two-card client view, and the sidebar nav link. After this task the feature is visually complete and live at `/insights`.

**Files:**
- Create: `src/app/insights/page.tsx`
- Create: `src/components/insights-view.tsx`
- Modify: `src/components/sidebar.tsx` (add `/insights` `NavLink`)

**Interfaces:**
- Consumes: `Insights`, `InsightSignal` types from `./queries` (type-only import in the client component); `formatCostUsd`, `formatTokens` from `@/lib/format`; `PRICING_RETRIEVED_AT` from `@/lib/pricing`.
- Produces: a routable `/insights` page and a sidebar entry that highlights on `/insights`.

- [ ] **Step 1: Create the server route**

Create `src/app/insights/page.tsx`:

```tsx
import { Sidebar } from "@/components/sidebar";
import { InsightsView } from "@/components/insights-view";
import { getCollectorHealth, getInsights } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  const health = getCollectorHealth();
  return (
    <main className="relay-shell">
      <Sidebar
        connectedAgents={health.connectedAgents}
        sourceErrors={health.parseErrors}
      />
      <InsightsView insights={getInsights()} />
    </main>
  );
}
```

- [ ] **Step 2: Create the `InsightsView` client component**

Create `src/components/insights-view.tsx`:

```tsx
"use client";

import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { formatCostUsd, formatTokens } from "@/lib/format";
import { PRICING_RETRIEVED_AT } from "@/lib/pricing";
import type { Insights, InsightSignal } from "@/lib/queries";

interface InsightsViewProps {
  insights: Insights;
}

function level(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.max(1, Math.round((value / max) * 10));
}

export function InsightsView({ insights }: InsightsViewProps) {
  const router = useRouter();

  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [router]);

  return (
    <section className="relay-content">
      <header className="page-header">
        <div>
          <h1>Insights</h1>
          <p>
            Actionable efficiency signals from your coding-agent usage. API-equivalent
            cost estimates from public per-token rates (pricing recorded{" "}
            {PRICING_RETRIEVED_AT}); cache hit rate is token-only and always available.
          </p>
        </div>
      </header>

      <div className="insights-grid">
        <CacheCard insights={insights} />
        <CostCard insights={insights} />
      </div>
    </section>
  );
}

function Signal({ signal }: { signal: InsightSignal }) {
  return (
    <div
      className={`insight-signal is-${signal.tone}`}
      role={signal.tone === "warning" ? "alert" : "status"}
    >
      <Sparkles size={13} />
      <span>{signal.text}</span>
    </div>
  );
}

function CacheCard({ insights }: { insights: Insights }) {
  const { cache } = insights;
  const hitPct =
    cache.week.hitRate === null
      ? "—"
      : `${Math.round(cache.week.hitRate * 100)}%`;
  const deltaPts = cache.week.hitRateDeltaPts;
  const deltaClass =
    deltaPts === null
      ? ""
      : deltaPts > 0
        ? "is-up"
        : deltaPts < 0
          ? "is-down"
          : "";
  const deltaLabel =
    deltaPts === null
      ? ""
      : `${deltaPts > 0 ? "▲" : "▼"} ${Math.abs(Math.round(deltaPts))} pts wk-over-wk`;
  const maxModelTokens = Math.max(
    ...cache.week.byModel.map((m) => m.tokens),
    0,
  );
  const maxTrend = Math.max(
    ...cache.trend.map((d) => d.hitRate ?? 0),
    0,
  );

  return (
    <section className="card insight-card" aria-label="Cache effectiveness">
      <div className="insight-card-head">
        <h3>Cache effectiveness</h3>
        <span className="mono">last 7 days</span>
      </div>

      {cache.signal && <Signal signal={cache.signal} />}

      <div>
        <div className="insight-headline">{hitPct}</div>
        <div className="insight-sub">weighted cache hit rate</div>
        {deltaLabel && (
          <div className={`insight-delta ${deltaClass}`}>{deltaLabel}</div>
        )}
      </div>

      <div>
        <strong>
          {cache.week.savedUsd === null
            ? "Unavailable"
            : `${formatCostUsd(cache.week.savedUsd)} saved`}
        </strong>
        <span className="insight-sub">
          {cache.week.savedSharePct === null
            ? "Requires full pricing"
            : `${Math.round(cache.week.savedSharePct)}% of gross cost`}
        </span>
      </div>

      {cache.week.byModel.length ? (
        <div>
          <div className="insight-sub">Hit rate by model</div>
          {cache.week.byModel.map((m) => (
            <div className="dist-row dist-row-wide" key={m.model}>
              <span className="mono dist-label">{m.model}</span>
              <span className="meter" aria-hidden>
                <i className={`meter-fill-${level(m.hitRate, 1)}`} />
              </span>
              <span className="mono">{Math.round(m.hitRate * 100)}%</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="overview-empty">No usage recorded yet this week.</p>
      )}

      <div>
        <div className="insight-sub">Hit rate, last 30 days</div>
        <div
          className="spark"
          role="img"
          aria-label="Daily cache hit rate, last 30 days"
        >
          {cache.trend.map((d) => (
            <span
              key={d.day}
              className="spark-slot"
              title={`${d.day}: ${d.hitRate === null ? "no usage" : `${Math.round(d.hitRate * 100)}%`}`}
            >
              <i className={`spark-fill-${level(d.hitRate ?? 0, maxTrend)}`} />
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function CostCard({ insights }: { insights: Insights }) {
  const { cost } = insights;
  const maxOutlier = Math.max(...cost.outliers.map((o) => o.costUsd), 0);

  return (
    <section className="card insight-card" aria-label="Cost outliers">
      <div className="insight-card-head">
        <h3>Cost outliers</h3>
        <span className="mono">last 7 days</span>
      </div>

      {cost.signal && <Signal signal={cost.signal} />}

      <div>
        <div className="insight-headline">
          {cost.week.paretoSharePct === null
            ? "—"
            : `Top 5 = ${Math.round(cost.week.paretoSharePct)}%`}
        </div>
        <div className="insight-sub">
          {cost.week.totalUsd === null
            ? "Week cost unavailable (some usage unpriced)"
            : `${formatCostUsd(cost.week.totalUsd)} total this week`}
        </div>
      </div>

      {cost.outliers.length ? (
        <div>
          <div className="insight-sub">Most expensive sessions</div>
          {cost.outliers.map((o) => (
            <Link
              key={o.id}
              href={`/sessions/${o.id}`}
              className="dist-row dist-row-wide"
              title={`${formatTokens(0)} · $${o.usdPerMin.toFixed(2)}/min`}
            >
              <span className="dist-label">{o.title}</span>
              <span className="meter" aria-hidden>
                <i className={`meter-fill-${level(o.costUsd, maxOutlier)}`} />
              </span>
              <span className="mono">{formatCostUsd(o.costUsd)}</span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="overview-empty">No priced sessions this week.</p>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Add the sidebar `NavLink`**

In `src/components/sidebar.tsx`, add `Sparkles` to the `lucide-react` import (if not already present) and insert a new `NavLink` after the Usage link (after the `label="Usage & cost"` `NavLink`, before the `/agents` `NavLink`):

```tsx
        <NavLink
          href="/insights"
          active={pathname === "/insights"}
          icon={<Sparkles size={15} />}
          label="Insights"
        />
```

The import line becomes:

```tsx
import {
  BarChart3,
  Blocks,
  CircleDot,
  Database,
  LayoutDashboard,
  MoreHorizontal,
  Settings,
  Sparkles,
} from "lucide-react";
```

- [ ] **Step 4: Verify typecheck and build**

Run: `npm run verify`
Expected: PASS — lint, typecheck, format:check, test:run, and build all green. Open `http://127.0.0.1:3000/insights` (via `npm run dev`) and confirm both cards render with live data, the sidebar highlights Insights, and 15s refresh works.

- [ ] **Step 5: Commit**

```bash
git add src/app/insights/page.tsx src/components/insights-view.tsx src/components/sidebar.tsx
git commit -m "✨ feat(insights): add /insights page with cache + cost cards"
```

---

## Task 5: Documentation update (Definition of Done — final task)

Per the plan DoD, review and update `README.md` for user-facing behavior and `AGENTS.md` for architecture/convention changes. Also re-read the spec's "Open question" and confirm the runtime handling matches what shipped.

**Files:**
- Modify: `README.md` (routes table + any usage notes)
- Modify: `AGENTS.md` (Pages section: add `/insights`; read boundary note for `getInsights`)

- [ ] **Step 1: Update the README routes table**

In `README.md`, add a row for `/insights` in the routes table (after the `/usage` row, ~line 37). Match the existing table's column structure and prose density:

```markdown
| `/insights`      | Insights — actionable efficiency signals: a cache-effectiveness card (weighted cache hit rate, week-over-week delta, estimated dollars saved by caching, hit rate by model, 30-day trend) and a cost-outlier card (Pareto share of spend, the most expensive sessions with $/min, a concentration warning). All derived from already-collected usage; cache hit rate is always available, dollar figures follow the pricing-trust rule. |
```

- [ ] **Step 2: Update the AGENTS.md Pages section**

In `AGENTS.md`, find the `## Pages:` bullet (the line starting ``Pages: `/` Overview ...``). Append `/insights` (`insights-view.tsx`; `getInsights()` — cache hit rate and $-saved derivation plus cost-outlier Pareto/$-per-minute, curated rule-based signals) to that list, matching the existing parenthical style.

Also, in the `## Relay architecture` section, add `getInsights()` to the bullet describing the server-side read boundary (`src/lib/queries.ts`):

> ...Session status is derived at query time...; `getInsights()` derives cache-effectiveness and cost-outlier signals for the `/insights` page under the same pricing-trust rule.

- [ ] **Step 3: Confirm the spec open question is resolved**

Re-read the spec's "Open question" (sessions with null/zero runtime in the $/min sort). Confirm Task 2's implementation excludes them from the *sort metric* (via `Math.max(runtimeMs / 60_000, 1)` flooring to 1 minute) while still listing them by raw cost. No doc change needed — note the resolution in the commit message.

- [ ] **Step 4: Run the full verification one final time**

Run: `npm run verify`
Expected: PASS — lint, typecheck, format:check, test:run, build all green.

- [ ] **Step 5: Commit**

```bash
git add README.md AGENTS.md
git commit -m "📝 docs: document the /insights page and getInsights read boundary"
```

---

## Self-Review Notes

**Spec coverage:** Card 1 (cache hit rate, delta, $ saved, by-model, 30d trend, signal) → Task 1. Card 2 (Pareto headline, cost outliers with $/min, cost trend, signal) → Task 2. Page location + nav → Task 4 step 3. Styling rules (semantic tokens, `meter-fill-N`/`spark-fill-N`) → Task 3. Pricing-trust null handling → Tasks 1 & 2. README + AGENTS.md → Task 5. All spec sections covered.

**Pricing-trust edge:** `$ saved by caching` requires both a counterfactual (cache reads repriced as input) and the actual cache-read rate — only computable when a pricing-table entry exists. Reported-cost rows without a table entry can't build the counterfactual, so they force `savedUsd = null` (handled in `aggregateCache`). Cache hit rate stays token-only and unaffected.

**Type consistency:** `Insights`, `InsightSignal`, `getInsights()` shapes are defined once in Task 1 and consumed unchanged by Tasks 2 and 4. `level()` helper appears in both `usage-view.tsx` (existing) and `insights-view.tsx` (new) — duplicated by design to match the existing per-component pattern rather than introducing a shared util not asked for.
