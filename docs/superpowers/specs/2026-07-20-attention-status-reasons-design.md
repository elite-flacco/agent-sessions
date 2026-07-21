# Attention status reasons — design

## Problem

`needs_attention` currently conflates two very different things:

1. A session genuinely **waiting on the user** (an unresolved Zcode
   `AskUserQuestion` tool call).
2. A session that **failed** for some provider-side reason — usage-limit
   throttle, insufficient balance, network error, empty model turn, or a
   generic subagent execution failure.

Today any non-`cancel` error on the last Zcode message, and any rollout
`status === "failed"`, maps to `needs_attention`. Of 11 current
`needs_attention` sessions, only **1** is actually awaiting input; the other
10 are failures the UI can't tell apart. The label tells the user nothing
about what actually happened.

`needs_attention` is emitted **only by Zcode** — the Claude and Codex adapters
produce only `completed` / `interrupted` / `undefined`. So the derivation
changes are confined to the two Zcode status sites.

## Goal

- `needs_attention` means **only** "awaiting user input" (unresolved
  `AskUserQuestion`). Relabel it **"Awaiting input"**.
- Introduce a terminal status **`failed`** for genuine errors, carrying a
  **reason** so the session list shows the actual cause
  (e.g. "Failed · Usage limit").
- `interrupted` is unchanged (explicit user cancel/abort).

## Status model

`src/lib/types.ts`

- Add `"failed"` to `sessionStatuses`.
- New reason union:

  ```ts
  export const statusReasons = [
    "usage_limit",
    "insufficient_balance",
    "network_error",
    "model_error",
    "execution_error",
  ] as const;
  export type StatusReason = (typeof statusReasons)[number];
  ```

- `NormalizedSession` gains `statusReason?: StatusReason`.

Reasons attach only to `failed`. `needs_attention` is self-describing and
carries no reason. `interrupted`/`completed`/`running`/`incomplete` carry no
reason.

## Reason classification

Only the two Zcode derivation sites change. Both return
`{ status; reason? }`.

### `zcodeStoredStatus` (`src/collector/index.ts`, DB message/part path)

Order of checks (first match wins):

1. Any `AskUserQuestion` part with `state.status === "running"` →
   `{ status: "needs_attention" }` (awaiting input).
2. Last message `data.error` present → classify by
   `JSON.stringify(error)`:
   - `/cancel/i` → `{ status: "interrupted" }`
   - `/usage limit|rate limit/i` → `{ status: "failed", reason: "usage_limit" }`
   - `/insufficient balance|no resource package|recharge/i` →
     `{ status: "failed", reason: "insufficient_balance" }`
   - `/network connection failed/i` →
     `{ status: "failed", reason: "network_error" }`
   - `/no text.*no tool calls|no usage before completing/i` →
     `{ status: "failed", reason: "model_error" }`
   - otherwise → `{ status: "failed", reason: "execution_error" }`
3. Assistant turn in flight / completed / user break → unchanged
   (`staleStatus` derives running/incomplete/completed as today).

### Zcode adapter `terminalStatus` (`src/collector/adapters/zcode.ts`, rollout JSONL)

Rollout rows have no error text.

- `status === "cancelled"` → `{ status: "interrupted" }`
- `status === "failed"` → `{ status: "failed", reason: "execution_error" }`
- completed markers → `{ status: "completed" }`

This covers subagents (their rollout carries `status: "failed"` /
`"Turn execution failed"`); the richer reasons come from the DB reconcile
path for main sessions.

## Plumbing

- **`shared.ts`** — `JsonlStrategy.terminalStatus` returns
  `{ status: "completed" | "interrupted" | "needs_attention" | "failed";
  reason?: StatusReason } | undefined`. `parseJsonl` sets both
  `session.status` (via `staleStatus`) and `session.statusReason`.
- **`utils.ts`** — `staleStatus` accepts the terminal status value; a small
  helper keeps the `{status, reason}` split so callers thread `reason` onto
  the session. `failed` is terminal (never goes stale).
- **`persistSession`** — writes the new `status_reason` column; include
  `failed` wherever `completed`/`needs_attention` currently gate `ended_at`.
- **Schema** — add nullable `status_reason TEXT` to `sessions` in
  `src/db/schema.ts` and the bootstrap SQL in `src/db/client.ts`; run
  `npm run db:generate` for the migration. `migrate.ts` baseline unaffected
  (additive nullable column).

## Read boundary — `src/lib/queries.ts`

- `SessionListItem` gains `statusReason: StatusReason | null`; add
  `status_reason statusReason` to every session SELECT
  (`getSessions`, `getSession`, and any other session projection).
- The `attention` pseudo-filter and the overview attention list/count become
  `status IN ('interrupted', 'needs_attention', 'failed')` — everything that
  wants a human. The failures aggregate (cost) includes `failed`.
- `statusExpression` unchanged (only `running` goes stale).

## Labels — `src/lib/labels.ts`

- `statusLabels.needs_attention = "Awaiting input"`, add
  `statusLabels.failed = "Failed"`.
- `statusReasonLabels: Record<StatusReason, string>`:
  `usage_limit → "Usage limit"`, `insufficient_balance → "Insufficient balance"`,
  `network_error → "Network error"`, `model_error → "Model error"`,
  `execution_error → "Execution failed"`.
- `statusDisplay(status, reason)` helper → `"Failed · Usage limit"` when a
  reason is present, otherwise `statusLabels[status]`.

## UI

- `dashboard.tsx`, `session-detail.tsx`, `overview-view.tsx` render
  `statusDisplay(session.status, session.statusReason)` instead of
  `statusLabels[session.status]`. The status filter dropdown picks up
  "Failed" automatically from `statusLabels`.
- `globals.css`: add `.status-failed` to the error-tone group with
  `.status-interrupted`. Give `.status-needs_attention` its **own** calm
  ("waiting") tone, distinct from the failure tone.

## Docs

- `AGENTS.md` — rewrite the status-contract sentences: explicit failures →
  `failed` with a reason; unresolved Zcode `AskUserQuestion` → `needs_attention`
  ("awaiting input"); explicit abort/cancel → `interrupted`.
- `README.md` — reflect the new "Awaiting input" / "Failed · reason" labels
  wherever status vocabulary appears.

## Testing (TDD)

- `adapters.test.ts` — the Zcode `failed` case now asserts
  `status: "failed"`, `statusReason: "execution_error"`.
- `collector.test.ts` — `zcodeStoredStatus`: add cases for
  `AskUserQuestion` → `needs_attention`; each error family → `failed` + reason;
  `cancel` → `interrupted`.
- `queries.test.ts` — the attention filter/list includes `failed`; SELECT
  surfaces `statusReason`.
- `labels` — `statusDisplay` composes reason text.

## Rollout

After merge, force a Zcode re-scan so the 11 stored `needs_attention` rows
re-derive: 1 → `needs_attention` (Awaiting input), 10 → `failed` with their
reasons. Verify against `data/relay.db`.

## Out of scope

- No new statuses per reason (single `failed` + reason detail).
- No change to Claude/Codex derivation (they never emit `needs_attention`).
- No transient-vs-hard split at the status level — reason text carries that
  nuance.
