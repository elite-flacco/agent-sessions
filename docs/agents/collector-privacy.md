# Collector and privacy invariants

Read before editing `src/collector/` (adapters, scans, reconciliation, watchers) or `src/lib/transcript.ts`; treat every rule below as an invariant.

- Adapters may return normalized metadata, never raw prompts, responses, reasoning, credentials, or tool arguments.
- Diff impact (`files_changed`, `additions`, `deletions`) is derived from edit tool calls through `fileEditStats`, which takes raw inputs and returns counts only. A file path is a tool argument, so paths size the changed-file set and are then discarded; the transcript boundary stays the only place a path is exposed. NULL means the provider exposed no edit calls to count, never that a session changed nothing.
- Zcode tool counts come from its message/part DB, not the rollout JSONL: the JSONL carries only a fraction of a session's calls (3 against 211 on one measured session).
- Do not persist detailed transcripts. Keep `sessions.source_path` server-side and read transcripts on demand through `src/lib/transcript.ts`; Zcode prefers its message/part DB and falls back to rollout JSONL.
- Apply shared credential redaction at the transcript boundary. Reasoning/thinking blocks are included there — redacted and rendered collapsed by default — while adapters and the collector still never persist them.
- Preserve normalized hierarchy fields: `parent_external_id`, `session_kind`, `agent_label`, and `agent_depth`. Traverse parent/child relationships within the same provider. `session_kind` distinguishes spawned sub-agent runs (`subagent`) from conversations the agent itself created, such as Codex `create_thread` delegations (`thread`); both nest and roll up as delegated children.
- Prefer provider-authored titles. Codex titles come from its state DB; Claude prefers `custom-title`, then `ai-title`; Zcode metadata is reconciled from its DB. Keep existing fallbacks for missing titles.
- Zcode's DB supplies authoritative metadata, database-only sessions, capability evidence, model, and usage when available. It reconciles status too, except explicit rollout interruption evidence wins over a DB-derived nonterminal status. Rollout JSONL is the fallback; branch remains JSONL-derived.
- Keep ingestion idempotent. Full scans and watchers must use collector leases; per-adapter scan state belongs in `adapter_scans`.
- Increment `NORMALIZATION_VERSION` whenever parsing, normalization, or extraction semantics change so unchanged source files are reprocessed.
