# Agentarium

Agentarium is a private, local-only operations dashboard for coding-agent sessions. It indexes metadata and sanitized activity from Codex, Claude Code, Zcode, and Pi into a local SQLite database. Detailed session pages read messages and tool payloads from local provider storage on demand — nothing is copied into Agentarium's database.

## Requirements

- Node.js 20.9 or newer
- Local session histories from one or more supported agents

## Run locally

One-time setup after cloning:

```bash
npm ci
npm run db:migrate
npm run collect
```

Then, whenever you want to use the dashboard:

```bash
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Agentarium refreshes dashboard data and checks for changed local source files every 5 seconds while a page is open, so the setup commands do not need to be repeated. Use **Sync activity** for an immediate refresh, or run `npm run collect` again to import changes from the command line. `npm ci` installs exactly the versions pinned in `package-lock.json` (`npm install` also works, but may update the lockfile); re-run it only after pulling dependency changes, and re-run `npm run db:migrate` after pulling commits that add migrations in `drizzle/`.

Optional: to keep collecting even when no dashboard page is open, run a watcher in a second terminal:

```bash
npm run collect:watch
```

Only one watcher can ingest at a time: a durable lease in the database makes a second `collect:watch` process exit with a message instead of double-importing.

## Pages

Overview, Sessions, Usage & Cost, Insights, and project briefings share a **7-day / 30-day / all-time** range toggle in the header that scopes that page's metrics to the same window.

### `/` — Overview

- Daily and weekly summaries, plus running, needs-attention, and recent-project cards; cards link into matching filtered views.
- A patterns section: a day × time-of-day activity heatmap, a session-length histogram, and cost-at-a-glance. The histogram and cost card follow the selected range; the heatmap always shows the previous 30 days.
- "Today", "running now", "needs attention", and "recent projects" stay range-independent.

### `/sessions` — Sessions

- Shared summary cards, URL-backed search, and provider/project/model/status filters, with switchable Sessions and Projects tables.
- Runs sort by last update, show started and updated timestamps, and nest subagent runs beneath their main session. Titles open the detail page.
- Each run shows its model as one canonical name (snapshot and prefix variants grouped into one name); the model filter narrows by that name, with an "(unknown)" option for runs whose model wasn't recorded.
- While open, the page ingests changed source files and refreshes every 5 seconds. The Overview's Sessions-today card links here with a contextual Today drilldown.

### `/sessions/[id]` — Session detail

- Full-width view with session metadata and links between main and subagent sessions.
- An on-demand transcript of user/assistant messages, tool arguments, and tool results, read straight from provider storage (see [Privacy boundary](#privacy-boundary)).

### `/projects` — Projects

- Repository-backed workspaces built from local Git evidence, showing session counts, runtime, API-equivalent total cost, pricing exclusions, and the agents that worked in each.
- Cards link to the GitHub repository when every observed worktree agrees on one origin.
- Selecting a project opens a briefing — headline metrics, daily spend sparkline, per-agent session and cost split, activity feed, and evidence list — all scoped by the range toggle; the worktree context is always all-time.
- The activity feed shows the newest retained lifecycle event per session.
- Costs follow the usage-page rules with each session counted once, so delegated subagent spend is not double-counted. The evidence list can be filtered to sessions needing attention.

### `/usage` — Usage & cost

- Cost, token, session, and cache-read metrics; daily cost history; and breakdowns by model, agent, and project — all scoped by the range toggle.
- All-time begins at the earliest locally recorded usage date.

### `/insights` — Insights

- Jump-linked KPI tiles for cost, cache hit rate, and capability adoption.
- Cache avoided-spend estimates, hit rate by model, cost concentration, and expensive sessions with their share of the period total.
- Capability adoption tabs — Skills, MCPs, Not observed, By provider — independently URL-backed.
- "Not observed" judges only available local history: providers with incomplete source coverage are excluded, and Zcode stays incomplete until its latest capability reconciliation succeeds.
- Cache hit rate is always available; dollar figures follow the pricing-trust rule.

### `/agents` — Agent setup

- A live, read-only global inventory of plugins, skills, MCP servers, and instruction files for Codex, Claude Code, Zcode, and Pi.
- **Inventory**: a per-provider catalog with provider and Kind rails, search/source/status filters, source-grouped skills, expandable plugin parents, and safe selected-item details.
- **Compare**: the consensus Needs-attention view plus the full provider-by-provider matrix.
- **Scheduled tasks**: a schedule-first table of recurring jobs from Codex automations, Claude scheduled-task directories, and Zcode workflow definitions, sorted by cadence and flagging tasks whose target project the agent no longer lists.

Rules and interpretation details: [Agent setup](#agent-setup).

## Session statuses

Statuses come from provider lifecycle records, never guessed from inactivity alone.

| Status         | Meaning                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| Completed      | Explicit completion evidence.                                                                                      |
| Running        | Unfinished and updated within the last 10 minutes.                                                                 |
| Incomplete     | Unfinished and stale — no updates for 10 minutes. A trailing user message with no assistant completion lands here. |
| Interrupted    | An explicit abort or cancellation marker — nothing less.                                                           |
| Awaiting input | An unresolved Zcode `AskUserQuestion`; the session is waiting on you.                                              |
| Failed         | A genuine error, labeled with its reason — e.g. _Failed · Usage limit_, _Failed · Network error_.                  |

The Overview includes attention sessions — Awaiting input, Failed, and Interrupted — from today and the two previous calendar days.

## Costs

Costs are **API-equivalent estimates**; subscription plans don't bill per token.

- Tokens are priced against a checked-in table of public per-token rates (`src/lib/pricing.ts`, with effective dates and source URLs). Pi sessions instead carry the provider's own recorded cost, shown as **Reported**.
- A model with no pricing entry shows **Unavailable** rather than a partial dollar figure. Costs are computed at read time, so updating the pricing table re-prices history automatically.
- When Zcode's session database is available, its model and usage records are authoritative — because Zcode prunes its rollout logs, these figures can exceed earlier rollout-only imports.

Subagent rollups:

- A session's cost includes every subagent it spawned, at any depth. Detail pages break that out as _main_ vs. _subagents_, and each nested subagent row shows its own subtree total.
- One unpriced model anywhere in the tree makes the whole total unavailable — a main session can read **Unavailable** even when its own usage is priced.
- Dollar totals on `/usage`, the overview cost card, and the Insights period total count each session once, so subagents are never double-counted. The Insights expensive-session list credits a subtree to its topmost in-window session, so heavily delegating sessions appear once with their whole tree's spend instead of crowding the list.

## Data sources

| Provider    | Local source                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------- |
| Codex       | `~/.codex/sessions/**/*.jsonl` and `~/.codex/state_5.sqlite` (or `~/.codex/sqlite/state_5.sqlite`)                  |
| Claude Code | `~/.claude/projects/**/*.jsonl`                                                                                     |
| Zcode       | `~/.zcode/cli/rollout/**/*.jsonl`, `~/.zcode/cli/agents/**/*.jsonl`, and `~/.zcode/cli/db/db.sqlite` when available |
| Pi          | `~/.pi/agent/sessions/**/*.jsonl`                                                                                   |

- Agentarium stores its normalized database at `data/agentarium.db`. Override with `AGENTARIUM_DATABASE_PATH=/absolute/path/agentarium.db`. The pre-rename `RELAY_DATABASE_PATH` variable and `data/relay.db` location are still honored, and a default-location `data/relay.db` is adopted (renamed) automatically on first run.
- Titles prefer provider-authored values: Codex titles come from the read-only `threads.title` field in its state database; Claude Code prefers the latest JSONL `custom-title`, then the latest `ai-title`; both fall back to the first meaningful user message. Collection passes also reconcile Codex title-only changes that don't touch the rollout JSONL.
- Zcode's rollout files carry model usage but no working directory and incomplete conversation data, so Agentarium uses Zcode's own session database (read-only) for authoritative titles, parent/subagent relationships, project metadata, user-input waits, database-only sessions, and on-demand transcripts. Rollout JSONL is the fallback. Codex parent-thread metadata and Claude sidechain records provide the equivalent hierarchy for those providers.

## Agent setup

The **Agent setup** page reads global configuration live when `/agents` is opened; it is never persisted in Agentarium's database. This first version is global-only — project-level configuration is not included yet.

**Needs attention** evaluates every capability type across the three primary agents (Pi stays contextual):

- **Fix** — genuinely broken state: install files missing on disk, missing global instructions, or skills.sh-managed skills absent from one agent (they exist to be synced everywhere).
- **Review** — other partial installs and configuration or content drift. Skill drift compares whitespace-normalized `SKILL.md` fingerprints, so identically named skills with different content are flagged while line-ending differences are not. Deliberately disabled capabilities count as present (drift, not a missing install).
- The attention view also lists configuration warnings — malformed sources, stale plugin cache versions, skills.sh lockfile entries with no installed skill — and per-agent duplicate installs, distinguishing identical redundant copies from same-name copies with different content.
- Capabilities found on only one provider remain contextual in **Complete matrix** instead of being treated as errors.
- These labels are read-only heuristics; Agentarium never modifies agent configuration.

| Provider    | Global sources                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Codex       | `~/.codex/config.toml`, `~/.codex/skills`, configured plugin directories, and `~/.codex/AGENTS.md`                                         |
| Claude Code | `~/.claude/settings.json`, `~/.claude/plugins/installed_plugins.json`, `~/.claude/skills`, `~/.claude.json`, and `~/.claude/CLAUDE.md`     |
| Zcode       | `~/.zcode/cli/config.json`, `~/.zcode/cli/plugins/installed_plugins.json`, `~/.zcode/skills`, plugin directories, and `~/.zcode/AGENTS.md` |
| Pi          | `~/.pi/agent/settings.json`, `~/.pi/agent/extensions`, `~/.pi/agent/skills`, `~/.agents/skills`, and `~/.pi/agent/AGENTS.md`               |

How the inventory is interpreted:

- Standalone skills installed by the skills.sh CLI are identified from `~/.agents/.skill-lock.json`; locally linked skills, plugin-contributed skills, built-ins, and unknown sources are labeled separately.
- Broken skill links and plugins whose install directories are gone remain visible as unavailable, so the comparison can expose drift.
- Plugins missing from a provider's enabled-plugins map read as **Installed** (state unknown) rather than disabled; only an explicit disable reads as **Disabled**. Codex per-skill disables (`[[skills.config]]` in `config.toml`) apply on top of the plugin's state.
- Disabled capabilities appear only in Compare, where a deliberate disable is distinguished from a missing install. The Inventory catalog and rail counts show what is in effect, one provider and one Kind at a time.
- Skills are grouped by management source — Standalone, Plugin-provided, Built-in, Marketplace, and Personal when present — each starting expanded and independently collapsible. Plugin-provided skills stay beneath a collapsible plugin parent even when only one skill matches, because the plugin is the installation unit.
- Selecting a row opens a focused inspector with parent-plugin and duplicate-install context; Compare remains a flat table.

The page allowlists display fields: capability name and type, enabled or installed status, packaging, provenance, source repository, and safe local paths. Global instruction Markdown is shown in full. MCP commands, arguments, environment variables, credentials, and raw configuration blocks are never returned.

## Commands

- `npm run dev` — start the loopback-only development server
- `npm run build && npm start` — build and run the production server
- `npm run collect` — incrementally import changed local files once
- `npm run collect:watch` — import once and watch existing sources for changes
- `npm run db:generate` — generate a versioned migration after schema changes
- `npm run db:migrate` — apply generated migrations
- `npm run verify` — lint, typecheck, formatting, tests, and production build

## Privacy boundary

- Adapters derive short task titles, workspace metadata, timestamps, trustworthy model/usage summaries, and sanitized activity labels such as tool names. Raw assistant responses, full transcripts, reasoning, credentials, and tool arguments are never written into Agentarium's database.
- Each session stores only the path of its original local source file. Opening `/sessions/[id]` reads provider storage on demand and normalizes user and assistant messages, tool arguments, and tool results for display. Zcode prefers its read-only `message` and `part` tables so sessions stay readable even when rollout files are absent.
- Common credential fields and recognizable token shapes are redacted, raw reasoning records are ignored, and large individual payloads are capped in the rendered view.
- Provider-injected context can still appear when a provider records it as part of a user or assistant message.
