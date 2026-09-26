<!-- BEGIN:nextjs-agent-rules -->

# Next.js version

This project may use Next.js APIs and conventions newer than your training data. Before changing Next.js code, read the relevant guide in `node_modules/next/dist/docs/` and follow its deprecation notices.

<!-- END:nextjs-agent-rules -->

## Before editing

- Preserve unrelated working-tree changes.
- Trace data changes end to end: provider source -> adapter/reconciliation -> SQLite -> query -> UI.
- Inspect the raw shape of provider data before changing normalization.
- Treat privacy, status, hierarchy, usage, and cost rules — in this file and the `docs/agents/` references — as invariants. Update the matching file when intentionally changing one.

## Architecture map

- `src/collector/adapters/`: provider-specific JSONL normalization.
- `src/collector/index.ts`: scans, reconciliation, persistence, and filesystem watching.
- `src/collector/lock.ts`: durable collector leases; do not bypass them.
- `src/db/`: SQLite/Drizzle schema and migrations.
- `src/lib/queries.ts`: server-side dashboard read boundary.
- `src/lib/transcript.ts`: on-demand transcript reading and redaction.
- `src/lib/trajectory.ts`: derives working time, idle gaps, per-tool-call durations, and the activity ribbon's bursts from transcript entries.
- `src/lib/transcript-markers.ts`: classifies plan, decision, and phase tool calls and parses their payloads for the session log.
- `src/collector/adapters/file-edits.ts`: derives diff-impact counts from edit tool calls without retaining their arguments.
- `src/lib/pricing.ts`: dated, sourced model pricing and model normalization.
- `src/lib/agent-inventory/`: live global capability and scheduled-task discovery; never persisted by the collector.
- `src/app/globals.css`: semantic design tokens and shared component classes.

## Status semantics

- `completed`: explicit completion evidence.
- `interrupted`: explicit abort or cancellation evidence.
- `needs_attention`: reserved for a session waiting on the user, such as an unresolved Zcode `AskUserQuestion`.
- `failed`: a genuine failure, with a reason only from `usage_limit`, `insufficient_balance`, `network_error`, `model_error`, or `execution_error`.
- `running`: unfinished and updated within the last 10 minutes.
- `incomplete`: unfinished and stale. Inactivity alone must never imply interruption.

Presentation derives stale status at query time; do not trust the stored `running` value by itself. Status reasons attach only to `failed`. Attention views include `interrupted`, `needs_attention`, and `failed`.

## References

The detailed per-area rulebooks live in `docs/agents/`. Read the matching reference before editing an area, and treat it as authoritative for that area.

- `src/collector/` (adapters, scans, reconciliation, watchers) or `src/lib/transcript.ts` -> `docs/agents/collector-privacy.md`
- Capability-usage extraction in the collector or capability views in `src/lib/queries.ts` -> `docs/agents/capability-usage.md`
- `src/db/` schema or migrations, `src/lib/queries.ts`, client/server import boundaries, or page range and evidence semantics -> `docs/agents/db-server-boundaries.md`
- `src/lib/pricing.ts`, `session_model_usage`, or token/cost aggregation and display -> `docs/agents/usage-cost.md`
- `src/lib/agent-inventory/` -> `docs/agents/agent-inventory.md`
- `src/components/`, page UI, or `src/app/globals.css` -> `docs/agents/ui-conventions.md`

## Plans and verification

- For trivial, fully specified changes—especially copy, token, and one-line styling edits—do not invoke brainstorming, create a design spec, or write an implementation plan. Implement directly and verify proportionately.
- Skip a formal implementation plan for small, well-scoped changes.
- When a plan is warranted, its final task must review `README.md` for user-facing changes and `AGENTS.md`, `CLAUDE.md`, and the matching `docs/agents/` reference for architecture or convention changes.
- Do not weaken the Definition of Done to fit a task.
- After code changes, run `npm run verify`. If unrelated existing files make the format check fail, run targeted checks for changed files and report the exact pre-existing failure.
