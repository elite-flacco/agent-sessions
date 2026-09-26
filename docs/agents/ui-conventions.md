# UI conventions

Read before editing `src/components/`, page UI, or `src/app/globals.css`; treat every rule below as an invariant.

- Keep browsing filters URL-backed and use the shared sidebar.
- `router.refresh()` only rereads SQLite. Pages that must show fresh local activity must also call the shared throttled `refreshIngestedData()`; use `DASHBOARD_REFRESH_INTERVAL_MS` for polling and ingestion cadence.
- Use semantic tokens and component classes from `src/app/globals.css`. Component CSS lives there, not in co-located `*.module.css` files.
- Prefer Tailwind utilities backed by the semantic `@theme inline` tokens (e.g. `flex gap-2`, `text-muted-foreground`) for trivial one-off spacing and layout. Add a `globals.css` class when the styling has states, breakpoints, pseudo-elements, or more than one consumer.
- Session duration is reported as working time from `src/lib/trajectory.ts`, never raw start-to-end wall clock; inactivity is shown as an explicit idle gap. Reporting a stalled session's span as work time restates the inactivity-is-not-interruption rule wrongly. A sub-threshold pause between a finished turn (last entry an assistant reply) and the next user message is waiting on the user, not work: it is excluded from working time and drawn as a hatched wait band in the activity ribbon.
- The session log hangs each turn off a gutter: `.transcript-turn`'s padding, its `::before` spine, and the `.transcript-message > header::before` nodes all read `--turn-gutter` and `--turn-space-before` / `--turn-space-after`. Change the tokens, not the individual offsets, or the spine and its nodes drift apart.
- Rank in the log is: turn label (`--text-sm`, 600, `--foreground`) > message prose (`--foreground`) > author labels, tool-group headers, thoughts, and meta (`--text-xs`, muted; mono for machinery). Turns own the chevron-and-weight treatment; tool groups and thoughts must stay visually subordinate to it.
- For the heatmap, use the quantized `heat-fill-N` classes. Meter and sparkline fills are derived inline from `level()` in `src/lib/format.ts`.
- Verify visible behavior in a browser at relevant desktop and mobile widths.
