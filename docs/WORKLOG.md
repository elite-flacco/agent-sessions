# Relay Worklog

Running log of autonomous work on TODO.md items. Newest entries at the bottom of each section. Scope agreed with Shuang on 2026-07-11: TODO suggested-order items 1–4 (Live Activity → collector diagnostics/tests → Projects → Overview), commits directly on `main`, fully autonomous with decisions recorded here.

## Status: all four milestones shipped

One commit per milestone on `main`, each passing `npm run verify`:

1. `c912651` — Live Activity stream (`/activity`)
2. `1c7f8a7` — Collector leases, scan tracking, diagnostics, watcher/concurrency tests
3. `c73c365` — Projects view (`/projects`) with unknown-workspace group
4. `b6897a0` — Overview home page with drill-down links (Sessions → `/sessions`)

To test at any point: `git checkout <sha>`, then `npm run dev`.

## Open questions for Shuang

1. **Sessions moved from `/` to `/sessions`** so Overview could be home. Easy to swap back if you preferred landing on the session table — say the word.
2. **Live Activity triggers ingestion server-side** (throttled to once per 10s while the page is open). If you'd rather the web process never touch source files and require `collect:watch` instead, it's a one-line removal in `src/app/activity/page.tsx`.
3. **Repository aliases** (same repo under moved/multiple paths): needs a home for local config. I'd fold it into the Settings milestone with a small `settings` table — OK to design it that way?
4. **"Failures this week" reads high** because most providers' files just stop when you close a window, which is indistinguishable from an interruption. Fine as-is until the adapter lifecycle work, or would you rather Overview only count `needs_attention`?
5. **Usage & Cost** stays untouched pending a decision on the pricing table (source, versioning, effective dates). If you point me at a pricing source you trust, that milestone can start.

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

### Design

- Two new tables (versioned migration `0001`): `adapter_scans` (per-adapter last scan time and tallies, separate from per-file state) and `collector_leases` (durable named leases).
- Durable locking via SQLite leases rather than a lockfile: a `sync` lease (5 min TTL) makes a full scan exclusive across processes — a second process gets `locked: true` and skips; an expired lease from a dead process is taken over automatically. A `watch` lease (90s TTL, renewed every 30s) makes `collect:watch` refuse to start when another live watcher exists.
- Concurrent syncs inside one process (manual sync button + activity-page auto-sync) now share a single in-flight run instead of racing.
- `watchSources` accepts injectable source roots (`{path, provider}[]`, defaulting to the real home-dir roots), resolves adapters by root instead of substring matching, waits for the watcher to be ready before returning, and records per-file errors instead of crashing the process on an unhandled rejection.
- Sync-error hygiene: errors older than 7 days are pruned each scan, and a source that parses cleanly again clears its previous errors — fixes the misleading "21 sync errors in 24h" from v1's initial import.
- Session staleness is now derived at query time (`running` with no update for 10 min reads as `interrupted`), fixing the inconsistency noted in milestone 1 where one view showed Running and another Interrupted. The health strip also lists adapters whose last scan is >15 min old ("Scans delayed: …").
- CLI: Ctrl+C now releases the watch lease cleanly; a lock-skipped sync prints a distinct message.

### Decisions

- 2026-07-11: SQLite leases over OS lockfiles — the DB is already the shared, WAL-protected coordination point, and leases self-expire when a process dies.
- 2026-07-11: Deferred "unsupported event counts" and batched writes: the former needs a per-adapter definition of "unsupported" that would touch every strategy (better done with the format-version detection TODO), and the latter has no observed performance problem yet.
- 2026-07-11: Kept parse-time `staleStatus` as the stored initial value; the query layer owns presentation-time staleness.

### Verified

- `npm run verify` passes (23 tests including real-watcher tests that create and append JSONL files in a temp root, concurrent `syncAll` calls, lease takeover, and error-pruning).

## Milestone 3 — Projects

### Design

- New `/projects` route with the same master-detail layout as Sessions: project list on the left, inspector on the right, selection URL-backed (`?selected=<key>`). No schema change — projects are an aggregation over `sessions` (`GROUP BY repository`), with runtime, active count, distinct providers/branches/workdirs, and last activity per group.
- Project identity is the normalized repository name; distinct working directories are listed within a project rather than splitting it (multiple checkouts/worktrees of one repo stay together). Sessions without repository context group into an explicit "Unknown workspace" entry flagged "needs review" in the inspector, with an explanation of why (Zcode model-I/O files carry no cwd).
- Detail panel shows stats, local paths, recent branch chips, and the session history; each history row links to the Sessions view (`/?range=all&selected=<id>`).

### Decisions

- 2026-07-12: Repository aliases (repos that moved or appear under multiple paths) deferred — they need persistent user-defined mappings, which belongs with the Settings milestone's local-config storage. Listed under open questions.
- 2026-07-12: "Common tasks" per project deferred; session titles are too free-form to cluster meaningfully without better title normalization (a Sessions-improvements TODO).
- 2026-07-12: Fixed a client-boundary bug found in dev: a runtime constant exported from `queries.ts` (server-only, pulls better-sqlite3) was imported by a client component. Constant moved to `types.ts`; convention noted — client components may import only types from `queries.ts`.

### Verified

- `npm run verify` passes (25 tests). Browser-checked against real data: grouping, unknown-workspace bucket, branch chips, history links, selection.

## Milestone 4 — Overview

### Design

- Overview is now the home page (`/`); Sessions moved to `/sessions`. This matches the nav order and lets every summary card deep-link into filtered Sessions views. Behavior change worth knowing: old `/?q=…` bookmarks now land on Overview — Sessions filters live at `/sessions?…`.
- Summary cards (all linked): sessions today → `?range=today`, running now → `?status=running`, sessions this week, failures this week → `?status=interrupted`. No cost totals anywhere, per the TODO's pricing-trust rule.
- Left column: "Running now" and "Needs attention" (interrupted/needs-attention with activity in the last 24h) session lists, each row linking to the session in the Sessions view.
- Right column: agent distribution meters for the week (linking to provider-filtered Sessions), a 14-day sessions-per-day bar strip, and recent projects linking into `/projects`.
- Charts are pure CSS meters/bars using semantic tokens. Because AGENTS.md forbids inline styles, dynamic widths/heights are quantized to ten `meter-fill-N`/`spark-fill-N` component classes instead of computed styles.

### Decisions

- 2026-07-12: Moved Sessions off `/` (see above) rather than putting Overview at `/overview` — the app is days old, so link breakage is negligible and the nav has always listed Overview first.
- 2026-07-12: "Failures this week" counts derived interrupted + needs-attention sessions. On real data this reads high (54) because sessions whose files simply stop (window closed, agent killed) are indistinguishable from real interruptions in most providers' JSONL. Better lifecycle detection is already a TODO under adapter improvements; the number is honest, just blunt.

### Verified

- `npm run verify` passes (27 tests). Browser-checked: linked cards, running/attention lists, distribution meters, 14-day bars, recent projects, and the `/sessions` move (filters and selection still work).
