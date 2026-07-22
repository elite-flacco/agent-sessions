# Relay

Relay is a private, local-only operations dashboard for coding-agent sessions. It indexes metadata and sanitized activity from Codex, Claude Code, Zcode, and Pi into SQLite. Detailed session pages read messages and tool payloads from local provider storage on demand without copying them into Relay's database.

## Requirements

- Node.js 20 or newer
- Local session histories from one or more supported agents

## Run locally

```bash
npm install
npm run db:migrate
npm run collect
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Relay refreshes dashboard data and checks for changed local source files every 5 seconds. Use **Sync activity** for an immediate refresh, or run `npm run collect` again to import changes from the command line.

For continuous collection in a second terminal:

```bash
npm run collect:watch
```

Only one watcher can ingest at a time: a durable lease in the database makes a second `collect:watch` process exit with a message instead of double-importing.

## Pages

| Route            | What it shows                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`              | Overview — daily/weekly summaries, running and needs-attention sessions, and a patterns section (day-by-time-of-day heatmap over the actual last 30 Eastern-time days, session-length histogram, week cost-at-a-glance). Cards link into filtered views.                                                                                                                                                                                            |
| `/sessions`      | Shared summary cards and URL-backed search/provider/project/status/date filters with switchable Sessions and Projects tables. Sessions sort by last update by default and show both started and updated timestamps. While open, it ingests changed local source files and refreshes every 5 seconds. Subagent runs are nested beneath their main session. Session titles open a dedicated detail page, and the adjacent icon opens it in a new tab. |
| `/sessions/[id]` | A full-width session detail view with metadata, links between main and subagent sessions, and an on-demand transcript of user/assistant messages, tool arguments, and tool results. Common credential shapes are redacted; raw reasoning records are excluded.                                                                                                                                                                                      |
| `/projects`      | Redirects to the Projects view on `/sessions` for compatibility with old bookmarks.                                                                                                                                                                                                                                                                                                                                                                 |
| `/usage`         | Usage & cost — today/7-day/30-day cost and token totals, a 30-day daily cost strip, and breakdowns by model, agent, and project.                                                                                                                                                                                                                                                                                                                    |
| `/insights`      | Insights — actionable efficiency signals: a cache-effectiveness card (weighted cache hit rate, week-over-week delta, estimated dollars saved by caching, hit rate by model, 30-day trend) and a cost-outlier card (Pareto share of spend, the most expensive sessions with $/min, a concentration warning). All derived from already-collected usage; cache hit rate is always available, dollar figures follow the pricing-trust rule.             |
| `/agents`        | Agent setup — a live, read-only global inventory of plugins, skills, MCP servers, and instruction files for Codex, Claude Code, Zcode, and Pi. Compare opens a consensus-based Needs attention view, while Complete matrix preserves the full provider-by-provider inventory.                                                                                                                                                                       |

Session status is derived from provider lifecycle records. **Interrupted** is reserved for an explicit abort or cancellation marker. A session without a terminal marker is **Running** while its source is active and becomes **Incomplete** after 10 minutes without updates. A trailing user message with no assistant completion therefore becomes Incomplete rather than Interrupted. Zcode sessions with an unresolved `AskUserQuestion` tool are **Awaiting input** until the question is answered — this is the only "needs a human" state that means the session is waiting on you. A session that ends on a genuine error is **Failed**, labeled with the specific reason (e.g. _Failed · Usage limit_, _Failed · Network error_, _Failed · Execution failed_). Overview includes attention sessions — Awaiting input, Failed, and Interrupted — from today and the previous two local calendar days, avoiding rolling-window cutoffs within the three-day view.

Costs are **API-equivalent estimates**: tokens are priced against a checked-in table of public per-token rates (`src/lib/pricing.ts`, with effective dates and source URLs), because subscription plans don't bill per token. Pi sessions carry the provider's own recorded cost and show as **Reported**. A session whose model has no pricing entry shows **Unavailable** rather than a partial dollar figure; updating the pricing table re-prices history automatically because costs are computed at read time.

## Data sources

| Provider    | Local source                                                        |
| ----------- | ------------------------------------------------------------------- |
| Codex       | `~/.codex/sessions/**/*.jsonl` and `~/.codex/state_5.sqlite`        |
| Claude Code | `~/.claude/projects/**/*.jsonl`                                     |
| Zcode       | `~/.zcode/cli/rollout/*.jsonl` and `~/.zcode/cli/agents/**/*.jsonl` |
| Pi          | `~/.pi/agent/sessions/**/*.jsonl`                                   |

Relay stores its normalized database at `data/relay.db`. Override this with `RELAY_DATABASE_PATH=/absolute/path/relay.db`.

Relay prefers provider-authored display titles when they are available. Codex titles come from the read-only `threads.title` field in `~/.codex/state_5.sqlite`; Claude Code prefers the latest JSONL `custom-title`, then the latest `ai-title`. Both fall back to the first meaningful user message when an authoritative title is unavailable. A collection pass also reconciles Codex title-only changes that do not modify the rollout JSONL.

Zcode's rollout (`model_io`) files carry model usage but no working directory and incomplete conversation data, so Relay uses Zcode's own session database (`~/.zcode/cli/db/db.sqlite`, read-only) for authoritative titles, parent/subagent relationships, missing project/workspace metadata, user-input waits, database-only sessions, and on-demand transcripts. JSONL remains the transcript fallback when that database is unavailable. Codex parent thread metadata and Claude Code sidechain records provide the equivalent hierarchy for those providers.

## Agent setup sources

The **Agent setup** page reads global configuration live when `/agents` is
opened; it does not persist the inventory in Relay's database. This first
version is global-only. Project-level configuration is not included yet.

**Needs attention** evaluates every capability type across the three primary
agents (Pi stays contextual). **Fix** is reserved for genuinely broken state:
capabilities whose install files are missing on disk (unavailable), missing
global instructions, and skills.sh-managed skills absent from one agent —
skills.sh installs exist to be synced everywhere. Other partial installs and
configuration or content drift are **Review** items: skill drift compares
whitespace-normalized SKILL.md fingerprints, so identically named skills with
different content are flagged while line-ending differences are not.
Deliberately disabled capabilities count as present (drift, not a missing
install). The attention view also lists configuration warnings (malformed
sources, stale plugin cache versions, skills.sh lockfile entries with no
installed skill) and per-agent duplicate installs, distinguishing identical
redundant copies from same-name copies with different content. Capabilities
found on only one provider remain contextual in **Complete matrix** instead of
being treated as errors. These labels are read-only heuristics and never
modify agent configuration.

| Provider    | Global sources                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Codex       | `~/.codex/config.toml`, `~/.codex/skills`, configured plugin directories, and `~/.codex/AGENTS.md`                                         |
| Claude Code | `~/.claude/settings.json`, `~/.claude/plugins/installed_plugins.json`, `~/.claude/skills`, `~/.claude.json`, and `~/.claude/CLAUDE.md`     |
| Zcode       | `~/.zcode/cli/config.json`, `~/.zcode/cli/plugins/installed_plugins.json`, `~/.zcode/skills`, plugin directories, and `~/.zcode/AGENTS.md` |
| Pi          | `~/.pi/agent/settings.json`, `~/.pi/agent/extensions`, `~/.pi/agent/skills`, `~/.agents/skills`, and `~/.pi/agent/AGENTS.md`               |

Standalone skills installed by the skills.sh CLI are identified from
`~/.agents/.skill-lock.json`. Locally linked skills, skills contributed by
plugins, built-in skills, and unknown sources are labeled separately. Broken
skill links and plugins whose install directories are gone remain visible as
unavailable so the comparison can expose drift. Plugins missing from a
provider's enabled-plugins map read as **Installed** (state unknown) rather
than disabled; only an explicit disable reads as **Disabled**. Codex per-skill
disables (`[[skills.config]]` entries in `config.toml`) are applied on top of
the plugin's state, so individually disabled plugin skills read as Disabled
too. Disabled
capabilities appear only in the Compare view (where they distinguish a
deliberate disable from a missing install); the Inventory list and summary
counts show what is in effect. The Inventory list shows one provider at a
time (the summary cards act as a single-select provider control) and selects
capability Kind — Skills, Plugins, MCPs, plus Instructions when the provider
ships an instruction file — from a vertical rail on the left, so only one
kind's pane is visible at a time. Each pane nests capabilities as collapsible
Source groups (by origin — Personal, Marketplace, skills.sh, Built-in — open
by default, stating the provenance once), with the existing repo/plugin skill
grouping nested beneath; the Compare view remains a flat table.

The page allowlists display fields: capability name and type, enabled or
installed status, packaging, provenance, source repository, and safe local
paths. Global instruction Markdown is shown in full. MCP commands, arguments,
environment variables, credentials, and raw configuration blocks are never
returned to the page.

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

Each session stores only the path of its original local source file. When `/sessions/[id]` is opened, Relay reads provider storage on demand and normalizes supported user messages, assistant messages, tool arguments, and tool results for display. Most providers use the source JSONL; Zcode prefers its read-only `message` and `part` tables so sessions remain readable when rollout files are absent or contain only model-I/O telemetry. Common credential fields and recognizable token shapes are redacted, raw reasoning records are ignored, and large individual payloads are capped in the rendered view. Provider-injected context can still appear when a provider records it as part of a user or assistant message.
