# Sessions table: Model column + model filter

**Date:** 2026-07-28
**Status:** Approved design

## Goal

Add a **Model** column to the `/sessions` table and a **Filter by model**
control to the shared filter row, so users can see and narrow sessions by the
model each run used.

## Non-goals

- No schema or collector changes. The `sessions.model` column already exists
  and is populated per session.
- No new pricing entries, cost logic, or usage aggregation.
- No change to the Projects view (`ProjectsTable`) — its rollup has no single
  representative model.

## Decisions (locked)

1. **Normalization:** Display and filter by the canonical id from
   `normalizeModel()` (e.g. `claude-opus-4-8`), collapsing routing prefixes and
   dated snapshot suffixes. This matches the Insights page and groups
   near-duplicate model strings into one row/option.
2. **Column placement:** Between **Duration** and **Cost**:
   `Session · Agent · Status · Started · Updated · Duration · Model · Cost`.
3. **Unknown models:** The filter offers an explicit **"(unknown)"** option that
   isolates sessions whose `model` is null/empty, mirroring the existing
   `UNKNOWN_PROJECT_KEY` pattern.

## Data flow

`normalizeModel` (pure, client-safe, in `src/lib/pricing.ts`) is the single
grouping function used everywhere — the query layer, the options list, and the
display cell all key off it, so a stored raw string and its canonical id never
disagree.

`sessions.model` stores a raw provider string. `normalizeModel` cannot run
inside SQLite, so model filtering resolves the selected canonical id back to the
set of raw strings that normalize to it, then matches with `model IN (…)`.

## Changes

### 1. Query layer — `src/lib/queries.ts`

- **`SessionFilters`**: add `model?: string` (a canonical id, or the unknown
  sentinel).
- **Unknown sentinel**: introduce `UNKNOWN_MODEL_KEY` (value `"(unknown)"`)
  alongside the existing project key, exported from `src/lib/types.ts` so both
  server and client can reference it.
- **`getModelOptions()`**: returns
  `{ value: string; label: string; sessionCount: number }[]`, mirroring
  `ProjectOption`. Built by scanning `SELECT model FROM sessions`, applying
  `normalizeModel`, and counting distinct canonical ids. Null/empty models are
  aggregated under `UNKNOWN_MODEL_KEY` and surface as an "(unknown)" option.
  Sorted by descending `sessionCount` then label. Returns a
  `ModelOption` type (new export).
- **`getSessions()`**: when `filters.model` is set and not `"all"`:
  - If `filters.model === UNKNOWN_MODEL_KEY`: push clause
    `(model IS NULL OR model = '')`.
  - Otherwise: compute the raw model strings via
    `SELECT DISTINCT model FROM sessions` filtered in JS to those whose
    `normalizeModel(raw) === filters.model`. Push
    `model IN (?, ?, …)` with those raws as params. If the resolved set is
    empty (selected id no longer present), push a clause that matches nothing
    (`1 = 0`) so the table shows the empty state rather than every session.
  - This filters the flat list before nesting, consistent with how `provider`,
    `status`, and `project` filters already behave (a filtered-out parent
    orphans its children as roots).

### 2. Page wiring — `src/app/sessions/page.tsx` (server component)

- Parse the `model` search param into the `filters` object (alongside the
  existing `q`/`provider`/`status`/`range`/`sort`/`project` parsing).
- Call `getModelOptions()` and pass the result to `Dashboard` as
  `modelOptions`, mirroring the existing `projectOptions={getProjectOptions()}`
  prop.

### 3. Dashboard component — `src/components/dashboard.tsx`

- **Props**: add `modelOptions: ModelOption[]` to `DashboardProps`.
- **Filter control**: add a "Filter by model" `FilterSelect` after the project
  filter. Options: `{ value: "all", label: "All models" }` followed by each
  `ModelOption` rendered as `label (sessionCount)`. `onChange` →
  `updateParam("model", value)`.
- **`updateParam` defaults**: `model` with value `"all"` (or empty) is treated
  as default and dropped from the URL, matching the other filters.
- **Table header** (`SessionsTable`): insert `<span>Model</span>` between
  `Duration` and `Cost`.
- **Row** (`SessionRow`): insert a `<span className="mono session-secondary">`
  between the duration and cost cells rendering
  `session.model ? normalizeModel(session.model) : "—"`. Import `normalizeModel`
  from `@/lib/pricing` (client-safe).
- **Empty-state filter check**: add `filters.model` to the `hasFilters`
  expression at the `EmptyState` call site.

### 4. Styles — `src/app/globals.css`

- Update `.session-table-head, .session-row` `grid-template-columns` from 7 to 8
  tracks, inserting a model track (≈ `minmax(6rem, 0.8fr)`) before the final
  cost track.
- No mobile change: the existing rule hiding `.session-row > :nth-child(n + 3)`
  already collapses the new column on small screens.

## Testing

Query-layer tests (following existing `queries` test patterns):

- `getModelOptions()` returns canonical ids with correct counts, collapses
  snapshot/prefix variants of the same model into one option, and emits an
  `UNKNOWN_MODEL_KEY` option counting null/empty-model sessions.
- `getSessions({ model })` returns only sessions whose model normalizes to the
  selected id, including sessions stored under a raw variant of that id.
- `getSessions({ model: UNKNOWN_MODEL_KEY })` returns only null/empty-model
  sessions.
- A `model` value with no matching sessions yields an empty result (not all
  sessions).

## Docs

- **`AGENTS.md`**: extend the `/sessions` page description to note the model
  column and the URL-backed model filter (canonical-id grouping, unknown
  option).
- **`README.md`**: reflect the new column/filter in the user-facing Sessions
  description.

## Verification (Definition of Done)

Run the project's full check suite (format, lint, typecheck, tests, build) per
`docs/superpowers/plan-dod.md`. Visually verify the column renders and the
filter narrows the table via the dev-server browser preview.
