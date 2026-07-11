<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Relay architecture

- `src/collector/adapters/` contains provider-specific JSONL normalization. Adapters must never return raw prompts, responses, reasoning, credentials, or tool arguments.
- `src/collector/index.ts` owns idempotent source fingerprinting, persistence, and filesystem watching.
- `src/db/` owns the versioned SQLite/Drizzle schema; generated migrations live in `drizzle/`.
- `src/lib/queries.ts` is the server-side read boundary for dashboard data.
- `src/components/dashboard.tsx` owns the interactive Sessions experience and URL-backed filters.
- New UI must use semantic tokens and component classes from `src/app/globals.css`; do not introduce raw Tailwind palette colors, arbitrary values, inline styles, or `dark:` variants.

## Plan authoring rules

When a task requires an implementation plan, include `docs/superpowers/plan-dod.md` in the planning context. The final plan task must review and update `README.md` for user-facing behavior and `AGENTS.md` for architecture or convention changes. Never weaken the Definition of Done to fit a smaller task; skip a formal plan when the work does not need one.
