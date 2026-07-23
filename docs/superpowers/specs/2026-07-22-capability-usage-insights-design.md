# Capability Usage Insights — Design Spec

**Date:** 2026-07-22
**Status:** Pending review
**Scope:** Extend `/insights` with observed skill and MCP usage plus active capabilities with no observed use. Plugin attribution is intentionally deferred.

## Motivation

Relay can show which skills and MCP servers are installed, but it cannot answer which ones are actually used. The raw provider sources contain more capability evidence than the normalized session database currently retains:

- Claude and Zcode record native `Skill` calls with a skill name.
- Claude, Zcode, and Codex record namespaced MCP tool calls.
- Codex records the tool call that reads a skill's `SKILL.md`, which can be matched to the live inventory by canonical path.
- Pi can provide the same evidence when its logs contain an inventory-matched `SKILL.md` read or a namespaced MCP call.

The existing `activity_events` table cannot support reliable analytics because adapters retain only the final 40 events per session and its generic titles discard some provider attribution. Capability usage therefore needs its own privacy-safe normalization boundary.

The feature should answer two questions:

1. Which skills and MCP servers are used most often?
2. Which active installed skills and MCP servers have not been observed recently or anywhere in the available history?

## Product scope

### Included

- Skill and MCP usage only.
- A URL-backed 7-day / 30-day range control, defaulting to 30 days.
- Most-used skills and MCPs, with invocation count, distinct session count, last-used time, and provider badges.
- Active installed capabilities with no observed use in the selected range.
- A distinct "Never observed" state for capabilities with no matching usage in available history.
- Provider coverage messaging when source errors or unsupported log evidence prevent a definitive unused conclusion.
- Historical backfill through a full collector scan.

### Deferred

- Plugin activity or attribution.
- Tool-level MCP breakdown inside an MCP server.
- Capability cost attribution; provider usage does not reliably apportion tokens or cost to individual tool calls.
- Effectiveness scoring or recommendations about whether a capability should be removed.
- Project-level capability inventory.

## Data model

Add a `session_capability_usage` table:

| Column            | Purpose                                             |
| ----------------- | --------------------------------------------------- |
| `id`              | SQLite primary key                                  |
| `session_id`      | Foreign key to `sessions`, cascading on delete      |
| `external_id`     | Stable provider event identifier within the session |
| `provider`        | `codex`, `claude`, `zcode`, or `pi`                 |
| `kind`            | `skill` or `mcp`                                    |
| `capability_name` | Canonical display and aggregation name              |
| `occurred_at`     | Provider event timestamp                            |

Use a unique index on `(session_id, external_id)` and query indexes on `(kind, capability_name)` and `occurred_at`. Update both `src/db/schema.ts` and the bootstrap SQL in `src/db/client.ts`, then generate a Drizzle migration.

The table stores no prompts, command strings, tool arguments, tool results, MCP payloads, skill contents, credentials, or configuration. Provider adapters inspect raw records only long enough to emit the allowlisted fields above.

Capability identity in this version is `provider + kind + canonical name`. Same-named duplicate installations within one provider remain a concern of the existing `/agents` comparison view; usage logs that identify only a skill name cannot reliably distinguish those physical copies.

## Normalization rules

Extend `NormalizedSession` with a `capabilityUsage` array and keep extraction provider-specific.

At the start of a full scan or watcher run, the collector builds a per-provider `CapabilityLookup` from the existing global inventory discovery boundary. The lookup contains only active skill canonical paths and names plus safe MCP names. It is passed to adapter parsing as read-only context and reused for the run; adapters do not independently rescan inventory for every source file. A later watcher restart or full scan picks up inventory changes.

### Claude

- A `tool_use` block named `Skill` becomes a `skill` event using the allowlisted skill-name field.
- A tool name shaped like `mcp__<server>__<tool>` becomes an `mcp` event aggregated under `<server>`.
- Tool arguments other than the skill identifier are ignored.

### Zcode

- Native `Skill` parts become `skill` events using the allowlisted skill-name field.
- The read-only Zcode database's `tool_usage` table is authoritative for MCP tool names and timestamps, including database-only sessions.
- Names shaped like `mcp__<server>__<tool>` aggregate under `<server>`.
- Reconciliation follows the existing Zcode database metadata/status pattern and never copies inputs or outputs.

### Codex

- Function calls with an MCP namespace become `mcp` events. Codex app namespaces such as `mcp__codex_apps__github` normalize to the user-facing server/app name (`github`). Generic internal namespaces that are not discovered as active inventory MCPs are not presented as installed-versus-unused entries.
- A function/custom-tool call counts as skill usage only when its stored input references a `SKILL.md` path that exactly matches an active skill's canonical inventory path. The emitted event stores the inventory skill name, not the command or path.
- Merely mentioning a skill name, listing available skills, editing an unrelated `SKILL.md`, or reading an unmatched path does not count.
- Multiple reads of the same matched `SKILL.md` in one tool call produce one usage event.

### Pi

- Apply the same exact inventory-path match for `SKILL.md` reads when call inputs are present.
- Normalize namespaced MCP calls when present.
- Do not manufacture usage from injected skill catalogs or prompt text.

### Canonical MCP names

MCP tool names roll up to the server rather than the individual operation. For example, `github.search_prs` and `github.create_pr` both count as invocations of `github`. Provider-specific opaque server identifiers may be mapped to a live inventory name only when the provider's safe configuration metadata establishes an exact mapping; otherwise they remain observed-only names and are excluded from definitive installed-versus-unused matching.

## Persistence and backfill

Persist capability usage in the same transaction as the session, model usage, and activity events:

1. Upsert the session.
2. Delete prior `session_capability_usage` rows for that session.
3. Insert the newly normalized, deduplicated rows.
4. Commit atomically.

Increment `NORMALIZATION_VERSION` so the next full collection reprocesses unchanged source files and backfills historical capability usage. Zcode database-only reconciliation also refreshes capability rows for sessions whose rollout files are missing.

Collector fingerprinting remains source-based and idempotent. Repeated scans must not increase counts for unchanged sessions.

## Query boundary

Extend `getInsights()` with a capability section. The server page parses `capabilityRange=7d|30d`; invalid or absent values resolve to `30d`.

The returned shape is conceptually:

```ts
capabilities: {
  range: "7d" | "30d";
  mostUsed: {
    kind: "skill" | "mcp";
    name: string;
    invocations: number;
    sessionCount: number;
    lastUsedAt: string;
    providers: AgentProvider[];
  }[];
  unused: {
    kind: "skill" | "mcp";
    name: string;
    providers: AgentProvider[];
    lastUsedAt: string | null;
    neverObserved: boolean;
  }[];
  coverage: {
    provider: AgentProvider;
    state: "complete" | "partial" | "unavailable";
    message?: string;
  }[];
}
```

`mostUsed` aggregates matching names across providers, ordered by invocation count, then distinct sessions, then most recent use. The UI shows the top five skills and top five MCPs separately so frequent MCP operations do not crowd out skills.

`unused` is calculated per provider installation and then grouped by capability name for display:

- Inventory entries with status `enabled` or `installed` are active candidates.
- `disabled` and `unavailable` entries are excluded.
- No use inside the selected range means unused in that range.
- No use anywhere in the normalized available history means "Never observed."
- A capability used on Claude but unused on Codex remains unused on Codex; provider badges make that distinction visible.
- Providers with partial or unavailable coverage are excluded from definitive unused results. Their coverage note explains that Relay cannot determine inactivity safely.

Observed capability names that no longer appear in the live inventory remain eligible for `mostUsed` but not for installed-versus-unused comparison.

## Insights interface

Add a full-width **Skills & MCP usage** card below the existing Cache effectiveness and Cost outliers cards. It uses existing semantic tokens and component patterns from `src/app/globals.css`.

### Header and range

- Title: `Skills & MCP usage`
- Subtitle: `Observed capability calls across coding agents`
- URL-backed `7 days` and `30 days` controls, with `30 days` selected by default.
- The selected range changes both most-used rankings and recent-unused classification. "Never observed" always checks all available normalized history.

### Most used

Two compact lists appear side by side on desktop and stack on mobile:

- **Skills:** top five skill names.
- **MCPs:** top five MCP server names.

Each row shows invocation count, distinct session count, last-used relative time, and provider badges. Invocation count is the primary metric because an MCP may be called several times in one session; session count prevents that number from being mistaken for breadth of adoption.

Empty states distinguish "no calls in this range" from incomplete provider coverage.

### Installed but unused

A separate subsection lists active inventory capabilities with no observed calls in the selected range. Rows show capability kind, name, affected provider badges, and either:

- `Last used <relative time>` when usage exists before the selected window, or
- `Never observed in available history` when no usage has been normalized.

The list is ordered with never-observed capabilities first, then by oldest last use, then name. Show the first eight rows initially, followed by an accessible native disclosure labeled `Show all N unused capabilities` when more remain, so a large inventory does not overwhelm the Insights page.

### Coverage note

A quiet note summarizes provider coverage. It appears only when at least one provider is partial or unavailable and explicitly says that those providers are omitted from unused conclusions. Source parse errors remain visible through the existing sidebar health indicator as well.

Coverage derives from the latest `adapter_scans` row and the persisted outcome of required auxiliary reconciliation:

- `complete`: the latest scan found at least one source, reported zero errors, and Zcode's latest authoritative capability reconciliation completed successfully when applicable.
- `partial`: sources were scanned but at least one parse error occurred, or Zcode's latest reconciliation could not read every required `session`, `message`, `part`, and `tool_usage` query. A later successful pass restores complete coverage.
- `unavailable`: the provider has no completed scan or no readable sources.

Coverage describes the available Relay history, not whether a provider is currently installed or enabled.

### Responsive and accessible behavior

- Use semantic tokens and named component classes; no raw palette colors, arbitrary values, inline styles, or `dark:` variants.
- Use existing badge component classes for provider/kind indicators.
- Desktop and 390px layouts must avoid horizontal body overflow.
- Counts and states are expressed in text, not color alone.
- Range controls expose their selected state and retain keyboard focus styling.
- Lists remain readable without hover; title attributes are supplemental only.

## Error handling and trust rules

- Malformed capability evidence is skipped without failing the entire session parse.
- Only allowlisted identifiers are accepted; empty, oversized, or path-like display names are rejected.
- An unmatched Codex/Pi `SKILL.md` path is ignored rather than guessed.
- An opaque MCP identifier without an exact safe mapping may appear in most-used observations but cannot prove that an installed inventory entry is used.
- Collector/source errors downgrade the affected provider's coverage and suppress definitive unused results for that provider.
- The UI describes the data as "observed" because deleted or unavailable historical logs cannot prove lifetime non-use.

## Testing strategy

Follow test-driven development for each behavior.

### Adapter and normalization tests

- Claude explicit skill extraction, MCP server extraction, malformed input rejection, and argument non-retention.
- Zcode skill extraction plus database-backed MCP usage and database-only sessions.
- Codex namespace normalization and exact canonical-path skill matching, including negative cases for mentions, catalogs, unmatched paths, and duplicate reads.
- Pi exact-path matching and unsupported evidence behavior.
- Canonical-name validation and MCP server normalization.

### Persistence and migration tests

- Schema/bootstrap parity and generated migration.
- Transactional replacement prevents duplicate counts after repeat ingestion.
- Session deletion cascades capability usage.
- Normalization-version reindex backfills unchanged sources.

### Query tests

- 7-day and 30-day ranges.
- Ranking by invocations, sessions, and recency.
- Skill and MCP lists remain separate.
- Active installed capability filtering.
- Per-provider unused semantics and grouped display rows.
- Difference between recently unused and never observed.
- Observed-but-no-longer-installed behavior.
- Partial coverage suppression.

### Component and browser tests

- Default 30-day state and URL-backed range selection.
- Most-used, unused, never-observed, empty, and partial-coverage states.
- Desktop and 390px layout, wrapping, scrolling, keyboard interaction, and browser console.
- Existing cache and cost cards remain unchanged.

## Documentation impact

- Update `README.md` to describe skill/MCP usage and installed-versus-unused visibility on `/insights`.
- Update `AGENTS.md` and `CLAUDE.md` with the privacy-safe `session_capability_usage` boundary, provider normalization rules, and the expanded `getInsights()` responsibility.
- Do not document plugin activity because it is outside this version.

## Definition of Done

- `/insights` shows top skills, top MCPs, and active installed capabilities with no observed use for the selected range.
- The default range is 30 days; 7-day selection is URL-backed and refresh-safe.
- Claude/Zcode native skill calls, Codex/Pi exact-path skill reads, and namespaced MCP calls normalize according to this spec.
- Full collection backfills historical usage without storing prompts, arguments, results, contents, credentials, or configuration.
- Partial provider coverage never produces a definitive unused claim.
- Tests cover adapter extraction, privacy boundaries, idempotent persistence, queries, and component states.
- Browser verification covers desktop and 390px layouts, interaction states, overflow, and console errors.
- `npm run verify` exits successfully without weakening checks.
- `README.md`, `AGENTS.md`, and `CLAUDE.md` are reviewed and updated for user-facing and architectural changes.
