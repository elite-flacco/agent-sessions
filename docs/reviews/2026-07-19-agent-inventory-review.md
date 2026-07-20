# Agent inventory discovery & attention-flagging review — 2026-07-19

Review of `src/lib/agent-inventory/` (discovery, metadata extraction, status
identification for Codex, Claude Code, Zcode, Pi) and the Needs Attention
logic, followed by fixes for everything found. All changes are covered by
tests written first (TDD).

## Findings and fixes

1. **Absent-from-enabledPlugins conflated with disabled (fixed).** Claude and
   Zcode registry plugins missing from `enabledPlugins` were marked
   `disabled` and then filtered out of the inventory entirely — an installed
   plugin with no enabled-state entry silently disappeared. Now absence reads
   as `installed` (state unknown, matching the cache-walker semantics) and
   only an explicit `false` reads as `disabled`.

2. **Disabled capabilities hidden from comparison (fixed).** Filtering
   disabled capabilities out of `getAgentInventories` made "deliberately
   disabled on X" indistinguishable from "never installed on X", so deliberate
   disables were flagged as missing-install Fixes. Disabled capabilities are
   now retained end-to-end, render with their Disabled badge, count as present
   in the comparison (drift → Review), and get their own status filter option.

3. **Registered-but-gone plugins reported healthy (fixed).** A plugin whose
   config entry survives but whose install directory was deleted showed as
   `enabled`. `pluginStatusWithPresence` now lstat-checks install paths for
   all three plugin providers; missing files → `unavailable` → Fix. Broken
   skill symlinks are always `unavailable`, even inside an enabled plugin.

4. **Lexicographic version sort (fixed).** Plugin cache version directories
   were sorted as strings, so `10.0.0` lost to `9.0.0` and a stale copy was
   surfaced as active. `compareVersionDirs` sorts numerically per segment.

5. **Parsing robustness (fixed).** `enabled = false # comment` in Codex
   config.toml was read as enabled (regex required end-of-line); bare
   `.mcp.json` maps could turn scalar keys (`version`, notes) into phantom
   MCP capabilities. Both guarded.

6. **Missing-from-one-provider was always a Fix (rebalanced).** Partial
   presence of a personal MCP or marketplace plugin is often deliberate. Fix
   is now reserved for skills.sh-origin capabilities (cross-agent sync is
   their premise); everything else demotes to Review.

7. **Structural status noise in drift detection (fixed).** `installed` vs
   `enabled` (standalone vs plugin-contributed) drifted forever despite being
   the same "active" state. The assessment signature normalizes them; for
   skills it also drops packaging and compares a whitespace-normalized
   SKILL.md `contentFingerprint` instead — flagging same-name/different-content
   skills (real behavior drift) while ignoring line-ending noise. Instruction
   fingerprints are normalized the same way. The Complete-matrix collapsed
   cell still requires literal uniformity across all four providers.

8. **Pi absence polluted discrepancy highlighting (fixed).** `isDiscrepancy`
   is now computed over the three primary providers only, matching the
   assessment's scoping.

9. **Duplicates were detected but never rendered (wired).**
   `findComparisonDuplicates` now feeds a "Duplicate installs" section in
   Needs Attention, ignores disabled/unavailable copies, and distinguishes
   identical redundant copies ("safe to remove one") from same-name copies
   with different content (shadowing — pick a winner).

10. **Missing stale-artifact signals (added).** New `stale` warning code:
    multiple cached plugin versions on disk (Codex + Zcode caches) and
    skills.sh lockfile entries with no installed skill anywhere.

11. **Warnings never reached the attention view (added).** Needs Attention now
    leads with a deduplicated "Configuration warnings" card — a malformed
    config.toml undermines the whole inventory and outranks any per-row item.

## Decisions of note

- Retaining disabled capabilities reverses an earlier documented decision
  ("dashboard surfaces only active capabilities"). The old behavior was the
  root cause of both silent hiding (finding 1) and wrong Fix advice
  (finding 2); the privacy boundary is unaffected since only names/paths are
  ever collected.
- `isUniformAcrossProviders` deliberately keeps its all-four-providers,
  raw-signature semantics: the collapsed matrix cell renders one literal
  status, so it must only merge literally identical cells.
- Disabled plugins with missing files stay `disabled` (not `unavailable`):
  missing files for something the user turned off are not worth flagging.
