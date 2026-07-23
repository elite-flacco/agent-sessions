@AGENTS.md

## Capability usage insights

`session_capability_usage` is the privacy-safe normalized boundary for observed skill and MCP usage. Claude and Zcode use native `Skill` calls, Codex and Pi require exact live-inventory matches for `SKILL.md` reads, and namespaced MCP calls roll up to server names. Relay stores only session/provider identity, capability kind and canonical name, a stable event identifier, and timestamp — never prompts, arguments, results, contents, credentials, or raw configuration. Extraction changes must increment `NORMALIZATION_VERSION` so a full collection backfills unchanged sources. `getInsights(range, inventories)` combines persisted observations with live active inventory and provider coverage; providers with incomplete coverage are excluded from unused conclusions. Plugin activity remains outside this feature.
