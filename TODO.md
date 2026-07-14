# Relay Roadmap and Outstanding Work

This file tracks work intentionally deferred from Relay v1. Items are ordered by recommended priority; they are candidates, not commitments. See `docs/WORKLOG.md` for decisions and open questions from the post-v1 milestones.

## Product areas shown in the navigation

### Projects (view shipped; follow-ups remain)

- Support aliases for repositories that moved or appear under multiple paths (needs local config storage — pair with Settings).
- Extend the "unknown workspace" group into a real review flow (manual repository assignment stored as an override).
- Surface common tasks per project once title normalization improves.

### Usage and Cost (view shipped; follow-ups remain)

- Keep the pricing table (`src/lib/pricing.ts`) current when providers change rates; entries carry effective dates and source URLs.
- Add a pricing entry for `kimi-k2.6` once a trustworthy rate exists (Pi reports its cost directly, so only non-Pi usage would need it).
- Consider a cache-savings view (estimated cost avoided by prompt caching).
- Split Codex usage per model when a session changes models mid-way (today the cumulative total is attributed to the majority turn model).

### Settings

- Show detected provider sources and their latest successful sync.
- Allow source paths to be enabled, disabled, or overridden locally.
- Configure history limits, stale-session thresholds, retention, and collector polling behavior.
- Add database backup, export, reset, and re-index controls with confirmations.
- Show app, schema, adapter, and collector versions for troubleshooting.

## Sessions improvements

- Add pagination or list virtualization for large histories instead of returning up to 250 rows at once.
- Add sortable columns and saved filter views.
- Add a dedicated session route so details can be opened directly, not only through a query parameter.
- Add visible sync progress for large initial imports.
- Add a source-diagnostics drawer for parse failures and unsupported event types.
- Improve task-title extraction for agent-specific wrapper messages and command-only sessions.
- Add safe title overrides stored separately from provider data.
- Normalize repository and branch data for Zcode sessions where model-I/O files do not expose a working directory.
- Investigate reliable file-change, additions, and deletions metadata per provider.
- Add keyboard shortcuts for search focus, row navigation, inspector open/close, and sync.
- Add accessible announcements when filters, sync state, or selected sessions change.

## Collector and data quality

- Add adapter format-version detection and compatibility fixtures from multiple agent releases.
- Record unsupported event counts without persisting raw event bodies.
- Add explicit source truncation, rotation, deletion, and moved-file handling.
- Add backpressure and batched SQLite writes for very large histories.
- Add configurable retention and database compaction.
- Improve session lifecycle detection so abandoned sessions (window closed) are distinguishable from real interruptions; today both read as "interrupted", which inflates Overview failure counts.
- Add a repair command that verifies indexes, source fingerprints, orphaned events, and duplicate sessions.
- Investigate whether Zcode’s task database can safely provide repository and lifecycle metadata missing from JSONL.
- Add fixtures for nested agents, subagents, resumed sessions, multiple tasks in one Codex thread, and sessions spanning time zones or daylight-saving changes.
- Keep a documented privacy review checklist for every new provider field.

## Quality and operations

- Add browser end-to-end tests for search, combined filters, selection, sync, empty states, and mobile layout.
- Add performance benchmarks for initial import, incremental sync, and dashboard queries.
- Add structured local logs with redaction and bounded retention.
- Add database backup/restore tests before exposing those controls in Settings.
- Add CI when shared workflow defaults are available for this repository.
- Review and resolve dependency audit findings without using forced breaking upgrades.
- Revisit the two design-QA polish notes: mobile metric copy wrapping and incomplete Zcode workspace context.

## Longer-term candidates

- Package Relay as a native desktop app with automatic collector startup and menu-bar status.
- Add optional local notifications for completed, interrupted, or attention-needed sessions.
- Add a command palette for navigation, filtering, and common actions.
- Add tags, notes, and favorites stored locally without modifying provider session files.
- Add a local full-text activity search that continues to exclude transcript bodies.
- Add exportable weekly activity reports by project and provider.
- Add optional LAN access with an explicit security boundary and authentication.
- Add an optional hosted dashboard with encrypted metadata sync, while keeping local-only operation the default.
- Add team workspaces, roles, and shared views only if Relay expands beyond a personal tool.
- Add provider plugin registration so new adapters can be added without changing dashboard code.

## Suggested implementation order

1. Settings and local data-management controls (also unblocks repository aliases).
2. Usage and Cost after pricing provenance is reliable.
3. Sessions improvements (pagination, dedicated session route, keyboard shortcuts).
4. Desktop packaging, notifications, or optional sharing based on actual usage.

## Completed post-v1 (July 2026)

- Usage & Cost at `/usage`: normalized per-model token usage for all four adapters, a checked-in versioned pricing table with sources and effective dates, read-time cost derivation distinguishing reported/estimated/unavailable, window totals, and model/agent/project breakdowns.

- The experimental Live Activity stream was retired after the Sessions view became the preferred way to reach running work.
- Collector hardening: durable sync/watch leases, per-adapter scan tracking, sync-error pruning, watcher tests for new/appended files, concurrent syncs, and restarts.
- Projects view at `/projects` with repository grouping, branches, runtime, session history, and an unknown-workspace review group.
- Overview home page with daily/weekly summaries, running and needs-attention lists, agent distribution, 14-day activity, and drill-down links (Sessions moved to `/sessions`).
- Query-time status staleness so all views agree on running vs interrupted.

## Completed in v1

- Local Next.js dashboard matching the original ChatGPT Site on desktop and mobile.
- SQLite and Drizzle persistence with versioned migrations.
- Codex, Claude Code, Zcode, and Pi adapters.
- Idempotent historical import and continuous source watching.
- Sanitized session metadata and normalized activity without transcript storage.
- Search, provider/status/date filters, URL-backed state, session inspection, manual sync, and automatic refresh.
- Empty, loading, unsupported-data, and ingestion-error presentation.
- Local-only server binding, verification scripts, tests, and design QA.
