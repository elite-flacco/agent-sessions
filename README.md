# Relay

Relay is a private, local-only operations dashboard for coding-agent sessions. It indexes metadata and sanitized activity from Codex, Claude Code, Zcode, and Pi into SQLite without retaining full prompts, responses, reasoning, credentials, or tool payload bodies.

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

## Data sources

| Provider    | Local source                                                        |
| ----------- | ------------------------------------------------------------------- |
| Codex       | `~/.codex/sessions/**/*.jsonl`                                      |
| Claude Code | `~/.claude/projects/**/*.jsonl`                                     |
| Zcode       | `~/.zcode/cli/rollout/*.jsonl` and `~/.zcode/cli/agents/**/*.jsonl` |
| Pi          | `~/.pi/agent/sessions/**/*.jsonl`                                   |

Relay stores its normalized database at `data/relay.db`. Override this with `RELAY_DATABASE_PATH=/absolute/path/relay.db`.

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
