# Agent Setup Attention View Design

## Goal

Make the Agent setup comparison answer “what may need fixing?” without removing
the complete capability matrix. The first iteration uses transparent consensus
rules across Codex, Claude Code, Zcode, and Pi so the result can be refined from
real usage.

## Scope

This change affects only comparison derivation and presentation. It does not
change provider discovery, inventory persistence, configuration files, or the
existing privacy boundary. Plugins, skills, MCPs, and global instructions are
all evaluated.

## Comparison modes

The Compare surface has two explicit modes:

- **Needs attention** is the destination of the primary Compare tab and shows
  only rows assessed as `fix` or `review`.
- **Complete matrix** preserves the full union of capabilities across all four
  providers.

The mode is URL-backed. The primary Compare link uses
`view=compare&comparison=attention`; Complete matrix uses `view=compare` so
existing complete-matrix bookmarks retain their meaning. The legacy
`discrepancies=1` URL continues to show the original broad discrepancy filter.

## Assessment model

`buildComparisonRows` derives an assessment and concise reason for every row:

- **Fix**
  - a discovered capability is `unavailable`;
  - a global instruction file is missing; or
  - a capability exists on three providers and is missing from the fourth.
- **Review**
  - capability presence is split two-to-two;
  - a capability present on multiple providers differs by status, packaging,
    origin, or source repository; or
  - global instruction contents differ.
- **Context**
  - a capability exists on only one provider; or
  - the row is consistent and requires no action.

Rules are evaluated in severity order, so an unavailable capability remains a
Fix even when another rule would classify the row as Review or Context. Each
assessment includes a stable reason code for tests and a short UI label. The
UI does not infer severity itself.

This is intentionally a heuristic, not an assertion that providers should be
identical. Provider-specific capabilities remain visible in Complete matrix
but do not flood Needs attention.

## Presentation

Compare adds a compact secondary switcher for **Needs attention** and
**Complete matrix** plus a summary showing Fix and Review counts. Needs
attention is ordered by severity, then capability type and name. Each row shows
its assessment badge and reason beside the capability metadata.

The matrix reduces disclosure density:

- rows whose populated capability cells have the same status, packaging,
  origin, and source repository across all four providers render one compact
  “All agents” summary spanning the provider columns;
- divergent rows keep their provider columns, but only cells with meaningful
  provenance details are expandable;
- missing cells remain plain status markers;
- instruction cells remain expandable because their safe Markdown content is
  the comparison detail.

The existing sticky capability column, horizontal scrolling, semantic table,
and privacy-safe details remain intact.

## Empty and edge states

If Needs attention has no matching rows, show a positive empty state explaining
that no consensus drift was found and link to Complete matrix. Filters continue
to apply before the mode assessment. Provider filtering does not recalculate
consensus; assessment always uses all discovered providers so changing a
display filter cannot change the meaning of Fix or Review.

## Testing and verification

Unit tests cover every severity rule, precedence, stable reasons, and existing
discrepancy behavior. Component tests cover mode parsing and URLs, actionable
filtering and ordering, summary counts, the no-attention state, legacy
discrepancy URLs, compact unanimous rows, and divergent disclosures.

Completion requires the repository’s full verification suite plus browser
checks of both comparison modes at desktop and mobile widths, keyboard focus,
horizontal scrolling, filters, empty state, and browser console errors.

## Documentation

Update `README.md` with the two comparison modes and consensus heuristic. Update
`AGENTS.md` and `CLAUDE.md` only if implementation introduces a durable
architecture or convention beyond the comparison assessment described here.
