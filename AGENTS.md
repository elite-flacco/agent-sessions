<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Relay architecture

- `src/collector/adapters/` contains provider-specific JSONL normalization. Adapters must never return raw prompts, responses, reasoning, credentials, or tool arguments.
- `src/collector/index.ts` owns idempotent source fingerprinting, persistence, and filesystem watching. Full scans and the watcher hold durable leases (`src/collector/lock.ts`, `collector_leases` table) so two processes never ingest concurrently; concurrent in-process syncs share one run. Per-adapter scan state lives in `adapter_scans`.
- `src/db/` owns the versioned SQLite/Drizzle schema; generated migrations live in `drizzle/`. Schema changes must update both `src/db/schema.ts` and the bootstrap SQL in `src/db/client.ts`, then run `npm run db:generate`.
- `src/lib/queries.ts` is the server-side read boundary for dashboard data. It imports the SQLite client, so client components may import **types only** from it; runtime values shared with client code belong in `src/lib/types.ts`, `src/lib/labels.ts`, or `src/lib/format.ts`. Session status is derived at query time (`running` goes stale to `interrupted` after 10 minutes without updates) — do not trust the stored status column for presentation.
- Pages: `/` Overview (`overview-view.tsx`), `/sessions` (`dashboard.tsx`), `/activity` (`activity-stream.tsx`, server-side throttled ingest via `src/lib/live-sync.ts`), `/projects` (`projects-view.tsx`). All share `src/components/sidebar.tsx`, use URL-backed filters/selection, and poll with `router.refresh()`.
- New UI must use semantic tokens and component classes from `src/app/globals.css`; do not introduce raw Tailwind palette colors, arbitrary values, inline styles, or `dark:` variants. For dynamic chart fills, use the quantized `meter-fill-N`/`spark-fill-N` classes instead of inline styles.

## Plan authoring rules

When a task requires an implementation plan, include `docs/superpowers/plan-dod.md` in the planning context. The final plan task must review and update `README.md` for user-facing behavior and `AGENTS.md` for architecture or convention changes. Never weaken the Definition of Done to fit a smaller task; skip a formal plan when the work does not need one.
