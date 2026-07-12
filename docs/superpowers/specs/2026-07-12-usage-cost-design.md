# Usage & Cost — Design

Date: 2026-07-12. Scope: the "Usage and Cost" TODO area. Decisions confirmed with Shuang: costs are shown everywhere as clearly-labeled **API-equivalent estimates** (subscriptions like the Claude plan and the Z.ai coding plan don't bill per token); Usage & Cost gets a **dedicated `/usage` page**; pricing lives in a **checked-in versioned table** (no runtime network calls).

## Goals (from TODO.md)

1. Normalize input, output, and cached-token usage per provider and model.
2. Versioned local pricing table with effective dates and source metadata.
3. Calculate cost only when provider, model, usage fields, and pricing record all match confidently.
4. Clearly distinguish reported cost, locally calculated cost, and unavailable cost.
5. Daily, weekly, monthly, provider, model, and project breakdowns.

## Normalized usage model

One canonical shape for all providers, stored per session **per model** (sessions mix models — e.g. Claude subagents run Sonnet inside a Fable session):

| Field | Meaning |
|---|---|
| `inputTokens` | Uncached input tokens (excludes cache reads and writes) |
| `outputTokens` | Output tokens, including reasoning/thinking tokens |
| `cacheReadTokens` | Tokens served from prompt cache |
| `cacheWriteTokens` | Tokens written to prompt cache (only Anthropic-style APIs report this) |
| `reportedCostUsd` | Cost the provider itself recorded, when present (Pi only today) |

Provider mappings (verified against real local files on 2026-07-12):

- **Claude Code**: assistant rows carry `message.usage` with `input_tokens` (already cache-exclusive), `cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens`, plus `message.model`. Streaming repeats the same usage across rows sharing one `message.id` — dedupe by message id, count once. Skip model `<synthetic>`.
- **Codex**: `token_count` events carry cumulative `info.total_token_usage`; `cached_input_tokens` is a **subset** of `input_tokens`, so normalized input = `input_tokens − cached_input_tokens`, cacheRead = `cached_input_tokens`, cacheWrite = 0. `output_tokens` already includes `reasoning_output_tokens`. Model comes from `turn_context.payload.model` (majority wins); the current adapter's `model_provider` ("openai") is wrong as a model and gets fixed.
- **Pi**: assistant `message` rows carry `model` and `usage: {input, output, cacheRead, cacheWrite, cost.total}`; `input` is cache-exclusive. Sum per model; `reportedCostUsd` = Σ `cost.total`.
- **Zcode**: `model_io` rows carry `response.usage` (camelCase); its `inputTokens` **includes** cache tokens, so normalized input = `inputTokens − cacheReadTokens − cacheWriteTokens`. Model from `model.modelId` (or legacy string `model`). One row per completed request; count each once.

Privacy: only token counts, model ids, and cost numbers are read — no new prompt/response fields.

## Schema (migration 0002)

New table `session_model_usage`: `id`, `session_id` (FK → sessions, cascade), `model` (raw provider string), `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `reported_cost_usd` (nullable real). Unique `(session_id, model)`; replaced wholesale on each re-parse (idempotent).

`sessions` keeps its existing total columns for the session list: collector now fills `input_tokens` (uncached), `output_tokens`, `cached_tokens` (read + write), and sets `model` to the dominant model by total tokens. `estimated_cost_usd` is no longer written (cost is derived at query time so pricing-table updates apply retroactively); the column stays for schema stability.

## Pricing table (`src/lib/pricing.ts`)

Client-safe pure data + pure functions (no SQLite import). Each entry: normalized model id, USD per million tokens for `input` / `output` / `cacheRead` / `cacheWrite`, `effectiveFrom` / `effectiveTo` dates, `source` URL, `retrievedAt`. Rates recorded from the 2026-07-12 lookup:

| Model | In | Out | Cache read | Cache write | Notes |
|---|---|---|---|---|---|
| claude-fable-5 | 10 | 50 | 1.00 | 12.50 | write = 1.25× (5-min TTL, Claude Code default) |
| claude-opus-4-8 / 4-7 / 4-6 | 5 | 25 | 0.50 | 6.25 | |
| claude-sonnet-5 (→ 2026-08-31) | 2 | 10 | 0.20 | 2.50 | introductory pricing |
| claude-sonnet-5 (2026-09-01 →) | 3 | 15 | 0.30 | 3.75 | sticker |
| claude-sonnet-4-6 | 3 | 15 | 0.30 | 3.75 | |
| claude-haiku-4-5 | 1 | 5 | 0.10 | 1.25 | |
| gpt-5.5, gpt-5.6-sol | 5 | 30 | 0.50 | 5 | OpenAI has no write premium (write = input rate; Codex reports no writes anyway) |
| gpt-5.4 | 2.50 | 15 | 0.25 | 2.50 | |
| gpt-5.4-mini | 0.75 | 4.50 | 0.075 | 0.75 | |
| gpt-5-mini | 0.25 | 2 | 0.025 | 0.25 | dated snapshots (e.g. `-2025-08-07`) normalize here |
| glm-5.2 | 1.40 | 4.40 | 0.26 | 1.40 | Z.ai; no write premium published |

Model normalization strips provider/plan prefixes (`z-ai/`, `builtin:zai-coding-plan/`, `<uuid>/z-ai/`), lowercases, and strips date suffixes (`gpt-5-mini-2025-08-07` → `gpt-5-mini`). `kimi-k2.6` is deliberately absent (seen once, cost already reported by Pi; no verified rate).

Cost formula per usage row: `(input·rIn + output·rOut + cacheRead·rRead + cacheWrite·rWrite) / 1e6`, using the pricing entry whose effective window contains the session's start date.

## Cost derivation (query time, `src/lib/queries.ts`)

Per usage row: `reportedCostUsd` wins; otherwise compute from pricing; otherwise unpriced. Per session, cost source is:

- **reported** — every token-bearing row has provider-reported cost;
- **estimated** — every row priced, at least one locally computed;
- **unavailable** — any token-bearing row has no price (per TODO rule 3, no partial dollar figures; the session's tokens still count in token aggregates, and aggregates report how many sessions were excluded from cost).

New read-boundary query `getUsageSummary(range)` returns: totals (cost + tokens + session count + excluded count) for today / this week / this month, a daily series (last 30 days), and provider / model / project breakdowns (cost, tokens, sessions each). Day bucketing uses the session's start date in local time, consistent with Overview.

## UI

- New `/usage` route (server component, `force-dynamic`) + `usage-view.tsx` client component; sidebar gains a Usage link. Layout mirrors Overview: summary cards (today / week / month cost with token subtitles), a 30-day cost bar strip (quantized `spark-fill-N` classes), and breakdown panels for agent (provider), model, and project with `meter-fill-N` meters. Every dollar figure carries the "estimated" framing; a caption explains API-equivalent pricing and names the pricing-table date.
- Session inspector (Sessions page): token detail becomes input / output / cache split, and the cost row shows the derived figure with a source badge (Estimated / Reported / Unavailable).
- Semantic tokens and component classes only; no raw palette colors or inline styles.

## Testing

- Adapter fixtures per provider asserting normalized per-model usage (dedupe, cache semantics, model attribution, Pi reported cost).
- Pricing unit tests: normalization patterns, effective-date selection (Sonnet 5 intro window), unknown model → undefined.
- Query test: cost source classification (reported / estimated / unavailable) and aggregation on a seeded temp DB.
- `npm run verify` (lint, typecheck, format, tests, build) plus browser check against real data.

## Out of scope

Runtime pricing fetch, budgets/alerts, per-event cost timelines, kimi pricing, cost columns in the sessions list table.
