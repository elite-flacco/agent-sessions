# Relay Roadmap and Outstanding Work

This file tracks work intentionally deferred from Relay v1. Items are ordered by recommended priority; they are candidates, not commitments.

## Recommended next milestone

### Live Activity

- Add a live event stream across all running sessions.
- Group events by agent and session while preserving chronological order.
- Show new tool, command, file, completion, interruption, and warning events without refreshing the page.
- Add pause/resume, provider filters, repository filters, and “follow newest” behavior.
- Surface collector health and delayed/stale sources in the stream.
- Keep raw prompts, responses, reasoning, tool arguments, and credentials outside the database and UI.

Why this first: the collector and normalized activity model already exist, so this creates the most useful new workflow without requiring a new data model or cloud services.

## Product areas shown in the navigation

### Overview

- Add daily and weekly summaries for sessions, runtime, activity, failures, and provider usage.
- Show currently running work and sessions that may need attention.
- Add recent projects and agent distribution charts.
- Make every summary card link to the corresponding filtered Sessions view.
- Avoid estimated cost totals until model pricing and token accounting are trustworthy.

### Projects

- Group sessions by normalized repository and working directory.
- Show recent branches, active agents, runtime, usage, and last activity.
- Add project detail pages with session history and common tasks.
- Support aliases for repositories that moved or appear under multiple paths.
- Add an explicit “unknown workspace” review flow for records lacking repository context.

### Usage and Cost

- Normalize input, output, and cached-token usage per provider and model.
- Add a versioned local pricing table with effective dates and source metadata.
- Calculate cost only when the provider, model, usage fields, and pricing record all match confidently.
- Clearly distinguish reported cost, locally calculated cost, and unavailable cost.
- Add daily, weekly, monthly, provider, model, and project breakdowns.

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
- Add a durable collector lock so two watcher processes cannot ingest concurrently.
- Add backpressure and batched SQLite writes for very large histories.
- Track each adapter’s last successful scan separately from individual file state.
- Add configurable retention and database compaction.
- Add a repair command that verifies indexes, source fingerprints, orphaned events, and duplicate sessions.
- Investigate whether Zcode’s task database can safely provide repository and lifecycle metadata missing from JSONL.
- Add fixtures for nested agents, subagents, resumed sessions, multiple tasks in one Codex thread, and sessions spanning time zones or daylight-saving changes.
- Keep a documented privacy review checklist for every new provider field.

## Quality and operations

- Add browser end-to-end tests for search, combined filters, selection, sync, empty states, and mobile layout.
- Add tests for the file watcher receiving newly created sessions and appended records.
- Add tests for concurrent sync requests and collector restarts.
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

1. Live Activity.
2. Collector diagnostics and watcher/concurrency tests.
3. Projects and repository normalization.
4. Overview with drill-down links.
5. Settings and local data-management controls.
6. Usage and Cost after pricing provenance is reliable.
7. Desktop packaging, notifications, or optional sharing based on actual usage.

## Completed in v1

- Local Next.js dashboard matching the original ChatGPT Site on desktop and mobile.
- SQLite and Drizzle persistence with versioned migrations.
- Codex, Claude Code, Zcode, and Pi adapters.
- Idempotent historical import and continuous source watching.
- Sanitized session metadata and normalized activity without transcript storage.
- Search, provider/status/date filters, URL-backed state, session inspection, manual sync, and automatic refresh.
- Empty, loading, unsupported-data, and ingestion-error presentation.
- Local-only server binding, verification scripts, tests, and design QA.
