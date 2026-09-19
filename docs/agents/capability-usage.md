# Capability usage invariants

Read before editing capability-usage extraction in the collector or capability views in `src/lib/queries.ts`; treat every rule below as an invariant.

- `session_capability_usage` is the privacy-safe boundary for observed skill and MCP use. Persist only session/provider identity, kind, canonical name, stable event ID, valid timestamp, and optional validated MCP tool and explicit plugin identifiers—never prompts, arguments, results, skill contents, credentials, raw config, or payload bodies.
- MCP display labels are presentation-only; preserve canonical identities and counts. Codex plugin attribution requires a matching call ID, server, and tool in an explicit completion record; conflicting attribution stays unknown. Resolve plugin display names and descriptions from allowlisted live manifest fields, never a service-name map or runtime-name guess. Tool and plugin evidence follow the selected range; reprocess available logs for historical enrichment.
- Keep inference conservative: Claude and Zcode use native skill calls; Codex and Pi require exact active-inventory matches for `SKILL.md` reads; MCP aliases must be exact and collision-free. Plugin adoption counts are outside this feature.
- Plugin display metadata does not create plugin usage or adoption counts. Observed usage remains reportable regardless of inventory coverage. Adoption and unused conclusions include only active installations from providers with complete scan coverage.
- Zcode coverage is complete only after every required authoritative DB query succeeds. On failure, mark coverage partial and preserve prior rollout evidence until a later successful reconciliation.
