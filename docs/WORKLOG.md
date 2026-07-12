# Relay Worklog

Running log of autonomous work on TODO.md items. Newest entries at the bottom of each section. Scope agreed with Shuang on 2026-07-11: TODO suggested-order items 1–4 (Live Activity → collector diagnostics/tests → Projects → Overview), commits directly on `main`, fully autonomous with decisions recorded here.

## Status: five milestones shipped

One commit per milestone on `main`, each passing `npm run verify`:

1. `c912651` — Live Activity stream (`/activity`)
2. `1c7f8a7` — Collector leases, scan tracking, diagnostics, watcher/concurrency tests
3. `c73c365` — Projects view (`/projects`) with unknown-workspace group
4. `b6897a0` — Overview home page with drill-down links (Sessions → `/sessions`)
5. Usage & Cost (`/usage`) — see Milestone 5 below. **Note:** this commit also carries the session-lifecycle improvements (`incomplete` status, `terminalStatus` markers) that a concurrent Codex session left uncommitted in the same working tree; the two features are interleaved in the adapter files and were verified together, so they ship together.

To test at any point: `git checkout <sha>`, then `npm run dev`.

## Milestone 5 — Usage & Cost

### Design

- Spec: `docs/superpowers/specs/2026-07-12-usage-cost-design.md`. Decisions confirmed with Shuang up front: costs presented as clearly-labeled API-equivalent estimates (subscriptions don't bill per token), a dedicated `/usage` page, and a checked-in versioned pricing table (no runtime lookups).
- Pricing looked up online 2026-07-12: Anthropic (fable-5 $10/$50, opus-4-6/4-7/4-8 $5/$25, sonnet-5 intro $2/$10 through 2026-08-31 then $3/$15, sonnet-4-6 $3/$15, haiku-4-5 $1/$5; cache read 0.1×, write 1.25×), OpenAI (gpt-5.5 and gpt-5.6-sol $5/$0.50 cached/$30, gpt-5.4 $2.50/$0.25/$15, gpt-5-mini $0.25/$0.025/$2), Z.ai GLM-5.2 ($1.40/$0.26 cached/$4.40). Sources and retrieval date are recorded on every entry in `src/lib/pricing.ts`.
- Normalized per-model usage (uncached input / output / cache read / cache write / optional reported cost) extracted per provider, each verified against real local files: Claude dedupes streaming-repeated `message.id`s and splits models (subagents differ from the main loop); Codex takes the last cumulative `total_token_usage`, subtracts `cached_input_tokens` (a subset of input), and attributes to the majority `turn_context` model — the old adapter stored `model_provider` ("openai") as the model, now fixed; Pi sums per-message usage and its provider-recorded `cost.total` (→ "Reported"); Zcode reads camelCase `response.usage` whose `inputTokens` includes cache traffic, so cache read/write are subtracted back out.
- New `session_model_usage` table (migration `0002`), replaced per session on re-parse; `NORMALIZATION_VERSION` bumped to force a one-time full re-ingest. Dollar costs are never stored: queries derive them at read time so pricing-table corrections apply retroactively. Per the TODO's trust rule, a session is priced only if every usage row matches (reported or table); otherwise "Unavailable" — no partial dollar figures, and aggregates count the exclusions.
- `/usage` page: today/7-day/30-day cost+token cards, cache-read share card, 30-day daily cost strip, and model/agent/project breakdowns (quantized meter classes; new `dist-row-wide`/`dist-label` component classes for dollar-width rows). Sessions inspector now shows tokens, cache traffic, and cost with a Reported/Estimated/Unavailable label.

### Decisions

- 2026-07-12: `kimi-k2.6` deliberately has no pricing entry — it appeared once, in Pi, which reports actual cost; an unverified rate would contaminate estimates.
- 2026-07-12: OpenAI and Z.ai publish no cache-write premium, so cache writes price as ordinary input there; Anthropic writes use the 1.25× 5-minute-TTL rate (Claude Code's default).
- 2026-07-12: `sessions.estimated_cost_usd` is no longer written (kept for schema stability); reported cost lives on usage rows.
- 2026-07-12: This milestone ran concurrently with the session-lifecycle work (same working tree). The two features touch the same adapter files; both edit streams were merged carefully on disk (lifecycle's `terminalStatus` kept intact, usage extraction layered on top) and the shared test fixtures were extended rather than reshaped.

### Verified

- Full suite passes (50 tests: adapter usage fixtures per provider, pricing normalization/effective-date/unknown-model tests, query-layer cost-source classification and aggregation).
- Re-ingested all 173 real sources; browser-checked `/usage` against real data (30-day totals, model/agent/project breakdowns, daily strip) with no console errors.

## Open questions for Shuang

1. **Sessions moved from `/` to `/sessions`** so Overview could be home. Easy to swap back if you preferred landing on the session table — say the word.
2. **Live Activity triggers ingestion server-side** (throttled to once per 10s while the page is open). If you'd rather the web process never touch source files and require `collect:watch` instead, it's a one-line removal in `src/app/activity/page.tsx`.
3. **Repository aliases** (same repo under moved/multiple paths): needs a home for local config. I'd fold it into the Settings milestone with a small `settings` table — OK to design it that way?
4. **"Failures this week" reads high** because most providers' files just stop when you close a window, which is indistinguishable from an interruption. Fine as-is until the adapter lifecycle work, or would you rather Overview only count `needs_attention`?
5. ~~**Usage & Cost** stays untouched pending a decision on the pricing table.~~ Shipped as milestone 5 (2026-07-12) after you picked the online lookup + checked-in table approach. Remaining follow-ups are listed under "Usage and Cost" in TODO.md.

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
