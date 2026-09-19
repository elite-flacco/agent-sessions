# UI conventions

Read before editing `src/components/`, page UI, or `src/app/globals.css`; treat every rule below as an invariant.

- Keep browsing filters URL-backed and use the shared sidebar.
- `router.refresh()` only rereads SQLite. Pages that must show fresh local activity must also call the shared throttled `refreshIngestedData()`; use `DASHBOARD_REFRESH_INTERVAL_MS` for polling and ingestion cadence.
- Use semantic tokens and component classes from `src/app/globals.css`. Component CSS lives there, not in co-located `*.module.css` files.
- Prefer Tailwind utilities backed by the semantic `@theme inline` tokens (e.g. `flex gap-2`, `text-muted-foreground`) for trivial one-off spacing and layout. Add a `globals.css` class when the styling has states, breakpoints, pseudo-elements, or more than one consumer.
- For the heatmap, use the quantized `heat-fill-N` classes. Meter and sparkline fills are derived inline from `level()` in `src/lib/format.ts`.
- Verify visible behavior in a browser at relevant desktop and mobile widths.
