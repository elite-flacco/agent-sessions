# Code Review — 2026-07-12

Three review passes, consolidated:

1. **Usage & Cost milestone** — commits `1ba8f1f` (design spec) + `2293c45` (implementation), ~2,200 lines across adapters, schema, pricing, queries, and UI.
2. **Full codebase** — every source file: collector, adapters, DB layer, query boundary, API surface, all pages/components, configs, and tests.
3. **Independent full-codebase pass + provider-pricing re-verification** — re-checked the checked-in pricing table against the providers' live pricing pages and re-traced the cost-derivation paths. Caught the `gpt-5.6-sol` cache-write rate error (#4) and the by-model attribution gap (#5).

All findings were verified against the live database, real provider session files on this machine, and (for pricing) the providers' published pricing pages. Duplicated findings between passes appear once, at the higher severity.

Severity scale: **P0** blocks release · **P1** likely bug / major design risk · **P2** important gap · **P3** minor.

---

## P1

### 1. Session search silently fails for queries containing `_` or `%`

**Where:** [`src/lib/queries.ts:82`](../../src/lib/queries.ts) (`getSessions`)

`getSessions` escapes `%` and `_` in the search string as `\%` / `\_`, but the `LIKE` clauses declare no `ESCAPE '\'`. SQLite gives backslash no special meaning in `LIKE` by default, so the pattern demands a _literal backslash_ in the stored text.

**Verified empirically:** searching `fix_bug` or `50%` returns zero rows against titles containing exactly that text; adding `ESCAPE '\'` returns the correct rows. Underscores are common in branch, repo, and file names, so real searches break.

**Fix:** append `ESCAPE '\'` to all three `LIKE` clauses, and escape backslash itself in the user input first (`\` → `\\` before the `%`/`_` replacements).

---

## P2

### 2. `normalizeModel` misses Anthropic's compact-date snapshot ids

**Where:** [`src/lib/pricing.ts:196`](../../src/lib/pricing.ts) (`normalizeModel`)

The date-suffix regex `/-\d{4}-\d{2}-\d{2}$/` strips dashed dates (`gpt-5-mini-2025-08-07`) but not compact ones (`-20251001`). Anthropic's official pinned ids use the compact form — Haiku 4.5's _primary_ API id is `claude-haiku-4-5-20251001` (confirmed on the live models page), and legacy ids like `claude-sonnet-4-5-20250929` / `claude-opus-4-1-20250805` follow the same pattern.

**Impact:** any session that logs a dated Anthropic id fails the pricing lookup; under the all-or-nothing rule the _entire session_ reads "unavailable" and silently drops out of dollar aggregates, understating costs. Local data currently only contains dateless aliases, so nothing is wrong today — this fails quietly the day a dated id appears (e.g. a subagent pinned to Haiku).

**Fix:** also strip `/-\d{8}$/`; add `["claude-haiku-4-5-20251001", "claude-haiku-4-5"]` to the normalization test cases.

### 3. Codex session titles display harness-injected boilerplate

**Where:** [`src/collector/utils.ts:53`](../../src/collector/utils.ts) (`safeTitle`), [`src/collector/adapters/codex.ts:30`](../../src/collector/adapters/codex.ts) (`title`)

Two sessions in the current 7-day view are titled _"This block is automatically suppli…"_. Root cause (confirmed in the raw rollout files): the first user message is a `<recommended_plugins>` block — stripped correctly — and the second is an `<in-app-browser-context source="ambient-ui-state">` block, whose tag is **not** in `safeTitle`'s strip list. The generic tag-removal keeps its inner prose, which becomes the title.

The enumerated-blocklist design guarantees this recurs whenever a harness adds a new wrapper tag.

**Fix:** add `in-app-browser-context` to the strip list now; longer-term, prefer a structural rule (e.g. strip any leading `<tag …>…</tag>` block the message starts with, or skip candidates whose stripped text begins with known-injected boilerplate).

### 4. `gpt-5.6-sol` cache-write is underpriced; the pricing-table header comment is now false

**Where:** [`src/lib/pricing.ts:113`](../../src/lib/pricing.ts) (`gpt-5.6-sol` entry) and the header comment at [`src/lib/pricing.ts:27`](../../src/lib/pricing.ts)

_Third-pass finding (provider-pricing re-verification)._ The table sets `cacheWritePerMTok = inputPerMTok` ($5) for `gpt-5.6-sol`, matching the comment "OpenAI and Z.ai publish no cache-write premium, so writes price as ordinary input there." But OpenAI's live pricing page publishes an **explicit cache-write column for the gpt-5.6 family at $6.25/MTok** (1.25× the $5 input; cached reads $0.50 = 0.1×). The "no premium" rule holds for `gpt-5.5` and earlier only — confirmed live. (The `gpt-5.6-sol` input/output/cache-read rates of $5 / $30 / $0.50 are correct; only cache-write is wrong.)

**Impact:** cache-write tokens are typically the largest bucket in agentic coding sessions, so `gpt-5.6-sol` sessions undercost that bucket by ~20%. Estimates are labeled approximate, but this is a checked-in fact error, not an estimation caveat.

**Fix:** set `cacheWritePerMTok: 6.25` for `gpt-5.6-sol`; rewrite the header comment to note the per-family exception rather than a blanket "OpenAI has no premium." (Leave the `gpt-5.5`/`5.4`/`5.4-mini`/`5-mini` entries as-is — their cache-write = input is correct.)

### 5. By-model chart zeroes a _priced_ model when a sibling model in the same session is unpriced

**Where:** [`src/lib/queries.ts:659`](../../src/lib/queries.ts) (`getUsageSummary`, the `byModel` loop)

_Third-pass finding._ Per-model cost is gated on the session-level `priced` flag:

```ts
for (const [model, totals] of session.models) {
  addBucket(byModel, model, session.priced ? totals.costUsd : 0, totals.tokens);
}
```

`session.priced` is set `false` if _any_ usage row in the session is unpriced (`queries.ts:596`). So a session running a priced model A ($5) and an unknown model B causes model A's $5 to be dropped from `byModel` entirely — even though A is fully priced on its own. A model's displayed cost then depends on whether it ever co-occurred with an unknown model, and the `byModel` totals won't reconcile with the window totals.

The window-level exclusion (`queries.ts:644`) is correct and matches the documented "any unpriced usage → session excluded from dollar sums" rule; the bug is that this session-level gate is reused at model granularity. No test covers the mixed-model case — `queries.test.ts:248` only exercises a single-model unpriced session. (See also #11 for the inverse display problem.)

**Fix:** track a per-model priced flag (accumulate at the row, not the session) and attribute cost when that model is individually priced; or document that `byModel` reflects fully-priced sessions only. Add a multi-model test.

---

## P3

### 6. Overview drill-down links drop `needs_attention`

**Where:** [`src/components/overview-view.tsx:81`](../../src/components/overview-view.tsx), `:112`

The "Failures this week" metric and the "Needs attention" panel both count `interrupted` **and** `needs_attention` sessions (`getOverview` / `getAttentionSessions`), but their "View all" links filter to `/sessions?status=interrupted` only. A failed ZCode session is counted in the card yet missing from the drill-down list. The status filter is single-valued, so either add a combined pseudo-filter or link to the unfiltered list.

### 7. Stale usage rows survive a re-parse that yields no usage

**Where:** [`src/collector/index.ts:101`](../../src/collector/index.ts) (`persistSession`)

The `session_model_usage` cleanup (`DELETE … WHERE model NOT IN (…)`) only runs when the new parse produced usage rows, and the `sessions` upsert `COALESCE`s the token columns so they never clear either. A session whose source re-parses to zero usage (adapter change, truncated source) keeps showing its old cost with no token backing. Move the delete outside the `if` (delete-all when usage is empty).

### 8. Day-bucketing mixes UTC and local time

**Where:** [`src/lib/queries.ts`](../../src/lib/queries.ts) (`getUsageSummary`, `getOverview`)

"Today" windows use local midnight (`startOfToday()`), while the daily series in both `getOverview` (SQLite `date(started_at)`) and `getUsageSummary` (`startedAt.slice(0, 10)`) bucket by **UTC** date. In EDT, sessions started after 8pm land on the next day's bar, and the Today card can disagree with the chart's last bar in the evening. The usage design spec explicitly says local-time bucketing, so this is also spec drift — either fix the bucketing in both places or amend the spec sentence.

### 9. Two processes _can_ ingest concurrently, contradicting AGENTS.md

**Where:** [`src/collector/lock.ts`](../../src/collector/lock.ts), [`src/collector/index.ts:246`](../../src/collector/index.ts)

The `sync` and `watch` leases are independent names, so a watcher process and a second process running a full scan (e.g. `npm run collect` while the dev server's `/activity` live-sync fires) ingest at the same time. Consequences are benign — better-sqlite3 serializes writes and every upsert is idempotent — but AGENTS.md states "two processes never ingest concurrently," which the lease design doesn't actually enforce. Either have ingestion respect both leases or soften the doc.

### 10. ZCode status semantics and subagent noise

**Where:** [`src/collector/adapters/zcode.ts:40`](../../src/collector/adapters/zcode.ts) (`terminalStatus`), `:14` (`discover`)

- `terminalStatus` treats any row with `completedAt` as session completion, and every `model_io` row gets one when its request finishes — so a ZCode session reads "completed" between requests while the agent is still mid-task. ZCode essentially never shows "running", undercounting Active Now.
- `discover` ingests `.zcode/cli/agents/**/transcript.jsonl` — 23 subagent transcripts on this machine, each with a distinct `sess_subagent_*` id, each becoming its own fallback-titled "Zcode coding session" that inflates session counts and the Unknown-workspace group. If unintended, skip `sess_subagent_*` session ids.
- Related scope note: `~/.codex/archived_sessions` (18 files here) is never discovered; archived Codex sessions only appear if ingested before archiving.

### 11. Unpriced models render as "$0.00" in the By-model list

**Where:** [`src/components/usage-view.tsx`](../../src/components/usage-view.tsx), [`src/lib/queries.ts`](../../src/lib/queries.ts) (`getUsageSummary`)

Model buckets containing only unpriced usage accumulate `costUsd: 0` and display "$0.00", indistinguishable from genuinely cheap usage; only the window cards disclose "N without pricing". Consider rendering "—" for buckets with no priced sessions. (The inverse case — a *priced* model rendered as $0 because of an unpriced sibling — is a separate logic bug, #5.)

### 12. `/sessions` runs the full 30-day usage aggregation on every poll

**Where:** [`src/app/sessions/page.tsx:54`](../../src/app/sessions/page.tsx)

`getUsageSummary()` (full 30-day join + JS aggregation) runs on every 15-second poll just to display the "Est. cost today" card. Fine at current scale (hundreds of sessions); worth a dedicated today-only query if the table grows.

### 13. ⌘K hint has no handler

**Where:** [`src/components/dashboard.tsx:180`](../../src/components/dashboard.tsx)

The search box renders a `⌘ K` kbd hint, but no keydown listener exists anywhere in the app — the shortcut does nothing. Wire it up (focus the search input) or drop the hint.

### 14. `getProjects` splits `GROUP_CONCAT` on bare commas

**Where:** [`src/lib/queries.ts:261`](../../src/lib/queries.ts)

`providers`, `branches`, and `workdirs` are split on `,`. A cwd (or branch) containing a comma splits into garbage entries in the Projects inspector. Use a custom separator unlikely to appear in paths (e.g. `GROUP_CONCAT(DISTINCT cwd, '')`).

### 15. Anthropic cache rates cite a source page that doesn't publish cache rates

**Where:** [`src/lib/pricing.ts:30`](../../src/lib/pricing.ts) (`source` field on every `claude-*` entry)

_Third-pass finding._ All Anthropic entries cite the models _overview_ page, whose footnote explicitly defers prompt-caching rates to a separate Pricing page. The 0.1× read / 1.25× write convention is Anthropic's long-standing pattern and very likely correct, but it is unverifiable from the cited URL — and AGENTS.md requires entries to be "dated and sourced." (The input/output rates _are_ on the overview page; only the cache rates are not.)

**Fix:** point the `source` at the Anthropic Pricing page that actually publishes cache rates; keep `retrievedAt`.

### 16. Dead `estimated_cost_usd` column contradicts "dollars never stored"

**Where:** [`src/db/schema.ts:32`](../../src/db/schema.ts), [`src/collector/index.ts:95`](../../src/collector/index.ts) (always inserts `null`), [`src/lib/queries.ts`](../../src/lib/queries.ts) (selected but never used for cost)

_Third-pass finding._ After this milestone, all cost is derived at read time from `session_model_usage` + `pricing.ts`. The nullable `estimated_cost_usd REAL` column is written as `null` and never read for cost, yet AGENTS.md states dollars are never stored — the column invites confusion and could be dropped in a future migration. (Minor display note: the inspector "Tokens" field sums only input+output, excluding cache — likely intentional, but worth a label so it isn't read as total tokens.)

### 17. No CI runs `verify`

**Where:** absent `.github/workflows/`

_Third-pass finding._ The project defines a complete `npm run verify` (lint + typecheck + format + test + build) but nothing runs it on push; enforcement is manual. A minimal Actions workflow mirroring `verify` would lock in the quality bar cheaply — e.g. the LIKE-escape bug in #1 would be caught by a one-line query test in CI.

---

## What holds up well

- **Security:** every query is parameterized (the only SQL interpolations are compile-time constants and generated `?` lists); React escapes all provider-derived text; dev/start bind 127.0.0.1; the unauthenticated `POST /api/sync` only triggers an idempotent local scan and returns counts.
- **Privacy boundary:** adapters persist only tool _names_, truncated titles, and token/cost numbers. Every `contentText` call path was traced; response bodies never reach the DB, and tests assert it with `PRIVATE_RESPONSE_BODY` sentinels.
- **Collector correctness:** the lease upsert (owner-or-expired guard) is the right pattern, tested for takeover, contention, and in-process run sharing; fingerprint skipping, error-recovery cleanup, and the watcher's `awaitWriteFinish` are covered by integration tests against a temp DB.
- **Usage & cost design:** the never-store-dollars / all-or-nothing pricing rule is enforced consistently from adapter to UI; provider-reported costs (Pi) win over table estimates and are labeled as such.
- **Adapter assumptions match reality:** across the last 30 local Claude sessions, repeated message ids always carry identical usage (943 repeats, 0 differing), so first-occurrence dedup is safe; the `terminalStatus` heuristic read 24/25 idle sessions as completed (the exception genuinely ended on an unanswered user message → `incomplete`, correct); Pi's real usage records match the adapter's field shapes.
- **Pricing accuracy:** Anthropic _input/output_ rates ($10/$50 Fable 5, $5/$25 Opus 4.8, $1/$5 Haiku 4.5) and the Sonnet 5 introductory window ($2/$10 through 2026-08-31, then $3/$15) match the live models page; the Anthropic _cache_ rates can't be confirmed from that page (see #15). OpenAI _input/output/cache-read_ rates for gpt-5.5/5.6-sol/5.4/5.4-mini match the live pricing page, but gpt-5.6-sol's cache-write rate does not — see #4. Z.ai `glm-5.2` rates ($1.4/$4.4/$0.26 cache-read, no cache-write premium) match the live page. (gpt-5-mini is delisted there; the dated `effectiveFrom` handles it correctly.)
- **Schema discipline:** the bootstrap SQL in `src/db/client.ts` matches `src/db/schema.ts` table-for-table, including `session_model_usage`, as AGENTS.md requires.
- **Scale:** whole-file re-parse per change is a non-issue at current volumes (largest source file ~9MB).

## Verification performed

- `npm run verify` — lint, typecheck, format check, **50/50 tests**, production build: all green.
- LIKE bug reproduced directly against SQLite with the exact escaping code; `ESCAPE '\'` fixes both test cases.
- Junk-title cause confirmed in two real Codex rollout files; live DB currently shows 182 sources, 0 parse errors.
- Real-data surveys: model strings across Claude/Codex/Pi/ZCode session files; Claude message-id usage-dedup analysis; ZCode subagent transcript ids.
- Pricing sources fetched live (Anthropic models overview, OpenAI pricing page, Z.ai pricing page) and cross-checked rate-by-rate against `src/lib/pricing.ts`; the gpt-5.6-sol cache-write discrepancy (#4) and the Anthropic cache-rate sourcing gap (#15) were found here.
- Browser verification of all five pages against live data (desktop + mobile viewports): `/usage` cards/chart/meters render correctly, session inspector shows cost with source labels ("$0.06 · Reported" on a Pi session), the new Incomplete status filter works end to end, no console errors. Mobile horizontal overflow exists but predates the reviewed changes (present on Overview too).

## Recommended order of work

1. **P1 #1** — one-line SQL fix per `LIKE` clause plus input backslash escaping; add a query test with `_`/`%` searches.
2. **P2 #4** — set `gpt-5.6-sol` `cacheWritePerMTok` to `6.25` and fix the header comment; retroactively corrects all gpt-5.6-sol cost estimates.
3. **P2 #2** — regex + test case, before dated Anthropic ids start appearing in sources.
4. **P2 #3** — add the missing tag now; consider the structural title rule when convenient.
5. **P2 #5** — decide the by-model attribution intent and add a multi-model test.
6. P3s in any order; **#6** (overview links) and **#7** (stale usage rows) are the most user-visible.
