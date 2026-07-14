# Relay

Relay is a private, local-only operations dashboard for coding-agent sessions. It indexes metadata and sanitized activity from Codex, Claude Code, Zcode, and Pi into SQLite. Detailed session pages can read messages and tool payloads directly from the original local JSONL file without copying them into Relay's database.

## Requirements

- Node.js 20 or newer
- Local session histories from one or more supported agents

## Run locally

```bash
npm install
npm run collect
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Use **Sync activity** in the app or run `npm run collect` again to import changed files.

For continuous collection in a second terminal:

```bash
npm run collect:watch
```

Only one watcher can ingest at a time: a durable lease in the database makes a second `collect:watch` process exit with a message instead of double-importing.

## Pages

| Route            | What it shows                                                                                                                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`              | Overview — daily/weekly summaries, running and needs-attention sessions, weekly agent distribution, 14-day activity, recent projects. Cards link into filtered views.                                                                                               |
| `/sessions`      | Shared summary cards and URL-backed search/provider/status/date filters with switchable Sessions and Projects tables. Project rollups reflect the active session filters. Session titles open a dedicated detail page, and the adjacent icon opens it in a new tab. |
| `/sessions/[id]` | A full-width session detail view with metadata and an on-demand transcript of user/assistant messages, tool arguments, and tool results. Common credential shapes are redacted; raw reasoning records are excluded.                                                 |
| `/projects`      | Redirects to the Projects view on `/sessions` for compatibility with old bookmarks.                                                                                                                                                                                 |
| `/usage`         | Usage & cost — today/7-day/30-day cost and token totals, a 30-day daily cost strip, and breakdowns by model, agent, and project.                                                                                                                                    |

Session status is derived from provider lifecycle records. **Interrupted** is reserved for an explicit abort or cancellation marker. A session without a terminal marker is **Running** while its source is active and becomes **Incomplete** after 10 minutes without updates. A trailing user message with no assistant completion therefore becomes Incomplete rather than Interrupted.

Costs are **API-equivalent estimates**: tokens are priced against a checked-in table of public per-token rates (`src/lib/pricing.ts`, with effective dates and source URLs), because subscription plans don't bill per token. Pi sessions carry the provider's own recorded cost and show as **Reported**. A session whose model has no pricing entry shows **Unavailable** rather than a partial dollar figure; updating the pricing table re-prices history automatically because costs are computed at read time.

## Data sources

| Provider    | Local source                                                        |
| ----------- | ------------------------------------------------------------------- |
| Codex       | `~/.codex/sessions/**/*.jsonl`                                      |
| Claude Code | `~/.claude/projects/**/*.jsonl`                                     |
| Zcode       | `~/.zcode/cli/rollout/*.jsonl` and `~/.zcode/cli/agents/**/*.jsonl` |
| Pi          | `~/.pi/agent/sessions/**/*.jsonl`                                   |

Relay stores its normalized database at `data/relay.db`. Override this with `RELAY_DATABASE_PATH=/absolute/path/relay.db`.

Zcode's rollout (`model_io`) files carry model usage but no working directory, so Relay resolves each Zcode session's project/workspace from Zcode's own session database (`~/.zcode/cli/db/db.sqlite`, read-only) and falls back to "Unknown workspace" only when a session id isn't found there.

## Commands

- `npm run dev` — start the loopback-only development server
- `npm run build && npm start` — build and run the production server
- `npm run collect` — incrementally import changed local files once
- `npm run collect:watch` — import once and watch existing sources for changes
- `npm run db:generate` — generate a versioned migration after schema changes
- `npm run db:migrate` — apply generated migrations
- `npm run verify` — lint, typecheck, formatting, tests, and production build

## Privacy boundary

The adapters derive short task titles, workspace metadata, timestamps, model/usage summaries when trustworthy, and sanitized activity labels such as tool names. Raw assistant responses, full transcripts, reasoning, credentials, and tool arguments are not written to Relay's database.

Each session stores only the path of its original local source file. When `/sessions/[id]` is opened, Relay reads that JSONL file on demand and normalizes supported user messages, assistant messages, tool arguments, and tool results for display. Common credential fields and recognizable token shapes are redacted, raw reasoning records are ignored, and large individual payloads are capped in the rendered view. Provider-injected context can still appear when a provider records it as part of a user or assistant message.
