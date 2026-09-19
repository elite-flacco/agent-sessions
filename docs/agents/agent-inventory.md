# Agent inventory invariants

Read before editing `src/lib/agent-inventory/`; treat every rule below as an invariant.

- Discovery is global, live, read-only, allowlist-based, and separate from session collection.
- Return only safe metadata: names, status, packaging, provenance, repositories, safe paths, warnings, redacted public plugin display names and descriptions, and global instruction Markdown. Never expose MCP commands, arguments, environment variables, credentials, or raw config.
- Scheduled-task readers are the sole exception: they may show the user-authored instruction body verbatim. A secret pasted into a prompt or script will therefore render; do not extend this exception to other capability types.
- Zcode scheduled tasks come from the v2 automations store (`~/.zcode/v2/tasks-index.sqlite` `automations` table — the CronCreate/CronList backing store), with the legacy `workflow_definition` table kept as a fallback. Surface only display-safe columns; `last_error`, `bot_delivery_target`, `target_task_id`, and `workspace_identity` stay out of the inventory. `enabled=0` reads as paused; lifecycle `completed` is its own status.
- Retain disabled capabilities in normalized inventories for comparison, even when inventory lists hide them. Only explicit `false` means disabled; absence from an enabled map means installed with unknown enabled state.
- Treat missing install paths and broken skill links as unavailable.
- Compare all primary providers; Pi is contextual. Do not provider-filter the comparison matrix. Unavailable items are Fixes; a two-of-three gap is a Fix only for skills.sh capabilities and a Review otherwise; one-provider items are Context.
- Skill content drift compares whitespace-normalized `SKILL.md` fingerprints. Skill configuration drift covers status/origin; non-skill configuration drift also covers packaging.
- Surface deduplicated discovery warnings and active same-provider duplicate installs. For scheduled-task directory formats, enumerate directories only; mark Codex targets orphaned only when its project map was read successfully.
- Keep `{ kind: "global" }` explicit at the public discovery boundary.
