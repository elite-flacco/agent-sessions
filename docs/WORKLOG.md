# Relay Worklog

Running log of autonomous work on TODO.md items. Newest entries at the bottom of each section. Scope agreed with Shuang on 2026-07-11: TODO suggested-order items 1–4 (Live Activity → collector diagnostics/tests → Projects → Overview), commits directly on `main`, fully autonomous with decisions recorded here.

## Milestone 1 — Live Activity

### Design

- New route `src/app/activity/page.tsx` (server component, `force-dynamic`) with a client `ActivityStream` component. The sidebar moves out of `dashboard.tsx` into a shared `src/components/sidebar.tsx` client component (active state via `usePathname`) so multiple pages can share the shell without duplicating nav markup.
- Data comes from the existing `activity_events` ⋈ `sessions` tables — no schema change. New read-boundary queries in `src/lib/queries.ts`: `getActivityStream` (recent events with session/provider/repository context, filterable by provider and repository) and `getCollectorHealth` (per-source parse state, last sync, stale detection).
- Liveness: the page reuses the v1 polling pattern (`router.refresh()` on an interval, 5s here vs 15s on Sessions) rather than SSE/WebSockets. Rationale: v1 already established polling, SSE route handlers + chokidar inside Next dev (HMR) risk leaked watchers, and 5s is fresh enough for a local dashboard. Revisit if it feels sluggish.
- Freshness of the DB itself: events only appear after ingestion. To keep the stream live without requiring `npm run collect:watch` in a second terminal, the activity page triggers a throttled incremental sync server-side (at most once per 10s across requests, module-level timestamp guard). Unchanged files are fingerprint-skipped, so the steady-state cost is one `stat` per source file.
- Grouping: consecutive events from the same session collapse into one block (agent badge, session title, repository), blocks ordered newest-first. Preserves chronology while grouping by agent/session, per TODO.
- Controls: pause/resume (stops polling + marks stream paused), provider filter, repository filter (both URL-backed like Sessions filters), follow-newest toggle (auto-stick to top; scrolling down disables it, matching common log-viewer behavior).
- Collector health: a strip above the stream showing sources indexed, parse errors, and stale sources (sources whose file mtime is newer than their last sync — i.e. the collector is behind), plus last-sync time.
- Privacy: only already-sanitized `activity_events` fields (kind, title, detail) are shown; no new provider fields are read.

### Decisions

- 2026-07-11: Polling + throttled server-side incremental sync instead of SSE (see rationale above).
- 2026-07-11: No new tables for Live Activity; stale-source detection compares `ingestion_sources.modified_at` freshness at query time instead of persisting a new state column.
- 2026-07-11: Sidebar becomes a shared component now (needed for any second page); Overview/Projects links stay disabled until those milestones land.

### Verified

- `npm run verify` passes (lint, typecheck, format, 15 tests, production build).
- Exercised in the browser against real local data: stream renders grouped blocks (including the session doing this work), provider/repo filters work, pause/follow toggles work, Sessions page unchanged with the shared sidebar.

### Observations for later milestones

- `sync_errors` accumulates forever, so the "sync errors in 24h" health item counts errors from v1's initial import too (21 showing on real data). Milestone 2 should prune or de-duplicate resolved errors.
- Session status is only recomputed when a source file re-parses, so a session can show "Running" in one view and "Interrupted" in another until its file changes again (pre-existing v1 behavior; `staleStatus` is evaluated at parse time). Candidate fix in milestone 2: derive staleness at query time instead of persisting it.

### Open questions / needs input

- None yet.

## Milestone 2 — Collector diagnostics and concurrency

_(pending)_

## Milestone 3 — Projects

_(pending)_

## Milestone 4 — Overview

_(pending)_
