# Attention Status Reasons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reclaim `needs_attention` to mean only "awaiting user input" and add a `failed` status carrying a reason, so the session list shows the actual cause of a stopped session.

**Architecture:** Add a `failed` status + `StatusReason` union to the type layer and a nullable `status_reason` DB column. Classify reasons in the two Zcode derivation sites only (adapter rollout + collector DB reconcile). Surface the reason through the read boundary, labels, and UI.

**Tech Stack:** TypeScript, Next.js (vendored), better-sqlite3 + Drizzle, Vitest.

## Global Constraints

- Status is derived at read/collection time; do not trust stored status for presentation (only `running` goes stale → `incomplete`).
- New UI uses semantic tokens/component classes from `globals.css`; no raw Tailwind palette, arbitrary values, inline styles, or `dark:` variants.
- Schema changes update BOTH `src/db/schema.ts` and the bootstrap SQL in `src/db/client.ts`, then `npm run db:generate`.
- `needs_attention` is emitted only by Zcode; Claude/Codex adapters are untouched.
- Reasons attach only to `failed`.

---

### Task 1: Status + reason types

**Files:**

- Modify: `src/lib/types.ts`

**Interfaces:**

- Produces: `sessionStatuses` incl. `"failed"`; `statusReasons`/`StatusReason`; `NormalizedSession.statusReason?: StatusReason`.

- [ ] **Step 1:** Add `"failed"` to `sessionStatuses` (after `"needs_attention"`).
- [ ] **Step 2:** Add:
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
- [ ] **Step 3:** Add `statusReason?: StatusReason;` to `NormalizedSession`.
- [ ] **Step 4:** `npx tsc --noEmit` — expect existing status-map errors in labels.ts (fixed Task 5); commit after Task 5.

---

### Task 2: DB column `status_reason`

**Files:**

- Modify: `src/db/schema.ts`, `src/db/client.ts`
- Generate: `drizzle/*`

- [ ] **Step 1:** In `schema.ts` `sessions` table add `statusReason: text("status_reason")` (nullable) near `status`.
- [ ] **Step 2:** In `client.ts` bootstrap SQL `CREATE TABLE sessions`, add `status_reason TEXT` column.
- [ ] **Step 3:** `npm run db:generate` to emit the migration.
- [ ] **Step 4:** `npx tsc --noEmit` on db files.
- [ ] **Step 5:** Commit schema + migration.

---

### Task 3: Adapter plumbing for `{status, reason}`

**Files:**

- Modify: `src/collector/adapters/shared.ts`, `src/collector/utils.ts`

**Interfaces:**

- Produces: `TerminalStatus = { status: "completed"|"interrupted"|"needs_attention"|"failed"; reason?: StatusReason }`; `JsonlStrategy.terminalStatus(rows) => TerminalStatus | undefined`; `staleStatus(updatedAt, terminal?: TerminalStatus)` returns `{ status: SessionStatus; reason?: StatusReason }`.

- [ ] **Step 1:** In `utils.ts` change `staleStatus` to accept an optional `{ status; reason? }` terminal and return `{ status, reason? }`. `failed` and `needs_attention`/`interrupted` are terminal; only absent-terminal derives running/incomplete from `updatedAt`.
- [ ] **Step 2:** In `shared.ts` export `TerminalStatus`, update `JsonlStrategy.terminalStatus` return type, and in `parseJsonl` set `status` and `statusReason` from the `staleStatus` result.
- [ ] **Step 3:** `npx tsc --noEmit` — expect adapter errors (fixed Task 4).

---

### Task 4: Zcode reason classification

**Files:**

- Modify: `src/collector/adapters/zcode.ts`, `src/collector/index.ts`
- Test: `src/collector/adapters/adapters.test.ts`, `src/collector/collector.test.ts`

**Interfaces:**

- Consumes: `TerminalStatus` (Task 3).
- Produces: `zcodeStoredStatus(messages, updatedAt) => { status; reason? }`.

- [ ] **Step 1 (test):** In `adapters.test.ts`, change the Zcode `failed` expectation to `status: "failed"`, `statusReason: "execution_error"`.
- [ ] **Step 2 (test):** In `collector.test.ts`, replace the `needs_attention` case and add cases: `AskUserQuestion` running → `needs_attention`; error `usage limit` → `failed/usage_limit`; `insufficient balance` → `failed/insufficient_balance`; `network connection failed` → `failed/network_error`; `no text ... no tool calls` → `failed/model_error`; unknown error → `failed/execution_error`; `cancel` → `interrupted`.
- [ ] **Step 3:** Run the two tests → FAIL.
- [ ] **Step 4:** `zcode.ts` `terminalStatus`: `cancelled`→`{status:"interrupted"}`; `failed`→`{status:"failed",reason:"execution_error"}`; completed markers→`{status:"completed"}`.
- [ ] **Step 5:** `index.ts` `zcodeStoredStatus`: return `{status,reason?}`. AskUserQuestion running → `{status:"needs_attention"}`. Error branch: classify by regex per spec (cancel→interrupted; usage/rate→usage_limit; balance/resource/recharge→insufficient_balance; network→network_error; empty-turn→model_error; else→execution_error) all as `failed`. In-flight/completed/user-break unchanged; fall through to `staleStatus(updatedAt).status`.
- [ ] **Step 6:** Update the two `reconcileZcodeMetadata` call sites: destructure `{status, reason}`, keep the interrupted-vs-running guard on `status`, include `"failed"` alongside `completed`/`needs_attention` for `ended_at`, and pass `reason` to the update/persist.
- [ ] **Step 7:** Add `status_reason` to the `UPDATE sessions ...` statement and to `persistSession`.
- [ ] **Step 8:** Run tests → PASS. `npx tsc --noEmit`.
- [ ] **Step 9:** Commit Tasks 1–4 together (types+schema+plumbing+classification).

---

### Task 5: Labels + `statusDisplay`

**Files:**

- Modify: `src/lib/labels.ts`
- Test: `src/lib/labels.test.ts` (create if absent)

- [ ] **Step 1 (test):** `statusDisplay("failed","usage_limit") === "Failed · Usage limit"`; `statusDisplay("needs_attention") === "Awaiting input"`.
- [ ] **Step 2:** Set `needs_attention: "Awaiting input"`, add `failed: "Failed"`. Add `statusReasonLabels: Record<StatusReason,string>` (Usage limit / Insufficient balance / Network error / Model error / Execution failed). Add:
  ```ts
  export function statusDisplay(
    status: SessionStatus,
    reason?: StatusReason | null,
  ): string {
    return reason
      ? `${statusLabels[status]} · ${statusReasonLabels[reason]}`
      : statusLabels[status];
  }
  ```
- [ ] **Step 3:** Run test → PASS. `npx tsc --noEmit`.

---

### Task 6: Read boundary

**Files:**

- Modify: `src/lib/queries.ts`
- Test: `src/lib/queries.test.ts`

- [ ] **Step 1 (test):** Add a `failed` session fixture; assert the `attention` filter and overview attention list include it, and that `statusReason` is surfaced on the row.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add `statusReason: StatusReason | null` to `SessionListItem`; add `status_reason statusReason` to each session SELECT (`getSessions`, `getSession`, overview attention list). Change `attention` pseudo-filter, overview list, and failures aggregate to `IN ('interrupted','needs_attention','failed')`.
- [ ] **Step 4:** Run → PASS. `npx tsc --noEmit`.
- [ ] **Step 5:** Commit Tasks 5–6.

---

### Task 7: UI

**Files:**

- Modify: `src/components/dashboard.tsx`, `src/components/session-detail.tsx`, `src/components/overview-view.tsx`, `src/app/globals.css`

- [ ] **Step 1:** Replace `statusLabels[session.status]` renders with `statusDisplay(session.status, session.statusReason)` in all three components (import `statusDisplay`).
- [ ] **Step 2:** `globals.css`: add `.status-failed` to the error-tone rule currently shared by `.status-interrupted`; move `.status-needs_attention` to its own rule with a distinct "waiting" token color.
- [ ] **Step 3:** `npx tsc --noEmit`; visually verify via preview (Task 9).
- [ ] **Step 4:** Commit.

---

### Task 8: Docs

**Files:**

- Modify: `AGENTS.md`, `README.md`

- [ ] **Step 1:** `AGENTS.md`: rewrite the status-contract sentences — explicit failures → `failed` + reason; unresolved Zcode `AskUserQuestion` → `needs_attention` (awaiting input); abort/cancel → `interrupted`.
- [ ] **Step 2:** `README.md`: update status vocabulary to "Awaiting input" / "Failed · reason".
- [ ] **Step 3:** `npx prettier --write AGENTS.md README.md`; commit.

---

### Task 9: Verify + re-derive

- [ ] **Step 1:** `npm run verify` (lint + typecheck + format:check + test:run + build). Note the 4 pre-existing doc-format failures under `docs/superpowers/{plans,specs}/2026-07-1{3,4}-*` are not ours.
- [ ] **Step 2:** Force a Zcode re-scan (script against the collector or delete `ingestion_sources` fingerprints + trigger sync) so the 11 sessions re-derive.
- [ ] **Step 3:** Query `data/relay.db`: confirm 1 `needs_attention` (Improve Catalog App UI) and 10 `failed` with expected `status_reason` values.
- [ ] **Step 4:** Preview `/sessions` and screenshot the relabeled rows.
