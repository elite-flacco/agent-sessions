# Insights Page — Design Spec

**Date:** 2026-07-14
**Status:** Pending review
**Scope:** A new `/insights` page surfacing two actionable efficiency themes — **cache effectiveness** and **cost outliers** — computed entirely from data already collected, to help the user use coding agents more productively.

## Motivation

The dashboard answers "what happened" well (sessions, cost, usage) but does not answer **"how can I use coding agents better."** That requires turning raw numbers into signals the user can act on. Two themes have the clearest actionable payoff and reuse data already in the schema:

1. **Is caching working?** Per-model usage already stores `cache_read_tokens` / `cache_write_tokens` / `input_tokens`, and pricing already carries separate cache read/write rates. Hit rate and "$ saved by caching" are pure read-time derivations — never stored, never displayed today. Cache behavior differs sharply across coding agents (long-context vs short-turn), so this is the single highest-value lever for agent cost.

2. **Where is money being wasted?** Cost is aggregated on `/usage`, but concentration (a few sessions dominating spend) and inefficiency (expensive-for-their-length sessions) are not surfaced. The user can't currently spot the one retry-loop session that cost $4 and ran 90 minutes.

Both themes turn existing data into "things you should do" (shorter prompts when cache misses, exit criteria when sessions loop, inspect the handful of cost outliers).

## Page location & navigation

- New route: `/insights` (`src/app/insights/page.tsx`).
- Server component, `dynamic = "force-dynamic"`, 15-second auto-refresh via `router.refresh()` — same pattern as `/` and `/usage`.
- **New sidebar entry** in `src/components/sidebar.tsx` between Usage and the Settings placeholder. Icon from `lucide-react` (e.g. `Sparkles` or `Lightbulb`). Label: "Insights".
- Shares the `InsightLayout` shell (sidebar + main) used by other primary pages.

## Layout

A responsive grid of insight cards (`grid-template-columns: repeat(auto-fit, minmax(0, 26rem))`), each card a self-contained unit: a header (title + this-week value), optional inline signal, a compact viz, and a short footnote. Card components live in `src/components/insights/`.

### Card 1 — Cache Effectiveness

The single most actionable card. **Cache hit rate** is defined as:

```
hitRate = cache_read_tokens / (cache_read_tokens + input_tokens)
```

This directly answers "of the tokens the model read this session, what fraction were served from cache (cheap) vs processed fresh (expensive)." `cache_write_tokens` is intentionally excluded from the hit rate — cache writes are an *investment* (pay now to populate the cache for future reads), not a hit or miss. Writes are still tracked and priced (at the cache-write rate) in the $-saved figure below.

Contents:

- **Headline:** weighted hit rate this week (e.g. "67%") with delta arrow vs prior week (e.g. "▲ 4 pts"). Weighted by tokens so a 90%-hit micro-session doesn't skew the average.
- **$ saved by caching:** computes the gap between actual cost (cache reads priced at the cache-read rate) and the counterfactual "nothing cached" cost (all cache_read_tokens re-priced at the full input rate). Display: "$47.20 saved this week — 14% of gross cost." Uses `src/lib/pricing.ts` rates; subject to the same pricing-trust rule (reads "unavailable" when any usage row is unpriced).
- **Hit rate by model:** meters per model using the existing `meter-fill-N` ramp. Sorted descending. This is where the actionable insight lives (e.g. "Codex 78% vs Claude 41%" → long-context Claude sessions aren't benefiting from cache).
- **30-day trend:** spark strip (`spark-fill-N`) of daily weighted hit rate, for context.
- **Inline signal:** if hit rate dropped ≥ 15 pts wk-over-wk, show a `[!]` warning inline: "Cache hit rate dropped 18 pts wk-over-wk — check that long sessions aren't losing context."

### Card 2 — Cost Outliers ("Pareto")

Surfaces where spend concentrates and where it's inefficient.

Contents:

- **Headline:** "Top 5 sessions = N% of this week's cost" — the Pareto share. Followed by total week cost for context.
- **Worst cost-per-runtime sessions:** derived as `cost_usd / runtime_minutes`, top 5, linking to `/sessions/[id]`. These are sessions where you paid a lot for little wall-clock work — typically retries, loops, or stuck agents. Each row: title, model badge, cost, runtime, $/min.
- **Cost trend:** spark strip (`spark-fill-N`) of daily cost, 30d (reuse the series already computed by `getUsageSummary().daily`).
- **Inline signal:** if the top-3 sessions account for ≥ 50% of week cost, show a `[!]` warning: "Three sessions drove over half of this week's cost — inspect them for loops or retries."

## Data sources

All data comes from existing tables; **no schema changes, no new collection.**

| Card | Source | Existing query |
|---|---|---|
| Cache hit rate | `session_model_usage` (per session/model token splits) | New aggregation in `queries.ts` |
| $ saved by caching | `session_model_usage` + `pricing.ts` rates | New derivation in `queries.ts` |
| Hit-rate trend | `session_model_usage`, grouped by day | New aggregation |
| Pareto share, cost outliers | `sessions` + read-time cost + runtime | New aggregation |
| Cost trend | `getUsageSummary().daily` | **Reuse** existing (do not recompute) |

### New query: `getInsights()`

A single server-side query in `src/lib/queries.ts` returning both cards' data, following the existing read-boundary pattern (server-only, imports the SQLite client). Returns:

```ts
type Insights = {
  cache: {
    week: {
      hitRate: number | null;          // weighted, 0..1; null if no tokens / unpriced
      hitRateDeltaPts: number | null;  // vs prior 7d
      savedUsd: number | null;         // cache savings; null if any row unpriced
      savedSharePct: number | null;    // saved / gross cost
      byModel: { model: string; hitRate: number; tokens: number }[];
    };
    trend: { day: string; hitRate: number | null }[];   // 30d daily
    signal: InsightSignal | null;      // hit-rate drop warning
  };
  cost: {
    week: { totalUsd: number | null; paretoSharePct: number | null };
    outliers: { id, title, model, costUsd, runtimeMs, usdPerMin }[]; // top 5 by cost
    trend: { day: string; costUsd: number | null }[];  // reuse getUsageSummary daily
    signal: InsightSignal | null;      // concentration warning
  };
};

type InsightSignal = {
  tone: "warning" | "info";
  text: string;
};
```

Pricing-trust rule applies: any card value that depends on a complete price set reads `null` / "unavailable" when a usage row is unpriced, exactly as `/usage` already does. Hit rate itself is token-only and always available; the **$ saved** figure is the part that can go null.

### Definitions & edge cases

- **Window:** "this week" = trailing 7 calendar days ending now; "prior week" = the 7 days before that. Matches the existing Overview/Usage week framing. 30-day trend for context strips.
- **Cache hit rate is always computable** (token-only, no pricing). "$ saved by caching" requires full pricing → null on unpriced rows.
- **Cost outlier** = top 5 sessions by `cost_usd` this week; **cost-per-runtime** = `cost_usd / max(runtimeMinutes, 1)`. Sessions with no usage rows or null cost are excluded from cost cards but still counted in cache hit rate (tokens exist).
- **Signals** are curated, rule-based, conservative thresholds (hit-rate drop ≥ 15 pts; Pareto top-3 ≥ 50%). A signal returns `null` when its rule doesn't fire — the card renders without an inline warning. No statistical anomaly detection in v1.
- **Empty state:** if no usage rows exist in the window, cards render with an empty-state message ("No usage yet this week") rather than zero-divisions.

## Styling

- New UI uses semantic tokens and component classes from `src/app/globals.css` only — no raw Tailwind palette colors, arbitrary values, inline styles, or `dark:` variants (per AGENTS.md).
- Charts reuse the existing quantized `meter-fill-N` / `spark-fill-N` ramps — no new charting library introduced in v1.
- Card grid and signal styling (warning tone, delta arrow) are added to `globals.css` as component classes.
- Reuse the card chrome pattern already established by `overview-view.tsx` / `usage-view.tsx` metric cards.

## Out of scope (deferred)

- Interrupt/failure card — captured data supports it (`status` column), but deferred to a later round to keep this batch focused on the two chosen themes.
- Model-mix / productivity-window card — deferred; overlaps partially with existing Usage "by model" view.
- Date-range selector — v1 uses fixed week/30d framing for parity with Overview/Usage.
- Statistical anomaly detection — v1 uses curated rule-based signals only.
- Per-agent (not per-model) cache breakdown — the schema distinguishes `agent_label`/`agent_depth`; a later card could split main vs subagent caching.

## Definition of Done

- [ ] `/insights` route renders both cards with live data from the dev database.
- [ ] Sidebar entry added; nav highlights `/insights` when active.
- [ ] `getInsights()` added to `queries.ts`; unit tests cover hit-rate math, $-saved derivation, Pareto share, signal thresholds (firing and non-firing), and the pricing-trust null case.
- [ ] Empty-state (no usage rows) and unpriced-row cases render gracefully.
- [ ] No raw palette colors / arbitrary values / inline styles / `dark:` variants; charts use `meter-fill-N` / `spark-fill-N`.
- [ ] All project checks pass: `npm run lint`, `npm run typecheck` (tsc --noEmit), `npm test`, `npm run build`.
- [ ] README updated (new route, what Insights shows); AGENTS.md updated (new page + the `getInsights()` read boundary).

## Open question

The cost-outlier "$/min" metric assumes `runtime` is meaningful (wall-clock from `started_at`→`ended_at`). Sessions that are still "running" (no `ended_at`) or that hit the 10-minute stale→incomplete rule will have imprecise runtime. v1 will exclude sessions with null/zero runtime from the $/min sort but still list them by raw cost. Acceptable for v1; flagged for review.
