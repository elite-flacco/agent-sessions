<!-- BEGIN:nextjs-agent-rules -->

# Next.js version

This project may use Next.js APIs and conventions newer than your training data. Before changing Next.js code, read the relevant guide in `node_modules/next/dist/docs/` and follow its deprecation notices.

<!-- END:nextjs-agent-rules -->

# Relay contributor guide

Relay is a private, loopback-only dashboard for coding-agent sessions, usage, capabilities, and scheduled tasks. Do not broaden the server bind address without an explicit security design. Prefer the current code and tests over adding implementation history here.

## Before editing

- Preserve unrelated working-tree changes.
- Trace data changes end to end: provider source -> adapter/reconciliation -> SQLite -> query -> UI.
- Inspect the raw shape of provider data before changing normalization.
- Treat privacy, status, hierarchy, usage, and cost rules below as invariants. Update this file when intentionally changing one.

## Architecture map

- `src/collector/adapters/`: provider-specific JSONL normalization.
- `src/collector/index.ts`: scans, reconciliation, persistence, and filesystem watching.
- `src/collector/lock.ts`: durable collector leases; do not bypass them.
- `src/db/`: SQLite/Drizzle schema and migrations.
- `src/lib/queries.ts`: server-side dashboard read boundary.
- `src/lib/transcript.ts`: on-demand transcript reading and redaction.
- `src/lib/pricing.ts`: dated, sourced model pricing and model normalization.
- `src/lib/agent-inventory/`: live global capability and scheduled-task discovery; never persisted by the collector.
- `src/app/globals.css`: semantic design tokens and shared component classes.

## Collector and privacy invariants

- Adapters may return normalized metadata, never raw prompts, responses, reasoning, credentials, or tool arguments.
- Do not persist detailed transcripts. Keep `sessions.source_path` server-side and read transcripts on demand through `src/lib/transcript.ts`; Zcode prefers its message/part DB and falls back to rollout JSONL.
- Apply shared credential redaction at the transcript boundary and exclude raw reasoning records.
- Preserve normalized hierarchy fields: `parent_external_id`, `session_kind`, `agent_label`, and `agent_depth`. Traverse parent/child relationships within the same provider.
- Prefer provider-authored titles. Codex titles come from its state DB; Claude prefers `custom-title`, then `ai-title`; Zcode metadata is reconciled from its DB. Keep existing fallbacks for missing titles.
- Zcode's DB supplies authoritative metadata, database-only sessions, capability evidence, model, and usage when available. It reconciles status too, except explicit rollout interruption evidence wins over a DB-derived nonterminal status. Rollout JSONL is the fallback; branch remains JSONL-derived.
- Keep ingestion idempotent. Full scans and watchers must use collector leases; per-adapter scan state belongs in `adapter_scans`.
- Increment `NORMALIZATION_VERSION` whenever parsing, normalization, or extraction semantics change so unchanged source files are reprocessed.

## Status semantics

- `completed`: explicit completion evidence.
- `interrupted`: explicit abort or cancellation evidence.
- `needs_attention`: reserved for a session waiting on the user, such as an unresolved Zcode `AskUserQuestion`.
- `failed`: a genuine failure, with a reason only from `usage_limit`, `insufficient_balance`, `network_error`, `model_error`, or `execution_error`.
- `running`: unfinished and updated within the last 10 minutes.
- `incomplete`: unfinished and stale. Inactivity alone must never imply interruption.

Presentation derives stale status at query time; do not trust the stored `running` value by itself. Status reasons attach only to `failed`. Attention views include `interrupted`, `needs_attention`, and `failed`.

## Capability usage invariants

- `session_capability_usage` is the privacy-safe boundary for observed skill and MCP use. Persist only session/provider identity, kind, canonical name, stable event ID, and valid timestamp—never prompts, arguments, results, skill contents, credentials, raw config, or payload bodies.
- Keep inference conservative: Claude and Zcode use native skill calls; Codex and Pi require exact active-inventory matches for `SKILL.md` reads; MCP aliases must be exact and collision-free. Plugin activity is outside this feature.
- Observed usage remains reportable regardless of inventory coverage. Adoption and unused conclusions include only active installations from providers with complete scan coverage.
- Zcode coverage is complete only after every required authoritative DB query succeeds. On failure, mark coverage partial and preserve prior rollout evidence until a later successful reconciliation.

## Database and server boundaries

- Schema changes must update both `src/db/schema.ts` and the bootstrap SQL in `src/db/client.ts`, then run `npm run db:generate`.
- Keep generated migrations in `drizzle/`. For every migration, append the matching ordered `alreadyPresent` predicate in `src/db/migrate.ts` so bootstrap-created databases can establish the correct baseline.
- Client components may import only types from `src/lib/queries.ts`. Put client-safe runtime values in `src/lib/types.ts`, `src/lib/labels.ts`, or `src/lib/format.ts`.
- Never expose `sessions.source_path` through client-side session list data. Allowlisted inventory and scheduled-task source paths are intentionally displayable.
- The shared URL-backed `OverviewRange` is `7d` (default), `30d`, or `all`; `all` removes the lower timestamp cutoff. Overview, Sessions, Usage & Cost, Insights, and Project briefings use the shared `RangeSwitcher`. Sessions additionally accepts `range=today` only for the Overview card's contextual drilldown. `getOverview(range)` and `getOverviewPatterns(range)` narrow the period KPIs, session-length histogram, and cost-at-a-glance to that window. The activity heatmap always spans 30 days regardless of range (a week is too sparse for the day x band grid). "Today", running, needs-attention, and recent-projects queries stay range-independent because they are inherently now-scoped.
- The `/usage` page passes the parsed range to `getUsageSummary(range)`; its selected summary, daily history, and model/agent/project buckets must all describe that same period. The all-time daily series begins with the earliest included usage date.
- The `/insights` page uses the same URL-backed `range` and default. Pass it to `getInsights(range, inventories)` so cache effectiveness, cost outliers, and capability adoption always describe one selected period; capability tabs remain separately URL-backed through `capabilityTab`.
- The `/projects` briefing takes the same URL-backed `range` plus an `evidence` filter (`all` default, `attention`), both parsed server-side and passed to `getProjectDetail(key, range, evidence)`. Every `window*` field, the cost rollup, spend trend, provider split, and activity feed describe that range; `project` stays the all-time summary, and worktree context is deliberately all-time. Project cost aggregates must visit each session once — never sum `getSessionsCostUsd`, whose figures are subtree roll-ups that would bill a delegating parent and its subagents twice — while the "most expensive session" ranking still credits a subtree to its topmost in-window session.

## Usage and cost invariants

- Persist per-model token usage in `session_model_usage`; never persist derived dollar costs.
- Derive costs at read time. Provider-reported row cost wins over the dated pricing table; new pricing entries require an effective date and source URL.
- A cost is available only when every contributing usage row is priced; otherwise report it as unavailable and exclude it from dollar aggregates.
- A session detail/list cost rolls up its complete subagent subtree. Overall totals count each stored session once so subagents are not double-counted.
- Per-session outlier rankings credit a subtree to its topmost in-window ancestor and must still sum to the same weekly total.
- Cache-savings estimates require table pricing even when the provider reports actual cost, because the counterfactual cache rates still need to be derived.
- Choose the representative model by token dominance, preserving the existing zero-usage fallback.
- `normalizeModel` may strip routing and dated snapshot prefixes/suffixes, but must preserve real source prefixes such as `z-ai/`; those are distinct deployable sources with distinct pricing.

## Agent inventory invariants

- Discovery is global, live, read-only, allowlist-based, and separate from session collection.
- Return only safe metadata: names, status, packaging, provenance, repositories, safe paths, warnings, and global instruction Markdown. Never expose MCP commands, arguments, environment variables, credentials, or raw config.
- Scheduled-task readers are the sole exception: they may show the user-authored instruction body verbatim. A secret pasted into a prompt or script will therefore render; do not extend this exception to other capability types.
- Retain disabled capabilities in normalized inventories for comparison, even when inventory lists hide them. Only explicit `false` means disabled; absence from an enabled map means installed with unknown enabled state.
- Treat missing install paths and broken skill links as unavailable.
- Compare all primary providers; Pi is contextual. Do not provider-filter the comparison matrix. Unavailable items are Fixes; a two-of-three gap is a Fix only for skills.sh capabilities and a Review otherwise; one-provider items are Context.
- Skill content drift compares whitespace-normalized `SKILL.md` fingerprints. Skill configuration drift covers status/origin; non-skill configuration drift also covers packaging.
- Surface deduplicated discovery warnings and active same-provider duplicate installs. For scheduled-task directory formats, enumerate directories only; mark Codex targets orphaned only when its project map was read successfully.
- Keep `{ kind: "global" }` explicit at the public discovery boundary.

## UI conventions

- Keep browsing filters URL-backed and use the shared sidebar.
- `router.refresh()` only rereads SQLite. Pages that must show fresh local activity must also call the shared throttled `refreshIngestedData()`; use `DASHBOARD_REFRESH_INTERVAL_MS` for polling and ingestion cadence.
- Use semantic tokens and component classes from `src/app/globals.css`. Component CSS lives there, not in co-located `*.module.css` files.
- Prefer Tailwind utilities backed by the semantic `@theme inline` tokens (e.g. `flex gap-2`, `text-muted-foreground`) for trivial one-off spacing and layout. Add a `globals.css` class when the styling has states, breakpoints, pseudo-elements, or more than one consumer.
- Do not add raw Tailwind palette colors, arbitrary values, or `dark:` variants. Inline styles are only permitted for data-driven values that can't be a class (e.g. a meter fill width derived from a runtime ratio).
- For the heatmap, use the quantized `heat-fill-N` classes. Meter and sparkline fills are derived inline from `level()` in `src/lib/format.ts`.
- Verify visible behavior in a browser at relevant desktop and mobile widths.

## Plans and verification

- For trivial, fully specified changes—especially copy, token, and one-line styling edits—do not invoke brainstorming, create a design spec, or write an implementation plan. Implement directly and verify proportionately.
- Skip a formal implementation plan for small, well-scoped changes.
- When a plan is warranted, its final task must review `README.md` for user-facing changes and both `AGENTS.md` and `CLAUDE.md` for architecture or convention changes.
- Do not weaken the Definition of Done to fit a task.
- After code changes, run `npm run verify`. If unrelated existing files make the format check fail, run targeted checks for changed files and report the exact pre-existing failure.
