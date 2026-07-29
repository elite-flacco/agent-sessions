# Recovering missing model + usage (zcode DB primary, codex fallback)

**Date:** 2026-07-28
**Status:** Approved design

## Problem

90 sessions render with model "(unknown)" on `/sessions`. `sessions.model` is
derived solely from extracted token usage (`dominantModel(usage)` in
`src/collector/adapters/shared.ts`), so a session with no usage row has no
model. Investigation showed the model is recoverable in every case — and, more
importantly, that the underlying usage is missing or wrong far beyond those 90
sessions.

### Evidence

- **90 blank sessions:** 86 zcode (51 subagent, 35 main) + 4 codex, all with
  null token counts.
- **The Zcode DB is authoritative and complete.** `~/.zcode/cli/db/db.sqlite`
  has a `model_usage` table (per request: `model_id`, `input_tokens`,
  `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`,
  `query_source`, `status`, `retry_count`, `raw_usage_json`). It covers 167/168
  zcode sessions Relay knows about (the one gap is a synthetic
  `model-io-no-session` orphan).
- **The rollout undercounts.** Zcode prunes/rotates `model-io-*.jsonl` rollout
  files, so adapter-parsed usage is partial or stale. Of 82 currently-populated
  zcode sessions, only 50 match the DB; the other 31 are 2–5× low. Example
  `sess_ef8f183a`: its rollout file is deleted from disk and Relay stored
  `output_tokens = 1034`, while the DB shows the true figure is 52,874.
- **The DB is not retry-inflated.** `attempt_index` is always 0 (retries are a
  `retry_count` annotation on a single row, never duplicate rows), and
  `turn_usage` matches `model_usage` (main_turn + completed) exactly. Summing
  `model_usage` per `session_id` is safe with no dedup.
- **Token semantics match `model_io`.** `input_tokens` is cache-inclusive
  (`raw_usage_json.totalTokens == inputTokens + outputTokens`, with
  `cacheReadTokens ⊂ inputTokens`), so uncached input =
  `input_tokens − cache_read_input_tokens − cache_creation_input_tokens`,
  identical to the existing rollout treatment. (`cache_creation` is 0 for all
  current rows; the subtraction is kept for parity and safety.)
- **Codex blanks are zero-usage automations.** The 4 codex sessions are
  scheduled automations that failed at zero balance (`token_count.info: null`,
  `credits.balance: "0"`). They genuinely used no tokens, but the model
  (`gpt-5.5`) is present in `turn_context.model`.

### Impact (why this matters beyond the blank rows)

Making the Zcode DB primary fills 86 blank sessions **and corrects 31
undercounted ones**. Aggregate zcode usage moves substantially and correctly:

| Metric         | Current (rollout) | DB (authoritative) |
| -------------- | ----------------- | ------------------ |
| Output tokens  | 0.98M             | 2.63M (~2.7×)      |
| Uncached input | 6.16M             | 20.73M             |
| Cache read     | 161.8M            | 361.8M             |

Cost/usage aggregates (`/usage`, overview cost card, insights week total and
cost outliers) will rise accordingly. This is a correction of existing
under-counting, not a new estimate.

## Decisions (locked)

1. **Zcode DB is the primary usage/model source**, not a fallback. Rollout
   `model_io` parsing is demoted to the fallback used only when the DB is
   unavailable (missing DB, or `ZCODE_DB_PATH` unset in tests).
2. **Include all `model_usage` rows** for a session regardless of
   `query_source` — `main_turn`, `subagent`, `session_title`, `compact`. It is
   all real model spend and the auxiliary calls are tiny. Zero-token `error`
   rows contribute nothing but are not specially excluded.
3. **Subagent attribution is per own `session_id`.** Subagent rows carry
   `session_id = sess_subagent_agent_*`; a parent's rows never include its
   children's tokens, so per-session aggregation composes correctly with the
   existing subagent cost roll-up (`getSessionsCostUsd`).
4. **Codex keeps a separate, label-only fallback** for zero-usage sessions.

## Design

### A. Zcode DB as primary usage/model source

**Read helper — `src/lib/zcode-db.ts`**

Add `getModelUsage(sessionExternalIds: string[]): Map<string, ModelUsage[]>`
(read-only), returning normalized per-model usage keyed by session external id:

```
SELECT session_id, model_id,
  SUM(input_tokens) input, SUM(output_tokens) output,
  SUM(cache_read_input_tokens) cacheRead,
  SUM(cache_creation_input_tokens) cacheWrite
FROM model_usage
WHERE session_id IN (…) AND model_id IS NOT NULL AND model_id != ''
GROUP BY session_id, model_id
```

Map each group to `ModelUsage`:
`inputTokens = max(0, input − cacheRead − cacheWrite)`, `outputTokens`,
`cacheReadTokens = cacheRead`, `cacheWriteTokens = cacheWrite`. No
`reportedCostUsd` (Relay prices zcode from the table). Honor the existing
`ZCODE_DB_PATH` seam and `__resetZcodeDbCache`.

**Collector reconciliation — `src/collector/index.ts`**

In the existing post-full-scan Zcode reconciliation (beside the title/status/
metadata reconcile), for every zcode session whose external id the DB covers:

- Replace that session's `session_model_usage` rows with the DB-derived rows
  (delete-then-insert, or upsert plus delete of models no longer present — reuse
  the existing usage-write statements in `index.ts`).
- Recompute and set `sessions.model` to the dominant model (max total tokens);
  when every row is zero-token, still set the single present `model_id` so
  failed/zero sessions show a model rather than "(unknown)".
- Recompute `sessions.input_tokens`/`output_tokens`/`cached_tokens` from the
  DB-derived usage to match (these mirror the summary the adapter writes).

Sessions the DB does not cover (the `model-io-no-session` orphan, or any
environment without the DB) keep their rollout-derived usage untouched — the
adapter path remains the fallback. Because this runs in the reconcile step, it
backfills existing sessions without depending on file fingerprints.

**Adapter (`src/collector/adapters/zcode.ts`)** is unchanged: its `model_io`
`usage()` remains as the fallback. No transcript-schema parser is added — the DB
covers subagents uniformly.

### B. Codex model fallback (label only)

- Add optional `model?(rows): string | undefined` to the adapter strategy type.
- In `shared.ts`, set `model: dominantModel(usage) ?? strategy.model?.(rows)`.
- Codex implements `model` as the majority `turn_context.model`, falling back to
  `session_meta.model`. No usage is fabricated; cost stays $0/unavailable.

This is independent of the zcode work and needs `NORMALIZATION_VERSION` bumped
so codex rollouts re-parse.

## Testing

- **`zcode-db.ts`**: `getModelUsage` aggregates per session+model, computes
  uncached input correctly, includes all query_sources, and returns nothing for
  unknown ids. Use a seeded temp DB via `ZCODE_DB_PATH` (existing test seam).
- **Collector reconciliation**: a DB-only zcode session (no rollout) gains usage
  - model; a session with a partial rollout is overwritten with the larger DB
    totals; the uncovered orphan keeps rollout usage; a zero-token failed session
    still gets a model. Assert `session_model_usage` rows and `sessions.model`.
- **Subagent non-overlap**: a parent and its subagent each receive only their
  own tokens (no double counting).
- **Codex fallback**: a rollout with `turn_context.model` but no usable
  `token_count` yields `sessions.model` set and no usage rows.
- **Regression**: the 50 already-matching zcode sessions are unchanged.

## Docs

- **`AGENTS.md`**: document that Zcode usage/model is reconciled from the DB
  `model_usage` table (primary), with rollout `model_io` parsing as the
  fallback; note the all-query_source inclusion and per-session attribution.
- **`README.md`**: note that zcode cost/usage reflects Zcode's own recorded
  usage, and that costs may exceed earlier figures because rollout files
  undercount.

## Verification (Definition of Done)

Bump `NORMALIZATION_VERSION` (13 → 14) for the codex re-parse. Run the full
check suite (format, lint, typecheck, tests, build). After a sync, confirm on
`/sessions` that previously-"(unknown)" sessions show a model and that the
Insights/Usage totals reflect the corrected zcode figures.
